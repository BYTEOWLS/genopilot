# Systems check — tasks

[Concept](concept.md). Steps affect this repository.

## Work

- [x] Run timing: a live overall timer, and start, finish, duration, and per-stage durations in the run results; workflows reuse it for their own executions.
- [x] Record the machine in saved configurations and provenance.
- [x] Show free disk, CPUs, and memory on the start page, with the disk estimate and a warning when it does not fit.
- [x] Sample the run's peak memory while it executes, save it in `timing.yaml`, and show it in the run results.
- [x] Write `machine-rates.yaml` after a completed run and show duration, disk, and memory estimates from it with their source.
- [x] Test estimates from injected measurements, a machine without completed runs, another machine's rate, and the warning paths, without depending on the test machine's hardware.
