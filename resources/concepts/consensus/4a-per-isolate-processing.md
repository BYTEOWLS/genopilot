# Task 4.1 — Per-isolate processing

## Goal

Implement the first executable scientific target: independently validate and process every selected isolate against the resolved backbone, preserve auditable intermediate results, and make each validated isolate FASTA eligible for explicit promotion into its isolate catalog entry.

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

- derive the read group from the read headers of each pair — `ID` from the flowcell, `PU` from the flowcell and barcode, `SM` from the isolate ID, and `LB` from the Illumina sample name and barcodes; extend `ID` and `PU` with the lane only when every record of the pair has the same lane, because lane-merged deliveries (`--no-lane-splitting`) combine all lanes of a flowcell in one file;
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

- [ ] Finalize the scientific toolchain, ploidy support, thresholds, and expected synthetic results.
- [ ] Add small redistributable paired FASTQ fixtures covering reference, alternate, no-call, low-quality, SNP, and indel cases, plus an isolate with two read pairs from different runs of one library.
- [ ] Implement full FASTQ/pair validation and checksumming for every read pair.
- [ ] Derive read groups per pair from read headers and record them in provenance.
- [ ] Implement pinned per-rule environments, per-pair QC, trimming, and alignment, per-isolate merging and per-library duplicate marking, and per-isolate callability, calling, normalization, and FASTA generation.
- [ ] Validate every intermediate format before dependent rules run.
- [ ] Emit per-isolate metrics, provenance, artifact records, and a versioned catalog-promotion manifest.
- [ ] Validate that every promotion candidate identifies its isolate and complete source artifacts without requiring catalog access.
- [ ] Test any positive isolate and read-pair count, trimmed input, isolated failure, resume, parameter-only reruns, direct Snakemake execution, and valid/invalid promotion candidates.

## Acceptance

The target runs directly through Snakemake and produces independently inspectable, scientifically validated artifacts for every isolate. Each successful FASTA can later be copied into catalog-owned storage without making catalog mutation part of the scientific DAG or overwriting older genome records.
