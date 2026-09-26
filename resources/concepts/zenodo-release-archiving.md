# Zenodo release archiving

Every GenoPilot release gets a permanent, citable DOI, so that a publication can name exactly the software version that produced its results.

## Why

Papers that use GenoPilot output must state which version produced it, or the analysis cannot be reproduced. A GitHub link or a branch name is not sufficient. It can move, be renamed, or disappear, and it does not pin a version. Zenodo stores an immutable copy of each release under its own DOI.

A consensus-genome publication built on GenoPilot output is the first concrete use. Its final analysis must run on a released version that already has a DOI.

## Decisions

- **GitHub–Zenodo integration, not manual uploads.** Zenodo archives a GitHub release automatically when it is published. There is no separate upload step to forget.
- **`CITATION.cff` is the only metadata source.** Zenodo reads title, authors, abstract, keywords, and license from it. Do not add a `.zenodo.json`, because Zenodo prefers it over `CITATION.cff` and the two would drift apart. `tests/citation.test.ts` keeps the citation version and license equal to `package.json`.
- **A GitHub release, not only a tag.** Zenodo reacts to published GitHub releases. Pushing a `vX.Y.Z` tag alone creates no DOI.
- **Two kinds of DOI.**
  - The *version DOI* identifies one release. Publications cite it.
  - The *concept DOI* always resolves to the latest release. The README badge and `CITATION.cff` use it.
- **Archived content is the release's Git snapshot.** It contains everything tracked in Git at that tag, including tests and synthetic fixtures, and nothing that is ignored. Zenodo records cannot be withdrawn quietly, so the repository-hygiene rules in `AGENTS.md` must hold before the first release.
- **Try it on the Zenodo sandbox first.** `sandbox.zenodo.org` issues test DOIs that do not count as real publications.

## One-time setup

1. The repository must be public. Zenodo archives only public repositories.
2. Sign in to Zenodo with GitHub and link an ORCID to the Zenodo account.
3. Grant the Zenodo GitHub app access to the `BYTEOWLS` organization. An organization owner must approve it.
4. Enable `BYTEOWLS/genopilot` on Zenodo's GitHub page. Repeat on the sandbox for the trial release.
5. Add the author's ORCID (`orcid:`) and affiliation to `CITATION.cff`.

## Release flow

1. Set the version in `package.json` and `CITATION.cff`, and move the `CHANGELOG.md` entries from *Unreleased* to the version.
2. Merge to `main` with CI passing, then tag `vX.Y.Z`.
3. Publish a GitHub release for the tag. Zenodo archives it and assigns the version DOI within minutes.
4. Publish the same version to npm. Both npm versions and Zenodo records are immutable, so both must come from the same tag.
5. After the first release, add the concept DOI to `CITATION.cff` (`doi:`) and a DOI badge to the README.

## Coordinating with a publication

1. Freeze the GenoPilot version that the paper's final analysis will use.
2. Release it and wait for its version DOI.
3. Run the final analysis with exactly that installed version, and cite that version DOI in the methods.

A result produced by an unreleased development build is not citable. Rerun it with the released version.

## Open questions

- Run provenance records the workflow ID and workflow version, but not the GenoPilot package version that produced the run. A reader of a run should be able to map it to the version DOI. Record the package version in run provenance before the first cited release.
