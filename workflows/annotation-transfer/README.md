# Genome annotation transfer

This workflow copies the gene annotation of a reference genome onto a target genome, such as a newly assembled or consensus genome of a related strain of the same species. It maps every reference gene model onto the target with LiftOn [1], keeps LiftOn's own output as evidence, checks the structure of the resulting GFF3, and reports how much of the annotation was transferred and how the transferred genes changed.

The result is a target annotation to review, not a curated one: genes the target lacks, gained copies, and changed proteins are reported rather than resolved. Every coding gene's protein is rated, and the genes that need a closer look are listed for review with their reasons. What every item of the result page means is explained in the workflow's [results page](results.md).

## Inputs

- **Reference**: a genome FASTA and its annotation GFF3 [2], either local files or a versioned NCBI assembly accession downloaded with both.
- **Target**: the genome FASTA to annotate, either a local file or a versioned NCBI assembly accession.

Both are copied into the run directory with a SHA-256 checksum before any step reads them, so no later step depends on where an input came from. An NCBI download is kept in a cache shared by all runs and reused only after its checksum matches.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| LiftOn profile | same-species | Fixed: LiftOn's defaults for genomes of the same species. No tuning options are exposed. |
| Minimum protein identity | 99% | A coding gene whose transferred protein matches the reference protein less closely, in its least similar transcript, is listed for review. Only the summary step uses it. |

The output directory, run name and description, and CPU allocation are recorded with the run but do not change its results.

## Background

A **gene model** is the set of GFF3 features that describe one gene: the gene, its transcripts, and their exons and coding sequences (CDS), linked by `Parent` attributes. Transferring an annotation means finding where each reference gene model lies on the target genome and writing it in the target's coordinates.

LiftOn combines two aligners. Liftoff [3] aligns each gene's DNA sequence with minimap2 [4], which works well while the target's sequence stays close to the reference. miniprot [5] aligns the reference protein instead, which still finds a gene whose DNA changed but whose protein is conserved. LiftOn builds each transferred gene model from both alignments and keeps the one whose protein is closest to the reference, comparing proteins with parasail [6]. A gene can be placed more than once, for example after a duplication in the target; the extra placements are reported as additional copies. When the DNA lift placed a gene once, LiftOn can still add one model at a second locus where miniprot finds the gene's protein and no other model lies, which recovers the second copy of a duplicated gene; such a model is marked `lifton_rescue_second_locus=true` in the raw GFF3. Between strains of one species this rarely adds anything, but in a paralogous gene family the second locus can belong to a related gene, so review these copies before relying on them.

For every transferred transcript LiftOn compares the target's sequence and protein with the reference and records its identities and **mutation classes**, such as `synonymous`, `frameshift`, or `stop_codon_gain`. These say what changed in the protein, not whether the gene still works.

### Rating the transferred proteins

A transfer only moves coordinates. Comparing proteins tells whether a copied gene model still describes an intact protein in the target, which DNA identity cannot: many synonymous changes leave the protein unchanged, while a single inserted base can shift its reading frame. The summary step therefore rates every coding gene from what LiftOn recorded, without running another tool. It rates the gene's primary target copy, or the gene itself when LiftOn could not place it, and takes the gene's most changed transcript.

Each rated gene gets one **protein category**, the most severe that applies:

| Category | When |
|---|---|
| unmapped | LiftOn placed the gene nowhere on the target. |
| lost | No protein could be aligned to the reference protein (`full_transcript_loss`, `no_protein`, or no protein identity at all). |
| disrupted | A frameshift, a premature stop codon, a missing stop codon, or a lost start (`frameshift`, `stop_codon_gain`, `stop_missing`, `start_lost`). |
| in-frame indel | An insertion or deletion that keeps the reading frame (`inframe_insertion`, `inframe_deletion`). |
| substitutions | Amino-acid substitutions only (`nonsynonymous`). |
| unchanged | The same protein (`synonymous`, `identical`, or no mutation class: LiftOn writes none for an identical transcript). |

The categories come from the mutation classes rather than from identity, because a frameshift near the end of a protein still leaves a high identity. A gene is **listed for review** with one or more reasons:

| Reason | When |
|---|---|
| unmapped or lost | The category is unmapped or lost. |
| disrupted | The category is disrupted. |
| below threshold | The protein identity lies below the minimum protein identity. |
| unresolved bases | The gene's coding sequence contains target bases that are not A, C, G, or T. |

An **unresolved base** is an `N`, written where the target's sequence is unknown, or another IUPAC code, written where it is ambiguous, such as `R` for A or G. A codon containing one cannot be translated, so the protein looks changed, or its frame broken, without any real change in the target: such a finding may be an artifact of the data rather than biology. The input check counts the target's unresolved bases before LiftOn runs and warns about them, and the summary step counts them per gene and writes their intervals as a BED file.

LiftOn's transcript status, which says whether LiftOn kept the Liftoff model, chained it with miniprot, or replaced it, is recorded for every rated gene but is not a review reason: LiftOn rebuilds a model to obtain a protein closer to the reference, and most rebuilt genes end up with an almost identical protein.

The rating ranks genes for a closer look; it does not predict their effect. Identity is not function: a single substitution in an active site can matter more than many conservative ones, and "changed" means different from the reference, not wrong.

## Steps

