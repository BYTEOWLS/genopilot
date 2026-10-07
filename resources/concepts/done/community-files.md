# Community files

Implemented as part of the [public release](../public-release.md): how researchers report problems and propose workflows, and the terms under which contributions are accepted.

- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md): problems and workflow proposals go through issues; pull requests are accepted on invitation only while the contracts are unstable; before merging, a contributor agrees to the [Contributor License Agreement](../../../CLA.md) in the pull request (`.github/pull_request_template.md`). It grants the project owner a non-exclusive, sublicensable right to license the contribution under any terms, so GenoPilot can still be offered under other terms than the AGPL; Austrian copyright cannot be transferred, so the contributor remains its author. A lawyer has reviewed the agreement.
- [`SECURITY.md`](../../../SECURITY.md): private reports through GitHub's private vulnerability reporting, which is enabled when the repository goes public, or by email.
- [`CODE_OF_CONDUCT.md`](../../../CODE_OF_CONDUCT.md): the Contributor Covenant 2.1.
- Issue forms in `.github/ISSUE_TEMPLATE/`: a bug report that asks for the GenoPilot version and build, the workflow ID and version, and the run's provenance and logs, and warns against attaching reads, unpublished assemblies, or collaborator data; a workflow proposal; blank issues disabled, with a link for security reports.
