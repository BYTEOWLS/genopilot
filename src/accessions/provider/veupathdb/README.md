# VEuPathDB provider

`mapMetadata` exposes shared organism, strain, strain taxon ID, and contig count from current-release organism reports. Species, genome/annotation version, site/release, file abbreviation, record ID, chromosome/supercontig counts, and rounded megabases follow as provider-specific attributes. Missing or malformed optional report facts stay unavailable. Retrieval time is separate from assembly and database dates. Older metadata remains readable; refresh populates the new fields without downloading genome files.

Supported component sites are declared in `index.ts`: FungiDB, ToxoDB, and PlasmoDB. One required `api-key` setting serves all sites. Authentication uses an HTTPS Bearer header; redirects are refused and response bodies are not included in errors.

## Discovery

- `GET https://<host>/a/service` identifies the site and current release.
- `record-types/organism/searches/GenomeDataTypes/reports/standard` lists organisms with `primary_key`, `name_for_filenames`, `project_id`, and `genome_version`, plus record keys.
- `reportConfig` requests plain text, ascending primary-key sorting, and pages of 200 records using `{offset, numRecords}`. Changed totals, duplicate records, incomplete pages, or a changed service release fail discovery rather than producing ambiguous references.
- Search matches every whitespace-separated query word against organism name, source ID, or canonical ID, ignoring case. This is local filtering of the site's authoritative current-release listing, not the native full-text search with its broader term semantics. No historical search or fuzzy spelling correction is claimed.
- Canonical identity is `<site>-<release>_<organism abbreviation>`, with exactly matching provider parameters. Historical metadata contains only pinned parameters; current facts are never substituted.

## Files

Downloads use the verified route:

```text
https://<host>/a/service/raw-files/release-<release>/<abbreviation>/<fasta-or-gff>/data/<site>-<release>_<abbreviation><suffix>
```

| Artifact | Directory | Suffix | Cache filename |
|---|---|---|---|
| Genomic FASTA | fasta | `_Genome.fasta` | genomic.fna |
| Annotation | gff | `.gff` | genomic.gff |
| Proteins | fasta | `_AnnotatedProteins.fasta` | proteins.faa |
| Transcripts | fasta | `_AnnotatedTranscripts.fasta` | transcripts.fna |
| CDS | fasta | `_AnnotatedCDSs.fasta` | cds.fna |

These are whole-genome files, including organellar sequences where supplied. New download reviews default to excluding mitochondrial sequences from genomic FASTA/GFF3. The provider-owned boolean option produces a distinct reference with `exclude_mitochondrial: true` and an `__nuclear` ID suffix; the suffix is reserved and removed before constructing source URLs. Whole-genome references and existing caches remain unchanged. Exact filtered IDs and saved references retain the choice through direct resolution.

`mitochondria.ts` recognizes explicit mito/mitochondrion/mitochondrial/mitochondria/chrM tokens in genome headers or GFF sequence IDs, plus GFF region `genome=mitochondrion` or `organelle=mitochondrion` attributes. Unknown sequences are retained, not guessed from length. It removes matching genomic records, annotation features, and sequence-region directives without changing retained coordinates. Embedded GFF FASTA and an empty resulting genome fail before publication. Other artifact types remain unfiltered whole-genome files.

Filtering fetches the genomic pair as classification inputs even for an individual genomic artifact, ensuring header- and GFF-based identification agree across independent downloads. Only selected derived artifacts and their byte-identical sources are published; unselected classification inputs are recorded by checksum rather than retained.

Byte-identical selected genomic sources are retained under `original/`; the cache verifies and preserves them with their derived artifacts during partial refresh. `facts.artifacts` owns per-artifact filtering provenance; the top-level filtering summary describes the latest request only. Provenance records source and classification-input digests, excluded IDs/base counts, removed-feature counts, and the detection policy. Completion notices list exclusions and counts; full lists remain in `genome.json`. Reported metadata is not rewritten to pretend it describes the filtered genome. Reported metadata URLs are not trusted as download destinations: observed links use HTTP, `Current_Release`, an obsolete GFF path, and an incorrect CDS filename. Missing pinned files never fall back to the current release.

A GFF 404 is considered unavailable only after confirming the pinned genome route exists. Other failures remain errors. A metadata-only or unavailable annotation-only request never publishes an empty cache. Shared cache validation, checksums, leases, rollback, and partial-refresh rules apply to every artifact. Progress reports actual accumulated transfer bytes without inventing a total.

## Evidence and tests

The authenticated investigation is retained at `resources/releases/0.0.4/done_veupathdb-api-evidence.md`. It records full FungiDB genome/GFF inspection, additional artifact checks, historical-release evidence, component-site coverage, and response quirks. Tests use synthetic sequences and injected HTTP responses; downloaded biological files and keys are not fixtures.

`tests/accessions/veupathdb-live.test.ts` is opt-in. It exercises live discovery on all supported sites, all five FungiDB artifacts through the packaged Python bridge, reuse without stored credentials, historical downloads, and an unavailable release. When the managed pinned Snakemake exists, it also checks offline reuse for reference, target, and backbone inputs from an unrelated working directory. No scientific analysis or Conda provisioning runs.

References:

- https://fungidb.org/service-api.html
- https://static-content.veupathdb.org/content/VEuPathDB/webServices.html
- https://static-content.veupathdb.org/documents/Using-Web-services-Dec2023.pdf
