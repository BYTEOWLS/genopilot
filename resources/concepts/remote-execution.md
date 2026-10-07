# Remote execution

## Goal

Large cohorts do not run on a laptop. A researcher chooses where a run executes, such as the local machine, a SLURM cluster, or a cloud service like AWS Batch, and GenoPilot starts it there. The run stays as reproducible as a local one and remains runnable directly through Snakemake.

Snakemake stays the only scheduler. Its executor plugins submit jobs to a cluster or cloud service, and its storage plugins move files to and from remote storage. GenoPilot chooses and configures them; it never submits jobs itself.

## Execution profiles

A profile names a place to run and the Snakemake options that send a run there: the executor, the number of jobs in flight, default resources, and, where needed, a storage provider and a container image. `local` is the built-in profile and behaves as runs do today.

- Profiles are saved as YAML in GenoPilot's per-user settings, because they describe a machine or account, not a run. They are validated in the application like run configurations.
- The start page offers the saved profiles, and the exact command it shows includes the options the profile adds.
- A profile never holds secrets. Credentials come from each service's standard sources, such as the AWS credential chain or the researcher's SLURM account, and GenoPilot neither asks for nor stores them.
- A run's configuration does not change with the profile. The same `config.yaml` runs locally or remotely, so a direct Snakemake run picks its executor on the command line as usual.

## Executor plugins in the runtime

The Pixi workspace pins the executor and storage plugins GenoPilot supports, next to Snakemake. The tooling check validates them like Snakemake itself, and a profile whose plugin is not installed is shown as unavailable rather than failing at start.

## Rule resources

Schedulers need memory and runtime per job. No rule declares `resources:` today; five declare `threads:`. Each rule needs memory and runtime that scale with its inputs, taken from the measurements of the [systems check](systems-check.md) rather than guessed. Profiles may override defaults, for example for a partition with a shorter time limit.

## Software and data

- **Shared filesystem (typical SLURM).** Jobs see the run directory and the Conda environments directly. Per-rule Conda works as locally, but the environments must be provisioned before jobs start on nodes without internet access, and they must be locked (see the environment locks in [`tasks.md`](../tasks.md#tooling)).
- **No shared filesystem (AWS Batch and similar).** Inputs and outputs move through a storage plugin, for example S3, and jobs run in container images that hold the rule environments. This ties into the question of archiving a container or Apptainer image with a cited release ([public release](public-release.md#reproducibility-of-a-cited-version)).

## Where GenoPilot runs

- **On a cluster login node, over SSH.** The terminal interface runs where Snakemake runs; the browser view is reached through an SSH port forward, as it already is.
- **On a laptop submitting to a cloud service.** Snakemake runs locally and submits jobs remotely; results stay in remote storage until they are fetched.

A remote run can take days, longer than a terminal session stays open. It must keep running after the terminal closes and be reattached later, which ties into resuming runs and [workflow cancellation](../later.md#workflow-cancellation).

## Cancellation

Ctrl+C reaches Snakemake, which cancels the jobs it submitted. GenoPilot waits for that before exiting, as for local runs, and says which jobs could not be cancelled.

## Provenance

Every run records where it ran: the profile's name and its Snakemake options without secrets, the executor and storage plugins with their versions, the container image digest where one is used, and for each job the host and the resources it was granted.

## Testing

The application's side is tested with injected process runners, as local runs are. CI has no cluster or cloud account. A real executor test stays opt-in, like the Conda integration test.

## Phases

1. A documented direct-Snakemake recipe for a GenoPilot-saved configuration on SLURM, together with rule resources.
2. Execution profiles and the start-page choice for SLURM.
3. AWS: a storage plugin and container images.
4. Further executors, such as Kubernetes or Google Batch, when a researcher needs them.

## Open questions

- Which service comes first after SLURM?
- Where do results of a cloud run end up: synced back to the local run directory, or viewed where they are?
- Who builds the container images: GenoPilot's release process, or the researcher from the pinned environments?
- Should a cloud run show expected cost and quota limits before it starts?
