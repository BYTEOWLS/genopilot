# Task 4.1 — Per-isolate processing

## Goal

Implement the first executable scientific target: independently validate and process every selected isolate against the resolved backbone, preserve auditable intermediate results, and make each validated isolate FASTA eligible for explicit promotion into its isolate catalog entry.

The science behind reads, alignment, duplicates, callability, and variants is explained for researchers in the [workflow README](../../../workflows/reference-consensus/README.md); the tools considered instead are in the [science background](science-background.md).

## Kickoff decisions

- **Toolchain.** fastp for read QC and light adapter trimming, `bwa mem` for alignment, samtools for fixmate, sorting, merging, duplicate marking, statistics, and FASTA indexes, and bcftools for calling, filtering, normalization, and the consensus. All four share one pinned environment, `workflows/reference-consensus/envs/short-read-calling/`, with exact versions that have bioconda builds for linux-64 and osx-arm64.
- **Code layout.** Everything specific to this workflow — rules, scripts, and environments — lives under `workflows/reference-consensus/`. `workflows/shared/` keeps only what annotation-transfer uses too: the run-events logger, the `ncbi-datasets-cli` environment, `resolve_input.py`, the FASTA/GFF3 parsers, and the checksum and pin helpers of the provenance script.
- **Parallelism and determinism.** Every rule declares its `threads`, and Snakemake runs read-pair and isolate jobs side by side up to the run's CPUs. `bwa mem -K` is fixed so alignments do not depend on the thread count. Runs use `--keep-going`, so a failing isolate is reported as a failed job while the others finish. The cohort stages then wait (Task 4.2), but finishing the others still reports every failure in one pass, keeps their results for the next attempt in the same run directory, and lets Task 5 exclude an unfixable isolate without reprocessing them.
- **Thresholds.** `min_mapping_quality` and `min_base_quality` become the `bcftools mpileup` read and base filters. `min_depth` counts the reads left after those filters and without duplicates (the sum of `FORMAT/AD`), and `min_allele_fraction` is the winning allele's share of them. Every other result-changing option, including mpileup's maximum depth, skipped read flags, and indel-candidate thresholds, fastp's adapter, length, and poly-G options, and the bwa batch size, is passed explicitly. Base-alignment quality stays at the pinned bcftools default (applied only in problematic regions), which the recorded command and tool version document.
- **Duplicates** are marked, never removed, per library through the read group's `LB`, and ignored by the caller. A fixture with two libraries proves that marking stays within a library.
- **Read groups.** `ID` equals `PU`, `<flowcell>[.<lane>].<barcode>`, so two libraries sequenced on the same lane still get distinct IDs. `LB` is the Illumina sample name from the R1 file name (`<sample>_S<n>…`) plus the barcode, or the isolate ID when the file name does not follow that pattern; the source is recorded. The barcode is taken from the first record, and records whose barcode differs never reject a pair. A pair whose headers are not Illumina headers fails with a clear message; renamed public-archive reads are a separate feature in [`later.md`](../../../later.md).
- **Callability** has three states, derived from an all-sites call that covers every position with reads:
  - `callable`: at least `min_depth` reads and one allele reaching `min_allele_fraction`;
  - `ambiguous`: enough reads but no winning allele, which in a haploid isolate points to contamination, a mixed culture, or collapsed paralogs;
  - `uncallable`: too few usable reads, including positions without any coverage and repeats where reads map with low quality.

  The callable mask is a BED file with this state per interval. An ambiguous indel marks its backbone span `ambiguous`. The indexed all-sites BCF is kept as the evidence behind every mask decision.
- **Isolate FASTA.** Only `A`, `C`, `G`, `T`, and `N` occur: confident alleles replace the backbone, and ambiguous or uncallable positions become `N`. The FASTA keeps the backbone's sequence IDs, and the mask says why a position is `N`. IUPAC codes are left to cohort voting ([Task 4.3](4c-combined-consensus-generation.md)).
- **Normalized VCF.** Variant records only, left-aligned against the backbone, each with `PASS` or a named filter (`LowDepth`, `LowAlleleFraction`) so no evidence is dropped. The consensus applies only `PASS` records.
- **Rely on the tools.** Custom code covers only what no pinned tool does: read groups from Illumina read names and mate record counts (bwa does not compare them), duplicate marking per library (samtools compares read groups, not libraries), and the three-state callable mask. Record format and mate names are checked by fastp and bwa, and the isolate FASTA by `samtools faidx`, a comparison of its index with the backbone's, and a single `A/C/G/T/N` check; what bcftools guarantees about applying variants and the mask is not tested again. Tests cover this workflow's results against the fixtures' truth, never tool internals.
- **Promotion candidates** are written per isolate, after its FASTA passed those checks, so a failing isolate cannot block its siblings. Verifying a candidate before copying it belongs to Task 5's promotion primitive.
- **Commands** in the run provenance come from the run events, which the logger records through Snakemake's public logger interface together with each job's wildcards and outputs; Snakemake's internal metadata files are not read.
- **Progress.** The run-events logger adds each job's wildcards, and the execution screen shows one progress bar per isolate.
- The configuration schema does not change.

## Pipeline

For every selected isolate:

