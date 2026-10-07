"""Tests for the run-event translation used by the `genopilot-run-events` logger plugin.

The field names asserted here are the ones Snakemake 9.26.1 attaches to its structured log
records, captured from real runs of this workflow.
"""

import unittest

from ._load import load_run_events_module

events = load_run_events_module()


def record(**fields):
    """Builds a log record's fields with the attributes every record carries."""
    return {"created": 1788681014.123, "levelname": "INFO", **fields}


class TimestampTests(unittest.TestCase):
    def test_formats_the_record_time_as_an_iso_utc_instant(self) -> None:
        self.assertEqual(events.format_timestamp(1788681014.123), "2026-09-06T07:50:14.123Z")

    def test_falls_back_to_the_epoch_for_an_unusable_time(self) -> None:
        self.assertEqual(events.format_timestamp(None), "1970-01-01T00:00:00.000Z")


class TranslationTests(unittest.TestCase):
    def test_reports_the_workflow_start_with_its_version_and_command(self) -> None:
        event = events.translate(
            record(event="workflow_started", snakemake_version="9.26.1", cmd="snakemake --cores 1")
        )

        self.assertEqual(
            event,
            {
                "schema_version": 1,
                "timestamp": "2026-09-06T07:50:14.123Z",
                "type": "workflow-started",
                "snakemake_version": "9.26.1",
                "command": "snakemake --cores 1",
            },
        )

    def test_separates_the_scheduled_job_total_from_the_per_rule_counts(self) -> None:
        event = events.translate(
            record(
                event="run_info",
                stats={"resolve_reference": 1, "resolve_target": 1, "validate_inputs": 1, "total": 3},
            )
        )

        self.assertEqual(event["type"], "run-info")
        self.assertEqual(event["total"], 3)
        self.assertEqual(
            event["jobs"], {"resolve_reference": 1, "resolve_target": 1, "validate_inputs": 1}
        )

    def test_derives_a_missing_total_from_the_per_rule_counts(self) -> None:
        event = events.translate(record(event="run_info", stats={"validate_inputs": 2}))

        self.assertEqual(event["total"], 2)

    def test_reports_a_started_job_with_the_rule_that_identifies_it(self) -> None:
        event = events.translate(
            record(
                event="job_info",
                jobid=1,
                rule_name="resolve_reference",
                threads=4,
                reason="Missing output files: resolved/reference.fasta",
                log=["logs/resolve-reference.log"],
            )
        )

        self.assertEqual(event["type"], "job-started")
        self.assertEqual(event["job_id"], 1)
        self.assertEqual(event["rule"], "resolve_reference")
        self.assertEqual(event["threads"], 4)
        self.assertEqual(event["logs"], ["logs/resolve-reference.log"])
        self.assertEqual(event["outputs"], [])
        self.assertEqual(event["wildcards"], {})
        self.assertIsNone(event["command"])

    def test_reports_a_started_job_with_its_outputs_wildcards_and_command(self) -> None:
        event = events.translate(
            record(
                event="job_info",
                jobid=4,
                rule_name="align_read_pair",
                output=["results/isolates/iso-a/pairs/2/aligned.bam"],
                wildcards={"isolate": "iso-a", "pair": 2},
                shellcmd="  bwa mem -t 8 ref.fasta r1.fq r2.fq | samtools sort -o out.bam -  ",
            )
        )

        self.assertEqual(event["outputs"], ["results/isolates/iso-a/pairs/2/aligned.bam"])
        self.assertEqual(event["wildcards"], {"isolate": "iso-a", "pair": "2"})
        self.assertEqual(event["command"], "  bwa mem -t 8 ref.fasta r1.fq r2.fq | samtools sort -o out.bam -  ")

    def test_reports_a_finished_job_by_the_identifier_snakemake_gives_it(self) -> None:
        # Snakemake names this field `job_id` when a job finishes and `jobid` everywhere else.
        event = events.translate(record(event="job_finished", job_id=2))

        self.assertEqual(event["type"], "job-finished")
        self.assertEqual(event["job_id"], 2)

    def test_reports_a_failed_job_with_its_rule_and_logs(self) -> None:
        event = events.translate(
            record(
                event="job_error",
                jobid=3,
                rule_name="transfer_annotation",
                log=["logs/transfer-annotation.log"],
                message="Error in rule transfer_annotation, jobid: 3",
            )
        )

        self.assertEqual(event["type"], "job-failed")
        self.assertEqual(event["job_id"], 3)
        self.assertEqual(event["rule"], "transfer_annotation")
        self.assertEqual(event["logs"], ["logs/transfer-annotation.log"])

    def test_reports_progress_and_workflow_errors(self) -> None:
        progress = events.translate(record(event="progress", done=2, total=3))
        error = events.translate(
            record(event="error", exception="WorkflowError", message="Missing input files")
        )

        self.assertEqual((progress["done"], progress["total"]), (2, 3))
        self.assertEqual(error["exception"], "WorkflowError")
        self.assertEqual(error["message"], "Missing input files")

    def test_drops_console_messages_and_unknown_events(self) -> None:
        # Console text is preserved separately as the run's complete stdout/stderr logs; this
        # contract carries workflow state only.
        self.assertIsNone(events.translate(record(message="Building DAG of jobs...")))
        self.assertIsNone(events.translate(record(event="shellcmd", shellcmd="python3 script.py")))
        self.assertIsNone(events.translate(record(event="resources_info", cores=1)))
        self.assertIsNone(events.translate(record(event="rulegraph")))

    def test_tolerates_missing_and_unusable_fields(self) -> None:
        started = events.translate(record(event="job_info"))
        failed = events.translate(record(event="job_error", jobid="not-a-number", log=None))
        info = events.translate(record(event="run_info", stats="unusable"))

        self.assertEqual(started["job_id"], None)
        self.assertEqual(started["rule"], None)
        self.assertEqual(started["logs"], [])
        self.assertEqual(failed["job_id"], None)
        self.assertEqual(failed["logs"], [])
        self.assertEqual(info["jobs"], {})
        self.assertEqual(info["total"], 0)

    def test_accepts_a_single_log_path_as_well_as_a_list(self) -> None:
        event = events.translate(record(event="job_info", log="logs/only.log"))

        self.assertEqual(event["logs"], ["logs/only.log"])


if __name__ == "__main__":
    unittest.main()
