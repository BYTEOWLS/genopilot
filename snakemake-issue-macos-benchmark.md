**Title:** Benchmark directive records NA for all metrics on macOS (psutil `memory_full_info()` raises AccessDenied)

### Snakemake version

9.27.0 (psutil 7.2.2, Python 3.13.15)

### Describe the bug

On macOS, every benchmark file has only the wall time; `max_rss`, `max_vms`, `max_uss`, `max_pss`, `io_in`, `io_out`, `mean_load`, and `cpu_time` are all `NA`, for every job.

`BenchmarkTimer._update_record` calls `proc.memory_full_info()` for the job's processes. On macOS, psutil needs elevated privileges to read another process's USS, even one owned by the same user, so the call raises `psutil.AccessDenied`. The handler records the process as skipped and continues; with every process skipped, nothing is collected and the whole record is written as `NA`, including the metrics that macOS does allow, such as RSS and CPU time.

The same process's `memory_info()` and `cpu_times()` succeed:

```python
import psutil, subprocess, time

child = subprocess.Popen(["sleep", "2"])
time.sleep(0.2)
process = psutil.Process(child.pid)
print(process.memory_info())       # pmem(rss=..., vms=..., ...)
print(process.cpu_times())         # pcputimes(user=..., system=..., ...)
process.memory_full_info()         # psutil.AccessDenied
```

This looks like the macOS counterpart of #4159 (all metrics NA on Windows, from `meminfo.pss`).

### Minimal example

```python
rule all:
    input: "done.txt"

rule busy:
    output: "done.txt"
    benchmark: "busy.benchmark.tsv"
    shell: "python3 -c 'x = bytearray(200_000_000); import time; time.sleep(8)' && touch {output}"
```

```console
$ snakemake --cores 1
$ cat busy.benchmark.tsv
s	h:m:s	max_rss	max_vms	max_uss	max_pss	io_in	io_out	mean_load	cpu_time
8.04	0:00:08	NA	NA	NA	NA	NA	NA	NA	NA
```

The job runs long enough to be sampled many times (the short interval is 0.5 s). Linux allows `memory_full_info()` for the user's own processes, so this is macOS-specific.

### Expected behavior

`max_rss`, `max_vms`, and `cpu_time` are recorded on macOS. When `memory_full_info()` raises `AccessDenied`, falling back to `memory_info()` would keep RSS and VMS and leave only `max_uss` and `max_pss` as `NA`; `cpu_times()`/`cpu_percent()` work without privileges. Reporting the skipped processes as a warning would also make the cause visible.

### Additional context

macOS 26.6.2 (arm64). Snakemake and psutil installed from conda-forge via Pixi.
