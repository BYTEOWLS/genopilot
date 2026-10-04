# Genome canvas styling

The pinned IGV renderer has no complete theme API. GenoPilot keeps its dark/light canvas adapter local to each track: no inversion filter, global canvas patch, or IGV fork. The dependency pin is in [`package.json`](../../../../package.json).

## Responsibilities

- [`genome-theme.ts`](../../../../src/browser/page/genome-theme.ts) owns the palette, wrappers, theme changes, and track cleanup. Each track has one drawing wrapper; repainting reads the current palette. Removing a track restores its native methods and releases adapter state.
- [`genome-palette.ts`](../../../../src/browser/page/genome-palette.ts) resolves CSS colors, supplies role-aware paint rules, and classifies deliberate evidence-color preservation. The settings chooser reuses its strand defaults.
- [`genome-canvas.ts`](../../../../src/browser/page/genome-canvas.ts) has named sequence, annotation, and alignment glyph handlers. It adapts paint at drawing operations rather than guessing the role of every assigned RGB value. Canvas gradients and patterns are preserved unless they are used for a known UI role.
- [`genome-geometry.ts`](../../../../src/browser/page/genome-geometry.ts) changes font size, native row heights, and glyph baselines. It never changes x coordinates, base positions, packing, or the source data. Its named constants record the renderer's fixed DNA baseline, translation bars, and mismatch baseline.
- [`genome-color-diagnostics.ts`](../../../../src/browser/page/genome-color-diagnostics.ts) reports unclassified paints only with explicit consent in the open viewer.

## Fallback policy

Use native track color/layout properties and CSS first. Canvas interception handles literal renderer paints and glyphs that native properties cannot theme.

A drawing method alone does not establish biological meaning: text can be a base or an amino acid, and a rectangle can be an evidence mark rather than a background. Supported track-specific glyph handlers identify those roles before applying the ordinary-label fallback. Full-size white rectangles in the supported ruler, annotation, alignment, and variant renderers are known backgrounds.

| Known role | Fallback |
|---|---|
| Ordinary labels and neutral UI linework in supported renderers | Theme foreground |
| Canvas backgrounds and white annotation gap linework | Theme background |
| Default annotation decorations | Theme track color |
| Nucleotide glyphs | Hue-preserving brightness adjustment, retaining alpha; unresolved gray sequence glyphs use the foreground |
| Known read, coverage, pairing, genotype, allele, and other evidence colors | Native paint and opacity |
| Unknown evidence fills, strokes, gradients, patterns, or unsupported track types | Native paint; report for investigation when diagnostics are enabled |

Annotation codon fills are identified by the pinned renderer's call scope, not their hue: `renderFeature` saves once for a feature, and `renderAminoAcidSequence` adds the second save before its direct rectangle fills below the native translation threshold. Feature-body fills remain outside that codon scope. This lets custom strand colors equal a native codon or marker literal without bypassing codon shading or recoloring the feature body. Recheck that save depth and threshold during an IGV upgrade; the named assumptions are in `nativeGeometry`.

Do not infer a biological category from RGB alone. In particular, `rgb(0,0,150)` is an annotation default, a variant default, and a short-template-length cue in different renderers. The rules below are scoped by track and role. Equivalent hex/RGB/rgba representations are normalized; opacity remains part of the color identity.

## Documented paint rules

This is an initial inventory, not a promise that every file format and coloring mode has been classified. The source references name symbols in the installed IGV ESM renderer rather than duplicating a dependency version. Native track properties take precedence for known evidence paints, including user/configuration overrides.

