# Run export

## Goal

One action packs the evidence of a run, how it was configured, decided, run, and recorded, into a small archive a researcher can attach to a paper's supplementary material or a bug report, or hand to a reviewer. It leaves out the run's large and data-bearing files, but lists each of them with its checksum, so a reader who holds the original results can confirm they belong to exactly this run.

The bug report form already asks for a run's provenance and logs and warns against attaching data. The export makes that one action instead of a careful selection by hand.

## What the export contains

From the run directory, unchanged:

- `config.yaml` and the saved decisions in `decisions/`;
- `artifacts.yaml`, the checksum of every input, result, and log;
- `provenance/`, the run's provenance and that of every iteration and resolved input;
- `citation/`, how to cite the run;
- `logs/`, every step's log and benchmark and each attempt's complete Snakemake stdout and stderr, and `events.jsonl`.

A workflow can add files of its own by convention, for example a snapshot saved next to `config.yaml` or small result summaries such as JSON reports, so the shared export never names a workflow's files. Whether the workflow's manifest lists them or its result reader does is decided with the [workflow modules](workflow-modules.md).

Everything else in the run directory stays out: reads, alignments, variant calls, consensus FASTAs, annotations, and every other result table. Inputs outside the run directory, such as the isolates' reads, are never copied.

## The export record

The archive holds one `EXPORT.md`, readable without GenoPilot, and its data as `export.json`:

- the GenoPilot version and build that exported, the run's ID and workflow, and when it was exported;
- every included file with its checksum;
- every file left out, with its size and the checksum `artifacts.yaml` records for it;
- every file that was changed by the privacy review below, with the checksum of its original.

A reader verifies a left-out file by comparing its checksum with the record; a later [verification command](../later.md#run-verification-command) can do that for a whole run.

## Privacy review

The files the export keeps are not harmless by themselves. `config.yaml`, the provenance, and the logs contain absolute paths, which name the user's home directory, and they can contain isolate names and descriptions, catalog details, and accessions of assemblies that are not yet public.

Before writing the archive, the export shows what it found:

- the absolute paths, grouped by their common prefixes, such as the home directory or the run directory;
- the isolate names and accessions the run used.

The researcher can replace the path prefixes with placeholders such as `<home>` and `<run-dir>`. Names and accessions are shown, not changed: replacing them would make the record useless for the bug it reports or the result it documents, so the researcher decides whether to export at all. A replaced file no longer matches its recorded checksum, so the record names it as changed and keeps its original checksum. Nothing is replaced silently.

## Decisions

- **The archive format.** A `.tar.gz` written with the system's `tar`, which Linux and macOS both have, instead of a ZIP writer as a new dependency; Node's built-ins have neither. Decide at the kickoff.
- **Where it starts.** From a run's result page and from the open-run screen, for complete and incomplete runs alike: a failed run is the most common reason to export one.
- **Where it is written.** Next to the run directory, never inside it, so an export does not change the run it describes.

## Open questions

- Should the export also have a non-interactive form, such as `genopilot export <run-dir>`, once the CLI has non-interactive commands?
- Do the small result summaries a workflow adds need a size limit, so a large cohort's summaries never turn an export into a data archive?

## Work

- [ ] Kickoff: decide the archive format and how a workflow names its own files for the export.
- [ ] The export of the shared files with `EXPORT.md` and `export.json`, including left-out files with their checksums.
- [ ] The privacy review: found paths, names, and accessions, and the replacement of path prefixes with their record.
- [ ] Each workflow's own files.
- [ ] Tests on a fixture run: the included and left-out files and their checksums, a replaced path and its record, an incomplete run, a failed `tar`, and that the run directory stays unchanged.
- [ ] Document the export in `docs/` and point to it from the bug report form and `CONTRIBUTING.md`.

## Acceptance

A researcher exports a run in one action and gets a small archive with its configuration, decisions, provenance, logs, and citation, a record of every file left out with its checksum, and no path or name they did not see before it was written.
