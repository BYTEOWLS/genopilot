# Contributing to GenoPilot

Thank you for your interest in GenoPilot. While its configuration and provenance contracts are still changing, contributions go through issues.

## Reporting a problem

Open a [bug report](https://github.com/BYTEOWLS/genopilot/issues/new/choose). It asks for:

- the GenoPilot version and build, shown on the tooling page and recorded in a run's `provenance/run.json`;
- the workflow ID and version;
- your operating system and architecture;
- the exact command GenoPilot showed, and what you expected instead;
- the run's provenance and logs, where the problem concerns a run.

Do not attach raw sequencing reads, unpublished assemblies, restricted workbooks, credentials, or collaborator data, in an issue or anywhere else in this repository. Reduce a problem to public accessions or a small synthetic example instead, or describe it and ask how to share more.

Report security vulnerabilities privately, as described in the [security policy](SECURITY.md), not in a public issue.

## Proposing a workflow

Open a [workflow proposal](https://github.com/BYTEOWLS/genopilot/issues/new/choose). Describe the scientific question, the tools and how they ask to be cited, public example data, and the outputs a researcher expects. Great workflows run reproducibly with pinned tools, and their documentation guides researchers from running them to interpreting the results.

## Pull requests

Pull requests are accepted on invitation only, after an issue has agreed on the change. Before an invited pull request is merged, its author agrees to the [Contributor License Agreement](CLA.md). GenoPilot is published under the [GNU Affero General Public License v3.0 or later](LICENSE) and also offered under other terms; the agreement lets the project owner license contributions under both, while you remain their author.

An invited change follows [`AGENTS.md`](AGENTS.md), which holds the project's architecture and conventions, and passes the verification steps in the README's [Development](README.md#development) section.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