| Track and renderer role | Native paint or property | Policy |
|---|---|---|
| Supported track backgrounds | Full-size white rectangle | Theme background |
| Supported neutral labels and linework | Black; `rgb(68,68,68)` | Theme foreground, except when recognized as a configured evidence color |
| Annotation feature strands | `color`, `altColor` | Theme blue/purple defaults; retain explicit user colors |
| Annotation default fill | `rgb(0,0,150)` | Theme track color |
| Annotation exon arrows and inter-feature gaps | White strokes | Theme background, matching the existing contrast treatment |
| Annotation codons, `renderAminoAcidSequence` | `rgb(124,124,204)`, `rgb(12,12,120)` | Lighter/darker shades of the current feature's strand color |
| Annotation codon text | White `fillText` | Black or white contrasting with the last painted codon fill |
| Annotation start/stop codons | `#83f902`, `#ff2101` | Theme-aware teal/rose marker fills |
| Sequence bases, `SequenceTrack.draw` | Native nucleotide palette; unresolved gray | Adjust nucleotide brightness; unresolved gray uses foreground |
| Sequence translation codons | `rgb(160,160,160)`, `rgb(224,224,224)` | Theme-aware alternating neutral fills |
| Sequence translation start/stop bars | `rgb(0,153,0)`, `rgb(255,0,0)` below the DNA row | Theme-aware teal/rose marker fills; marker labels use matching contrasting text |
| Alignment matching reads | `rgb(185,185,185)`; configured `color` | Preserve |
| Alignment coverage, `CoverageTrack.draw` | `rgb(150,150,150)`; configured coverage color | Preserve |
| Alignment nucleotide bars and coverage mismatches | Native nucleotide RGB with possible base-quality alpha | Preserve; only the glyph brightness is adapted |
| Alignment strand colors | `posStrandColor`, `negStrandColor`, including alpha | Preserve |
| Alignment base-modification colors | `baseModPosStrandColor`, `baseModNegStrandColor` | Preserve; other generated modification palettes remain discoverable |
| Alignment insertions/skipped regions | `insertionColor` = `rgb(138,94,161)`; `skippedColor` = `rgb(150,170,170)` | Preserve |
| Alignment deletion linework | Black | Theme foreground; operation and geometry still identify the deletion |
| Alignment short/long templates | `smallTLENColor` = `rgb(0,0,150)`; `largeTLENColor` = `rgb(200,0,0)` | Preserve |
| Alignment unexpected orientation | `rlColor` = `rgb(0,150,0)`; `rrColor` = `rgb(20,50,200)`; `llColor` = `rgb(0,150,150)` | Preserve |
| Alignment connectors/highlights | Configured `pairConnectorColor`, `highlightColor` | Preserve; generated mate-chromosome/tag palettes remain discoverable |
| Variant default, `VariantTrack.defaultColor` | `rgb(0,0,150)` | Preserve as evidence; not an annotation-default replacement |
| Variant genotype categories | `homrefColor` = `rgb(200,200,200)`; `homvarColor` = `rgb(17,248,254)`; `hetvarColor` = `rgb(34,12,253)` | Preserve |
| Variant absent/mixed genotype categories | `noGenotypeColor` = `rgb(200,180,180)`; `noCallColor` = `rgb(225,225,225)`; `nonRefColor` = `rgb(200,200,215)`; `mixedColor` = `rgb(200,220,200)` | Preserve |
| Variant allele-frequency bars | `refColor` = `rgb(0,0,220)`; `altColor` = `rgb(255,0,0)`; filtered counterparts with alpha | Preserve |
| Other format-specific or dynamically generated evidence paints | Not yet classified | Preserve and investigate; never recolor merely because a hue is unfamiliar |

Preservation does not guarantee sufficient contrast in every theme. If a known preserved category is unreadable, inspect its renderer and update that category deliberately, together with any researcher-facing legend. A generated palette may contain both known and unfamiliar hues; diagnostic classification of a hue is not proof of its meaning.

## Local color discovery

Enable **Collect unmapped canvas colors (browser console)** in the viewer's Settings. In the browser developer console, filter for `[GenoPilot canvas]`, then exercise the file format, zoom level, theme, and coloring mode that exposes the problem.

The diagnostic emits only a coarse track type, drawing operation, and numeric RGBA color. Unparsed colors and gradients/patterns get fixed category tokens, not raw source strings. It never inspects or logs filenames, accessions, feature IDs, labels, coordinates, or biological content. Nothing is uploaded or written to a run or source file. Entries are deduplicated by track type, operation, and color, with a limit of 256 entries per collection. Switching collection off/on clears deduplication state; closing the viewer releases it. Browser console entries themselves remain subject to the browser's normal console retention.

To classify an entry, search the installed IGV renderer for its equivalent RGB/hex value and trace the draw call or native property. Record the track and semantic role here, decide whether to theme or deliberately preserve it, and then update the narrow adapter rule. Do not add a global RGB substitution. Known preserved categories do not generate unmapped diagnostics; consult this table when an already classified color is unreadable.

## Visual verification

Browser tests remain parked until explicitly resumed. The following manual checks are still pending after this refactor:

- Check light and dark themes at the smallest/default/largest viewer text sizes.
- Check wrapped sequence letters, unresolved bases, three-frame translation, and start/stop markers.
- Check forward/reverse annotations, custom strand colors, codon text, and expanded/compact layouts in GFF3 and BED tracks. Include strand colors matching each native codon/marker literal: `#7c7ccc`, `#0c0c78`, `#83f902`, and `#ff2101`; feature bodies must retain the custom colors while codon shading and start/stop highlights keep their separate treatment.
- Check BAM coverage, mismatch-quality opacity, pairing/strand colors, indels, and both lane layouts.
- Check VCF variant and genotype categories without interpreting colors as confidence.
- Change loci and tracks repeatedly; change themes with the same tracks loaded, confirming unchanged positions and no stale wrappers.
- Opt into discovery, confirm repeated paints are deduplicated, and confirm only the documented metadata appears in the console.
