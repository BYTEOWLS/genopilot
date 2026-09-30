# Genome annotation transfer

This workflow copies the gene annotation of a reference genome onto a target genome, such as a newly assembled or consensus genome of a related strain of the same species. It maps every reference gene model onto the target with LiftOn [1], keeps LiftOn's own output as evidence, checks the structure of the resulting GFF3, and reports how much of the annotation was transferred and how the transferred genes changed.

The result is a target annotation to review, not a curated one: genes the target lacks, gained copies, and changed proteins are reported rather than resolved. What every item of the result page means is explained in the workflow's [results page](results.md).

## Inputs

- **Reference**: a genome FASTA and its annotation GFF3 [2], either local files or a versioned NCBI assembly accession downloaded with both.
- **Target**: the genome FASTA to annotate, either a local file or a versioned NCBI assembly accession.

Both are copied into the run directory with a SHA-256 checksum before any step reads them, so no later step depends on where an input came from. An NCBI download is kept in a cache shared by all runs and reused only after its checksum matches.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| LiftOn profile | same-species | Fixed: LiftOn's defaults for genomes of the same species. No tuning options are exposed. |

The output directory, run name and description, and CPU allocation are recorded with the run but do not change its results.

## Background

A **gene model** is the set of GFF3 features that describe one gene: the gene, its transcripts, and their exons and coding sequences (CDS), linked by `Parent` attributes. Transferring an annotation means finding where each reference gene model lies on the target genome and writing it in the target's coordinates.

LiftOn combines two aligners. Liftoff [3] aligns each gene's DNA sequence with minimap2 [4], which works well while the target's sequence stays close to the reference. miniprot [5] aligns the reference protein instead, which still finds a gene whose DNA changed but whose protein is conserved. LiftOn builds each transferred gene model from both alignments and keeps the one whose protein is closest to the reference, comparing proteins with parasail [6]. A gene can be placed more than once, for example after a duplication in the target; the extra placements are reported as additional copies.

For every transferred transcript LiftOn compares the target's sequence and protein with the reference and records its identities and **mutation classes**, such as `synonymous`, `frameshift`, or `stop_codon_gain`. These say what changed in the protein, not whether the gene still works.

## Steps

1. **Resolve inputs**: copy the local files or download the NCBI accessions, and record their checksums.
2. **Validate inputs**: check the structure of the FASTA and GFF3 files and that the reference annotation's sequence names exist in the reference FASTA. LiftOn starts only when this check passed; otherwise the report stays in place with every problem it found.
3. **Transfer annotation**: LiftOn maps the reference gene models onto the target. Its raw GFF3 and its complete output directory are kept unmodified.
4. **Validate annotation**: check the structure of LiftOn's GFF3: the version header, coordinates, strand, CDS phase, identifiers, and parent relationships. A failed check is kept as a scientific result for review, not treated as a failed run.
5. **Summarize results**: the per-feature transfer table, the metrics, and the completion summary with the run status.
6. **Record provenance**: the run's artifact index and provenance record.

## Outputs

Paths are inside the run directory.

| Path | Content |
|---|---|
| `resolved/` | the checksummed copies of the reference FASTA and GFF3 and the target FASTA |
| `results/input-validation.json` | the structural check of the inputs |
| `results/annotation/lifton.raw.gff3` | the transferred annotation exactly as LiftOn wrote it |
| `results/annotation/lifton_output/` | LiftOn's statistics, intermediate files, and its Liftoff and miniprot outputs |
| `results/validation.json` | the structural check of the transferred annotation |
| `results/feature-transfer.tsv` | one row per selected reference feature and per target copy |
| `results/metrics.json` | the transfer metrics with their one-line definitions |
| `results/summary.json` | the run status, the metrics, and links to every report |
| `artifacts.yaml` | every file's checksum and whether it was generated or imported |
| `provenance/run.json` | the effective configuration, commands, tool versions, resources, and input checksums |
| `logs/` | the log and benchmark of every step |

## Tools

The versions are pinned only in the files linked below and recorded in every run's provenance.

| Tool | Role | Pinned in | Reference |
|---|---|---|---|
| Snakemake | scheduling, per-step environments, reruns | GenoPilot runtime ([`policy.ts`](../../src/tooling/policy.ts)) | [7] |
| NCBI Datasets CLI | downloading NCBI accessions | [`ncbi-datasets-cli`](../shared/envs/ncbi-datasets-cli/environment.yaml) | [8] |
| LiftOn | annotation transfer | [`lifton`](../shared/envs/lifton/environment.yaml) | [1] |
| minimap2 | DNA alignment inside Liftoff | [`lifton`](../shared/envs/lifton/environment.yaml) | [4] |
| miniprot | protein-to-genome alignment | [`lifton`](../shared/envs/lifton/environment.yaml) | [5] |
| parasail | protein and sequence comparison | [`lifton`](../shared/envs/lifton/environment.yaml) | [6] |

LiftOn drives minimap2, miniprot, and parasail itself, so they are pinned together in one environment. Input checks, validation, and the summaries are small scripts that read the tools' outputs.

Publications that use this workflow's results should cite the tools above, next to the GenoPilot version that produced them.

## References

1. Chao KH, Heinz JM, Hoh C, Mao A, Shumate A, Pertea M, Salzberg SL. Combining DNA and protein alignments to improve genome annotation with LiftOn. Genome Res 35:311–325 (2025). https://doi.org/10.1101/gr.279620.124
2. The Sequence Ontology. Generic Feature Format Version 3 (GFF3), specification 1.26. https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md
3. Shumate A, Salzberg SL. Liftoff: accurate mapping of gene annotations. Bioinformatics 37:1639–1643 (2021). https://doi.org/10.1093/bioinformatics/btaa1016
4. Li H. Minimap2: pairwise alignment for nucleotide sequences. Bioinformatics 34:3094–3100 (2018). https://doi.org/10.1093/bioinformatics/bty191
5. Li H. Protein-to-genome alignment with miniprot. Bioinformatics 39:btad014 (2023). https://doi.org/10.1093/bioinformatics/btad014
6. Daily J. Parasail: SIMD C library for global, semi-global, and local pairwise sequence alignments. BMC Bioinformatics 17:81 (2016). https://doi.org/10.1186/s12859-016-0930-z
7. Mölder F, et al. Sustainable data analysis with Snakemake. F1000Research 10:33 (2021). https://doi.org/10.12688/f1000research.29032.2
8. O'Leary NA, et al. Exploring and retrieving sequence and metadata for species across the tree of life with NCBI Datasets. Sci Data 11:732 (2024). https://doi.org/10.1038/s41597-024-03571-y
