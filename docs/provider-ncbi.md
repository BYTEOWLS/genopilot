# NCBI

## About this provider

NCBI maintains public genome assemblies and annotations. GenoPilot downloads a specific assembly through the NCBI Datasets REST API, using a versioned GenBank (`GCA_…`) or RefSeq (`GCF_…`) accession. These are distinct assembly records; do not assume their sequences or annotations are interchangeable.

Find an assembly on the [NCBI genome search website](https://www.ncbi.nlm.nih.gov/datasets/genome/), then copy its complete versioned accession into GenoPilot. GenoPilot currently supports exact-accession lookup, not organism-name search or browsing for this provider.

## API key

An NCBI API key is **optional**. You can download without one. NCBI documents its request limits and key use in [Datasets API keys](https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/).

1. Sign in to an NCBI account and open [account settings](https://www.ncbi.nlm.nih.gov/account/settings/).
2. Find **API Key Management** and create or copy an API key.
3. In GenoPilot, open **Manage tooling → Accession Providers → NCBI**.
4. Enter the key in **API key**, move to **Save settings**, and press Enter.

Stored secrets are masked and never prefilled. **Configured** means a key is stored, not that NCBI has accepted it. Clearing a key does not remove downloaded files.

## What GenoPilot requests

| Choice | Current behavior |
|---|---|
| API | NCBI Datasets REST API |
| Identity | Exact versioned assembly accession; no automatic substitution |
| Metadata | Assembly report for that accession |
| Artifacts | Genomic FASTA, available GFF3, and annotated proteins (FASTA), independently selectable |
| Sequence scope | Whole assembly as supplied; no automatic mitochondrial exclusion |

Protein FASTA contains amino-acid sequences translated from annotated coding regions, not DNA bases. It does not replace genomic FASTA or GFF3. Not every assembly has annotated proteins: if NCBI supplies none for a selected protein download, deselect annotated proteins in download review and retry. A failed download leaves existing verified files unchanged.

A missing annotation is different from a failed download. A verified genomic FASTA can remain usable where annotation is not required. GenoPilot records the accession, provider facts, checksums, and downloaded/reused origin.

See [Managing accessions](genome-sources.md) for download review, cache reuse, provider settings, and workflow input requirements. Technical API documentation: [NCBI Datasets REST API](https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/).
