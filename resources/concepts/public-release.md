# Public release

## Goal

Make the repository public in a state where a researcher can install GenoPilot, reproduce a known result, run their own data, and cite exactly what produced it. Reviewers of a paper that uses GenoPilot should be able to check the same.

[Zenodo release archiving](zenodo-release-archiving.md) gives every release a DOI, and the [bundled package](done/bundled-package.md) pins the application's own code. This concept covers the rest.

## Citing a run

Each run says how to cite it, so citing never depends on the researcher reconstructing versions afterwards.

### Prerequisite: the GenoPilot version in provenance

Run provenance records the workflow ID and version and the configured and observed tool versions, but not the GenoPilot package version. That is the open question of the Zenodo concept. Record it, from `package.json`, in the saved configuration and in the provenance. A direct Snakemake run then reports the version that saved its configuration.

Many development builds share one version number, so record the build's commit next to the version: the commit, its committer date, and whether the working tree had uncommitted changes. A run from a released version is identified by its version alone; the commit only makes development runs traceable.

What exists:

- `src/package-root.ts` (`packagedPath('package.json')`) reads the version in the sources and in the bundle alike; `src/cli.tsx` already holds it in `metadata.version`.
- `src/build-info.ts` (`readBuildInfo()`) returns the commit, `committedAt`, and `modified`, embedded by `scripts/build.mjs` or read from Git under `pnpm dev`, and `undefined` outside a Git checkout. `metadata.build` holds it, and the tooling page already shows it.

Where it goes:

- The saved configuration: each workflow's builder (`src/workflows/*/run-configuration.ts`) writes it, and its validator (`src/workflows/*/configuration.ts`, with the shared checks in `src/workflows/configuration-validation.ts`) accepts it. The builders run in the UI, so the version and build info are passed in rather than read inside them, which keeps them testable.
- The provenance: the scripts that write `provenance/run.json` copy it from the configuration they already receive through `--config-json`: `workflows/shared/scripts/collect_run_provenance.py`, and `collect_consensus_provenance.py` and `collect_iteration_provenance.py` under `workflows/reference-consensus/scripts/`. Their Python tests are under `tests/workflows/`.
- The result page: next to the workflow identity in `src/ui/run-results-screen/screen.tsx`, and in the browser's provenance footer (`src/browser/page/provenance.tsx`), which today shows only the running application's version.

Open points:

- A reference-consensus iteration runs later from the same `config.yaml`, possibly with a newer GenoPilot. Decide whether its provenance records the version that saved the configuration, the one that ran the iteration, or both.
- Runs saved before this change have no version. The project is unreleased, so no schema bump or migration is needed, but decide whether such runs still open, showing the version as unknown, or are rejected as incompatible.

### Citation file per run

Every run writes a `CITATION.md` into its results, and the result page shows it. It contains:

- the GenoPilot version and its version DOI, and the workflow ID and version;
- the tools that ran, with the versions the run observed;
- the references for these tools, and the GenoPilot citation;
- a draft methods paragraph built from the effective parameters, which the researcher checks and adapts.

The tool references are written out in full rather than linked. Researchers cite what is in front of them; a link to the workflow README alone would leave most papers citing GenoPilot only, and GenoPilot is the wrapper, not the method. The file lists only the tools that ran in this run, for example not the NCBI Datasets CLI when no input was an accession. Each tool is cited the way it asks to be, from its README or `CITATION` file, rather than with a paper we choose. The result page only says to cite GenoPilot and the tools listed in `CITATION.md`, and the full list stays in the file.

### Viewing and copying the citation

The result page's documents include the run's `CITATION.md`, so `v` opens it in the [browser view](../../docs/browser-view.md) like the result help. There, each part a researcher pastes elsewhere gets a copy button: the methods paragraph, the reference list, and the whole file. A button copies plain text with the Markdown markup removed, because the text goes into a manuscript, not a Markdown file. The page is served from `127.0.0.1`, which browsers treat as a secure origin, so the clipboard API is available, also through an SSH port forward. If copying fails, the button says so and selects the text for a manual copy.

The terminal shows the file and its path but offers no copy action; terminal clipboard support varies too much to rely on.

Open question: should a reference list also be copyable as BibTeX or RIS for reference managers? That needs the workflow reference files to hold structured fields rather than formatted strings.

