import argparse
import csv
import json
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

collect_transfer_metrics = load_script("collect_transfer_metrics")


REFERENCE_GFF3 = """##gff-version 3
chr1	fixture	gene	1	100	.	+	.	ID=gene1
chr1	fixture	mRNA	1	100	.	+	.	ID=mrna1;Parent=gene1
chr1	fixture	gene	201	300	.	+	.	ID=gene2
chr1	fixture	mRNA	201	300	.	+	.	ID=mrna2;Parent=gene2
chr1	fixture	gene	401	500	.	+	.	ID=gene3
chr1	fixture	sequence_feature	601	620	.	+	.	ID=note1
chr1	fixture	sequence_feature	641	660	.	+	.	ID=note1
"""

TARGET_GFF3 = """##gff-version 3
chrA	LiftOn	gene	11	110	.	+	.	ID=gene1;source=Liftoff
chrA	LiftOn	mRNA	11	110	.	+	.	ID=mrna1;Parent=gene1;status=Liftoff;dna_identity=0.990;protein_identity=1.000;mutation=synonymous
chrB	LiftOn	gene	501	600	.	-	.	ID=gene2;source=miniprot
chrB	LiftOn	mRNA	501	600	.	-	.	ID=mrna2;Parent=gene2;status=LiftOn_miniprot;dna_identity=0.910;protein_identity=0.930;mutation=frameshift,stop_missing
chrC	LiftOn	gene	701	800	.	+	.	ID=gene2_1;extra_copy_number=1;source=miniprot
chrC	LiftOn	mRNA	701	800	.	+	.	ID=mrna2_1;Parent=gene2_1;status=miniprot;protein_identity=0.900;mutation=nonsynonymous
chrC	LiftOn	sequence_feature	901	920	.	+	.	ID=note1
chrC	LiftOn	sequence_feature	941	960	.	+	.	ID=note1
"""


TARGET_FASTA = ">chrA\n" + "A" * 1000 + "\n>chrB\n" + "C" * 1000 + "\n>chrC\n" + "G" * 1000 + "\n"


