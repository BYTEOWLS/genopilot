# Genome-source boundary

`registry.ts` exports `accessionSources`, the registry of packaged providers. Shared catalog, storage, discovery,
registration, and view operations live here alongside the cache and provider contract.
Provider-specific code lives under `provider/<id>/`: `provider/ncbi/` owns accession
validation, metadata fetching and validation, REST downloads, and ZIP extraction.
`provider/veupathdb/` owns supported-site mapping, canonical release/organism IDs,
paged current-release organism discovery, and authenticated raw-file downloads. NCBI API evidence
is recorded in `provider/ncbi/README.md`. Catalog identity is `(source, id)`;
providers validate parameters and metadata. Exact resolution and staged download
are required; metadata lookup, search, and browse are optional methods. Providers
declare `artifacts` as supported file kinds and display labels. The current formats
are genomic FASTA, GFF3, proteins, transcripts, and CDS; the catalog renders the
declaration, not its own artifact list. Artifact identity is separate from FASTA
format: only genomic FASTA satisfies a workflow's genome requirement. Catalog
schema 3 records each artifact's checksum independently and rejects older catalogs
without migration; existing cache directories can be rediscovered.

`cache.ts` writes fixed genome filenames, SHA-256 checksums, and `genome.json`
(reference, metadata, provider facts, annotation availability). Discovery validates
that record through the registry before hashing files. Discovery checks all recorded
files; role-specific reuse checks only required files and never returns unverified
annotation paths or digests. FASTA validation rejects empty sequence records.
Catalog entries never hold credentials. Remote credentials enter only through the provider context.

Artifacts are independently selectable. Verified paths and digests are returned only
for requested files; FASTA is not assumed to exist in an annotation-only copy.
Discovery checks every recorded artifact, and a catalog copy must record at least
one checksum. Missing artifacts do not create conflicts with copies holding a larger
subset. Workflows must request and snapshot the files their role actually requires.

Partial refresh verifies unselected artifacts independently under the same source
lock, so repairing a damaged artifact does not discard a valid unchecked file.
Copied files are rehashed against their old digests before publication. A changed
genomic FASTA cannot be combined silently with preserved annotation, proteins,
transcripts, or CDS: refresh the affected artifacts together.
An unavailable annotation-only request publishes no empty cache.

Providers may return byte-identical source evidence through `originals`, using fixed `original/<artifact filename>` paths. The cache hashes these files, stores their digests in `genome.json`, verifies them on reuse, and preserves evidence for unchecked derived artifacts during partial refresh. Provider-owned `facts.artifacts` retains matching per-artifact provenance; the top-level facts describe the latest request.

Downloads use a per-entry filesystem lock and a private staging directory. Workflow
consumers use `withGenomeCache`, which holds that same lock through consumption,
including reuse from a snapshotted cross-root path. `resolveGenomeCache` returns
catalog facts and paths, not a consumer lease. All
files are checked before publication. Refresh keeps the prior directory until
commit and restores it if publication fails. Deletion uses the same lock. Locks
are not stolen automatically; an interrupted process may require inspecting and
removing its lock. Workflow rules coordinate same-genome consumers through
Snakemake resources without weakening the cache lease. Cross-instance cache
contention still fails explicitly rather than waiting. Classic and ZIP64 single-part
archives are supported for stored
and deflated members. ZIP64 sizes and offsets must fit safe integers; malformed
records, multipart/encrypted archives, unsupported compression, and directories
larger than 64 MiB fail before publication.

## Shared metadata

`metadata.ts` owns the typed Assembly and Genome statistics contract. Every provider implements `mapMetadata` over its validated persisted facts, returning the common fields, ordered provider-specific attributes, and separate retrieval provenance. NCBI maps both REST and cached assembly reports; shared screens never interpret NCBI records directly. The editor and download review use one renderer, stable field IDs, units, and explicit unavailable values.

This normalized projection is not separately persisted: provider metadata remains authoritative in catalogs and `genome.json`. Existing schema-3 records remain readable; new optional VEuPathDB facts need no migration or file redownload. Old records show unavailable fields until metadata is refreshed. No checksums, identity, or workflow snapshots change.

VEuPathDB maps organism, strain, strain taxon ID, and contig count. Its overloaded genome version (which can be a date), rounded megabases, and supercontigs remain custom attributes rather than guessed assembly names, exact bp lengths, or scaffold counts. Database release is never an assembly release date. Historical references retain pinned parameters only when current discovery cannot establish compatible facts. Missing metadata is not computed from files or enriched through another provider.

## Provider help

Each packaged provider contributes `docs/provider-<id>.md`, readable on GitHub and in the shared Markdown document page. `readProviderDocuments` opens that provider's page followed by shared catalog guidance. Global Help includes the registered providers' pages without a shared provider-name list. Tooling provider selection/setup and accession download/details/review expose `?` outside text fields, preserving drafts and choices on return. Provider help owns purpose, website search links, credentials, exact API discovery/search scope, and scientific transformations; implementation/API evidence stays in each provider's source README.

## Workflow handoff

