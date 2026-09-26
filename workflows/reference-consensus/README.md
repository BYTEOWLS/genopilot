# Reference-guided cohort consensus

Builds one consensus genome from the paired Illumina reads of many isolates. Every isolate's reads are called against one backbone assembly. The isolates' alleles, and optionally the backbone's, then vote at each position, and the winning allele by strict majority or plurality forms the cohort consensus.

Status: per-isolate processing is implemented. Every isolate gets its alignment, callable mask, normalized variants, and reference-guided FASTA. Cohort support aggregation and consensus generation are not implemented yet.

## Inputs

- **Backbone**: one assembly FASTA, either a local file or a versioned NCBI assembly accession. It supplies the coordinates and every base an isolate does not change.
- **Isolates**: the selected isolates and their read pairs (R1/R2 FASTQ files), taken from a snapshot of the isolate catalog made when the run was created. Later catalog edits never change an existing run.

The reads must keep their original Illumina read names, because the read groups are derived from them (see *Read groups*).

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| Voting method | strict majority | Not used yet. Strict majority needs more than half of the votes cast; plurality needs the unique highest vote count. |
| Backbone vote | yes | Not used yet. Whether the backbone casts one vote next to the callable isolates. |
| Ploidy | 1 | Fixed: isolates are called haploid. |
| Minimum read depth | 10 | Reads needed at a position, counted after the quality filters and without duplicates. |
| Minimum mapping quality | 20 | Reads mapped with a lower quality are not counted. |
| Minimum base quality | 20 | Bases with a lower quality are not counted. |
| Minimum allele fraction | 0.8 | Share of the counted reads the winning allele needs; above 0.5 and at most 1. |

The voting parameters are saved with the run and take effect once consensus generation is implemented.

## Steps

The workflow runs three stages before any isolate is processed:

1. **Resolve backbone**: copy the local FASTA or download the NCBI accession, and record its checksum.
2. **Validate inputs**: check the backbone FASTA's structure and that every read file can be read.
3. **Index backbone**: build the bwa and samtools indexes.

Then, for every read pair of every isolate:

4. **Validate read pair**: check the read names and record counts, derive the read group, and checksum both files.
5. **Trim**: fastp read QC and light adapter trimming.
6. **Align**: bwa mem with the pair's read group, then samtools fixmate and sort.

And for every isolate:

7. **Mark duplicates**: merge the isolate's read pairs and mark duplicates per library.
8. **Alignment metrics**: samtools stats, flagstat, and per-contig coverage.
9. **Call all sites**: bcftools mpileup and call, haploid, at every covered position.
10. **Classify callability**: decide for every backbone base whether it is callable, ambiguous, or uncallable.
11. **Filter and normalize variants**: mark every variant `PASS` or with a named filter, split multiallelic records, and left-align them.
12. **Build isolate consensus**: apply the `PASS` variants to the backbone and mask every base that is not callable with `N`.
13. **Summarize isolate**: metrics, provenance, and the promotion candidate.

Finally, **record provenance** writes the run's artifact index and provenance record.

Isolates are processed independently and in parallel. A failing isolate is reported as a failed job while the others finish.

## Read groups

A read group labels where reads came from: the sequencing run, lane, library, and sample. Every read in a BAM file carries its read group, so reads from different read pairs remain distinguishable after they are merged into one isolate alignment.

Every read pair gets its own read group, derived from its Illumina read names and file name. A read name looks like this:

```text
@A00123:45:HXYZ7DSX2:2:1101:1000:2000 1:N:0:ACGTACGT+TGCATGCA
```

Its fields are instrument (`A00123`), run (`45`), flowcell (`HXYZ7DSX2`), lane (`2`), tile and position, and, after the space, the barcode (`ACGTACGT+TGCATGCA`). The R1 file name follows the pattern `<sample>_S<n>[_L<lane>]_R1_<chunk>.fastq.gz`, for example `NID42_S7_L002_R1_001.fastq.gz`.

| Field | Meaning | Derived from | Example |
|---|---|---|---|
| `ID` | Unique key of the read group | flowcell, lane, barcode | `HXYZ7DSX2.2.ACGTACGT+TGCATGCA` |
| `PU` | Platform unit | same as `ID` | `HXYZ7DSX2.2.ACGTACGT+TGCATGCA` |
| `SM` | Sample | isolate ID | the isolate ID |
| `LB` | Library | sample name from the R1 file name, barcode | `NID42.ACGTACGT+TGCATGCA` |
| `PL` | Platform | fixed | `ILLUMINA` |

- The lane is part of `ID` and `PU` only when every read of the pair has the same lane. A lane-merged delivery combines all lanes of a flowcell in one file, so its read group carries no lane.
- The barcode keeps the `ID` distinct when two libraries were sequenced on the same lane. It is taken from the first read.
- When the R1 file name does not follow the Illumina pattern, the isolate ID is used as the library's sample name.

A read pair fails validation when:

- a read name is not an Illumina read name;
- a read name disagrees with the first one on instrument, run, or flowcell (lanes may differ);
- R1 and R2 hold different numbers of reads, which bwa does not check.

