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

1. [ ] The repository must be public. Zenodo archives only public repositories.
2. [x] Sign in to Zenodo with GitHub and link an ORCID to the Zenodo account.
3. [ ] Grant the Zenodo GitHub app access to the `BYTEOWLS` organization. An organization owner must approve it.
4. [ ] Enable `BYTEOWLS/genopilot` on Zenodo's GitHub page. Repeat on the sandbox for the trial release.
5. [ ] Add the author's ORCID (`orcid:`) and affiliation to `CITATION.cff`.

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

## Software and paper credit

GenoPilot is planned to appear in two papers, one with the GenoPilot author as first author. Paper authorship and software authorship are kept apart:

- **`CITATION.cff` authors are the people who wrote code**, currently only the GenoPilot author. Co-authors who contribute to a paper, such as the supervisor as co-author or last author, do not become software authors or copyright holders.
- **After a paper is published, add it as `preferred-citation`** in `CITATION.cff`, with all of the paper's authors, its DOI, and journal. GitHub's "Cite this repository" and readers then cite the paper, while the software entry and the Zenodo version DOI keep naming the code's authors. `preferred-citation` holds only one paper; name the other paper describing GenoPilot in the README's citation section.
- **Papers that only use GenoPilot are not added to `CITATION.cff`.** Its `references:` lists works GenoPilot builds on, not works that cite it. Such a paper, for example a supervisor's own paper with data produced by GenoPilot, cites the version DOI of the release that produced its data, following [Coordinating with a publication](#coordinating-with-a-publication). Its contribution statement credits whoever ran the analysis (*Formal analysis*, *Data curation*, or co-authorship, as the authors agree). Papers that use GenoPilot can be listed in a *Publications using GenoPilot* section of the README.
- **The paper's CRediT contribution statement records who wrote the software** (*Software*, *Conceptualization*, *Methodology*) separately from *Supervision* and *Writing – review & editing*.
- **The license is settled before the first submission**, so the paper, `CITATION.cff`, and the Zenodo record name the same license. GenoPilot uses `AGPL-3.0-or-later`, which is OSI-approved and therefore accepted by journals and Bioconda. Zenodo takes the license from `CITATION.cff`. Version 0.0.1 on npm remains under MIT.

## Open questions

- Resolved: run provenance records the GenoPilot version and build that saved the configuration, so a reader can map a run to its version DOI ([citing runs](done/citing-runs.md#the-genopilot-version-in-provenance)).
