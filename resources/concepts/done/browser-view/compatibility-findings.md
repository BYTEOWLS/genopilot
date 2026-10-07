# IGV compatibility findings

Development-time verification for the [genome view](genome.md), using the exact `igv` dependency pinned in `package.json`. The original spike observations are distinct from the later development integration described below; they do not verify every subsequent UI change.

## Scope and method

A throwaway read-only localhost harness, kept only under `/tmp`, serves explicitly supplied files by registered ID, with a random URL token, Host/Origin checks, the existing browser CSP, and single HTTP byte ranges. It loads IGV's published ES module unchanged. No workflow, cache, or input files are written or converted.

Headless Chromium loaded one existing reference-consensus run's backbone, one isolate's alignment and variants, and its consensus mask; a second view loaded a verified accession cache copy with annotation. Synthetic wrapped FASTA sequences tested index offsets across line boundaries with LF and CRLF endings, including a shorter final sequence line. Browser requests, CSP violations, page errors, feature retrieval, sequence retrieval, and SVG generation were observed. A simulated local 404 tested missing-annotation behavior. Private paths, identifiers, and biological results are deliberately omitted.

## Observed compatibility

| Resource | Observation |
|---|---|
| Plain reference FASTA with existing `.fai` | Sequence retrieval succeeded over byte ranges. |
| BAM with the workflow's `.bam.bai` | Alignment retrieval succeeded, including reads around an existing variant. |
| bgzip VCF with the workflow's `.vcf.gz.csi` | Header and feature retrieval succeeded; a window around an existing variant returned that variant. No TBI conversion is needed. |
| Existing consensus mask BED | Loaded unindexed; a window overlapping a mask returned a feature. |
| Cached plain FASTA without `.fai` | Loaded using an in-memory generated index; cache files remained unchanged. |
| Cached unindexed GFF3 | Loaded with explicit `format: 'gff3'` and `indexed: false`; features were retrieved. |
| Synthetic wrapped FASTA, LF and CRLF | Both returned the exact expected sequence across line boundaries through generated indexes. |
| SVG export | `browser.toSVG()` returned SVG for both scientific views and the synthetic references. |

The workflow view issued multiple range reads; the accession view range-read its sequence while loading the unindexed annotation whole. On this machine, single-isolate opening and feature/SVG checks completed in less than a second. This is not a cohort performance benchmark or a budget guarantee.

## Offline configuration and CSP

**Set `loadDefaultGenomes: false`.** Without it, IGV attempts requests to its remote genome catalog and backup. With this option disabled, the latest evaluated release made zero external requests and produced no CSP violations or page errors in the four successful-load views.

**Keep the latest evaluated release pinned.** After a simulated local 404, that release attempted a remote URL-mapping-table request. CSP blocked it and the missing annotation surfaced a local error. No public configuration switch for this fallback was found in the inspected API. An earlier release was also tested and did not make that attempt, but retaining the latest release is the chosen policy; no downgrade or patch is applied.

CLI opening checks should verify files exist and are readable before creating a view. Files can still become unavailable during later region loads. Production integration must retain a visible local error for that case. Distinguish zero external requests on successful local loads from CSP-blocked attempts on failure: the latter remains a known limitation to resolve before claiming that every error path makes zero external request attempts.

The existing browser CSP sufficed for file loading, inline IGV styling, canvas drawing, and obtaining SVG as a string. No worker or external-origin allowance was needed. Additional failure paths must still be checked during production integration rather than assuming one missing-file test covers every error; do not permit external origins to accommodate the mapping fallback.

Downloads were not exercised. IGV's PNG export uses a `blob:` image URL, so that future feature needs a narrowly scoped `img-src blob:` allowance and its own verification. Do not broaden CSP for exports before they are implemented.

## Relevant IGV options

