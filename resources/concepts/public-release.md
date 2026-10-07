# Public release

## Goal

Make the repository public in a state where a researcher can install GenoPilot, reproduce a known result, run their own data, and cite exactly what produced it. Reviewers of a paper that uses GenoPilot should be able to check the same.

[Zenodo release archiving](zenodo-release-archiving.md) gives every release a DOI, and the [bundled package](done/bundled-package.md) pins the application's own code. This concept covers the rest.

## Citing a run

Each run says how to cite it, so citing never depends on the researcher reconstructing versions afterwards.

### Prerequisite: the GenoPilot version in provenance (done)

Every saved configuration has a required `genopilot` section: the `package.json` version and, when known, the build's commit, its committer date, whether the working tree had uncommitted changes, and whether it is a release build (`released`: the build `pnpm publish` makes through `prepublishOnly`, which refuses uncommitted changes; a local build or running the sources is never a release, and the tag is not checked). The provenance scripts copy it into `provenance/run.json` and each iteration's provenance, so a direct Snakemake run reports the version that saved its configuration. The result page and the browser's provenance footer show it; a release shows only its version.

Decisions:

- A reference-consensus iteration records the version that saved the configuration, not the one that ran the iteration. Passing the running version as a `--config` override would change the configuration Snakemake sees and make the iteration's dry-run check refuse it; an iteration runs the same workflow version, and the result page already flags a mismatch.
- The section is required. No runs exist from before it, so there is no fallback for a missing version.

### Citation file per run (done)

Every finished run writes `citation/CITATION.md`, with `citation/references.bib` and `citation/references.ris` beside it, from its `provenance/run.json` (the shared rule `write_citation`). It contains:

