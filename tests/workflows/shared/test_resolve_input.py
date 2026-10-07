import json
import unittest
from pathlib import Path

from ._load import load_script

resolve_input = load_script("resolve_input")


class Sha256FileTests(unittest.TestCase):
    def test_matches_known_digest(self) -> None:
        with self.subTest():
            path = Path(self._make_temp_file(b"hello world\n"))
            self.assertEqual(
                resolve_input.sha256_file(path),
                "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
            )

    def _make_temp_file(self, content: bytes) -> str:
        import tempfile

        handle = tempfile.NamedTemporaryFile(delete=False)
        handle.write(content)
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return handle.name


class ShouldDownloadTests(unittest.TestCase):
    def test_missing_cache_always_downloads(self) -> None:
        self.assertTrue(resolve_input.should_download("reuse", False, False))
        self.assertTrue(resolve_input.should_download("refresh", False, False))

    def test_refresh_always_redownloads_even_when_valid(self) -> None:
        self.assertTrue(resolve_input.should_download("refresh", True, True))

    def test_reuse_trusts_a_matching_checksum(self) -> None:
        self.assertFalse(resolve_input.should_download("reuse", True, True))

    def test_reuse_redownloads_on_checksum_mismatch(self) -> None:
        self.assertTrue(resolve_input.should_download("reuse", True, False))


class ResolveLocalTests(unittest.TestCase):
    def test_copies_file_and_returns_matching_checksum(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            source = temp_dir / "source.fasta"
            source.write_text(">a\nACGT\n", encoding="utf-8")
            destination = temp_dir / "nested" / "resolved.fasta"

            checksum = resolve_input.resolve_local(source, destination)

            self.assertTrue(destination.is_file())
            self.assertEqual(destination.read_text(encoding="utf-8"), source.read_text(encoding="utf-8"))
            self.assertEqual(checksum, resolve_input.sha256_file(destination))


class FakeDownload:
    """Records calls and writes a minimal NCBI-datasets-shaped payload."""

    def __init__(self, fasta_content: bytes = b">seq\nACGT\n", gff3_content: bytes = b"##gff-version 3\n") -> None:
        self.calls: list[tuple[str, list[str]]] = []
        self.fasta_content = fasta_content
        self.gff3_content = gff3_content

    def __call__(self, accession, include, destination_dir, datasets_bin, api_key_env) -> None:
        self.calls.append((accession, list(include)))
        data_dir = destination_dir / "ncbi_dataset" / "data" / accession
        data_dir.mkdir(parents=True, exist_ok=True)
        if "genome" in include:
            (data_dir / f"{accession}_genomic.fna").write_bytes(self.fasta_content)
        if "gff3" in include:
            (data_dir / f"{accession}_genomic.gff").write_bytes(self.gff3_content)


class ResolveNcbiBundleTests(unittest.TestCase):
    def test_first_resolution_downloads_and_records_checksums(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "cache"
            download = FakeDownload()

            checksums, downloaded = resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1",
                ["fasta", "gff3"],
                cache_dir,
                "reuse",
                "datasets",
                None,
                download=download,
            )

            self.assertTrue(downloaded)
            self.assertEqual(len(download.calls), 1)
            self.assertEqual(sorted(download.calls[0][1]), ["genome", "gff3"])
            self.assertIn("fasta", checksums)
            self.assertIn("gff3", checksums)
            checksums_path = cache_dir / "GCF_000000001.1" / "checksums.json"
            self.assertEqual(json.loads(checksums_path.read_text(encoding="utf-8")), checksums)

    def test_reuse_mode_skips_download_when_cache_is_valid(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "cache"
            download = FakeDownload()
            resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "reuse", "datasets", None, download=download
            )
            self.assertEqual(len(download.calls), 1)

            _checksums, downloaded = resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "reuse", "datasets", None, download=download
            )

            self.assertFalse(downloaded)
            self.assertEqual(len(download.calls), 1, "reuse must not re-invoke the download")

    def test_reuse_mode_redownloads_on_checksum_mismatch(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "cache"
            download = FakeDownload()
            resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "reuse", "datasets", None, download=download
            )
            cached_file = cache_dir / "GCF_000000001.1" / "genomic.fna"
            cached_file.write_bytes(b">corrupted\n")

            _checksums, downloaded = resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "reuse", "datasets", None, download=download
            )

            self.assertTrue(downloaded)
            self.assertEqual(len(download.calls), 2)
            self.assertEqual(cached_file.read_bytes(), download.fasta_content)

    def test_refresh_mode_always_redownloads(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "cache"
            download = FakeDownload()
            resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "refresh", "datasets", None, download=download
            )

            _checksums, downloaded = resolve_input.resolve_ncbi_bundle(
                "GCF_000000001.1", ["fasta"], cache_dir, "refresh", "datasets", None, download=download
            )

            self.assertTrue(downloaded)
            self.assertEqual(len(download.calls), 2)


