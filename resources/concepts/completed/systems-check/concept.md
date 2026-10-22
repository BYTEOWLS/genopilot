# Systems check

## Goal

Set realistic expectations before a researcher starts a run, especially on machines much slower or smaller than a developer's. A run that fills the disk after hours, or takes a day where the researcher expected an hour, is a worse outcome than a clear warning up front.

The check reports measured facts and estimates with their basis. It never blocks a run on a guess, and it never claims a duration it cannot back with measurements.

## What limits a run

Measured during consensus Task 4.2:

- **Disk** is the most likely hard failure. A real reference-consensus run kept about 1.1 GB per isolate for a genome of about 30 Mb at typical coverage: the duplicate-marked alignment (about 850 MB), the all-sites calls (about 220 MB), and the isolate FASTA (about 30 MB). That is about 10 GB for 10 isolates and about 220 GB for 200. Temporary trimmed reads and per-pair alignments add to the peak while a run is in progress.
- **Time** is dominated by per-isolate alignment and calling. It scales with read volume, genome size, and cores, and Snakemake runs isolates in parallel up to the run's CPUs.
- **Cohort aggregation** is not a bottleneck. It runs on one core and grows linearly with the cohort: on an Apple M3 Max, a stress case of 200 isolates on a 30 Mb genome with 4,000 unshared variants each took 12 s. Slower machines are expected to need about 2–5 times as long, depending on single-core speed. Its tables grow faster than linearly (about 650 MB uncompressed in that case, before bgzip).
- **Memory** follows the aligner and caller; the consensus steps of a 30 Mb genome need little. It becomes relevant for much larger genomes.

## Before a run

On the start page, next to the exact command, show:

- the free space of the output root and an estimate of what the run will need, with the per-isolate figure it is based on;
- the available CPUs and the run's effective CPUs, which the configuration already records;
- the available memory.

The disk estimate adds up what each part of a run keeps, from sizes known before it starts, at one `stat` per file: each isolate's read files and the genome (the backbone or reference FASTA). A workflow's manifest declares default factors under names of its own, and the workflow's estimator turns them and its input sizes into kept and peak bytes; the shared check takes only that result. Reference consensus uses bytes kept per read byte and per genome byte for each isolate, and per genome byte for the run. The factors are per byte, so they carry over to other species, genome sizes, and coverages; a species enters only through its read and genome sizes. The machine's own measurement replaces the defaults once a completed run exists (see below). A workflow without factors shows free disk only, and inputs still to be downloaded from NCBI are left out with a note. A run whose estimate exceeds the free space gets a clear warning with both numbers; the researcher decides.

Hardware specifications alone do not predict duration well, and a speed test on the bundled fixtures is dominated by startup overhead, so neither is used for time estimates.

## After a run

GenoPilot samples the memory of Snakemake and its jobs while a run executes (see *Decisions*). Once a run has completed, GenoPilot can:

- show the run's peak memory in the run results;
- derive this machine's own factors, in the shape of the default disk factors below, and its time per isolate;
- estimate the next run's disk need and duration on the same machine, stating which run the estimate comes from.

Estimates are shown as ranges and labeled as estimates. A machine without a completed run shows only the disk estimate from the default and no duration.

## Decisions

- **Machine record.** Saved configurations record the machine: platform, architecture, CPU model, CPU count, and memory. Rates count only for runs whose record matches the current machine, which also covers a data directory shared between hosts. The record is taken when the configuration is saved; a run resumed on another machine, such as a copied run directory, keeps the first record and is accepted as a known limit.
- **Stored rates.** After a completed run, GenoPilot writes `machine-rates.yaml` to its data directory: per workflow, the latest completed run's machine record, run ID and directory, effective CPUs, its default disk estimate, its measured directory size, its duration, and its sampled peak memory. The default estimate is the yardstick that scales the measurement to the next run. Resetting the tooling removes it; the next completed run writes it again.
- **Default disk factors** of reference consensus, measured per isolate on a real run of 9 isolates of a haploid genome of about 30 Mb, with 1.4–2.5 GB of gzipped reads per isolate from two sequencing batches:

  | Part | Kept | Factor |
  |---|---|---|
  | Duplicate-marked alignment | 0.84–1.22 GB per isolate | 0.47–0.62 × the isolate's read bytes |
  | All-sites calls, isolate FASTA, and reports | 0.24–0.27 GB per isolate | about 9 × genome bytes per isolate |
  | Resolved backbone with its index | 79 MB | about 2.6 × genome bytes per run |
  | Cohort tables and consensus | 31 MB | about 1 × genome bytes per cohort |

  The default uses the upper ends (0.62 and 9), which overestimate the measured isolates by at most 25 %. The peak adds, for each isolate aligned at the same time (effective CPUs ÷ the aligner's 8 threads, at least 1), its temporary trimmed reads and per-pair alignment: about 1.6 × its read bytes. The peak is derived from the rule outputs, not measured, and is checked on the first monitored run. Cohort tables grow faster than linearly with the cohort; the term is revisited with a larger cohort. Annotation transfer's factors were measured on one run with genomes of about 30 Mb, which kept 506 MB: about 4.4 × the target FASTA (its copy and minimap2 index), 1 × the reference FASTA, and 11 × the reference GFF3 (the annotations, their databases, and the extracted sequences); no step declares temporary files.
- **Duration** comes only from stored rates: the measured run's duration, scaled by the ratio of the new run's default disk estimate to the measured run's, shown as ×0.7 to ×1.5, naming the source run and its CPUs, and flagging a different CPU count. The measured run's kept bytes, scaled the same way, replace the default disk estimate; the temporary files keep the manifest's factor. Its sampled peak memory is shown as measured, with a warning when it exceeds the installed memory. A workflow without disk factors has no rates. On the measured run, the isolates took 23 of its 23½ minutes.
- **Peak memory** is sampled by GenoPilot, not read from Snakemake's job benchmarks: on macOS, Snakemake writes `NA` for every memory and CPU value, because psutil's `memory_full_info()` is refused there for other processes and Snakemake then drops the whole sample, a Snakemake bug. Every 5 seconds while an execution runs, GenoPilot sums the resident memory of Snakemake's process tree from `ps` and records the highest total. Tested on macOS; Linux and WSL2 use the same `ps` options and are expected to behave alike. A spike shorter than the interval can be missed, and shared memory counts once per process, so the figure errs high. CPU time is not sampled: `ps` no longer shows a job that has finished, so a sum would undercount.
- **Run timing** comes first: a live overall timer while Snakemake runs, and, when it ends, GenoPilot appends the execution's start, end, duration, exit code, command, and stage times (from its structured events) to the run's `timing.yaml`. Results and the run list read only that file. An iteration's execution is recognized by its target, `provenance/cohort/iteration-<n>.json`, in the recorded command.

## Work

See the [ordered tasks](tasks.md).

## Acceptance

Before starting a run, a researcher on any machine sees whether the run will fit on disk and, once the machine has completed a run, roughly how long it will take and what that estimate is based on.