```text
each R1/R2 read pair of the isolate
  -> authoritative input and pairing validation
  -> read-group derivation from the read header
  -> read QC and light adapter trimming
  -> alignment to the resolved backbone
merged per isolate
  -> duplicate marking per library
  -> sorted/indexed BAM
  -> mapping, depth, and coverage metrics
  -> callable-position mask
  -> normalized SNP/indel calls and index
  -> reference-guided isolate FASTA
  -> isolate FASTA validation
```

No isolate name or read-pair count is hard-coded in a rule.

## Read pairs and read groups

An isolate may have several read pairs, typically one per lane or sequencing run of the same library. Each pair is validated, QC'd, and aligned separately with its own read group, then merged per isolate:

- derive the read group from the read headers of each pair — `ID` and `PU`, which are equal, from the flowcell and barcode, `SM` from the isolate ID, and `LB` from the Illumina sample name and barcodes; extend `ID` and `PU` with the lane only when every record of the pair has the same lane, because lane-merged deliveries (`--no-lane-splitting`) combine all lanes of a flowcell in one file;
- reject a pair whose records disagree with its first header on instrument, run, or flowcell, but never on lane alone;
- mark duplicates across all pairs of the same library, because PCR duplicates of one library can appear in several runs;
- record instrument, run, flowcell, lane, read length, and read counts per pair in provenance; the isolate catalog deliberately does not store them.

Run QC and adapter trimming inside the workflow with a pinned tool and recorded parameters so every isolate is processed identically. Prefer untrimmed input: aligners soft-clip adapter and low-quality ends and variant callers weigh base qualities, so aggressive provider trimming mostly discards usable data. Input marked `trimmed` still runs through the same steps, which then change little, and its status is carried into metrics, provenance, and the Task 5 result views. Snakemake expands jobs from the immutable `isolates.yaml` snapshot and remains the only scheduler.

## Scientific contract to finalize first

Implement the contract agreed at the [Task 3 kickoff](3-workflow-configuration-and-review.md#kickoff-decisions): haploid calling (`calling.ploidy: 1`) with the editable `min_depth`, `min_mapping_quality`, `min_base_quality`, and `min_allele_fraction` thresholds, read per isolate from the run's `isolates.yaml` snapshot. The resolved backbone is `resolved/backbone.fasta` from the existing `resolve_backbone` rule, and per-isolate processing starts only after `validate_run_inputs` passes. Select and pin the read-QC, mapper, BAM-processing, variant-calling, normalization, callability, and consensus tools; finalize their detailed thresholds, duplicate handling, no-call representation, and behavior in repeats without silently adding persisted semantics to the released configuration schema. Save every effective setting; do not rely on an unrecorded tool default.

The isolate consensus uses the backbone as coordinates and starting sequence, not as an equal second vote. A confident isolate allele replaces the backbone allele. Ambiguous or uncallable positions follow the explicit per-isolate policy and remain distinguishable through the callable mask.

## Outputs per isolate

Preserve at least:

- read-validation and QC reports;
- BAM and index;
- alignment, depth, and callable-coverage metrics;
- callable-position mask;
- normalized VCF and index;
- reference-guided consensus FASTA and index;
- logs, benchmark data, checksums, tool versions, and effective parameters.

One isolate failing validation or execution must be visible as a failed job and must not disappear from later aggregation.

## Catalog promotion candidate

The scientific workflow writes a versioned promotion manifest describing each successfully validated isolate FASTA, its isolate ID, checksum, backbone identity/checksum, producing run, workflow version, and creation time. This keeps direct Snakemake execution independent of user-local TUI state.

Task 5 offers an explicit **Save to isolate catalog** action. On confirmation, the TUI uses Task 5's promotion primitive to copy the FASTA, index, and compact provenance into `genomes/<isolate-id>/<genome-id>/`, verify the copy, and append its authoritative record to `isolates.yaml`. Never offer or promote a partial, failed, missing, or checksum-invalid FASTA. Repeating promotion is idempotent for the same genome identity and checksum; another run or backbone creates a separate record rather than replacing an older genome.

## Work

- [x] Finalize the scientific toolchain, ploidy support, thresholds, and expected synthetic results.
- [x] Add small redistributable paired FASTQ fixtures covering reference, alternate, no-call, low-quality, SNP, and indel cases, plus an isolate with two read pairs from different runs of one library.
- [x] Check every read pair's Illumina read names and mate record counts, and checksum it; fastp and bwa check the record format and mate names.
- [x] Derive read groups per pair from read headers and record them in provenance.
- [x] Implement pinned per-rule environments, per-pair QC, trimming, and alignment, per-isolate merging and per-library duplicate marking, and per-isolate callability, calling, normalization, and FASTA generation.
- [x] Validate every intermediate format before dependent rules run, with the tools' own checks.
- [x] Emit per-isolate metrics, provenance, artifact records, and a versioned catalog-promotion manifest.
- [x] Make every promotion candidate identify its isolate, its FASTA and index with checksums, the backbone, the producing run, and the workflow without catalog access; verifying a candidate before copying it is Task 5's.
- [x] Test any positive isolate and read-pair count, trimmed input, isolated failure, resume, parameter-only reruns, and direct Snakemake execution.
- [x] Run isolates in parallel and show per-isolate progress in the TUI.

## Acceptance

The target runs directly through Snakemake and produces independently inspectable, scientifically validated artifacts for every isolate. Each successful FASTA can later be copied into catalog-owned storage without making catalog mutation part of the scientific DAG or overwriting older genome records.
