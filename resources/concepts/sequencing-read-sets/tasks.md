# Sequencing technology and read sets — tasks

[Concept](concept.md). Steps affect this repository.

## Implementation plan

- [ ] Inspect catalog, import, editing, selection, configuration validation, snapshots, provenance, and workflow read-group handling; record the affected contracts.
- [ ] Resolve the open decisions and approve the schema and transition plan before implementation.
- [ ] Implement versioned catalog storage and the agreed migration or re-import boundary.
- [ ] Update discovery, metadata review, catalog editing, and read-set presentation.
- [ ] Add explicit workflow compatibility and read-set selection, saved in immutable run snapshots.
- [ ] Define validated sequencing-specific preprocessing defaults and required metadata; resolve and snapshot effective settings per read set.
- [ ] Update workflow inputs, preprocessing, read-group handling, provenance, and old-run handling as agreed.
- [ ] Update user documentation, workflow documentation, and changelog together with the implementation.
- [ ] Test transition failures, mixed-platform isolates, unsupported versus invalid input, layout compatibility, lane/chunk pairing, shared libraries across read sets, metadata conflicts, and snapshots unaffected by catalog edits; follow the repository's browser-test pause.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm pack:local`, and Python workflow tests.
