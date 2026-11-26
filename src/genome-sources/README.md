# Genome-source boundary

`registry.ts` registers packaged providers. Catalog identity is `(source, id)`;
providers validate parameters and metadata. Exact resolution and staged download
are required; metadata lookup, search, and browse are optional methods.

`cache.ts` writes fixed genome filenames, SHA-256 checksums, and `genome.json`
(reference, metadata, provider facts, annotation availability). Discovery validates
that record through the registry before hashing files. Discovery checks all recorded
files; role-specific reuse checks only required files and never returns unverified
annotation paths or digests. FASTA validation rejects empty sequence records.
Catalog entries never hold credentials. Remote credentials enter only through the provider context.

Downloads use a per-entry filesystem lock and a private staging directory. All
files are checked before publication. Refresh keeps the prior directory until
commit and restores it if publication fails. Deletion uses the same lock. Locks
are not stolen automatically; an interrupted process may require inspecting and
removing its lock. ZIP64 packages currently fail explicitly rather than being
partly extracted.

## NCBI evidence

The Datasets REST download route and archive layout were checked with an exact,
versioned assembly request:

```text
GET /datasets/v2/genome/accession/{id}/download
    ?include_annotation_type=GENOME_FASTA
    &include_annotation_type=GENOME_GFF

ncbi_dataset/data/assembly_data_report.jsonl
ncbi_dataset/data/{id}/{id}_{assembly_name}_genomic.fna
ncbi_dataset/data/{id}/genomic.gff
```

The API also returned `dataset_catalog.json`, `md5sum.txt`, and a README; these
are not extracted. Only the requested assembly's files and its single report
are accepted. Tests build small synthetic stored/deflated ZIPs and inject HTTP
responses; no downloaded genome or key is kept as a fixture.

Reference: https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/

## Remaining integration

The catalog download action, provider setup UI, and packaged Node/Python workflow
handoff are not wired yet. Workflow handoff must protect verification through the
copy into the run: returned cache paths currently have no reader-lifetime protection
against refresh or deletion. Current workflow downloads still use the Datasets CLI
and do not write the new provider cache record. VEuPathDB is not registered:
authenticated current/older-release route evidence is required first. See
`resources/releases/0.0.4/01_genome_sources.md` for delivery order and acceptance.