The tool references are only prose under `## References` in each workflow README today. To write them into a run, each workflow needs a machine-readable list beside its README, such as `references.yaml` or `references.bib`, and the README's list should be generated from it or checked against it by a test, so the two cannot drift. This file belongs to the workflow and is found by convention. Shared code never names a workflow.

A run produced by a development build, whose version has no DOI, is marked as not citable in its citation file and on its result page, following the rule [Coordinating with a publication](zenodo-release-archiving.md#coordinating-with-a-publication).

Open questions:

- How does a run learn its version DOI? A version's DOI exists only after its release is published, so it cannot be compiled into that release. Options: the citation file names the version and the concept DOI and says how to find the version DOI, or the application looks it up when the page is shown.
- Should the methods paragraph name every parameter, or only those that differ from the defaults, with the full configuration attached?

## Reproducibility of a cited version

These tasks are already in [`tasks.md`](../tasks.md#tooling) and block the first cited release:

- pin LiftOn's pip dependencies;
- record each rule environment's explicit conda package list and `pip freeze` in run provenance;
- lock the rule environments with Snakemake's per-platform pin files.

Pinned versions are not the same as available packages. Zenodo archives the code but not the conda or PyPI packages, and channels can drop builds. For a cited release, decide whether to also archive the explicit lock files, and possibly a container or Apptainer image with the provisioned environments. Clusters often need such an image anyway (see [Clusters](#clusters)).

## A worked example on public data

The fixtures are synthetic and prove the rules work. They do not show a researcher what a real run looks like, and they cannot support a scientific claim. Each workflow needs one documented example on public data:

- public accessions and reads, small enough to run on a laptop;
- the expected duration, disk use, and memory on a stated machine;
- the expected key results, such as counts and checksums, that a researcher can compare;
- for reviewers, a comparison with an independent result where one exists.

The example belongs to the workflow (`workflows/<id>/`), not to `docs/`. A test can check that its documented expectations match a recorded run, but the example itself is not part of CI.

## Community files

- `CONTRIBUTING.md`: how to report problems, propose workflows, and run the verification steps.
- `SECURITY.md`: where to report a vulnerability without a public issue.
- A code of conduct.
- Issue templates. The bug template asks for the GenoPilot version, the workflow version, and the run's provenance and logs, and warns against attaching reads, unpublished assemblies, or collaborator data.

## Sharing a run

Researchers need a run's evidence for supplementary material and bug reports without its large files. Add a single export action that packs a run's configuration, decisions, provenance, logs, checksums, and citation file, and leaves out reads, alignments, and other large intermediates. It lists what it left out and their checksums, so a reader can still verify them against the original run.

## Clusters

Large cohorts do not run on a laptop. Every workflow runs directly through Snakemake already. Document how to run a GenoPilot-saved configuration with a Snakemake executor, such as SLURM, and what the run then records. Non-interactive `--version` and `--help` are already in [`tasks.md`](../tasks.md#application).

## Before switching to public

Going public publishes the full Git history, not only the current tree, and Zenodo snapshots cannot be withdrawn.

- Audit the history for private material. A search of `git log -p` for accessions and paths found only public or placeholder accessions (for example `GCF_000149205`, `SRR1234567`) and test paths (`/Users/researcher`). Still check the design notes for collaborator names, unpublished findings, and personal notes, as was done for the Zenodo concept.
- Check that `CITATION.cff` has the author's ORCID and affiliation (see the Zenodo concept).
- Consider the [Journal of Open Source Software](https://joss.theoj.org) review checklist. It asks for an OSI license, tests, documentation, community guidelines, and a statement of need, which this concept mostly covers, and a JOSS paper is a citable description of GenoPilot next to the version DOIs.

## Order

The [bundled package](done/bundled-package.md) is done: it pins the application's own code, and its package-root helper is how the application reads its version from `package.json`. Native binaries or a single executable stay out of scope (see the bundled-package concept).

1. The GenoPilot version in provenance.
2. The history audit.
3. The citation file per run, with machine-readable workflow references.
4. The environment locks already in `tasks.md`.
5. The worked examples.
6. Community files and issue templates.
7. Run export and cluster documentation, which can follow the first public release.
