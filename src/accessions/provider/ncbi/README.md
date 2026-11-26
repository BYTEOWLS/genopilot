# NCBI provider evidence

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

A later live check reproduced the reported encoding error: even a roughly 11 MB
package used `0xffffffff` member sizes with ZIP64 extra field `0x0001`, containing
64-bit uncompressed and compressed sizes. Its end record remained classic.
The shared downloader now successfully extracts and verifies that layout, including
FASTA and GFF3, without keeping downloaded data in the repository. Synthetic tests
also cover ZIP64 directories, streamed data descriptors, malformed/unsafe fields,
CRC failures, and cancellation before publication.

Reference: https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/