class ProvenanceTests(unittest.TestCase):
    def test_local_provenance_shape(self) -> None:
        payload = resolve_input.build_local_provenance(Path("/abs/reference.fasta"), "deadbeef")

        self.assertEqual(payload["source"], "local")
        self.assertEqual(payload["path"], "/abs/reference.fasta")
        self.assertEqual(payload["checksum"], {"algorithm": "sha256", "value": "deadbeef"})
        self.assertEqual(payload["origin"], "imported")

    def test_ncbi_provenance_shape(self) -> None:
        payload = resolve_input.build_ncbi_provenance(
            "GCF_000000001.1", "reuse", "deadbeef", "18.36.0", False
        )

        self.assertEqual(payload["source"], "ncbi")
        self.assertEqual(payload["accession"], "GCF_000000001.1")
        self.assertEqual(payload["cache_mode"], "reuse")
        self.assertEqual(payload["datasets_cli_version"], "18.36.0")
        self.assertFalse(payload["downloaded"])
        self.assertEqual(payload["origin"], "imported")


class MainLocalTests(unittest.TestCase):
    def test_resolves_reference_fasta_and_gff3(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            fasta = temp_dir / "reference.fasta"
            gff3 = temp_dir / "reference.gff3"
            fasta.write_text(">chr1\nACGT\n", encoding="utf-8")
            gff3.write_text("##gff-version 3\n", encoding="utf-8")

            exit_code = resolve_input.main(
                [
                    "--role", "reference",
                    "--source-type", "local",
                    "--fasta-destination", str(temp_dir / "out" / "reference.fasta"),
                    "--fasta-provenance", str(temp_dir / "prov" / "reference.fasta.json"),
                    "--gff3-destination", str(temp_dir / "out" / "reference.gff3"),
                    "--gff3-provenance", str(temp_dir / "prov" / "reference.gff3.json"),
                    "--local-fasta", str(fasta),
                    "--local-gff3", str(gff3),
                ]
            )

            self.assertEqual(exit_code, 0)
            self.assertTrue((temp_dir / "out" / "reference.fasta").is_file())
            self.assertTrue((temp_dir / "out" / "reference.gff3").is_file())
            provenance = json.loads((temp_dir / "prov" / "reference.fasta.json").read_text(encoding="utf-8"))
            self.assertEqual(provenance["source"], "local")


    def test_resolves_a_backbone_fasta_without_gff3(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            fasta = temp_dir / "backbone.fasta"
            fasta.write_text(">chr1\nACGT\n", encoding="utf-8")

            exit_code = resolve_input.main(
                [
                    "--role", "backbone",
                    "--source-type", "local",
                    "--fasta-destination", str(temp_dir / "out" / "backbone.fasta"),
                    "--fasta-provenance", str(temp_dir / "prov" / "backbone.fasta.json"),
                    "--local-fasta", str(fasta),
                ]
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual((temp_dir / "out" / "backbone.fasta").read_text(encoding="utf-8"), ">chr1\nACGT\n")
            self.assertEqual(sorted(path.name for path in (temp_dir / "out").iterdir()), ["backbone.fasta"])


class MainNcbiTests(unittest.TestCase):
    def test_resolves_a_backbone_accession_as_fasta_only(self) -> None:
        import tempfile

        fake_download = FakeDownload()
        original_download = resolve_input.download_accession
        original_version = resolve_input.get_datasets_version
        resolve_input.download_accession = fake_download
        resolve_input.get_datasets_version = lambda datasets_bin: "18.36.0"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_dir = Path(tmp)
                exit_code = resolve_input.main(
                    [
                        "--role", "backbone",
                        "--source-type", "ncbi",
                        "--fasta-destination", str(temp_dir / "out" / "backbone.fasta"),
                        "--fasta-provenance", str(temp_dir / "prov" / "backbone.fasta.json"),
                        "--accession", "GCF_000149205.2",
                        "--cache-dir", str(temp_dir / "cache"),
                        "--cache-mode", "refresh",
                    ]
                )

                self.assertEqual(exit_code, 0)
                self.assertEqual(fake_download.calls, [("GCF_000149205.2", ["genome"])])
                provenance = json.loads((temp_dir / "prov" / "backbone.fasta.json").read_text(encoding="utf-8"))
                self.assertEqual(provenance["cache_mode"], "refresh")
        finally:
            resolve_input.download_accession = original_download
            resolve_input.get_datasets_version = original_version

    def test_resolves_target_fasta_via_injected_download(self) -> None:
        import tempfile

        fake_download = FakeDownload()
        original_download = resolve_input.download_accession
        original_version = resolve_input.get_datasets_version
        resolve_input.download_accession = fake_download
        resolve_input.get_datasets_version = lambda datasets_bin: "18.36.0"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_dir = Path(tmp)
                exit_code = resolve_input.main(
                    [
                        "--role", "target",
                        "--source-type", "ncbi",
                        "--fasta-destination", str(temp_dir / "out" / "target.fasta"),
                        "--fasta-provenance", str(temp_dir / "prov" / "target.fasta.json"),
                        "--accession", "GCA_000000001.1",
                        "--cache-dir", str(temp_dir / "cache"),
                        "--cache-mode", "reuse",
                    ]
                )

                self.assertEqual(exit_code, 0)
                self.assertEqual(fake_download.calls, [("GCA_000000001.1", ["genome"])])
                self.assertTrue((temp_dir / "out" / "target.fasta").is_file())
                provenance = json.loads((temp_dir / "prov" / "target.fasta.json").read_text(encoding="utf-8"))
                self.assertEqual(provenance["accession"], "GCA_000000001.1")
                self.assertEqual(provenance["datasets_cli_version"], "18.36.0")
                self.assertTrue(provenance["downloaded"])
        finally:
            resolve_input.download_accession = original_download
            resolve_input.get_datasets_version = original_version


if __name__ == "__main__":
    unittest.main()
