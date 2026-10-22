# Sequencing technology and read sets

## Status

Implemented. This is a breaking contract replacement: schema versions stay at `1`, with no catalog migration or legacy-run compatibility.

## Goal and boundary

Keep isolate identity independent of sequencing inputs. Platform and layout belong to read sets, not isolates. Only paired-end Illumina data is currently stored and executed; recording or executing other technologies needs a deliberate extension, not another isolate for the same biological sample.

The reference-consensus workflow selects compatible sets explicitly. Similar read layout alone never establishes compatibility with another platform. Backbone assemblies remain independent of sequencing technology.

## Catalog contract

- Isolates retain identity, display metadata, and lineage and contain non-empty `read_sets`, not isolate-level `read_pairs`.
- Each read set has a stable `id`, editable `name`, `platform`, `layout`, confirmed `library_id`, technology metadata, and non-empty `read_pairs`. The repository README contains the YAML example.
- IDs use lowercase letters, digits, and single hyphens, starting with a letter. Read-set IDs are unique within an isolate and remain independent of names and file paths. Forms/import generate them; editing does not rename them.
- A read set represents one library, platform, and layout. It can contain multiple file groups across lanes/chunks; each currently holds one R1/R2 pair. Lane-merged files are supported without invented lane metadata.
- Separate deliveries can become separate sets with the same library ID. User confirmation on saving, not filenames or headers, establishes library identity. New sets receive editable isolate-based suggestions that avoid existing library IDs; top-ups share an existing ID only by explicit choice. Saved values and manual edits are preserved. IDs permit letters, digits, dot, underscore, plus, and hyphen for safe read-group values.
- Each group records absolute plain/gzip FASTQ paths and `trimmed`: `true`, `false`, or `null` for unknown prior processing. Duplicate file paths are rejected across the catalog; filesystem checks also detect linked files.
- Illumina metadata records reviewed `chemistry` (`four-colour`, `two-colour`, `one-channel`, `unknown`) and `poly_g` (`auto`, `on`, `off`). Unknown metadata can be stored without implying execution compatibility.