class CollectTransferMetricsTests(unittest.TestCase):
    def prepare(self, temp_dir: Path) -> argparse.Namespace:
        reference = temp_dir / "resolved" / "reference.gff3"
        raw = temp_dir / "results" / "annotation" / "lifton.raw.gff3"
        validation = temp_dir / "results" / "validation.json"
        diagnostics = temp_dir / "results" / "annotation" / "lifton_output"
        stats = diagnostics / "stats"
        intermediate = diagnostics / "intermediate_files"
        reference.parent.mkdir(parents=True)
        raw.parent.mkdir(parents=True)
        stats.mkdir(parents=True)
        intermediate.mkdir(parents=True)
        reference.write_text(REFERENCE_GFF3, encoding="utf-8")
        target_fasta = temp_dir / "resolved" / "target.fasta"
        target_fasta.write_text(TARGET_FASTA, encoding="utf-8")
        raw.write_text(TARGET_GFF3, encoding="utf-8")
        validation.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "status": "passed",
                    "gff3": {"errors": [], "warnings": ["example warning"]},
                }
            ),
            encoding="utf-8",
        )
        (diagnostics / "run_manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "counts": {
                        "reference_features": 3,
                        "mapped_reference_features": 2,
                        "emitted_feature_copies": 3,
                        "miniprot_rescued_genes": 1,
                    },
                }
            ),
            encoding="utf-8",
        )
        (intermediate / "auto_feature_types.txt").write_text("gene\n", encoding="utf-8")
        (stats / "completeness_by_feature_type.txt").write_text(
            "feature_type\tn_reference\tn_lifted\tn_missed\tn_extra_copies\tn_target\tpct_recovered\n"
            "gene\t3\t2\t1\t1\t3\t0.66667\n",
            encoding="utf-8",
        )
        (stats / "mapped_feature.txt").write_text(
            "gene1\t1\tcoding\ngene2\t2\tcoding\n", encoding="utf-8"
        )
        (stats / "mapped_transcript.txt").write_text(
            "mrna1\t1\tcoding\nmrna2\t2\tcoding\n", encoding="utf-8"
        )
        (stats / "unmapped_features.txt").write_text("gene3\tcoding\n", encoding="utf-8")
        (stats / "extra_copy_features.txt").write_text(
            "gene2\t2\tcoding\n", encoding="utf-8"
        )
        return argparse.Namespace(
            reference_gff3=reference,
            raw_gff3=raw,
            validation=validation,
            target_fasta=target_fasta,
            minimum_protein_identity=99,
            unresolved_bed=temp_dir / "results" / "target-unresolved.bed",
            diagnostics=diagnostics,
            details=temp_dir / "results" / "feature-transfer.tsv",
            metrics=temp_dir / "results" / "metrics.json",
            summary=temp_dir / "results" / "summary.json",
            workflow_id="annotation-transfer",
            workflow_version=1,
            run_id="test-run",
            run_created_at="2026-09-05T20:00:00.000Z",
            effective_cpus=4,
        )

    @staticmethod
    def argv(args: argparse.Namespace) -> list[str]:
        return [
            "--reference-gff3",
            str(args.reference_gff3),
            "--raw-gff3",
            str(args.raw_gff3),
            "--validation",
            str(args.validation),
            "--target-fasta",
            str(args.target_fasta),
            "--minimum-protein-identity",
            str(args.minimum_protein_identity),
            "--unresolved-bed",
            str(args.unresolved_bed),
            "--diagnostics",
            str(args.diagnostics),
            "--details",
            str(args.details),
            "--metrics",
            str(args.metrics),
            "--summary",
            str(args.summary),
            "--workflow-id",
            args.workflow_id,
            "--workflow-version",
            str(args.workflow_version),
            "--run-id",
            args.run_id,
            "--run-created-at",
            args.run_created_at,
            "--effective-cpus",
            str(args.effective_cpus),
        ]

    def test_collects_deterministic_per_feature_rows_and_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))

            metrics, summary, rows, _unresolved = collect_transfer_metrics.collect(args)
            collect_transfer_metrics.write_details(args.details, rows)

            self.assertEqual(
                [(row["reference_id"], row["status"], row["copy_number"]) for row in rows],
                [
                    ("gene1", "mapped", 0),
                    ("gene2", "mapped", 0),
                    ("gene2", "extra-copy", 1),
                    ("gene3", "unmapped", 0),
                ],
            )
            self.assertEqual(rows[1]["lifton_category"], "coding")
            self.assertEqual(rows[1]["minimum_protein_identity"], 0.93)
            self.assertEqual(rows[1]["mutations"], "frameshift,stop_missing")
            self.assertEqual(rows[3]["target_id"], "")
            self.assertEqual(
                [(row["reference_seqid"], row["reference_start"], row["reference_end"], row["reference_strand"]) for row in rows],
                [("chr1", 1, 100, "+"), ("chr1", 201, 300, "+"), ("chr1", 201, 300, "+"), ("chr1", 401, 500, "+")],
            )

            transfer = metrics["transfer"]
            self.assertEqual(transfer["reference_features"], 3)
            self.assertEqual(transfer["mapped_features"], 2)
            self.assertEqual(transfer["unmapped_features"], 1)
            self.assertEqual(transfer["target_feature_copies"], 3)
            self.assertEqual(transfer["features_with_extra_copies"], 1)
            self.assertEqual(transfer["extra_copies"], 1)
            self.assertEqual(transfer["miniprot_rescues"], 1)
            self.assertEqual(transfer["changed_primary_protein_coding_features"], 1)
            self.assertEqual(
                transfer["mutation_classifications_by_target_copy"],
                {"frameshift": 1, "nonsynonymous": 1, "stop_missing": 1, "synonymous": 1},
            )
            self.assertEqual(metrics["validation"]["warnings"], 1)
            self.assertIn("miniprot", metrics["definitions"]["miniprot_rescues"])
            self.assertIn(
                "LiftOn",
                metrics["detail_column_definitions"]["target_id"],
            )
            self.assertEqual(
                transfer["authoritative_sources"],
                [
                    str(args.diagnostics / "run_manifest.json"),
                    str(args.diagnostics / "stats" / "completeness_by_feature_type.txt"),
                    str(args.diagnostics / "stats" / "mapped_feature.txt"),
                    str(args.diagnostics / "stats" / "unmapped_features.txt"),
                    str(args.diagnostics / "stats" / "extra_copy_features.txt"),
                    str(args.diagnostics / "intermediate_files" / "auto_feature_types.txt"),
                ],
            )

            self.assertEqual(summary["workflow"], {"id": "annotation-transfer", "version": 1})
            self.assertEqual(summary["status"], "completed-with-warnings")
            self.assertEqual(summary["metrics"]["payload"], metrics)
            self.assertTrue(summary["source_evidence"]["run_manifest"]["available"])
            self.assertEqual(summary["generated_reports"]["feature_transfer"], str(args.details))

            with open(args.details, encoding="utf-8", newline="") as handle:
                written = list(csv.DictReader(handle, delimiter="\t"))
            self.assertEqual([row["reference_id"] for row in written], ["gene1", "gene2", "gene2", "gene3"])

    def test_records_an_explicit_reason_when_identity_metrics_are_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            without_identities = TARGET_GFF3.replace(";dna_identity=0.990;protein_identity=1.000", "")
            without_identities = without_identities.replace(
                ";dna_identity=0.910;protein_identity=0.930", ""
            ).replace(";protein_identity=0.900", "")
            args.raw_gff3.write_text(without_identities, encoding="utf-8")

            metrics, _summary, _rows, _unresolved = collect_transfer_metrics.collect(args)

            identity = metrics["transfer"]["protein_identity_by_transcript_model"]
            self.assertEqual(identity["unit"], "transcript_model")
            self.assertEqual(identity["count"], 0)
            self.assertIn(
                "LiftOn emitted no protein_identity attributes",
                identity["unavailable_reason"],
            )

    def test_rejects_a_run_manifest_that_contradicts_the_gff3(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            manifest_path = args.diagnostics / "run_manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["counts"]["mapped_reference_features"] = 99
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(
                collect_transfer_metrics.SummaryError,
                "mapped_reference_features.*99.*feature reports imply 2",
            ):
                collect_transfer_metrics.collect(args)

    def test_extra_copy_mutations_do_not_mark_the_primary_model_as_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.raw_gff3.write_text(
                TARGET_GFF3.replace(
                    "mutation=frameshift,stop_missing",
                    "mutation=synonymous",
                ),
                encoding="utf-8",
            )

            metrics, _summary, _rows, _unresolved = collect_transfer_metrics.collect(args)

            self.assertEqual(
                metrics["transfer"]["changed_primary_protein_coding_features"], 0
            )
            self.assertEqual(
                metrics["transfer"]["mutation_classifications_by_target_copy"]
                ["nonsynonymous"],
                1,
            )

    def test_identical_primary_models_are_not_counted_as_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.raw_gff3.write_text(
                TARGET_GFF3.replace("mutation=synonymous", "mutation=identical").replace(
                    "mutation=frameshift,stop_missing", "mutation=identical"
                ),
                encoding="utf-8",
            )

            metrics, _summary, _rows, _unresolved = collect_transfer_metrics.collect(args)

            self.assertEqual(
                metrics["transfer"]["changed_primary_protein_coding_features"], 0
            )
            self.assertEqual(
                metrics["transfer"]["mutation_classifications_by_target_copy"]["identical"], 2
            )

    def test_protein_loss_classes_count_as_changed(self) -> None:
        for mutation in ("no_protein", "full_transcript_loss"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                args = self.prepare(Path(tmp))
                args.raw_gff3.write_text(
                    TARGET_GFF3.replace(
                        "mutation=frameshift,stop_missing", f"mutation={mutation}"
                    ),
                    encoding="utf-8",
                )

                metrics, _summary, _rows, _unresolved = collect_transfer_metrics.collect(args)

                self.assertEqual(
                    metrics["transfer"]["changed_primary_protein_coding_features"], 1
                )

    def test_defines_every_detail_column(self) -> None:
        self.assertEqual(
            set(collect_transfer_metrics.DETAIL_EXPLANATIONS),
            set(collect_transfer_metrics.DETAIL_COLUMNS),
        )

    def test_marks_a_summary_as_validation_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.validation.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "status": "failed",
                        "gff3": {"errors": ["broken parent"], "warnings": []},
                    }
                ),
                encoding="utf-8",
            )

            metrics, summary, _rows, _unresolved = collect_transfer_metrics.collect(args)

            self.assertEqual(metrics["validation"]["status"], "failed")
            self.assertEqual(summary["status"], "validation-failed")
            self.assertIn("failed structural validation", summary["status_explanation"])

    def test_requires_lifton_selected_feature_types(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            (args.diagnostics / "intermediate_files" / "auto_feature_types.txt").unlink()

            with self.assertRaisesRegex(
                collect_transfer_metrics.SummaryError,
                "required LiftOn result is missing",
            ):
                collect_transfer_metrics.collect(args)

    def test_rejects_an_extra_copy_without_the_pinned_lifton_id_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.raw_gff3.write_text(
                TARGET_GFF3.replace("ID=gene2_1;extra_copy_number=1", "ID=copy-of-gene2;extra_copy_number=1"),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                collect_transfer_metrics.SummaryError,
                "does not end with expected suffix",
            ):
                collect_transfer_metrics.collect(args)

    def test_rates_primary_coding_copies_and_leaves_other_rows_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))

            metrics, _summary, rows, _unresolved = collect_transfer_metrics.collect(args)

            rating = [
                (row["protein_category"], row["lifton_status"], row["unresolved_bases"], row["review_reasons"])
                for row in rows
            ]
            self.assertEqual(
                rating,
                [
                    ("unchanged", "Liftoff", 0, ""),
                    ("disrupted", "LiftOn_miniprot", 0, "disrupted,below_threshold"),
                    ("", "", "", ""),
                    ("unmapped", "", "", "unmapped_or_lost"),
                ],
            )
            proteins = metrics["proteins"]
            self.assertEqual(proteins["minimum_protein_identity_percent"], 99)
            self.assertEqual(proteins["rated_genes"], 3)
            self.assertEqual(
                proteins["genes_by_category"],
                {"unmapped": 1, "lost": 0, "disrupted": 1, "inframe_indel": 0, "substitutions": 0, "unchanged": 1},
            )
            self.assertEqual(
                proteins["genes_by_review_reason"],
                {"unmapped_or_lost": 1, "disrupted": 1, "below_threshold": 1, "unresolved_bases": 0},
            )
            self.assertEqual(proteins["genes_listed_for_review"], 2)
            self.assertEqual(
                proteins["genes_by_match"], {"exact_match": 1, "near_match": 0, "needs_review": 2}
            )
            for key in proteins:
                if key not in ("source", "unresolved_intervals"):
                    self.assertIn(key, metrics["definitions"])

    def test_counts_a_changed_protein_above_the_threshold_as_a_near_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.raw_gff3.write_text(
                TARGET_GFF3.replace(
                    "protein_identity=1.000;mutation=synonymous", "protein_identity=0.995;mutation=nonsynonymous"
                ),
                encoding="utf-8",
            )

            metrics, _summary, rows, _unresolved = collect_transfer_metrics.collect(args)

            self.assertEqual(rows[0]["protein_category"], "substitutions")
            self.assertEqual(rows[0]["review_reasons"], "")
            self.assertEqual(
                metrics["proteins"]["genes_by_match"], {"exact_match": 0, "near_match": 1, "needs_review": 2}
            )

    def test_leaves_non_coding_features_unrated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            (args.diagnostics / "stats" / "mapped_feature.txt").write_text(
                "gene1\t1\tnon-coding\ngene2\t2\tcoding\n", encoding="utf-8"
            )
            (args.diagnostics / "stats" / "unmapped_features.txt").write_text("gene3\tnon-coding\n", encoding="utf-8")

            metrics, _summary, rows, _unresolved = collect_transfer_metrics.collect(args)

            self.assertEqual([row["protein_category"] for row in rows], ["", "disrupted", "", ""])
            self.assertEqual(rows[3]["review_reasons"], "")
            self.assertEqual(metrics["proteins"]["rated_genes"], 1)

    def test_counts_unresolved_bases_in_the_cds_and_writes_them_as_bed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            args.target_fasta.write_text(
                TARGET_FASTA.replace("A" * 1000, "A" * 49 + "NR" + "A" * 949), encoding="utf-8"
            )
            args.raw_gff3.write_text(
                TARGET_GFF3.replace(
                    "mutation=synonymous\n",
                    "mutation=synonymous\nchrA\tLiftOn\tCDS\t11\t110\t.\t+\t0\tID=cds1;Parent=mrna1\n",
                ),
                encoding="utf-8",
            )

            self.assertEqual(collect_transfer_metrics.main(self.argv(args)), 0)

            with open(args.details, encoding="utf-8", newline="") as handle:
                gene1 = next(csv.DictReader(handle, delimiter="\t"))
            self.assertEqual(gene1["unresolved_bases"], "2")
            self.assertEqual(gene1["review_reasons"], "unresolved_bases")
            self.assertEqual(args.unresolved_bed.read_text(encoding="utf-8"), "chrA\t49\t51\n")
            metrics = json.loads(args.metrics.read_text(encoding="utf-8"))
            self.assertEqual(metrics["proteins"]["unresolved_target_bases"], {"n": 1, "other": 1})

    def test_main_writes_every_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            exit_code = collect_transfer_metrics.main(self.argv(args))

            self.assertEqual(exit_code, 0)
            self.assertTrue(args.details.is_file())
            self.assertTrue(args.metrics.is_file())
            self.assertTrue(args.summary.is_file())
            self.assertTrue(args.unresolved_bed.is_file())


