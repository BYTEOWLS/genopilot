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

The disk estimate starts from a documented default per gigabase of reads and is replaced by the machine's own measurement once a completed run exists (see below). A run whose estimate exceeds the free space gets a clear warning with both numbers; the researcher decides.

Hardware specifications alone do not predict duration well, and a speed test on the bundled fixtures is dominated by startup overhead, so neither is used for time estimates.

## After a run

Every Snakemake job already writes a benchmark file (`logs/**/*.benchmark.tsv`) with wall time, CPU time, and peak memory. Once a run has completed, GenoPilot can:

- show total and per-stage duration and peak memory in the run results (the open task in [`tasks.md`](../tasks.md) about durations and resource metrics);
- derive per-step rates for this machine, such as seconds per million read pairs for alignment and calling, and bytes kept per million read pairs;
- use those rates to estimate the next run's duration and disk need on the same machine, stating which run the estimate comes from.

Estimates are shown as ranges and labeled as estimates. A machine without a completed run shows only the disk estimate from the default and no duration.

## Work

- [ ] Kickoff: decide where the per-machine rates are stored (next to the tooling state or derived from discovered runs on each start) and the default disk rate.
- [ ] Show free disk, CPUs, and memory on the start page, with the disk estimate and a warning when it does not fit.
- [ ] Read job benchmarks into the run results, together with the open run-metrics task.
- [ ] Derive per-machine rates from completed runs and show duration and disk estimates with their source.
- [ ] Test estimates from injected benchmark data, missing or partial benchmarks, a machine without completed runs, and the warning path, without depending on the test machine's hardware.

## Acceptance

Before starting a run, a researcher on any machine sees whether the run will fit on disk and, once the machine has completed a run, roughly how long it will take and what that estimate is based on.