This concept owns read contracts. [Saved sequences](../../saved-isolate-sequences/concept.md) extends the catalog without renaming read fields. [Read submission](../../insdc-submission/concept.md#isolate-reads) consumes selected read sets and owns node-specific mappings, not another sequencing schema.

## Selection and immutable evidence

- The chooser shows every read set, marks incompatible ones without relying on color, and displays the highlighted set's reasons separately from truncated identity rows. Unsupported platform/layout, missing library identity, unreviewed processing, or unresolved chemistry prevent selection/execution; valid-but-incompatible metadata is distinct from malformed catalog data.
- Chooser labels omit read-set UUIDs and lineage and suppress repeated isolate/read-set names. Short set numbers distinguish equally named sets; human-readable isolate IDs disambiguate names across isolates only when needed. Selection and search still use stable IDs.
- Editing groups isolate details and each read set in distinct bordered sections, with short local field labels and a persistent current-section heading while scrolling. Technique appears once as read-only isolate details, not in action labels. Each file pair forms a nested section containing its mates, processing state, and remove action, with pair context retained while scrolling. Action buttons use brackets and vertical padding within read sets; padding and pair borders compress on short viewports to preserve focus. Editing and selection use terminal-height-aware windows. Editing follows field focus across resizing, preserves the selectable save action, and bounds validation previews so long forms/errors cannot push controls off-screen.
- Configuration records explicit `selected_read_sets` as `isolate-id/read-set-id` keys. `selected_isolates` is derived from those sets, in first-isolate order; sets are grouped by isolate in the snapshot.
- `isolates.yaml` copies only selected sets, their files, metadata, library identity, and `effective_preprocessing`. Catalog edits never alter saved evidence.
- Effective settings include resolved poly-G and its `chemistry`/`explicit` source, fixed minimum lengths, adapter detection, and disabled read-quality filtering. Application validation checks agreement with source metadata and the configuration's selection before saving or loading results.
- The workflow projects selected groups into numbered pair jobs; this is data projection, not a second scheduler. Checksums and effective read-group metadata are recorded against those groups in immutable workflow provenance.

## Illumina preprocessing

- Resolve poly-G per read set: Auto enables it for confirmed two-colour chemistry and disables it for confirmed four-colour chemistry. One-channel has no validated Auto default; it and unknown chemistry require an explicit On/Off choice when trimming will run; do not infer chemistry from platform or filenames.
- Keep the existing Illumina baseline: poly-G minimum 10 bases when enabled, retained length 30 bp, paired adapter detection, and no read-quality filtering. Only poly-G is configurable; these are not defaults for other technologies. Caller base-quality filtering remains separate.
- Off explicitly disables fastp's automatic poly-G detection.
- Known provider-trimmed groups bypass fastp and link original inputs unchanged. Their reports identify the skip and imported origin, with no invented fastp measurements. Unknown processing state requires review before execution.
- Snapshots preserve source state and effective settings. Provenance distinguishes generated preprocessing from skipped processing of imported inputs. A skipped setting is not claimed to have been applied.
- Changing trimming cannot resolve intrinsically non-unique mapping in repeats; fewer consensus Ns alone does not establish better defaults. Scientific rationale and tool references belong in the workflow README.

## Discovery, metadata, and validation

- Illumina delivery discovery is an import convenience, not the definition of isolate identity or eligibility. Proposals are reviewed before saving; copies are chosen per lane/chunk group. Review displays a warning after the proposed-isolate rows to choose chemistry or explicit poly-G before executing untrimmed inputs; the folder chooser does not display it.
- Each imported sample becomes a new read set containing its selected groups. Confirm that they share one library; otherwise import separately. Review the prefilled library suggestion, including when extending an existing isolate. Changing an import target refreshes unedited suggestions against that target's libraries; manual edits remain intact.
- Archive-renamed Illumina reads can be added manually with explicit library identity. Original Illumina headers are optional, not proof of platform or library identity.
- Read groups use a generated unique `ID`, snapshot isolate `SM`, explicit library `LB`, and selected-platform `PL`. Optional `PU` uses validated header flowcell, a single lane when known, and a consistent barcode. Never fabricate unknown optional fields.
- Reports record generated, explicit, header-derived, and unavailable metadata sources. Variable index comments leave barcode unknown instead of selecting the first as fact; instrument/run/flowcell conflicts and mixed original/archive formats fail validation.
- The application validates configuration/compatibility. Rules validate every FASTQ record, sequence/quality lengths, qualities, mate names/counts, and file evidence, including provider-trimmed inputs. Failed partial checksums are marked incomplete; diagnostics remain in logs when Snakemake removes failed outputs.

## Separation of concerns

- General code owns isolate/read-set identity, file grouping, storage, selection mechanics, snapshots, and provenance.
- Technology modules own discovery, metadata validation/interpretation, header parsing, and preprocessing defaults. TypeScript Illumina helpers live together under `src/isolates/illumina/`; library-ID suggestions remain in general catalog code. General code does not interpret Illumina headers or choose chemistry settings.
- Workflows declare compatibility and own pinned rules, environments, and file/evidence validation. Catalog support alone never enables execution.
- Use small, explicit modules needed today; no speculative plugin registry or general platform execution framework. The repository README gives a hypothetical technology-extension example, clearly marked as unsupported.

## Isolate-list grouping

The isolate manager groups entries by the techniques recorded on their read sets, with populated headings and isolate counts. Each isolate appears once regardless of its number of sets. Selection and navigation follow the displayed isolate order, skipping headings; headings remain visible when their rows are windowed. No unsupported-technique placeholders are shown. Empty catalogs use the shared warning-alert presentation with add/import instructions.

## Management help

The isolate list and edit form open general `docs/isolates.md` and separate technique help tabs with `?`. Each supported technique has one `docs/<technique>.md` file; currently `docs/illumina.md` explains pairs, chemistry choices, common instruments, poly-G rationale, and processing metadata. General identity, library identity, editing, and saving remain in isolate help. `isolateDocumentNames` owns the tab order; unsupported techniques have no placeholder files. It is also included in general Help and the Markdown documentation index. Help preserves list selection, draft values, and field focus; `?` remains text input in text/path fields. Saving and list actions are inactive while help is open. Esc or `?` closes help without leaving the owning screen.

## Breaking boundary

Old catalog/run structures are rejected even though schema versions remain at `1`. The ambiguous chemistry value `other` is rejected rather than silently mapped to four-colour. Users discard and re-import old catalogs and create new runs. Do not infer missing legacy metadata, automatically delete catalogs, rewrite saved evidence, or manipulate timestamps. Legacy viewing, resume, and new iterations are not supported.

## Out of scope

Other platforms/layouts, hybrid calling, additional technology-specific tuning/benchmarking, migration, legacy-run compatibility, and a generic platform framework. Another technology needs validated preprocessing, alignment, calling, and quality behavior; it may reuse existing workflow steps where scientifically appropriate.

## Delivery record

See the [tasks](tasks.md).