An isolate fails when two of its read pairs have the same read group `ID`, which means the same lane and barcode were listed twice.

Reads downloaded from a public archive often lost their Illumina read names and cannot be processed yet.

## Duplicates

PCR duplicates arise when one library preparation is amplified, so the same library sequenced in several runs can contain duplicates across those runs. Reads of different libraries are never duplicates of each other, even at identical coordinates.

Duplicates are therefore marked per library, using the read groups' `LB`. Each library's read pairs are merged and marked on their own, and the marked libraries are then merged into the isolate's alignment. samtools markdup alone would compare read groups, which are one per read pair, instead of libraries.

Duplicates are marked, never removed, and the variant caller ignores them.

## Callability

Every backbone base of an isolate gets one of three states. Depth is the number of reads at the position after the mapping-quality, base-quality, and duplicate filters.

| State | Meaning |
|---|---|
| callable | depth reaches the minimum read depth, and one allele reaches the minimum allele fraction |
| ambiguous | enough reads, but no allele reaches the fraction; in a haploid isolate this points to contamination, a mixed culture, or collapsed paralogs |
| uncallable | too few usable reads, including positions without any coverage and repeats where reads map with low quality |

Indels refine the bases they span. A callable deletion makes the backbone bases it removes callable, because the reads carry the deletion. An indel whose allele has more than `1 - fraction` but less than the fraction of the reads makes its span ambiguous. A smaller indel allele is treated as noise.

## Isolate FASTA

The isolate FASTA is the backbone with the isolate's `PASS` variants applied and every ambiguous or uncallable base replaced by `N`. It contains only `A`, `C`, `G`, `T`, and `N`, and keeps the backbone's sequence names and order. Lowercase soft-masking in the backbone is dropped, because it is annotation rather than sequence. A chain file maps backbone coordinates onto the FASTA's, and the callable mask says why a base is `N`.

The FASTA is checked before anything depends on it: samtools must index it, its sequences must match the backbone's in name and order, and it must contain no other characters.

## Outputs

Paths are inside the run directory.

| Path | Content |
|---|---|
| `resolved/backbone.fasta` | the resolved backbone and its indexes |
| `results/input-validation.json` | backbone and read-file validation |
| `results/isolates/<isolate>/pairs/<n>/read-validation.json` | read group, sequencing run fields, and checksums of read pair `n` |
| `results/isolates/<isolate>/pairs/<n>/fastp.json`, `fastp.html` | read QC and trimming report |
| `results/isolates/<isolate>/alignment.bam` | merged, duplicate-marked alignment and index |
| `results/isolates/<isolate>/markdup.json` | duplicates per library |
| `results/isolates/<isolate>/samtools-stats.txt`, `flagstat.json`, `coverage.tsv` | alignment metrics |
| `results/isolates/<isolate>/all-sites.bcf` | calls at every covered position, the evidence behind the mask |
| `results/isolates/<isolate>/callable-mask.bed` | the state of every backbone base |
| `results/isolates/<isolate>/consensus-mask.bed` | the ambiguous and uncallable intervals only |
| `results/isolates/<isolate>/callability.json` | bases per state, per contig and in total |
| `results/isolates/<isolate>/variants.vcf.gz` | normalized variants, each `PASS`, `LowDepth`, or `LowAlleleFraction` |
| `results/isolates/<isolate>/consensus.fasta` | the isolate FASTA, its index, and `consensus.chain` |
| `results/isolates/<isolate>/metrics.json` | the isolate's metrics |
| `results/isolates/<isolate>/provenance.json` | the isolate's read pairs, parameters, tool versions, and checksums |
| `results/isolates/<isolate>/promotion-candidate.json` | what is needed to copy the isolate FASTA into the isolate catalog |
| `artifacts.yaml` | every artifact of the run with its checksum and origin |
| `provenance/run.json` | configuration, inputs, tool versions, and commands of the whole run |
| `logs/` | the log and benchmark of every step |

Trimmed reads and per-pair alignments are temporary: the isolate's alignment keeps every read, and the fastp reports record what trimming did.

## Tools

All steps run in one pinned environment: fastp 1.3.7, bwa 0.7.19, samtools 1.24, bcftools 1.24, and htslib 1.24.

Every option that changes a result is set explicitly rather than left to a tool default:

- **fastp**: adapters detected for paired-end reads; quality filtering off, because the aligner soft-clips and the caller weighs base qualities; reads shorter than 30 bp dropped; poly-G tails of at least 10 bases trimmed on every instrument.
- **bwa mem**: a fixed batch size, so alignments do not depend on the number of threads.
- **bcftools mpileup**: maximum depth 10000; unmapped, secondary, QC-failed, and duplicate reads skipped; indel candidates need at least 2 reads and a 5% share. Base-alignment quality stays at the pinned default, which the recorded command and version document.

Trimmed input runs through the same steps, which then change little. Untrimmed input is preferred, because aggressive provider trimming mostly discards data the aligner and caller could use. Whether an isolate's reads were trimmed is recorded in its metrics and provenance.
