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

A run's evidence, without its large files, for supplementary material and bug reports has its own concept: [Run export](run-export.md). It can follow the first public release.

## Clusters and cloud services

Running on SLURM, AWS, and similar services through Snakemake executor plugins has its own concept: [Remote execution](remote-execution.md).

## Order

Native binaries or a single executable stay out of scope (see the [bundled package](done/bundled-package.md)).

1. The environment locks already in `tasks.md`.
