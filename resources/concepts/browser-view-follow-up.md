# Browser view follow-up

Builds on the [completed browser-view concept](done/browser-view/README.md), which records the implemented scope and original design.

The current browser view is sufficient for the next release. Further browser work is deferred until researcher requirements have been collected; the items below are candidates, not release commitments. Keep the existing preview and verification limitations explicit rather than treating deferred verification as completed.

## Requirements first

- [ ] Collect researcher feedback on the current document and genome views, then prioritize demonstrated needs before resuming implementation.

## Follow-up candidates

- [ ] Visually verify recent genome UI changes, canvas styling, and click details ([canvas notes](done/browser-view/canvas-colors.md), [compatibility findings](done/browser-view/compatibility-findings.md)).
- [ ] Restore and update parked browser tests once the UI settles ([restoration notes](done/browser-view/compatibility-findings.md#parked-tests)); include failure paths, resource correctness, and lifecycle coverage.
- [ ] Add panning-follow and region selection ([genome design](done/browser-view/genome.md#work)).
- [ ] Add CLI-owned decision drafting, browser review actions, and the draft tray; first move the cohort draft into the persistent result screen ([decision design](done/browser-view/genome.md#decision-drafting)).
- [ ] Add genome SVG/PNG downloads with provenance, the download menu, and the About sheet ([container design](done/browser-view/README.md#downloads)).
- [ ] Add the genome source for saved isolate sequences when that feature exists ([genome work](done/browser-view/genome.md#work)); the annotation review's read-only view is part of its [own concept](done/annotation-review.md#review-view).
- [ ] With drafting: the annotation review's verdict actions ([deferred there](annotation-review-decision.md#deferred)).
- [ ] Design chart and table kinds when a researcher-facing screen needs them.
- [ ] Update researcher documentation, legends, workflow result guides, and the changelog alongside any implemented follow-up.

Release bundling, browser asset inclusion, and dependency license notices are implemented as described in the [bundled-package concept](done/bundled-package.md).