class ProteinRatingTests(unittest.TestCase):
    def test_takes_the_most_severe_category(self) -> None:
        cases = [
            ([], 1.0, "unchanged"),
            (["identical"], 1.0, "unchanged"),
            (["synonymous"], 1.0, "unchanged"),
            (["nonsynonymous"], 0.99, "substitutions"),
            (["inframe_deletion", "nonsynonymous"], 0.98, "inframe_indel"),
            (["inframe_insertion", "start_lost"], 0.9, "disrupted"),
            (["frameshift", "no_protein"], 0.5, "lost"),
            (["full_transcript_loss"], 0.0, "lost"),
            ([], None, "lost"),
        ]
        for classes, identity, expected in cases:
            with self.subTest(classes=classes, identity=identity):
                self.assertEqual(collect_transfer_metrics.protein_category(classes, identity, "t1"), expected)

    def test_refuses_an_unknown_mutation_class(self) -> None:
        with self.assertRaisesRegex(collect_transfer_metrics.SummaryError, "does not know: novel_class"):
            collect_transfer_metrics.protein_category(["novel_class"], 0.9, "t1")

    def test_lists_reasons_with_the_threshold_as_an_exclusive_bound(self) -> None:
        reasons = collect_transfer_metrics.review_reasons
        self.assertEqual(reasons("unchanged", 0.99, 0, 99), [])
        self.assertEqual(reasons("substitutions", 0.989, 0, 99), ["below_threshold"])
        self.assertEqual(reasons("substitutions", 0.57, 0, 57), [])
        self.assertEqual(reasons("lost", None, 0, 99), ["unmapped_or_lost"])
        self.assertEqual(reasons("unmapped", None, 0, 99), ["unmapped_or_lost"])
        self.assertEqual(
            reasons("disrupted", 0.5, 3, 99), ["disrupted", "below_threshold", "unresolved_bases"]
        )

    def test_reads_unresolved_runs_across_lines_and_counts_each_cds_position_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fasta = Path(tmp) / "target.fasta"
            fasta.write_text(">s1 description\nacNN\nNNAC\nRT\n>s2\nACGT\n", encoding="utf-8")

            intervals, counts = collect_transfer_metrics.read_unresolved_intervals(fasta)

            self.assertEqual(intervals, {"s1": [(2, 6), (8, 9)], "s2": []})
            self.assertEqual(counts, {"n": 4, "other": 1})
            cds = [
                collect_transfer_metrics.Feature("s1", "LiftOn", "CDS", 1, 6, "+", {"Parent": "m1"}),
                collect_transfer_metrics.Feature("s1", "LiftOn", "CDS", 4, 9, "+", {"Parent": "m2"}),
                collect_transfer_metrics.Feature("s1", "LiftOn", "exon", 1, 10, "+", {"Parent": "m1"}),
            ]
            self.assertEqual(collect_transfer_metrics.unresolved_in_cds(cds, intervals), 5)
            self.assertEqual(collect_transfer_metrics.unresolved_in_cds(cds[:1], intervals), 4)


if __name__ == "__main__":
    unittest.main()