- whether the run is citable: only a run saved by a release build is; a development build is marked as not citable, following [Coordinating with a publication](zenodo-release-archiving.md#coordinating-with-a-publication);
- the workflow ID and version, and the GenoPilot version;
- the tools that ran, with the versions the run observed, falling back to the pinned version where the run could not observe one;
- a draft methods paragraph naming every parameter that changes a result, which the researcher checks and adapts;
- the GenoPilot citation and the tools' references, written out in full, and the same references as BibTeX and RIS.

The tool references are written out in full rather than linked. Researchers cite what is in front of them; a link to the workflow README alone would leave most papers citing GenoPilot only, and GenoPilot is the wrapper, not the method. The file lists only the tools that ran in this run, for example not the NCBI Datasets CLI when no input was an accession.

Each workflow keeps, by convention, `citation/references.json` (its README's references with structured fields, and its `## Tools` rows mapped to them) `citation/methods.txt` (the methods paragraph as a template), and `citation/phrases.json` (the wording of setting values in it, so a value without wording fails rather than appearing raw); `workflows/shared/citation/genopilot.json` holds GenoPilot's own entry. A test keeps the README lists and `CITATION.cff` equal to these files, and the workflow tests fill every template. JSON, because rule scripts use only the standard library.

The result page has a Citation tab, and the run's files list the file. `v` on the tab opens the citation in the [browser view](../../docs/browser-view.md), and every view opened from the run's results has a **Cite this run** button in its header that shows it in a dialog. There, the whole citation and each `##` section (methods, references, BibTeX, RIS) get a copy button that copies plain text without Markdown markup; if the clipboard is refused, the button says so and shows the text selected. The page is served from `127.0.0.1`, which browsers treat as a secure origin, so the clipboard API is available, also through an SSH port forward. The terminal offers no copy action; terminal clipboard support varies too much to rely on.

Decisions:

- **The version DOI.** A version's DOI exists only after its release is published, so it cannot be compiled into that release. The citation file names the version and, once one exists, the concept DOI, whose Zenodo record lists every version DOI. Looking the version DOI up through Zenodo's records API when the citation is shown is deferred until the first release has a concept DOI, since there is nothing to look up before.
- **The methods paragraph names every parameter** that changes a result, not only those that differ from the defaults.

Open points:

- Check each tool's own README or `CITATION` file for how it asks to be cited; the references follow the workflow READMEs, which were written from the tools' papers.
- Reference-consensus iterations do not write a citation of their own; the run's citation describes the first cohort.
- Snakemake's paper is a versioned F1000Research article whose DOIs name a version and which has no version-free DOI, so the references cite its latest version (3). A new paper version is rare and independent of the Snakemake pin; update the reference when one appears.

## Reproducibility of a cited version

These tasks are already in [`tasks.md`](../tasks.md#tooling) and block the first cited release:

- pin LiftOn's pip dependencies;
- record each rule environment's explicit conda package list and `pip freeze` in run provenance;
- lock the rule environments with Snakemake's per-platform pin files.

Pinned versions are not the same as available packages. Zenodo archives the code but not the conda or PyPI packages, and channels can drop builds. For a cited release, decide whether to also archive the explicit lock files, and possibly a container or Apptainer image with the provisioned environments. [Remote execution](remote-execution.md#software-and-data) on services without a shared filesystem needs such an image anyway.

## A worked example on public data

The fixtures are synthetic and prove the rules work. They do not show a researcher what a real run looks like, and they cannot support a scientific claim. Each workflow needs one documented example on public data:

- public accessions and reads, small enough to run on a laptop;
- the expected duration, disk use, and memory on a stated machine;
- the expected key results, such as counts and checksums, that a researcher can compare;
- for reviewers, a comparison with an independent result where one exists.

The example belongs to the workflow (`workflows/<id>/`), not to `docs/`. A test can check that its documented expectations match a recorded run, but the example itself is not part of CI.

## Community files

Done:

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md): problems and workflow proposals go through issues; pull requests are accepted on invitation only while the contracts are unstable; before merging, a contributor agrees to the [Contributor License Agreement](../../CLA.md) in the pull request (`.github/pull_request_template.md`). It grants the project owner a non-exclusive, sublicensable right to license the contribution under any terms, so GenoPilot can still be offered under other terms than the AGPL; Austrian copyright cannot be transferred, so the contributor remains its author.
- [`SECURITY.md`](../../SECURITY.md): private reports through GitHub's private vulnerability reporting, which is enabled when the repository goes public, or by email.
- [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md): the Contributor Covenant 2.1.
- Issue forms in `.github/ISSUE_TEMPLATE/`: a bug report that asks for the GenoPilot version and build, the workflow ID and version, and the run's provenance and logs, and warns against attaching reads, unpublished assemblies, or collaborator data; a workflow proposal; blank issues disabled, with a link for security reports.

## Sharing a run

Researchers need a run's evidence for supplementary material and bug reports without its large files. Add a single export action that packs a run's configuration, decisions, provenance, logs, checksums, and citation file, and leaves out reads, alignments, and other large intermediates. It lists what it left out and their checksums, so a reader can still verify them against the original run.

## Clusters and cloud services

Running on SLURM, AWS, and similar services through Snakemake executor plugins has its own concept: [Remote execution](remote-execution.md).

## Before switching to public

Going public publishes the full Git history, not only the current tree, and Zenodo snapshots cannot be withdrawn.

- Audit the history for private material. A search of `git log -p` for accessions and paths found only public or placeholder accessions (for example `GCF_000149205`, `SRR1234567`) and test paths (`/Users/researcher`). Still check the design notes for collaborator names, unpublished findings, and personal notes, as was done for the Zenodo concept.
- Check that `CITATION.cff` has the author's ORCID and affiliation (see the Zenodo concept).
- Have a lawyer review `CLA.md` before the first external contribution is merged.
- Prepare the [project website](project-website.md), which goes live with the public repository.
- Consider the [Journal of Open Source Software](https://joss.theoj.org) review checklist. It asks for an OSI license, tests, documentation, community guidelines, and a statement of need, which this concept mostly covers, and a JOSS paper is a citable description of GenoPilot next to the version DOIs.

## Order

The [bundled package](done/bundled-package.md) is done: it pins the application's own code, and its package-root helper is how the application reads its version from `package.json`. Native binaries or a single executable stay out of scope (see the bundled-package concept).

1. The GenoPilot version in provenance (done).
2. The history audit.
3. The citation file per run, with machine-readable workflow references (done).
4. The environment locks already in `tasks.md`.
5. The worked examples.
6. Community files and issue templates (done).
7. Run export, which can follow the first public release.