Catalog download and provider setup are registry-driven. Every provider requires
metadata/reference review and explicit Download confirmation. Optional metadata
lookup runs before review; failure never starts a download. Review can save only
metadata, preserving existing labels/cache copies, or explicitly download files.
The review renders provider artifacts through the shared `CheckboxGroup`, also
used by the GFF3 attribute form. It composes `ParameterList` and owns toggle keys;
the form owns navigation and a focus-following review viewport. Tab and arrows move focus; Space or left/right toggles a checkbox.
Enter activates action buttons only; Escape leaves review without downloading.
Providers may declare boolean `downloadOptions` alongside artifacts, with labels, defaults, and canonical reference transformations. The review applies defaults before metadata lookup and carries toggled references into saving/download. VEuPathDB's mitochondrial inclusion defaults off and yields a separate filtered identity; its genomic-pair classification dependencies are downloaded even when only one genomic artifact is selected. Optional `downloadSummary` formats provider facts for the shared completion notice.

All provider-declared artifacts start selected. An empty selection still permits metadata-only saving,
but cannot start a download.
Provider progress callbacks report actual transfer bytes (optional total) and
extraction, verification, and publication stages; the noninteractive entry point
keeps stdout reserved for its copy handshake. `provider-settings.ts`
stores secrets separately by provider and field; no old key file is migrated.

`dist/genome-source.js` and `workflows/shared/scripts/genome_source.py` implement
the protected copy boundary. Python sends a nonsecret request and keeps stdin open;
Node returns verified paths and holds the source lock until Python acknowledges
checksummed, staged copies and their replacement into the run. EOF without an
acknowledgment fails and releases the lock. Consumer EOF during resolution aborts
an active download before publication; EOF after a valid acknowledgment is normal.
The installed-package check exercises
this pair from an unrelated directory, including blocked refresh during copying,
cross-root reuse, annotation-only copies, corrupt-copy rejection, and abandoned consumers.
Managed execution exports its running Node path as `GENOPILOT_NODE_EXECUTABLE`;
the Python bridge uses it without requiring Node on the restricted job PATH.
Direct execution falls back to `node` on PATH and explains how to configure it
when absent. Installed-package verification exercises the bridge with an empty PATH.

Both workflow configurations use schema 2 and save `{source: remote, reference,
cache_mode, copy?}`. The reference snapshots provider identity and parameters;
`copy` records a catalog path and only the role-required digests. Incomplete copies
are not snapshotted. Refresh removes the snapshot and writes into the run's output
root. The resolver/rules use this bridge for remote inputs; local file copying is
unchanged. Per-file provenance records provider facts, parameters, Node version,
checksums, and `downloaded`; verified reuse remains `imported`. The Datasets CLI
environment and tool/citation entries are removed. Installed-package verification
also invokes the workflow resolver CLI for reference, target, and backbone roles.
Direct-Snakemake cache-reuse tests require the pinned runtime and built bundle.
Provider-independent cache-miss tests bundle the entry point with two synthetic
providers and exercise all three roles through the packaged Python resolver;
provider-specific live evidence is separate. To repeat NCBI's live cache-miss and
subsequent reuse checks for both workflows, build first and put the pinned
Snakemake and Node on PATH, then run:

```bash
RUN_NCBI_DOWNLOAD_INTEGRATION=1 python3 -m unittest tests.workflows.shared.test_ncbi_cache_miss_integration -v
```

Only input-resolution targets run. Downloads stay in temporary directories;
normal test discovery skips live requests unless explicitly enabled.
VEuPathDB is registered alongside NCBI. Its provider declares supported sites;
`DownloadForm` renders the site chooser without owning a site/host table. Discovery
pages `GenomeDataTypes` and matches all query words locally against organism
names, record IDs, and file abbreviations. Search covers the current release only;
exact pinned references can download older releases. Historical metadata review
shows only the pinned parameters, never current organism facts mislabeled as old.
The provider constructs verified HTTPS release-specific routes rather than
following stale HTTP/Current_Release metadata links, and refuses redirects.

Live evidence covers all five FungiDB artifacts, historical FASTA/GFF3, the packaged
Python copy bridge, and pinned-Snakemake offline reuse for all three input roles.
Run after building with a local key file:

```bash
RUN_VEUPATHDB_DOWNLOAD_INTEGRATION=1 VEUPATHDB_KEY_FILE=/path/to/private/key pnpm exec tsx --import ./tests/setup.ts --test tests/accessions/veupathdb-live.test.ts
```

Both guided workflow forms use the full catalog. `selection.ts` serializes only
the provider-canonical reference into string-valued form state; the field renders
the identifier, not JSON. Previous-run prefill preserves that snapshot, and both
draft builders validate it without reconstructing NCBI parameters. Workflow fields
are selection-only; identifiers are entered in the catalog. Only entries with genomic
FASTA can be selected, and save-time checks require every role-required file in one
verified copy before starting a guided run. Reviews use provider metadata
summaries, and NCBI-only optional-key/strain checks are guarded by provider identity.
Required-file snapshots canonicalize parameters before comparison, so YAML key
order does not cause redundant downloads.
See `provider/veupathdb/README.md` for API evidence and limitations.
