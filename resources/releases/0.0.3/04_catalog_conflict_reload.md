# Reload the catalog after a save conflict

## Outcome

When another window changes the isolate catalog, a refused save refreshes the displayed catalog without requiring a manual reload.

## Scope and contract

- Catalog storage owns revision checks and refuses stale writes. The isolate manager owns reloading and presenting the conflict.
- Reload only after a revision conflict; never silently overwrite newer data or automatically retry the rejected write.
- Explain that the save was refused. Retain recoverable edit values for deliberate retry where their referenced entries still exist; otherwise explain what changed. A reload failure remains visible and must not imply fresh data.
- Depends on the shared stale-lock fix; preserve the approved read-set schema and transition rules.

## Acceptance criteria

- [ ] A competing save causes the stale save to be refused and the current list/revision to load automatically.
- [ ] The competing changes remain intact; rejected edits are not silently applied or lost without explanation.
- [ ] Changed or removed entries cannot leave invalid selection or permit retry against the stale revision.
- [ ] Reload failure shows an actionable error; a subsequent explicit retry can recover.
