# Sequencing technology and read sets

## Status

Proposed breaking change. Resolve the open decisions and approve the plan before implementation. This does not add execution support for another sequencing technology.

## Goal

Keep isolates independent of sequencing technology. Record platform and read layout on their read sets, and let each workflow explicitly select compatible data. One isolate can have Illumina, Nanopore, and PacBio data without becoming several isolates.

Platform and layout are separate: Illumina, DNBSEQ, and AVITI can all produce paired-end short reads. Similar layout does not establish workflow compatibility; each platform needs validation before execution is supported.

## Current boundary

The catalog stores `read_pairs` directly on each isolate. Illumina delivery discovery uses filename patterns to propose isolates and read pairs. The reference-consensus workflow requires paired-end Illumina reads, derives read groups from Illumina headers, and writes platform `ILLUMINA`.

Read groups do not inherently require Illumina headers. Those headers supply useful metadata, but explicit metadata could supply it instead. Library identity must remain reliable because duplicate marking depends on it; never silently invent it.

The external tools are not strictly Illumina-exclusive. Their configuration and the workflow's input assumptions form a paired-end short-read pipeline currently supported only for Illumina. Backbone assemblies are independent of sequencing technology.

## Proposed approach

### Catalog model

- Keep isolate identity separate from its sequencing inputs.
- Give read sets stable IDs, independent of display names and file paths.
- Record sequencing platform separately from read layout, such as single-end or paired-end.
- Define a read set as one library sequenced on one platform with one layout, potentially delivered across several lanes or file chunks. Confirm this boundary against actual import and selection needs before finalizing the schema.
- Preserve R1/R2 associations and lane/chunk grouping within a read set.
- Represent library identity independently of read-set identity: sequencing the same library again must not make it a different library for duplicate marking.
- Add only fields required by the agreed use cases; defer other technology-specific execution metadata.

The exact schema, identifier rules, platform values, and representation of layouts not yet executable remain to be designed.

### Workflow compatibility

- Keep reference-consensus execution limited to paired-end Illumina read sets.
- Distinguish invalid input from valid catalog data that this workflow cannot use. Explain incompatibility, such as unsupported platform, unsupported layout, or missing required metadata.
- Show compatible and incompatible read sets during selection; never silently ignore other data.
- Explicitly select read sets by stable ID. Snapshot their files, platform, layout, library identity, and effective read-group metadata, not just references to the mutable catalog.
- Keep file validation and checksums in the workflow, linked to the selected snapshot inputs and recorded in provenance.
- Keep compatibility validation in the application and file/evidence validation in workflow rules.
- Do not implement generic scheduler or platform-plugin abstractions for hypothetical future callers.

### Discovery and validation

- Retain Illumina delivery-pattern discovery as an import convenience, not the definition of an isolate or its eligibility.
- Present inferred metadata for review before saving.
- Keep platform labels distinct from checks that the files and metadata are usable; header syntax alone is not proof of platform or library identity.
- A generated, unique read-group ID is acceptable when needed. Do not fabricate flowcell, lane, barcode, or library identity; unknown optional metadata stays unknown, and missing required metadata blocks execution.
- Record the source of effective read-group metadata: derived from headers or supplied explicitly. Check disagreements rather than silently choosing one source.
- Decide separately whether explicit read-group metadata should permit archive-renamed Illumina reads. Technology grouping alone does not solve missing library identity.

### Breaking transition

- Version the catalog and affected configuration/snapshot contracts explicitly.
- Choose confirmed migration or re-import for existing catalogs; do not silently assume legacy reads are Illumina.
- Preserve saved run snapshots unchanged so catalog edits cannot alter existing evidence.
- Define and document whether older runs remain viewable, resumable, or usable for new iterations, including behavior when packaged workflow updates invalidate upstream artifacts.
- Never simulate compatibility by rewriting provenance or manipulating timestamps.

## Open decisions

- Migrate existing catalogs with user confirmation, or require re-import?
- Support archive-renamed Illumina reads through explicit metadata now, or in a separate change?
- Does the proposed read-set boundary fit repeated sequencing of one library and lane-merged deliveries, and how are file groups and shared library identity represented?
- Which platforms and layouts can be recorded before they have an executable workflow, and how is unknown platform handled?
- Which read-group metadata is required for execution, how is its source recorded, and how are conflicting supplied and inferred values resolved?
- What is the supported boundary for viewing and executing existing runs after the contract change?

## Implementation plan

- [ ] Inspect catalog, import, editing, selection, configuration validation, snapshots, provenance, and workflow read-group handling; record the affected contracts.
- [ ] Resolve the open decisions and approve the schema and transition plan before implementation.
- [ ] Implement versioned catalog storage and the agreed migration or re-import boundary.
- [ ] Update discovery, metadata review, catalog editing, and read-set presentation.
- [ ] Add explicit workflow compatibility and read-set selection, saved in immutable run snapshots.
- [ ] Update workflow inputs, read-group handling, provenance, and old-run handling as agreed.
- [ ] Update user documentation, workflow documentation, and changelog together with the implementation.
- [ ] Test transition failures, mixed-platform isolates, unsupported versus invalid input, layout compatibility, lane/chunk pairing, shared libraries across read sets, metadata conflicts, and snapshots unaffected by catalog edits; follow the repository's browser-test pause.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm pack:local`, and Python workflow tests.

## Out of scope

Execution on any non-Illumina platform, including DNBSEQ, AVITI, Nanopore, and PacBio; hybrid calling; technology-specific optimization; and a general platform execution framework. Additional platform support needs validated preprocessing, alignment, calling, and quality behavior. Another short-read platform may reuse much of the existing pipeline rather than require a separate one.