| Requirement | API or setting |
|---|---|
| Local reference | `reference: {id, name, fastaURL, indexURL}`; URLs point to registered resources. |
| Explicit track types | `type` and `format`, with `url`, `indexURL` for indexed tracks, and `indexed: false` for whole-file tracks. Opaque resource IDs need no meaningful extension. |
| Reads grouped by allele | Alignment `groupBy: 'base:<chrom>:<position>'`, with a 1-based position. Source inspection confirms the conversion to an internal zero-based position; the harness applies grouping at the displayed window's midpoint. |
| Reads colored by strand | Alignment `colorBy: 'strand'`. |
| Compact variants | Variant `displayMode: 'COLLAPSED'`. |
| Low mapping quality | Source inspection shows reads with mapping quality zero are faded automatically. Do not document this as a general graded mapping-quality scale. A mapping-quality review preset still needs a deliberate choice and testing. |
| Hide inapplicable chrome | `showControls: false`, `showNavigation: false`, `showIdeogram: false`; `showTrackLabels: true` retains track labels. Production needs its own useful locus/zoom controls if navigation remains hidden. |
| SVG | `browser.toSVG()` returns a string, suitable for adding the later provenance footer before downloading. |

Track grouping and strand coloring were configured during successful rendering. Visual readability, dynamic preset changes, track ordering, and compact layouts still require production UI checks; source/API confirmation is not a substitute for those checks.

## Bundling check

A throwaway esbuild check imported `igv` normally with `mainFields: ['module', 'browser', 'main']`. The metafile showed that only IGV's published ESM entry was used, producing approximately 1.52 MB minified (about 444 KB gzip). The published minified module is approximately 1.50 MB; copying it separately is therefore not needed to avoid the full roughly 19 MB npm distribution.

The default browser resolver selected IGV's non-ESM `browser` entry and failed to find a default export. Prefer its `module` entry during release bundling. Keep the full latest evaluated package installed for development; the release build and transitive license collection belong to [Bundled package](../bundled-package.md).

## Verification boundary

The temporary harness and browser automation are not retained in the repository or package. Artifact paths were supplied explicitly rather than embedded in shared code. Permanent tests for the production integration must use synthetic fixtures.

The harness's simple whole-file index scan is not production indexing: streaming, layout validation, invalidation, range failure coverage, lifecycle cleanup, track compatibility, and representative-cohort measurements remain acceptance criteria in [genome.md](genome.md#resource-correctness-and-lifecycle).

## Development integration verified

The read-only genome kind and accession catalog entry point are implemented using existing files, without new workflow outputs or artifact conversions. Synthetic tests (now temporarily parked outside the active test tree) covered checksum refusal, FASTA index offsets and invalidation, range validation, stale resource IDs, changed/missing files, annotation mismatches, interrupted view preparation, track toggling, reference/track failures, late reference completion, local region validation, resizing, and shortcut suppression in forms and inactive tabs.

Headless Chromium also exercised the actual application page with a synthetic reference and a verified annotated cache copy. Both loaded without external requests or page errors. Region navigation, zoom, hiding/showing annotation, and replacement with a document worked; reopening the same unchanged genome retained the IGV DOM instance. A reduced laptop-width viewport did not overflow. At the time of that check, dark-theme switching kept the scientific canvas light; the renderer has since gained theme-aware canvas paints.

