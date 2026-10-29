# JBrowse genome workspace

## Goal

Replace IGV.js with `@jbrowse/react-linear-genome-view2` as GenoPilot's embedded linear genome viewer. Prefer supported TypeScript, React, and plugin interfaces over patches to viewer internals. Explore Apollo annotation editing and a circular overview without making either a prerequisite for the read-only migration.

This is planned work, not an implemented capability or a release commitment. The [completed browser design](../completed/browser-view/concept.md) describes the current implementation; this concept owns its viewer replacement. General browser follow-ups remain in their [own concept](../browser-view-follow-up/concept.md).

## Ownership and curation

- [Annotation review](../completed/annotation-review/concept.md) owns protein ratings, review reasons, evidence tracks, and the review list.
- [Annotation review decision](../annotation-review-decision/concept.md) owns verdicts, candidate selection, decision history, and reviewed GFF3 production. Its initial CLI-owned decision remains independently deliverable.
- This concept owns the renderer migration, embedded-plugin compatibility investigation, circular-view feasibility, and Apollo editing exploration. It does not create another verdict or annotation-output contract.
- [Browser follow-up](../browser-view-follow-up/nice-to-have.md) owns shared browser-to-CLI decision drafting. Apollo acceptance must use that boundary rather than introduce a separate save path.

For annotation transfer, editing could close the gap between a flagged gene and a corrected structure. For reference consensus, this applies to annotation transferred onto the resulting consensus in a subsequent transfer run. Annotation edits neither resolve uncertain bases nor change the nucleotide consensus. Reads aligned to the backbone cannot be displayed as consensus-coordinate evidence without an explicit mapping.

## Read-only migration contract

Keep the workflow-neutral `src/browser/contract.ts`, view builders, local server, and CLI-led selection as the integration boundary. Translate the existing view into JBrowse configuration inside the genome renderer; do not expose JBrowse models or plugin code through workflow manifests or saved decisions.

Preserve:

- accession, reference, target, Sites, and Proteins views; item navigation, markers, details, presets, and retained track choices;
- FASTA, GFF3, BED, BAM/index, and VCF/index evidence, including missing-file and large-file states;
- opaque file URLs, Range serving, checksum verification, provenance labels, and disconnected/read-only behavior;
- nucleotide and read-quality cues, strand/orientation, CDS phase and translation explanations, recorded feature attributes, and useful alignment details;
- responsive layout, keyboard access, light/dark themes, and a clear boundary between GenoPilot controls and viewer controls.

Parity means equivalent scientific information and usable interactions, not reproducing every IGV control or its colors. Record intentional differences and limitations before removing IGV. Verify coordinate conversions explicitly: GFF3, browser intervals, strand, indels, and contig boundaries must not shift silently. Do not add a permanent dual-viewer abstraction.

Bundle all code, fonts, workers, and plugin assets locally; no CDN, remote plugin loader, telemetry, or external data request. Preserve the loopback/token/Origin/Host boundary and same-origin CSP. Determine the minimum worker/style CSP requirements rather than broadly relaxing it. Load genome assets only when needed, and release workers, subscriptions, and models on view replacement or shutdown.

Measure bundle size, startup, memory, and navigation on small synthetic fixtures and a representative larger local genome. Do not commit private evaluation data.

## Embedded plugins and Apollo investigation

Confirm against a pinned published release that `@jbrowse/react-linear-genome-view2` accepts locally bundled plugins. Prove a minimal plugin first, then check Apollo's actual requirements; plugin support in JBrowse Web does not prove compatibility with the embedded product.

Evaluate Apollo's supported editing operations, undo/history, draft persistence, reload recovery, export, and gene/transcript identifier handling. Determine which application/session APIs it expects, and whether a backend, database, authentication, or collaboration server is required. Do not assume a client plugin alone provides a local editor. Any service provisioning or new write endpoint needs a separately approved design and explicit consent; never start it as a side effect of opening a view.

The experiment must demonstrate opening a flagged gene with evidence, changing a structure, reopening the draft, and exporting a valid replacement GFF3. Record compatible packages, licensing, deployment requirements, unsupported operations, and a go/no-go decision. If embedding is unsuitable, retain external specialist editing and the [corrected-model import](../../later.md#corrected-gene-model-import) route; the viewer migration can still ship.

### Acceptance boundary for future editing

Apollo structures are drafts, not accepted annotations. The CLI validates and explicitly saves a review decision; Snakemake produces and validates the reviewed GFF3 and downstream protein assessments. Original LiftOn outputs and diagnostic candidates remain unchanged.

Reuse the [curation provenance requirements](../../later.md#manual-annotation-review-and-correction): assembly and source-GFF3 checksums, affected IDs, before/after structures, reviewer, time, rationale, and supporting evidence. Show the difference before acceptance. Bind each draft to the exact assembly and source annotation; reject a stale draft after a consensus iteration or changed source rather than silently reapplying coordinates.

An externally supplied or Apollo-exported replacement GFF3 enters GenoPilot as `imported`, with checksum and origin; the reviewed annotation produced by a rule is `generated`. Never call an edited model `cached`.

Before implementation, extend the annotation review decision design for replacement artifacts, structural validation, split/merge identity mappings, and incomplete drafts. Define a versioned migration for persisted data only when the required schema is known. Do not broaden editing to arbitrary genes or functional annotation implicitly.

## Circular overview investigation

Evaluate `@jbrowse/react-circular-genome-view2` and the circular-view plugin against the same release family. Establish whether the linear component can host that view or whether a separate embedded component is necessary. A plugin cannot be assumed to add a view the host product does not support.

Prove the researcher-facing use case: show genome/contig context with annotation features and review markers, select a locus, and return to its linear detail. Verify annotation support specifically; variant chords or synteny links alone do not meet this need. Display unsupported tracks honestly rather than implying alignment or editing parity.

Switching views must retain the selected item, linear region, and track choices. A circular layout never asserts biological circularity. Use the existing shared tab/section patterns, with the interaction settled during the prototype. Keep the linear viewer fully usable if circular annotation display is unsuitable; record that result rather than shipping a misleading overview.

## Compatibility and delivery boundaries

Select compatible published packages and pin exact versions in package metadata, not this document. Repository `main` may contain unreleased interfaces. Apollo compatibility and circular annotations remain unverified until the prototypes succeed.

The saved configuration currently records `genopilot.igv`, and build metadata, citation templates, packaging checks, and license notices refer to IGV. Before implementation, choose the smallest explicit schema revision for recording the new viewer and its effective version. Keep historical runs readable and their recorded IGV citation intact; do not relabel old runs or require rewriting their configurations. Specify how older configurations are loaded or reused and which application versions may reject the new schema. Keep workflow methods separate from the viewer actually used for a later inspection.

Deliver the read-only replacement first, then independently gated circular and editing work. No editing writes, new services, or browser verdict actions are authorized by the viewer swap. Browser-specific tests remain parked until the user explicitly resumes them; use manual prototype checks and the allowed non-browser verification, and report those limits honestly.

## Sources and work

- [JBrowse components](https://github.com/GMOD/jbrowse-components), including the linear and circular embedded products.
- [Published linear component](https://www.npmjs.com/package/@jbrowse/react-linear-genome-view2); the older unsuffixed package is deprecated.
- [Apollo](https://github.com/GMOD/Apollo3): client plugin and separate server-side packages.
- [Ordered tasks](tasks.md).
