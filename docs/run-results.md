# Run results

Every workflow's result page has a **Run Details** tab with the run's technical metadata, a **Files** tab that starts with the run directory and the run's own files, and a **Citation** tab that shows how to cite the run. This page explains those items; each workflow's own results page explains the rest, including what its run status means.

## Citation

The Citation tab shows the run's `citation/CITATION.md`, which the run writes when it finishes: whether the run is citable, the GenoPilot version, the tools that ran with their versions and references, the genome viewer igv.js, a draft methods paragraph built from the run's configuration, and the references as BibTeX and RIS. Cite GenoPilot and the tools it lists; GenoPilot ran or bundles them, but the tools are the method. Check and adapt the methods paragraph before using it. A run saved by a development build is marked as not citable: only a released version has a DOI, so rerun the analysis with a release before citing it.

Press `v` on the tab to open the citation in the browser view, where it can be copied. A run that has not finished yet has no citation.

## Run details

| Item | Meaning |
|---|---|
| Run ID | Unique identifier generated when the run was created. It names the run directory and never changes. |
| Name | Optional label entered when the run was created. It does not need to be unique. |
| Description | Optional free-text description entered when the run was created. |
| Workflow | Workflow label with its stable identifier and version. Results are interpreted by identifier and version, so a changed label does not affect loading. |
| GenoPilot | The GenoPilot version that saved the run's configuration. A release shows only its version; a development build also shows its commit, and whether it had uncommitted changes. It also records its igv.js version. Only a run saved by a release can be cited by that release's DOI. Later steps of the run, such as one started from a saved decision, keep this version. |
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
| Run provenance | Record of the GenoPilot version and build that saved the configuration, commands, tool versions, resources, timestamps, effective configuration, and input checksums. |
| How to cite this run | The run's citation: the GenoPilot version, the tools that ran with their versions and references, a draft methods paragraph to check and adapt, and the references as BibTeX and RIS. A run of a development build is marked as not citable. The Citation tab shows it, and `v` there opens it in the browser view, where each part can be copied as plain text. |
| Complete step logs | Directory containing the complete logs of every workflow step. |