The genome area now uses the available width and a tall viewport, with annotation heights fitted to that area. [Browser events](https://igv.org/doc/igvjs/Events/) documents `trackclick` and returning `false` to suppress the default popup; the application uses this to show recorded name/value pairs as escaped text in an inline details panel. Track-label clicks use the same application panel, native hover titles are suppressed, and local shadow-root styles theme labels/borders. The later canvas adapter themes annotation and protein fills and nucleotide brightness while preserving recognizable nucleotide hues. The small track-height and label-element adapter was checked against the pinned implementation because those members are absent from the published TypeScript declarations. The browser automation remains only under `/tmp`; private identifiers, paths, and content are not recorded here.

Single-sequence wheel and button zoom use the pinned reference frame's native `zoomWithScaleFactor` rather than `search`, which recreates viewports. Unlike IGV's browser-level zoom wrapper, the reference-frame method awaits its redraw. Region changes, zoom, and the native bound resize handler share a promise queue and surface failures. IGV's `visibilityChange` and `layoutChange` wrappers detach resize/redraw promises, so they are not used. The application removes IGV's fire-and-forget window resize listener and routes its resize observer through the queued handler instead. Whole-reference mode uses an explicit chromosome order from the FASTA index, retaining short contigs, and IGV's ruler draws the chromosome track. File identities captured during checksum verification are retained through preparation and checked again before publication. The latest fixes also abort checksum streams during CLI cleanup and compare supplied FASTA index rows with a generated, cached index of the actual reference. These latest changes are source-reviewed and pass the active CLI tests, typecheck, build, and packaging checks; browser-specific tests remain paused, with no new real-browser integration check.

## Read-color explanations (pending visual review)

The pinned `trackclick` implementation passes `[track, dataList, genomicLocation, features]`, but populates `features` only for annotation tracks. The initial read-color handler incorrectly assumed this also supplied aligned reads, and visual review found the details absent. The adapter now captures the native alignment `clickedFeatures` result when `popupData` runs, binding it to the returned popup payload in a WeakMap so overlapping asynchronous clicks cannot exchange read identities. It uses the clicked alignment's native `getGroupValue` and the track's `getAlignmentColor`, active mode, expected orientation, and template-length thresholds. It explains the existing coloring decision, not a new biological classification, and leaves ordinary popup attributes visible as text. A bordered color chip uses IGV's original read color. Visual review found dark-theme gray read bars too dark, so literal remapping of read, coverage, and connector grays was removed; unexpected-pair category RGB values and alpha remain unchanged in both themes; coverage clicks do not receive a read-color verdict. Click details omit track-wide coloring mode, expected orientation, and threshold-range rows; a template-length threshold is included only when it explains the clicked read's short/long-fragment color. This correction is pending visual review; browser-specific tests remain parked.

The general genome help contains the paired-read legend and links to [IGV Desktop's paired-end alignment guide](https://igv.org/doc/desktop/#UserGuide/tracks/alignments/paired_end_alignments/). Online documentation describes coloring modes and sampled template-length thresholds, but some defaults differ from the pinned implementation; actual click details therefore report native state rather than copied documentation defaults. As before, literal-color theme adaptation is not a guarantee for every possible custom palette or future mode.

## Parked tests

Browser tests are temporarily parked in the Git-ignored `.parked-tests/browser/` folder while the UI changes rapidly. The archive includes `tests/browser/`, accession-view tests, and the original mixed CLI/browser UI test files. Its README explains restoration; merge only browser cases from the mixed files so later CLI changes are not overwritten. The remaining CLI tests stay active. The archive is excluded from test discovery, CI, and packaged artifacts, and is not backed up by Git. Restore and update this coverage after the UI settles, before considering browser integration verified again.

IGV is bundled from its ESM entry and served locally, with its license collected, as the [bundled package](../bundled-package.md) describes; installations lacking IGV visibly mark the genome shortcut unavailable. The blocked failure-time remote mapping attempt remains a library limitation. Run-result evidence and Sites locus navigation/presets are implemented. Decisions, exports, and representative-cohort budgets remain subsequent work.

### Sites preview awaiting visual review

Sites opens the selected filtered locus against a checksum-verified backbone, with existing isolate evidence, recorded vote cards, and in-memory annotation markers. Per-locus ordering shows voters by allele, then voting isolates without a vote, then other isolates hidden. Read/vote/strand/region presets intentionally reapply locus track choices and zoom; reads group by the first base of the locus, not a reconstructed multi-base allele. A matching accession-cache annotation requires the exact backbone FASTA checksum and a verified annotation checksum. Browser item selection goes through the existing validated request and updates the CLI; CLI selection updates retain the viewer. Changing the Sites filter or leaving the tab detaches that review until reopened. Browser-specific tests and real-browser automation remain paused; the new UI is not visually verified.
