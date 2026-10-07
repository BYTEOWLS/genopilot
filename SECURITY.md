# Security policy

## Supported versions

Only the latest released version of GenoPilot receives fixes. While versions stay in the `0.x` range, a fix is released as a new version rather than backported.

## Reporting a vulnerability

Report a vulnerability privately, never in a public issue:

- through GitHub's [private vulnerability reporting](https://github.com/BYTEOWLS/genopilot/security/advisories/new), or
- by email to m.oberwasserlechner@byteowls.com.

Describe the affected version, how to reproduce the problem, and its impact. Do not include private research data; a synthetic example is enough.

You will receive an answer within four weeks. Once a fix is released, the vulnerability is disclosed in a GitHub security advisory and the changelog, crediting you if you wish.

## Scope

GenoPilot starts packaged Snakemake workflows and pinned tools; it installs its runtime only with consent and from verified downloads. Reports about the workflows, the runtime installation, the local browser view, or the handling of downloaded data are in scope. Vulnerabilities in the tools a workflow runs belong to those tools' projects, but tell us if GenoPilot pins an affected version.
