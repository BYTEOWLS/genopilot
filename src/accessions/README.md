# Genome-source boundary

`registry.ts` registers packaged providers. Shared catalog, storage, discovery,
registration, and view operations live here alongside the cache and provider contract.
Provider-specific code lives under `provider/<id>/`: `provider/ncbi/` owns accession
validation, metadata fetching and validation, REST downloads, and ZIP extraction.
VEuPathDB will live under `provider/veupathdb/` when implemented. NCBI API evidence
is recorded in `provider/ncbi/README.md`. Catalog identity is `(source, id)`;
providers validate parameters and metadata. Exact resolution and staged download
are required; metadata lookup, search, and browse are optional methods. Providers
declare `artifacts` as supported file kinds and display labels. The current formats
are FASTA and GFF3; the catalog renders the declaration, not its own artifact list.

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
FASTA cannot be combined silently with preserved annotation: refresh both together.
An unavailable annotation-only request publishes no empty cache.

Downloads use a per-entry filesystem lock and a private staging directory. Workflow
consumers use `withGenomeCache`, which holds that same lock through consumption,
including reuse from a snapshotted cross-root path. `resolveGenomeCache` returns
catalog facts and paths, not a consumer lease. All
files are checked before publication. Refresh keeps the prior directory until
commit and restores it if publication fails. Deletion uses the same lock. Locks
are not stolen automatically; an interrupted process may require inspecting and
removing its lock. Classic and ZIP64 single-part archives are supported for stored
and deflated members. ZIP64 sizes and offsets must fit safe integers; malformed
records, multipart/encrypted archives, unsupported compression, and directories
larger than 64 MiB fail before publication.

## Remaining integration

Catalog download and provider setup are registry-driven. Every provider requires
metadata/reference review and explicit Download confirmation. Optional metadata
lookup runs before review; failure never starts a download. Review can save only
metadata, preserving existing labels/cache copies, or explicitly download files.
The review's artifact chooser uses the shared selectable list; Space toggles checks,
Enter applies them, and Escape keeps the prior selection. All provider-declared
artifacts start selected. An empty selection still permits metadata-only saving,
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

Workflow configuration, resolver, rules, and provenance still need wiring to that
bridge. Current workflow downloads still use the Datasets CLI and do not write the
new provider cache record. Review finding 4 is not closed for workflow runs until
this integration replaces the old resolver path. VEuPathDB is not registered:
authenticated current/older-release evidence is required first. See
`resources/releases/0.0.4/01_genome_sources.md` for delivery order and acceptance.
