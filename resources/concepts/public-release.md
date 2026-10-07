# Public release

## Goal

Make the repository public in a state where a researcher can install GenoPilot, reproduce a known result, run their own data, and cite exactly what produced it. Reviewers of a paper that uses GenoPilot should be able to check the same.

[Zenodo release archiving](zenodo-release-archiving.md) gives every release a DOI, the [bundled package](done/bundled-package.md) pins the application's own code, and [citing runs](done/citing-runs.md) and the [community files](done/community-files.md) are done, and the [project website](project-website.md#worked-examples-on-public-data) brings the worked examples on public data that let a researcher reproduce a known result. This concept covers the rest.

## Citing a run

Every run records the GenoPilot version and build that saved it and writes a citation file with the tools that ran, a draft methods paragraph, and the references ([citing runs](done/citing-runs.md)). Open points:

- Check each tool's own README or `CITATION` file for how it asks to be cited; the references follow the workflow READMEs, which were written from the tools' papers.
- Reference-consensus iterations do not write a citation of their own; the run's citation describes the first cohort.

## Reproducibility of a cited version

These tasks are already in [`tasks.md`](../tasks.md#tooling) and block the first cited release:

- pin LiftOn's pip dependencies;
- record each rule environment's explicit conda package list and `pip freeze` in run provenance;
- lock the rule environments with Snakemake's per-platform pin files.

Pinned versions are not the same as available packages. Zenodo archives the code but not the conda or PyPI packages, and channels can drop builds. For a cited release, decide whether to also archive the explicit lock files, and possibly a container or Apptainer image with the provisioned environments. [Remote execution](remote-execution.md#software-and-data) on services without a shared filesystem needs such an image anyway.

## Community files

The contributing guide, the Contributor License Agreement, the security policy, the code of conduct, and the issue forms are in place ([community files](done/community-files.md)).

## Sharing a run

Researchers need a run's evidence for supplementary material and bug reports without its large files. Add a single export action that packs a run's configuration, decisions, provenance, logs, checksums, and citation file, and leaves out reads, alignments, and other large intermediates. It lists what it left out and their checksums, so a reader can still verify them against the original run.

## Clusters and cloud services

Running on SLURM, AWS, and similar services through Snakemake executor plugins has its own concept: [Remote execution](remote-execution.md).

## Before switching to public

Going public publishes the full Git history, not only the current tree, and Zenodo snapshots cannot be withdrawn.

- History audit done on 2026-10-07.
- Add the author's affiliation to `CITATION.cff`; the ORCID is there (see the Zenodo concept).
- Prepare the [project website](project-website.md), which goes live with the public repository.
- Consider the [Journal of Open Source Software](https://joss.theoj.org) review checklist. It asks for an OSI license, tests, documentation, community guidelines, and a statement of need, which this concept mostly covers, and a JOSS paper is a citable description of GenoPilot next to the version DOIs.

## Order

Native binaries or a single executable stay out of scope (see the [bundled package](done/bundled-package.md)).

1. The environment locks already in `tasks.md`.
2. The checks before switching to public.
3. Run export, which can follow the first public release.
