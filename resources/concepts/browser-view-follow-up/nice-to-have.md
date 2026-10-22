# Browser view follow-up — candidates

Deferred candidates, not release commitments. Promote only demonstrated needs after the [requirements task](tasks.md) is complete.

- Visually verify recent genome UI changes, canvas styling, and click details ([canvas notes](../completed/browser-view/canvas-colors.md), [compatibility findings](../completed/browser-view/compatibility-findings.md)).
- Restore parked browser tests only when explicitly requested ([restoration notes](../completed/browser-view/compatibility-findings.md#parked-tests)); cover failures, resource correctness, and lifecycle.
- Add panning-follow and region selection ([genome design](../completed/browser-view/genome.md#work)).
- Add shared CLI-owned decision-drafting infrastructure and the draft tray; first move the cohort draft into the persistent result screen ([decision design](../completed/browser-view/genome.md#decision-drafting)). Domain features own their actions and decision semantics.
- Add genome SVG/PNG downloads with provenance, the download menu, and About sheet ([container design](../completed/browser-view/concept.md#downloads)).
- Add a genome source for saved isolate sequences once available ([genome work](../completed/browser-view/genome.md#work)); annotation review's read-only view belongs to its [own concept](../completed/annotation-review/concept.md#review-view).
- Design chart/table kinds when a researcher-facing screen needs them.

[Annotation review](../annotation-review-decision/concept.md#deferred) owns browser verdict actions and candidate choices; this concept supplies only their shared drafting prerequisite.

Any implemented follow-up updates researcher documentation, legends, workflow result guides, and the changelog together.
