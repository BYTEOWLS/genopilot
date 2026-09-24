# Task 2 — Manage accessions

## Goal

Turn the existing NCBI-access placeholder into a reusable accession catalog with researcher labels, NCBI metadata, verified cache discovery, and selection support for Task 3. Cataloging an accession does not download its assembly files; scientific workflows retrieve them on demand through the existing Snakemake resolver.

This catalog manages versioned NCBI **assembly** accessions (`GCA_….<version>` and `GCF_….<version>`). Raw-read run accessions remain part of a future isolate-source design and are not folded into this catalog.

## Catalog contract

Keep researcher-entered presentation separate from fetched NCBI facts and detected cache state:

```yaml
schema_version: 1
accessions:
  - accession: GCF_000149205.2
    name: Preferred T2T backbone
    description: Local note about intended use
    ncbi:
      organism: Example organism
      assembly_name: Example assembly
      strain: Example strain
    cached_copies:
      - path: /analysis/ncbi-accessions-cache/GCF_000149205.2
        verified_at: 2026-01-01T12:00:00.000Z
        fasta_sha256: "..."
```

The versioned accession is the stable identity. `name` and `description` are editable local presentation. Organism, assembly name, strain, assembly status, and other displayed NCBI fields are fetched facts with retrieval provenance, not editable substitutes for local notes. Do not persist guessed strain values when NCBI does not provide one.

An accession is normally cataloged before it is downloaded and may later have verified copies under more than one known output root. Different bytes for the same versioned accession are an error requiring inspection, not an automatic preference. Keeping uncached catalog entries metadata-only avoids consuming storage for assemblies that no workflow has used.

## Automatic cache discovery

Opening or refreshing **Manage accessions** scans only application-known output roots and explicitly selected cache directories; it must not crawl the user's filesystem. For every candidate accession directory:

- require a valid versioned accession name;
- read existing checksum/provenance records from the implemented resolver;
- verify expected files and checksums;
- add or update the catalog record automatically when valid;
- mark incomplete, stale, or checksum-invalid copies visibly without trusting them;
- perform no network request or deletion merely because discovery ran.

A successful workflow download also emits enough metadata for the TUI to register or update the accession and its verified cache copy automatically. Catalog registration is not required for direct Snakemake execution and never changes scientific outputs. **Manage accessions** never downloads, refreshes, or deletes assembly files; reuse/refresh is selected while configuring a workflow that needs the accession.

## TUI behavior

- List accessions by local name, versioned accession, organism, assembly name, strain when available, and cache status.
- Add a versioned accession and retrieve lightweight metadata before confirmation when available.
- Edit local name and description without changing fetched NCBI facts.
- Show uncached entries without implying that their assembly files are locally available.
- Refresh lightweight metadata independently from workflow-owned assembly retrieval.
- Discover existing verified cache entries and explain damaged entries.
- Keep the optional NCBI API-key management available without displaying the secret.

## Work

- [ ] Define and validate the versioned accession-catalog schema.
- [ ] Define the minimal pinned NCBI metadata fields and retrieval provenance.
- [ ] Reuse existing versioned-accession validation and API-key handling for metadata, while leaving assembly download, checksums, and cache modes in consuming workflows.
- [ ] Track application-known output roots without introducing an unrestricted filesystem scan.
- [ ] Implement verified automatic cache discovery and duplicate-copy conflict handling.
- [ ] Implement list, add, edit-local-metadata, metadata-refresh, and remove-catalog-entry flows without an eager assembly-download action.
- [ ] Add tests for offline/error states, metadata without strain, valid and damaged caches, duplicate locations, resizing, and secret redaction.

## Acceptance

A researcher can label and inspect a versioned assembly accession without downloading its assembly, see authoritative NCBI metadata and any verified local availability, and have existing cache entries discovered automatically. A consuming workflow retrieves uncached files on demand and records them afterwards; removing a catalog record does not delete cached sequence data.
