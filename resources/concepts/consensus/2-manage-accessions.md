# Task 2 — Manage accessions

## Goal

Turn the existing NCBI-access placeholder into a reusable accession catalog with researcher labels, NCBI metadata, verified cache discovery, and selection support for Task 3. Cataloging an accession does not download its assembly files; scientific workflows retrieve them on demand through the existing Snakemake resolver.

This catalog manages versioned NCBI **assembly** accessions (`GCA_….<version>` and `GCF_….<version>`). Raw-read run accessions remain part of a future isolate-source design and are not folded into this catalog.

## Catalog contract

Keep researcher-entered presentation separate from fetched NCBI facts and detected cache state:

```yaml
schema_version: 1
output_roots:
  - /analysis
accessions:
  - accession: GCF_000149205.2
    name: Preferred T2T backbone
    description: Local note about intended use
    ncbi:
      organism: Example organism
      tax_id: 12345
      assembly_name: Example assembly
      assembly_level: Complete Genome
      assembly_status: current
      assembly_type: haploid
      refseq_category: reference genome
      strain: Example strain
      submitter: Example submitter
      retrieved_at: 2026-01-01T12:00:00.000Z
      source: datasets-v2-rest
    cached_copies:
      - path: /analysis/ncbi-accessions-cache/GCF_000149205.2
        verified_at: 2026-01-01T12:00:00.000Z
        fasta_sha256: "..."
        gff3_sha256: "..."
```

The versioned accession is the stable identity. `name` and `description` are editable local presentation. Organism, assembly name, strain, assembly status, and other displayed NCBI fields are fetched facts with retrieval provenance, not editable substitutes for local notes. Do not persist guessed strain values when NCBI does not provide one.

`name` is optional; the accession is shown when it is absent. `ncbi` is `null` until metadata was retrieved, and every optional fact NCBI does not report is omitted. `source` records whether the facts came from the pinned NCBI Datasets v2 REST API (`datasets-v2-rest`) or from the `assembly_data_report.jsonl` the Datasets CLI caches with a download (`cached-download-report`); discovery never replaces metadata already recorded. `cached_copies` is the set of verified copies from the latest discovery; `verified_at` is when discovery first verified those bytes at that path, and `gff3_sha256` is present only when the copy includes GFF3. The catalog lives at `accessions/accessions.yaml` beside the isolate catalog and shares its private, locked, atomic store.

An accession is normally cataloged before it is downloaded and may later have verified copies under more than one known output root. Different bytes for the same versioned accession are an error requiring inspection, not an automatic preference. Keeping uncached catalog entries metadata-only avoids consuming storage for assemblies that no workflow has used.

## Automatic cache discovery

Opening or refreshing **Manage accessions** scans only application-known output roots and explicitly selected cache directories; it must not crawl the user's filesystem. The known roots are the current directory's `runs` folder, which is always scanned and never stored, and the catalog's `output_roots`, which the researcher adds or forgets and which a successful run with an NCBI input extends with its own output root. Only `<root>/ncbi-accessions-cache/<accession>/` is read. For every candidate accession directory:

- require a valid versioned accession name;
- read existing checksum/provenance records from the implemented resolver;
- verify expected files and checksums;
- add or update the catalog record automatically when valid;
- mark incomplete, stale, or checksum-invalid copies visibly without trusting them;
- perform no network request or deletion merely because discovery ran.

After a successful run whose configuration used an NCBI input, the TUI stores the run's output root and runs discovery, which registers or updates the accession and its verified cache copy from the resolver's `checksums.json` and cached report. Catalog registration is not required for direct Snakemake execution and never changes scientific outputs or the run's status. **Manage accessions** never downloads or refreshes assembly files; reuse/refresh is selected while configuring a workflow that needs the accession. It deletes assembly files only when the researcher removes an entry (see below).

## TUI behavior

- List accessions by local name, versioned accession, organism, assembly name, strain when available, and cache status.
- Add a versioned accession and retrieve lightweight metadata before confirmation when available.
- Edit local name and description without changing fetched NCBI facts.
- Show uncached entries without implying that their assembly files are locally available.
- Refresh lightweight metadata independently from workflow-owned assembly retrieval.
- Discover existing verified cache entries and explain damaged entries.
- Keep the optional NCBI API-key management available without displaying the secret.
- Organize the screen as tabs: **Accessions**, **Output roots**, and **NCBI API key**, switched with Tab or ←/→ as in the file browser; while the API-key field holds a draft, ←/→ move its cursor.
- Keep the list to one line per entry; opening an entry shows and edits everything about it: local fields, NCBI facts with provenance, verified and damaged copies, and conflicts.
- Removing an entry asks for confirmation and lists its cache directories under the known roots, verified or damaged. Confirming deletes them first and then the record, so a workflow that later needs the accession downloads it again; if deletion fails, the record stays. Removing an uncached entry deletes only the record.

## Kickoff decisions

- Metadata comes from the NCBI Datasets v2 REST `genome/accession/<accession>/dataset_report` endpoint through Node `fetch`. The API key is optional and sent only as a request header when configured. NCBI answers an unknown accession with an empty report, which blocks adding it; offline, rate-limited, and other failures still allow a metadata-less entry that can be refreshed later.
- Known output roots are stored in the catalog as `output_roots`, as described above.
- Removal deletes the entry's cached assembly files after confirmation instead of leaving them for discovery to re-add. This supersedes the original rule that removing a record never deletes cached data.

## Work

- [x] Define and validate the versioned accession-catalog schema.
- [x] Define the minimal pinned NCBI metadata fields and retrieval provenance.
- [x] Reuse existing versioned-accession validation and API-key handling for metadata, while leaving assembly download, checksums, and cache modes in consuming workflows.
- [x] Track application-known output roots without introducing an unrestricted filesystem scan.
- [x] Implement verified automatic cache discovery and duplicate-copy conflict handling.
- [x] Implement list, add, edit-local-metadata, metadata-refresh, and remove-catalog-entry flows without an eager assembly-download action.
- [x] Register the caches of a successful NCBI-sourced run automatically.
- [x] Add tests for offline/error states, metadata without strain, valid and damaged caches, duplicate locations, resizing, and secret redaction.

## Acceptance

A researcher can label and inspect a versioned assembly accession without downloading its assembly, see authoritative NCBI metadata and any verified local availability, and have existing cache entries discovered automatically. A consuming workflow retrieves uncached files on demand and records them afterwards. Removing a catalog record deletes its cached sequence data after confirmation, so a later workflow downloads it again.
