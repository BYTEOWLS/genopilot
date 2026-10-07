import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

write_citation = load_script("write_citation")

WORKFLOWS_DIR = Path(__file__).resolve().parents[3] / "workflows"
COMMIT = "0123456789abcdef0123456789abcdef01234567"


def provenance(workflow_id: str, inputs: dict, configuration: dict, released: bool = True, modified: bool = False) -> dict:
    genopilot = {
        "version": "1.2.3",
        "build": {"commit": COMMIT, "committed_at": "2026-10-07T06:30:00.000Z", "modified": modified, "released": released},
    }
    return {
        "workflow": {"id": workflow_id, "version": 1},
        "genopilot": genopilot,
        "effective_configuration": {"workflow_id": workflow_id, "genopilot": genopilot, "inputs": inputs, **configuration},
        "tool_versions": {
            "configured": {"ncbi-datasets-cli": "18.38.0", "parasail-python": "1.3.4", "htslib": "1.24"},
            "observed": {
                "snakemake": {"version": "9.27.0", "source": "workflow-runtime"},
                "lifton": {"version": "1.0.14", "source": "installed-package"},
                "parasail": {"status": "unavailable", "reason": "package metadata not found"},
                "minimap2": {"version": "2.31-r1215", "source": "executable"},
                "miniprot": {"version": "0.18-r281", "source": "executable"},
                "fastp": {"version": "1.3.7"},
                "bwa": {"version": "0.7.19-r1273"},
                "samtools": {"version": "1.24"},
                "bcftools": {"version": "1.24"},
            },
        },
    }


TRANSFER_CONFIGURATION = {
    "lifton": {"profile": "same-species"},
    "review": {"minimum_protein_identity": 99},
    "resources": {"cpu_mode": "automatic", "effective_cpus": 4},
}
LOCAL_TRANSFER_INPUTS = {
    "reference": {"source": "local", "fasta": "/inputs/reference.fasta", "gff3": "/inputs/reference.gff3"},
    "target": {"source": "local", "fasta": "/inputs/target.fasta"},
}
CONSENSUS_CONFIGURATION = {
    "calling": {"ploidy": 1, "min_depth": 10, "min_mapping_quality": 20, "min_base_quality": 20, "min_allele_fraction": 0.8},
    "consensus": {"include_backbone_vote": True, "voting_method": "strict-majority", "min_callable_isolates": 0, "unresolved_snp": "n"},
}


class WriteCitationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp_dir = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, workflow_id: str, record: dict) -> tuple[str, str, str]:
        provenance_path = self.temp_dir / "run.json"
        provenance_path.write_text(json.dumps(record), encoding="utf-8")
        citation_dir = WORKFLOWS_DIR / workflow_id / "citation"
        output = self.temp_dir / "citation"
        write_citation.main([
            "--provenance", str(provenance_path),
            "--references", str(citation_dir / "references.json"),
            "--methods", str(citation_dir / "methods.txt"),
            "--phrases", str(citation_dir / "phrases.json"),
            "--genopilot", str(WORKFLOWS_DIR / "shared" / "citation" / "genopilot.json"),
            "--markdown", str(output / "CITATION.md"),
            "--bibtex", str(output / "references.bib"),
            "--ris", str(output / "references.ris"),
        ])
        return tuple((output / name).read_text(encoding="utf-8") for name in ("CITATION.md", "references.bib", "references.ris"))

    def test_every_packaged_methods_template_is_filled(self) -> None:
        for workflow_id, inputs, configuration in [
            ("annotation-transfer", LOCAL_TRANSFER_INPUTS, TRANSFER_CONFIGURATION),
            ("reference-consensus",
             {"backbone": {"source": "ncbi", "accession": "GCF_000149205.2"}, "selected_isolates": ["a", "b", "c"]},
             CONSENSUS_CONFIGURATION),
        ]:
            with self.subTest(workflow_id):
                markdown, _, _ = self.write(workflow_id, provenance(workflow_id, inputs, configuration))
                methods = markdown.split("## Methods\n\n", 1)[1].split("\n\n", 1)[0]
                self.assertNotIn("$", methods)
                self.assertNotIn("{}", methods)
                self.assertIn("GenoPilot 1.2.3", methods)

    def test_cites_the_tools_that_ran_with_their_observed_versions(self) -> None:
        markdown, bibtex, ris = self.write("annotation-transfer", provenance("annotation-transfer", LOCAL_TRANSFER_INPUTS, TRANSFER_CONFIGURATION))
        self.assertIn("| LiftOn | 1.0.14 |", markdown)
        # A version the run could not observe falls back to its pin.
        self.assertIn("| parasail | 1.3.4 |", markdown)
        # Local inputs: the NCBI Datasets CLI did not run and is not cited.
        self.assertNotIn("NCBI Datasets", markdown)
        self.assertNotIn("oleary2024", bibtex)
        self.assertEqual(ris.count("ER  -"), bibtex.count("\n@") + 1)

    def test_cites_the_download_tool_when_an_input_came_from_ncbi(self) -> None:
        inputs = {**LOCAL_TRANSFER_INPUTS, "target": {"source": "ncbi", "accession": "GCF_000149205.2"}}
        markdown, bibtex, _ = self.write("annotation-transfer", provenance("annotation-transfer", inputs, TRANSFER_CONFIGURATION))
        self.assertIn("| NCBI Datasets CLI | 18.38.0 |", markdown)
        self.assertIn("@article{oleary2024,", bibtex)
        self.assertIn("NCBI assembly GCF_000149205.2", markdown)

    def test_marks_a_development_build_as_not_citable(self) -> None:
        released, _, _ = self.write("annotation-transfer", provenance("annotation-transfer", LOCAL_TRANSFER_INPUTS, TRANSFER_CONFIGURATION))
        development, _, _ = self.write(
            "annotation-transfer",
            provenance("annotation-transfer", LOCAL_TRANSFER_INPUTS, TRANSFER_CONFIGURATION, released=False, modified=True),
        )
        self.assertNotIn("Not citable", released)
        self.assertIn("Not citable", development)
        self.assertIn(COMMIT[:12], development)

    def test_writes_bibtex_and_ris_for_articles_preprints_and_software(self) -> None:
        article = {"id": "li2009", "type": "article", "authors": ["Li H", "Durbin R"], "others": True, "title": "Fast alignment",
                   "journal": "Bioinformatics", "volume": "25", "pages": "1754–1760", "year": 2009, "doi": "10.1/x"}
        bibtex = write_citation.bibtex_entry(article)
        self.assertIn("author = {Li, H. and Durbin, R. and others}", bibtex)
        self.assertIn("pages = {1754--1760}", bibtex)
        ris = write_citation.ris_entry(article)
        self.assertIn("TY  - JOUR", ris)
        self.assertIn("SP  - 1754\nEP  - 1760", ris)
        preprint = {"id": "li2013", "type": "preprint", "authors": ["Li H"], "others": False, "title": "BWA-MEM",
                    "repository": "arXiv", "number": "1303.3997", "year": 2013, "url": "https://arxiv.org/abs/1303.3997"}
        self.assertIn("eprint = {1303.3997}", write_citation.bibtex_entry(preprint))
        self.assertIn("TY  - UNPB", write_citation.ris_entry(preprint))
        group = {"id": "so", "type": "specification", "authors": ["The Sequence Ontology"], "others": False, "title": "GFF3"}
        self.assertIn("author = {{The Sequence Ontology}}", write_citation.bibtex_entry(group))

    def test_words_setting_values_and_drops_a_sentence_for_no_minimum(self) -> None:
        inputs = {"backbone": {"source": "local", "fasta": "/inputs/backbone.fasta"}, "selected_isolates": ["a", "b"]}

        def methods(consensus: dict) -> str:
            configuration = {**CONSENSUS_CONFIGURATION, "consensus": {**CONSENSUS_CONFIGURATION["consensus"], **consensus}}
            markdown, _, _ = self.write("reference-consensus", provenance("reference-consensus", inputs, configuration))
            return markdown.split("## Methods\n\n", 1)[1].split("\n\n", 1)[0]

        none = methods({})
        self.assertNotIn("strict-majority", none)
        self.assertNotIn("fewer than 0", none)
        self.assertIn("fewer than 2 callable isolates", methods({"min_callable_isolates": 2}))
        self.assertIn("IUPAC", methods({"unresolved_snp": "iupac"}))

    def test_rejects_a_setting_value_without_wording(self) -> None:
        with self.assertRaisesRegex(ValueError, "config.consensus.voting_method"):
            write_citation.apply_phrases({"config.consensus.voting_method": "random"},
                                         {"config.consensus.voting_method": {"plurality": "plurality"}})
        with self.assertRaisesRegex(ValueError, "unknown placeholder"):
            write_citation.apply_phrases({}, {"config.missing": {"*": "{}"}})

    def test_cites_genopilot_with_the_year_of_its_latest_release(self) -> None:
        _, bibtex, _ = self.write("annotation-transfer", provenance("annotation-transfer", LOCAL_TRANSFER_INPUTS, TRANSFER_CONFIGURATION))
        released = json.loads((WORKFLOWS_DIR / "shared" / "citation" / "genopilot.json").read_text(encoding="utf-8"))["date_released"]
        self.assertIn(f"year = {{{released[:4]}}}", bibtex.split("\n}", 1)[0])

    def test_rejects_an_unknown_methods_placeholder(self) -> None:
        with self.assertRaisesRegex(ValueError, "config.calling.min_depth"):
            write_citation.render_methods("At least ${config.calling.min_depth} reads.", {})


if __name__ == "__main__":
    unittest.main()
