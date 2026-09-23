import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from ._load import load_script

prefix_gff3 = load_script("prefix_gff3")


class ApplyPrefixToAttributesTests(unittest.TestCase):
    def test_prefixes_id(self) -> None:
        result = prefix_gff3.apply_prefix_to_attributes("ID=gene1;Name=gene1", "AN_CS_")
        self.assertEqual(result, "ID=AN_CS_gene1;Name=gene1")

    def test_prefixes_multi_valued_parent(self) -> None:
        result = prefix_gff3.apply_prefix_to_attributes("ID=cds1;Parent=mrna1,mrna2", "AN_CS_")
        self.assertEqual(result, "ID=AN_CS_cds1;Parent=AN_CS_mrna1,AN_CS_mrna2")

    def test_prefixes_derives_from(self) -> None:
        result = prefix_gff3.apply_prefix_to_attributes("ID=p1;Derives_from=mrna1", "AN_CS_")
        self.assertEqual(result, "ID=AN_CS_p1;Derives_from=AN_CS_mrna1")

    def test_leaves_descriptions_and_other_attributes_untouched(self) -> None:
        raw = "ID=gene1;Name=gene1;description=Contains ID and Parent in free text;Dbxref=GeneID:123"
        result = prefix_gff3.apply_prefix_to_attributes(raw, "AN_CS_")
        self.assertEqual(
            result,
            "ID=AN_CS_gene1;Name=gene1;description=Contains ID and Parent in free text;Dbxref=GeneID:123",
        )

    def test_missing_id_attribute_is_left_alone(self) -> None:
        raw = "Parent=mrna1"
        self.assertEqual(prefix_gff3.apply_prefix_to_attributes(raw, "AN_CS_"), "Parent=AN_CS_mrna1")

    def test_a_shared_discontinuous_id_prefixes_identically_on_each_line(self) -> None:
        first = prefix_gff3.apply_prefix_to_attributes("ID=cds1;Parent=mrna1", "AN_CS_")
        second = prefix_gff3.apply_prefix_to_attributes("ID=cds1;Parent=mrna1", "AN_CS_")
        self.assertEqual(first, second)
        self.assertEqual(first, "ID=AN_CS_cds1;Parent=AN_CS_mrna1")

    def test_distinct_original_ids_never_collide_after_prefixing(self) -> None:
        originals = ["gene1", "1", "AN_CS_gene1", "gene", "1_gene"]
        prefixed = {
            prefix_gff3.apply_prefix_to_attributes(f"ID={value}", "AN_CS_") for value in originals
        }
        self.assertEqual(len(prefixed), len(originals))


class PrefixGff3LineTests(unittest.TestCase):
    def test_leaves_comments_and_blank_lines_untouched(self) -> None:
        self.assertEqual(prefix_gff3.prefix_gff3_line("##gff-version 3", "AN_CS_"), "##gff-version 3")
        self.assertEqual(prefix_gff3.prefix_gff3_line("", "AN_CS_"), "")

    def test_leaves_a_malformed_row_untouched(self) -> None:
        malformed = "chr1\tsrc\tgene\t1\t10"
        self.assertEqual(prefix_gff3.prefix_gff3_line(malformed, "AN_CS_"), malformed)

    def test_prefixes_only_column_nine(self) -> None:
        line = "chr1\tLiftOn\tgene\t1\t10\t.\t+\t.\tID=gene1"
        result = prefix_gff3.prefix_gff3_line(line, "AN_CS_")
        self.assertEqual(result, "chr1\tLiftOn\tgene\t1\t10\t.\t+\t.\tID=AN_CS_gene1")


class PrefixGff3FileTests(unittest.TestCase):
    def test_rewrites_ids_and_parents_and_preserves_everything_else(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "raw.gff3"
            destination = Path(tmp) / "nested" / "prefixed.gff3"
            source.write_text(
                "##gff-version 3\n"
                "chr1\tLiftOn\tgene\t1\t100\t.\t+\t.\tID=gene1;Name=gene1\n"
                "chr1\tLiftOn\tmRNA\t1\t100\t.\t+\t.\tID=mrna1;Parent=gene1\n"
                "chr1\tLiftOn\texon\t1\t50\t.\t+\t.\tParent=mrna1\n"
                "chr1\tLiftOn\tCDS\t1\t50\t.\t+\t0\tID=cds1;Parent=mrna1\n"
                "chr1\tLiftOn\tCDS\t60\t100\t.\t+\t0\tID=cds1;Parent=mrna1\n",
                encoding="utf-8",
            )

            prefix_gff3.prefix_gff3(source, destination, "AN_CS_")

            lines = destination.read_text(encoding="utf-8").splitlines()
            self.assertEqual(lines[0], "##gff-version 3")
            self.assertIn("ID=AN_CS_gene1;Name=gene1", lines[1])
            self.assertIn("ID=AN_CS_mrna1;Parent=AN_CS_gene1", lines[2])
            self.assertIn("Parent=AN_CS_mrna1", lines[3])
            self.assertNotIn("ID=", lines[3])
            self.assertIn("ID=AN_CS_cds1;Parent=AN_CS_mrna1", lines[4])
            self.assertIn("ID=AN_CS_cds1;Parent=AN_CS_mrna1", lines[5])

    def test_never_modifies_the_source_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "raw.gff3"
            destination = Path(tmp) / "prefixed.gff3"
            content = "##gff-version 3\nchr1\tLiftOn\tgene\t1\t10\t.\t+\t.\tID=gene1\n"
            source.write_text(content, encoding="utf-8")

            prefix_gff3.prefix_gff3(source, destination, "AN_CS_")

            self.assertEqual(source.read_text(encoding="utf-8"), content)


class MainTests(unittest.TestCase):
    def test_cli_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "raw.gff3"
            destination = root / "prefixed.gff3"
            source.write_text("##gff-version 3\nchr1\tLiftOn\tgene\t1\t10\t.\t+\t.\tID=g1\n", encoding="utf-8")

            exit_code = prefix_gff3.main(
                ["--source", str(source), "--destination", str(destination), "--prefix", "AN_CS_"]
            )

            self.assertEqual(exit_code, 0)
            self.assertIn("ID=AN_CS_g1", destination.read_text(encoding="utf-8"))

    def test_an_empty_prefix_is_rejected_and_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "raw.gff3"
            destination = root / "prefixed.gff3"
            source.write_text("##gff-version 3\n", encoding="utf-8")

            with contextlib.redirect_stderr(io.StringIO()) as stderr:
                exit_code = prefix_gff3.main(
                    ["--source", str(source), "--destination", str(destination), "--prefix", ""]
                )

            self.assertEqual(exit_code, 2)
            self.assertIn("--prefix", stderr.getvalue())
            self.assertFalse(destination.exists())

    def test_a_missing_prefix_argument_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    prefix_gff3.main(
                        [
                            "--source",
                            str(root / "raw.gff3"),
                            "--destination",
                            str(root / "prefixed.gff3"),
                        ]
                    )


if __name__ == "__main__":
    unittest.main()