1. **Resolve inputs**: copy the local files or download the NCBI accessions, and record their checksums.
2. **Validate inputs**: check the structure of the FASTA and GFF3 files and that the reference annotation's sequence names exist in the reference FASTA, and count the bases that are not A, C, G, or T, warning about those in the target. LiftOn starts only when this check passed; otherwise the report stays in place with every problem it found.
3. **Transfer annotation**: LiftOn maps the reference gene models onto the target. Its raw GFF3 and its complete output directory are kept unmodified.
4. **Validate annotation**: check the structure of LiftOn's GFF3: the version header, coordinates, strand, CDS phase, identifiers, and parent relationships. A failed check is kept as a scientific result for review, not treated as a failed run.
5. **Summarize results**: the per-feature transfer table with the protein rating, the metrics, the target's unresolved bases, and the completion summary with the run status.
6. **Record provenance**: the run's artifact index and provenance record.
7. **Write citation**: how to cite the run, from its provenance: the tools that ran with their versions and references, a draft methods paragraph, and BibTeX and RIS.

## Outputs

Paths are inside the run directory.

| Path | Content |
|---|---|
| `resolved/` | the checksummed copies of the reference FASTA and GFF3 and the target FASTA |
| `results/input-validation.json` | the structural check of the inputs |
| `results/annotation/lifton.raw.gff3` | the transferred annotation exactly as LiftOn wrote it |
| `results/annotation/lifton_output/` | LiftOn's statistics, intermediate files, and its Liftoff and miniprot outputs |
| `results/validation.json` | the structural check of the transferred annotation |
| `results/feature-transfer.tsv` | one row per selected reference feature and per target copy, with the reference feature's position, and each coding gene's protein category, LiftOn status, unresolved bases, and review reasons |
| `results/target-unresolved.bed` | the target's intervals of bases that are not A, C, G, or T |
| `results/metrics.json` | the transfer metrics and the counts of the protein rating, with their one-line definitions |
| `results/summary.json` | the run status, the metrics, and links to every report |
| `artifacts.yaml` | every file's checksum and whether it was generated or imported |
| `provenance/run.json` | the GenoPilot version and build that saved the configuration, the effective configuration, commands, tool versions, resources, and input checksums |
| `citation/` | how to cite the run: `CITATION.md` with the GenoPilot version, the tools that ran with their versions and references, a draft methods paragraph built from the configuration, and the references as BibTeX and RIS, also as `references.bib` and `references.ris` |
| `logs/` | the log and benchmark of every step |

## Tools

The versions are pinned only in the files linked below and recorded in every run's provenance.

| Tool | Role | Pinned in | Reference |
|---|---|---|---|
| Snakemake | scheduling, per-step environments, reruns | GenoPilot runtime ([`pixi.toml`](../../runtime/pixi.toml)) | [7] |
| NCBI Datasets CLI | downloading NCBI accessions | [`ncbi-datasets-cli`](../shared/envs/ncbi-datasets-cli/environment.yaml) | [8] |
| LiftOn | annotation transfer | [`lifton`](../shared/envs/lifton/environment.yaml) | [1] |
| minimap2 | DNA alignment inside Liftoff | [`lifton`](../shared/envs/lifton/environment.yaml) | [4] |
| miniprot | protein-to-genome alignment | [`lifton`](../shared/envs/lifton/environment.yaml) | [5] |
| parasail | protein and sequence comparison | [`lifton`](../shared/envs/lifton/environment.yaml) | [6] |

LiftOn drives minimap2, miniprot, and parasail itself, so they are pinned together in one environment. Input checks, validation, and the summaries are small scripts that read the tools' outputs. Scripts of steps without their own environment run on the Python pinned with Snakemake in the GenoPilot runtime, and each run records its version.

Publications that use this workflow's results should cite the tools above, next to the GenoPilot version that produced them. Every run lists the tools it ran, with their versions and references, in `citation/CITATION.md`; the references are also kept machine-readable in [`citation/references.json`](citation/references.json), which must match the lists here.

## References

1. Chao KH, Heinz JM, Hoh C, Mao A, Shumate A, Pertea M, Salzberg SL. Combining DNA and protein alignments to improve genome annotation with LiftOn. Genome Res 35:311–325 (2025). https://doi.org/10.1101/gr.279620.124
2. The Sequence Ontology. Generic Feature Format Version 3 (GFF3), specification 1.26. https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md
3. Shumate A, Salzberg SL. Liftoff: accurate mapping of gene annotations. Bioinformatics 37:1639–1643 (2021). https://doi.org/10.1093/bioinformatics/btaa1016
4. Li H. Minimap2: pairwise alignment for nucleotide sequences. Bioinformatics 34:3094–3100 (2018). https://doi.org/10.1093/bioinformatics/bty191
5. Li H. Protein-to-genome alignment with miniprot. Bioinformatics 39:btad014 (2023). https://doi.org/10.1093/bioinformatics/btad014
6. Daily J. Parasail: SIMD C library for global, semi-global, and local pairwise sequence alignments. BMC Bioinformatics 17:81 (2016). https://doi.org/10.1186/s12859-016-0930-z
7. Mölder F, Jablonski KP, Letcher B, et al. Sustainable data analysis with Snakemake [version 3; peer review: 2 approved]. F1000Research 10:33 (2025). https://doi.org/10.12688/f1000research.29032.3
8. O'Leary NA, et al. Exploring and retrieving sequence and metadata for species across the tree of life with NCBI Datasets. Sci Data 11:732 (2024). https://doi.org/10.1038/s41597-024-03571-y
