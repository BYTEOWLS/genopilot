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


class CollectTransferMetricsTests(unittest.TestCase):
    def prepare(self, root: Path) -> argparse.Namespace:
        reference = root / "resolved" / "reference.gff3"
        raw = root / "results" / "annotation" / "lifton.raw.gff3"
        final = root / "results" / "annotation" / "lifton.prefixed.gff3"
        validation = root / "results" / "validation.json"
        diagnostics = root / "results" / "annotation" / "lifton_output"
        stats = diagnostics / "stats"
        intermediate = diagnostics / "intermediate_files"
        reference.parent.mkdir(parents=True)
        raw.parent.mkdir(parents=True)
        stats.mkdir(parents=True)
        intermediate.mkdir(parents=True)
        reference.write_text(REFERENCE_GFF3, encoding="utf-8")
        raw.write_text(TARGET_GFF3, encoding="utf-8")
        final.write_text(TARGET_GFF3, encoding="utf-8")
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
            final_gff3=final,
            validation=validation,
            diagnostics=diagnostics,
            details=root / "results" / "feature-transfer.tsv",
            metrics=root / "results" / "metrics.json",
            summary=root / "results" / "summary.json",
            workflow_id="annotation-transfer",
            workflow_version=1,
            run_id="test-run",
            run_created_at="2026-09-05T20:00:00.000Z",
            effective_cpus=4,
            id_prefix="AN_",
        )

    def test_collects_deterministic_per_feature_rows_and_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))

            metrics, summary, rows = collect_transfer_metrics.collect(args)
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
            self.assertTrue(metrics["prefix"]["applied"])
            self.assertIn("miniprot", metrics["definitions"]["miniprot_rescues"])
            self.assertIn(
                "Raw LiftOn target identifier",
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

            metrics, _summary, _rows = collect_transfer_metrics.collect(args)

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

            metrics, _summary, _rows = collect_transfer_metrics.collect(args)

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

            metrics, _summary, _rows = collect_transfer_metrics.collect(args)

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

                metrics, _summary, _rows = collect_transfer_metrics.collect(args)

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

            metrics, summary, _rows = collect_transfer_metrics.collect(args)

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

    def test_main_writes_all_three_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = self.prepare(Path(tmp))
            exit_code = collect_transfer_metrics.main(
                [
                    "--reference-gff3",
                    str(args.reference_gff3),
                    "--raw-gff3",
                    str(args.raw_gff3),
                    "--final-gff3",
                    str(args.final_gff3),
                    "--validation",
                    str(args.validation),
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
                    "--id-prefix",
                    args.id_prefix,
                ]
            )

            self.assertEqual(exit_code, 0)
            self.assertTrue(args.details.is_file())
            self.assertTrue(args.metrics.is_file())
            self.assertTrue(args.summary.is_file())


if __name__ == "__main__":
    unittest.main()
