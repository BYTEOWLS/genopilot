# Sequencing technology and read sets — tasks

[Concept](concept.md). Delivered in release 0.0.3.

## Implementation plan

- [x] Inspect catalog, import, editing, selection, configuration validation, snapshots, provenance, and workflow read-group handling; record the affected contracts below.
- [x] Record approved behavioral decisions and concrete schema/defaults; implementation authorized after planning. Schema versions remain at `1` by explicit user decision.
- [x] Replace catalog storage and reject old structures with re-import instructions; no migration or automatic deletion.
- [x] Update discovery, metadata review, catalog editing, and read-set presentation, including multiple lane/chunk groups, confirmed library IDs, and manual archive-read entry.
- [x] Add explicit compatibility and stable-ID selection, saved in immutable snapshots.
- [x] Resolve and snapshot per-set Illumina preprocessing: Auto / On / Off poly-G, provider-trimmed group skips, unknown-processing review, and fixed other defaults.
- [x] Update workflow inputs, full FASTQ validation, read groups, preprocessing, provenance, and rejection of incompatible saved runs; separate technology-specific helpers from general handling.
- [x] Update user/workflow documentation and changelog; add the hypothetical technology-extension example to the repository README.
- [x] Test contract rejection, compatibility, multi-group pairing, shared libraries, archive headers, metadata conflicts, preprocessing choices/skips, and snapshot isolation; preserve input-size estimates and keep browser testing paused.
- [x] Run final tests, typechecking, build, packaging, and Python workflow tests after the final review.

## Contract inventory

| Boundary | Owner |
|---|---|
| Nested catalog, stable identities, strict validation | `src/isolates/catalog.ts`; repository README YAML example |
| Illumina metadata/defaults/compatibility | `src/isolates/illumina/metadata.ts`; workflow README scientific rationale |
| Delivery grouping and reviewed import | `src/isolates/illumina/{delivery,import}.ts`; `docs/import-review.md` |
| Editing and explicit selection | `src/ui/isolates-screen/`; `src/ui/components/isolates-field.tsx`, with injected workflow compatibility |
| Configuration and immutable effective snapshots | `src/workflows/reference-consensus/{configuration,run-configuration,snapshot}.ts` |
| Selected-input resource estimates | `src/workflows/reference-consensus/disk-estimate.ts` |
| Numbered workflow pair projection | `workflows/reference-consensus/scripts/read_sets.py`; Snakefile |
| Full file validation and read-group provenance | `workflows/reference-consensus/scripts/validate_read_pair.py`; corresponding rule |
| Actual preprocessing or explicit skip | `workflows/reference-consensus/scripts/preprocess_reads.py`; `rules/align_reads.smk` |
| Metrics, provenance, methods wording, and results | `scripts/summarize_isolate.py`, `citation/methods.txt`, workflow README/results page |

## Review fixes

- [x] Keep focused form fields, the save action, and bounded validation previews visible across terminal resizing.
- [x] Mark incompatible sets early and show the highlighted set's reasons below the list; size the list around those details.
- [x] Add short/narrow-terminal tests for large forms, validation failures, long read-set identities, visible reasons, and selection restrictions.

- [x] Prefill editable, unused library suggestions while preserving manual/saved identities; group Illumina helpers under `src/isolates/illumina/`.

- [x] Group editing fields into isolate/read-set sections with persistent context; shorten chooser rows without losing selection identity or name disambiguation.

- [x] Keep isolate-list summaries compact: omit successful read-check status and false/unknown wild-type badges, retaining read problems and parent lineage.

- [x] Add packaged isolate-management help to the general index and list/edit `?` shortcuts, preserving drafts and text input; test loading failure, return navigation, and disabled background actions.

- [x] Group the isolate list by recorded technique with isolate counts and persistent headings; preserve scrolling and edit/remove navigation without duplicating isolates for multiple sets.

- [x] Bracket edit-form action buttons, pad read-set actions, and show technique once in isolate details; include the extra rows in viewport budgeting and test pair removal/navigation.

- [x] Group file pairs inside read-set sections with local mate/processing labels and persistent pair context; budget nested headings for short terminals.

- [x] Give each supported technique its own help file (`docs/illumina.md` currently), beside general isolate help in separate tabs; explain chemistry options and rationale, keep shared identity/library guidance general, and omit unsupported-technique placeholders. Test tab switching without changing the edit draft.

- [x] Replace ambiguous `other` chemistry with four-colour and one-channel; gate Auto for one-channel/unknown when trimming is needed, preserve explicit choices and provider skips, and reject the old value without migration. Illumina help explains each detection scheme, common instruments, lab choices, and the poly-G rationale.

- [x] Use a warning alert for empty isolate lists and place the chemistry/poly-G reminder after proposed import rows, not in the folder chooser; account for alert height in review pagination.

- [x] Default new Illumina sets to two-colour and Poly-G Auto (On), with two-colour first in the chemistry choices; replace the import reminder with info pointing to isolate details. Preserve saved settings, document the editable assumption, and test defaults and alert placement.

- [x] Share `Section` with accession editing and other headed views: bold single-line title, borderless by default, optional rounded border, existing row/field/nested-section children, and automatic two-space indentation per nested section. Remove border overhead from isolate viewport budgeting and verify focus/navigation across resizing. The API and reuse rules live in `AGENTS.md`. Render isolate details, read sets, and nested pairs explicitly in JSX; retain the flat row order only for focus and viewport calculations.

- [x] Reject non-string Illumina metadata without coercion; keep accession editing within terminal height while paging metadata and cache details; synchronize the snapshot package's citation version.

## Verification record

Verification passed. Opt-in Conda integration was skipped; browser tests remain paused.
