# Run results

Every workflow's result page has a **Run Details** tab with the run's technical metadata, and a **Files** tab that starts with the run directory and the run's own files. This page explains those items; each workflow's own results page explains the rest, including what its run status means.

## Run details

| Item | Meaning |
|---|---|
| Run ID | Unique identifier generated when the run was created. It names the run directory and never changes. |
| Name | Optional label entered when the run was created. It does not need to be unique. |
| Description | Optional free-text description entered when the run was created. |
| Workflow | Workflow label with its stable identifier and version. Results are interpreted by identifier and version, so a changed label does not affect loading. |
| Created | Time the run workspace was created, shown in local time. |
| Results written | Time the workflow wrote the results shown, in local time: the completion summary, or the provenance of the active cohort. A later rerun of that stage updates it. |
| Effective CPUs | Number of CPUs the workflow was allowed to use after applying the selected CPU mode. |

## Run files

| Item | Meaning |
|---|---|
| Run directory | Directory containing the saved configuration, all results, and all logs of this run. |
| Current attempt stdout | Complete standard output of the Snakemake process for the execution that just ended. |
| Current attempt stderr | Complete standard error of the Snakemake process for the execution that just ended. |
| Artifact index | Index of the run's files with checksums and whether each was generated, imported, or cached. |
| Run provenance | Record of commands, tool versions, resources, timestamps, effective configuration, and input checksums. |
| Complete step logs | Directory containing the complete logs of every workflow step. |
