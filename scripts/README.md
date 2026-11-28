# Developer scripts

Run commands from the repository root. These scripts are not included in the npm package.

## Build

```bash
pnpm build
```

`pnpm build` type-checks the sources and then bundles them with esbuild (`scripts/build.mjs`): the CLI with every dependency into one `dist/cli.js`, and the browser page and IGV into `dist/browser/assets/`. The package therefore has no runtime dependencies: an installation runs exactly the versions `pnpm-lock.yaml` pins, and dependencies are added as `devDependencies`. The build writes every bundled package's license into `dist/THIRD-PARTY-LICENSES.md` and fails for a license outside the permitted list or a package without a license file; such a package's reviewed upstream license goes into `resources/licenses/`. The bundle also embeds the commit it was built from, its date, and whether the working tree had uncommitted changes, which the tooling page shows; `pnpm dev` reads them from Git instead. Run `pnpm build` before opening browser documents or genome views from the source CLI; rebuild after changing browser code or styles.

`empty-module.js` is a build-only stub for optional React devtools; it is not a standalone command.

## Verify a package

```bash
pnpm pack:local
pnpm verify:package
```

`verify-package.mjs` installs the tarball into a temporary npm prefix, checks packaged resources and CLI startup, and calls `verify-package-genome-source.py` to exercise the installed Node/Python genome-copy bridge with synthetic files. It requires npm and Python and removes its temporary directory afterward.

To verify another tarball:

```bash
pnpm verify:package /path/to/package.tgz
```

## Comparing downloaded references

Compare a trusted reference with a downloaded copy locally (Python standard library only):

```bash
python3 scripts/compare-genome-files.py trusted.fna downloaded.fna
python3 scripts/compare-genome-files.py trusted.faa downloaded.faa
python3 scripts/compare-genome-files.py trusted.gff downloaded.gff --limit 5 > comparison.json
```

The JSON report includes each file's raw SHA-256 and normalized differences. Exit codes are `0` for normalized equality, `1` for differences, and `2` for errors. Gzip inputs are detected by content. `--format fasta|gff|text` overrides filename-based detection; `--limit` bounds examples, not counts.

- FASTA: matches exact IDs regardless of record order or wrapping; reports missing IDs, changed sequences/lengths, and changed headers. Case, ambiguous residues, and terminal protein stops remain significant. Sequence checksums are not alignment identities.
- GFF: compares all nine columns as an unordered multiset, preserving duplicates. Attribute order and trailing semicolons are ignored; values, coordinates, source, scores, and phase remain significant. Comments and directives are ignored; embedded FASTA is compared separately. A changed row counts once on each side, not as two changed genes.
- Other text: compares line positions, ignoring newline style. An insertion can shift subsequent comparisons.

Sequence content is streamed; memory grows with FASTA IDs or distinct GFF row hashes, not genome length. Files are read more than once and must remain unchanged during comparison. Empty FASTA/GFF files and malformed record structure fail; this is not a full biological-format validator. The script does not download files or establish release identity: compare the same organism, release, artifact kind, and mitochondrial-inclusion policy. Equality alone cannot explain an annotation-transfer quality change. This developer utility is not included in the npm package.
