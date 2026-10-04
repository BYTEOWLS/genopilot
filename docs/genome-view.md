# Reading a genome view

A genome view shows a reference's chromosomes or contigs and the available annotation, alignments, variants, or masks in its coordinates. It is read-only: panning, zooming, and hiding a track do not change source files or saved settings.

## Moving around

Enter a region as `sequence:start-end` and press Go or Enter. Coordinates are 1-based and include both ends. Use the exact sequence name from the reference; for example, `contig1:100-200`. Choose a chromosome or contig from the selector. Its overview shows where the current region lies within that sequence. The plus and minus buttons zoom in and out; drag within the tracks to pan. Use the Wheel button to switch between Zoom and Vertical scroll; its label shows the active mode. In Zoom mode, scroll within a track to zoom around the mouse pointer, keeping the pointed position in place except at sequence boundaries. In Vertical scroll mode, the wheel moves through the viewer's tracks without zooming; explicit zoom buttons remain available. The details panel scrolls independently in either mode. The crosshair marks the pointer's position. Genome views cannot search public genomes or load files from a URL or your disk.

Choose All chromosomes / contigs, or enter `all`, to see the whole reference when it contains multiple sequences. The chromosome ruler track shows every sequence, including short contigs. Click a chromosome on that track, choose it from the selector, or scroll up over it in Zoom mode to enter its local coordinates. The plus and minus buttons become available in the single-sequence view.

Open Tracks beside Settings to see a scrollable list of evidence tracks. Use each track's switch to show or hide it; each row shows its file size, loading state, and any problem. The button flags unavailable tracks even while the list is closed. Unindexed annotation loads whole, so large files start hidden and can be enabled explicitly. A track with sequence names or coordinates that do not fit the reference is marked as incompatible instead of being silently hidden. Matching names do not prove that two files use the same coordinates; the source of the view must provide compatible files.

Click the `?` icon or press `?` to open the help menu. It offers the complete reading guide, individual sections from that guide, any review guide supplied by the current view, and Sources and provenance. Choose a topic to read it in a dialog; Escape, Close, or `?` closes the dialog. Review-specific topics appear only when that view provides them. The `p`/`n` navigation shortcuts are suspended while a dialog or menu is open. Help and track controls are above the viewer; nothing is placed underneath it. The genome viewer uses the available window width and a tall, resizable track area. Theme switching changes the viewer background, ruler, annotation tracks, labels, and details panel without resetting the region or reloading tracks. Nucleotide hues stay recognizable in both themes, with brightness adjusted for contrast; forward-strand annotations use blue and reverse-strand annotations use purple, with lighter shades in dark mode. Strand arrows and recorded strand attributes remain available without color. Annotation colors do not encode confidence.

## Sequence and annotation

Viewer text starts at 16 px. Open Settings and use A− and A+ beside Text to adjust track labels, feature labels, DNA letters, and bp coordinates between 12 and 24 px. Annotation spacing and aligned-read lane heights grow with the text; mismatch letters remain centered within their read lanes. These controls do not change genomic alignment positions, the region, reload source files, or save a setting. Zoom further in if larger DNA letters need more horizontal space.

Zoom in to see individual reference bases. The letters identify nucleotides even without color: A, C, G, and T are resolved bases; N is unresolved. Other letters may represent IUPAC ambiguity codes. DNA letters are filled rather than outlined, with faint colored backplates. Color is an aid, not a confidence score.

Lowercase `a`, `c`, `g`, and `t` usually indicate soft masking: the source assembly marks repeats or low-complexity sequence but retains the bases. A lowercase `a` still means adenine, like `A`; it is not inherently a variant or a low-confidence call. The exact meaning depends on the source assembly's masking method. Unlike lowercase resolved bases, `N` means the base is unresolved. Soft masking alone is not evidence that a region cannot be translated.

At close zoom, coding exons can show translated amino-acid letters on opaque codon backgrounds that alternate lighter and darker shades of the feature's own strand color. Reverse-strand codons follow the reverse-strand (alt) color, including custom display colors, rather than switching to blue. Text switches between black and white for contrast with each fill in either theme. Methionine/start markers use a teal-green highlight and stop codons (`*`) use a rose-red highlight, with soft fills in light mode and darker fills in dark mode. Three-frame `START` and `STOP` labels use contrasting text in both themes. These display cues do not establish a true translation start or a functional protein.

Annotation tracks show features such as genes, transcripts, and coding regions. Arrows indicate strand and boxes indicate annotated spans. In a transcript model, a thin connecting line represents an intron, a thick bar represents coding sequence (CDS), and a thinner bar represents an untranslated region (UTR). One exon can contain both coding and untranslated portions; an entirely untranslated exon is drawn as a thin bar. UTRs belong to the transcript but are not translated, so zooming in does not reveal amino acids over them.

Missing amino-acid letters inside a coding bar do not by themselves mean residues are missing from the protein. Translation display needs sufficiently close zoom, reference sequence, and usable CDS phase or reading-frame information. A codon split across an exon boundary, unresolved or ambiguous reference bases, incomplete annotation, or a viewer-rendering limitation can affect the display. Inspect the recorded CDS and sequence to distinguish these cases rather than inferring a biological deletion from a gap in letters.

Click a feature to see the attributes recorded in its annotation in GenoPilot's inline details panel, not an IGV dialog. Hovering does not open details. Click a track label for its track information, and use the × button to dismiss the panel. Drag the divider beside the panel to resize its width. On smaller windows, the panel sits above the genome rather than squeezing the tracks; drag its bottom divider to resize its height. Focus the divider and use arrow keys to resize, or Home/End for the minimum/maximum size. The size stays in this open view only. Long track titles wrap without hiding the close button. An annotation is evidence about a sequence, not proof that a gene is functional. A blank region may simply have no annotation.

## Reads, variants, and masks

An alignment track has a coverage histogram above stacked rows of reads aligned to the displayed reference. The rows pack overlapping reads into separate lanes; they are not unaligned reads or separate isolates. Gray read stretches generally match the reference, while colored bases or marks highlight mismatches. Different read start/end positions are expected because sequenced fragments cover different spans. Mismatching bases carry nucleotide colors; insertion and deletion marks indicate differences from the reference. Read letters are filled and centered, with theme-adjusted nucleotide brightness against IGV's original read-bar colors. Nucleotide hue identities remain recognizable. IGV's base-quality opacity is preserved, so low-quality mismatches can still appear faint; inspect the read attributes rather than treating faintness as a theme defect. Read depth is not a vote count or a confidence score. IGV fades reads with mapping quality zero; do not interpret this as a general graded mapping-quality scale. The displayed BAM may retain reads or marked duplicates excluded by the workflow's caller, so the browser's coverage need not equal the workflow's filtered depth.

A variant track shows the recorded VCF calls, including their filter fields. A displayed variant is not necessarily an accepted call; inspect its attributes and the workflow's result help. Masks show intervals and their recorded state. Missing or incompatible evidence remains visibly marked in the track chooser; other usable tracks stay available. BAM and compressed VCF require their existing indexes and load regions through local byte-range requests, while unindexed masks and annotations load whole.

### Paired reads: whole-read colors

Whole-read bar colors and individual mismatch-base colors have different meanings. The current alignment view uses IGV's unexpected-pair coloring for paired reads; unpaired reads use uniform coloring. Click a read to see a color swatch and why IGV assigned that color to this read. When a short or long template length explains the color, the explanation includes the read's absolute template length and the applicable IGV threshold. Track-wide settings are not repeated as if they were properties of the clicked read. The ordinary read details remain alongside the explanation. The swatch represents the whole-read color; mapping-quality-zero fading is reported separately.

For the default expected inward-facing orientation (`fr`), IGV uses:

| Whole-read color | Meaning |
|---|---|
| Gray | No pairing anomaly highlighted by this mode, or insufficient mate information. Not proof that the read is correct. |
| Green | Outward-facing pair (`RL`). |
| Blue | Both mates reverse-facing (`RR`). |
| Teal/cyan | Both mates forward-facing (`LL`). |
| Dark blue | Absolute template length below IGV's current lower threshold. |
| Red | Absolute template length above IGV's current upper threshold. |
| Chromosome-specific color | Mate maps to a different chromosome or contig; there is no universal single color for this case. |

Orientation coloring takes precedence over mate-chromosome and template-length coloring in unexpected-pair mode. Some hues are similar, so use the click explanation rather than identifying a condition from color alone. The template-length thresholds come from IGV's current viewer state, potentially sampled from loaded reads; they are not workflow calling thresholds. A pairing anomaly is a diagnostic cue, not proof of a structural variant, a misalignment, or a bad read. Other coloring modes have different meanings: strand coloring indicates read direction, not a pairing problem.

Individual mismatch bases use A green, C blue, G orange, and T red. GenoPilot fills the letters and adjusts their brightness for the theme, preserving base-quality opacity. IGV's original whole-read colors, including gray and the unexpected-pair category colors above, remain unchanged in both themes, as do the neutral coverage and connector colors. The color chip uses the same whole-read color. Colors are presentation: alignment coordinates, SAM flags, mate information, and the workflow's recorded results remain unchanged.

For further interpretation, see the researcher-facing [IGV Desktop guide to viewing alignments](https://igv.org/doc/desktop/#UserGuide/tracks/alignments/viewing_alignments_basics/) and [paired-end alignments](https://igv.org/doc/desktop/#UserGuide/tracks/alignments/paired_end_alignments/). These explain alignment and pairing displays rather than developer APIs. GenoPilot exposes its own controls; available settings and defaults can differ from IGV Desktop.

## Click details

The panel identifies the clicked read, coverage position, variant, or annotation, then shows coordinates and identity before the applicable evidence sections. Alignment and quality, pairing, the clicked base or variant, coverage, color explanation, and additional recorded attributes are separate. Track-label clicks show track information instead of read-specific evidence. Original field names remain alongside expanded names; values and unfamiliar tags remain as recorded, without guessed meanings. Only attributes supplied by IGV are available; a missing field is not evidence of absence. How to read click details opens this glossary.

| Field | How to read it |
|---|---|
| Clicked position | Reference sequence and 1-based position under the pointer; not necessarily the start of the read or feature. |
| MAPQ — Mapping quality | Confidence in the alignment location, not in a particular base. SAM uses a Phred-scaled score; 255 means unavailable, not exceptionally confident. |
| CIGAR — Alignment operations | Run lengths and alignment operations: M means aligned bases (matches or mismatches), = match, X mismatch, I insertion, D deletion, N skipped reference region, S soft clip, H hard clip, P padding. Not a variant verdict. |
| Base quality | Confidence in the clicked read base, usually Phred-scaled; distinct from MAPQ. An unknown value is not a zero score. |
| TLEN — Template length (Insert Size) | Signed template length in base pairs from the alignment. IGV uses its absolute value for short/long-fragment coloring; the sign is not a confidence measure. |
| Pair Orientation | Recorded mate directions/order. IGV read codes such as F1R2 distinguish forward/reverse and first/second mate. Expected library codes fr, rf, and ff describe forward/reverse, reverse/forward, and same-direction orientations. Relative coloring groups depend on that expectation: with fr expected, RL is outward-facing, RR both reverse-facing, and LL both forward-facing. Do not apply that interpretation unchanged to another library orientation. |
| Read depth (Total Count) | Reads counted by IGV at the clicked position, not votes or quality. A/C/G/T/N entries retain IGV's counts, percentages, and forward (+)/reverse (−) counts. These may differ from caller-filtered counts. |
| REF / ALT | Recorded reference and alternate alleles in the VCF. Display does not imply the alternate allele was accepted. |
| QUAL | Phred-scaled variant quality as recorded by the caller, not mapping or base quality; a missing value remains missing. |
| FILTER | Recorded VCF filters; PASS and a missing filter value have different meanings. Refer to the file's definitions and workflow result help. |
| Color explanation | IGV's current whole-read color and its recorded reason, including an applicable template-length threshold. A visual diagnostic cue, never proof of a biological outcome. |
| GFF feature type [Type] | The type in the GFF3 feature column, such as gene, mRNA, exon, or CDS. Each feature has its own attributes. |
| GenBank feature key [gbkey] | The source GenBank feature category, such as Gene or mRNA. It is distinct from the GFF3 feature type, not a confidence score or hierarchy level. |
| Parent feature ID [Parent] | The ID of a parent feature in GFF3; a transcript can belong to a gene, and an exon or CDS to a transcript. Multiple parents are possible. |
| Gene / transcript biotype | Recorded biological category, such as protein_coding; not proof of function. |
| Gene/protein product [product] | Recorded description of the gene or protein product. |
| Database cross-references [Dbxref] | Identifiers in external databases, as recorded in the annotation. |
| CDS phase [Phase] | For a CDS, 0, 1, or 2 bases to skip at its coding-direction start to reach the next complete codon. Not the genomic reading frame; a dot means not specified or not applicable. |
| Additional recorded attributes | Other supplied fields and tags, kept without guessing their meaning. Consult the source format and file header. |

Annotation details preserve IGV's separate feature blocks, with headings such as Gene, Transcript (mRNA), Exon, and Coding sequence (CDS). These describe different records, not multiple types of the same gene. Exon and CDS blocks appear when they overlap the clicked position. The numbered blocks follow IGV's supplied order; numbering does not establish parentage. Use recorded ID/Parent relationships when available, not order alone. IGV can omit ID and Parent from its click data, so this panel is not a complete GFF3 hierarchy or a complete list of a gene's children. Known attribute names are expanded while original keys remain visible; unfamiliar attributes stay with their feature.

See the [GFF3 specification](https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md), [NCBI GFF3 guidance](https://www.ncbi.nlm.nih.gov/datasets/docs/v2/reference-docs/file-formats/annotation-files/about-ncbi-gff3/), [SAM specification](https://samtools.github.io/hts-specs/SAMv1.pdf), [SAM optional tags](https://samtools.github.io/hts-specs/SAMtags.pdf), [VCF specification](https://samtools.github.io/hts-specs/VCFv4.5.pdf), and [IGV Desktop alignment guide](https://igv.org/doc/desktop/#UserGuide/tracks/alignments/viewing_alignments_basics/) for authoritative definitions. The paired-read color legend above explains the current view's diagnostic colors.

## Display settings

Use Settings above the viewer and choose the reference, an annotation track, or an alignment track. Text-size controls are in this panel and apply to the whole viewer; read lanes and annotation spacing scale automatically. These controls change presentation only: they never modify the reference, annotation, workflow configuration, or a saved decision. They remain in this browser view until it is replaced or reopened with changed sources.

The Show track labels switch applies globally, including to tracks loaded later or changed by a review preset. Hiding labels leaves track names and visibility controls in Tracks. Horizontal boundaries and contrasting gutters separate tracks in both themes, even when labels are hidden; these separators do not encode scientific meaning. This does not hide feature names within annotations or change the scientific evidence.

For the reference, choose a forward or reverse-complement sequence display and optionally show three-frame translation. The reverse-complement control affects sequence display, not genomic coordinates or the recorded strand of annotation features. Three-frame translation shows possible translations of the displayed DNA at close zoom; it does not predict a gene, splice out introns, or establish a functional protein. Reset reference display restores the forward sequence without three-frame translation.

For an annotation track, choose forward/reverse strand colors and an expanded, compact, or collapsed layout. Hidden tracks can be configured before showing them. Coding-exon translation is automatic when sufficiently zoomed in and usable CDS frame information exists; there is no annotation translation toggle. Custom strand colors survive theme changes, so check their contrast in both themes. Reset strand colors returns to the theme-aware defaults. Start/stop codon highlights keep their separate meaning and theme-aware colors, even if a custom strand color matches an IGV codon or marker color.

For an alignment track, independently show or hide Coverage (read depth) and Aligned reads. Expanded lanes show readable mismatch letters at close zoom and grow with viewer text size. Compact lanes show colored marks rather than base letters. Reset alignment display restores coverage, reads, and expanded lanes. These controls retain genomic positions; they do not realign reads, change filtering, or alter cohort votes. Settings can also be chosen for a hidden alignment track before showing it.

### Color diagnostics

Some file formats and coloring modes introduce additional IGV colors. Unclassified evidence colors retain their original paint and opacity; GenoPilot does not guess their meaning or replace every unfamiliar hue with a theme color. Known labels and backgrounds have theme-aware fallbacks. A preserved color can still have poor contrast, so inspect the recorded attributes rather than relying on color alone.

To investigate an unreadable color, enable Collect unmapped canvas colors (browser console) in Settings and open your browser's developer console. Filter for `[GenoPilot canvas]`, then show the affected track or region. Collection is off by default and emits only a coarse track type, drawing operation, and numeric RGBA color or a fixed category token. It does not log labels, paths, positions, or biological content, and nothing is uploaded or written to your source files. Entries are deduplicated and capped at 256; switch collection off/on to start a fresh collection. Already classified colors, including colors deliberately preserved, are not reported as unmapped. Browser console entries remain until cleared according to your browser's normal console behavior.

## Amino-acid letters and translation

IGV's translation uses the standard genetic code. This is a display convention, not a claim that every organism or organelle uses that code; mitochondrial and other alternative codes can differ. Verify the appropriate genetic code before interpreting a displayed translation biologically. Three-frame reference translation is distinct from translation of an annotated, spliced CDS.

| Letter | Abbreviation | Amino acid |
|---|---|---|
| A | Ala | Alanine |
| R | Arg | Arginine |
| N | Asn | Asparagine |
| D | Asp | Aspartic acid |
| C | Cys | Cysteine |
| Q | Gln | Glutamine |
| E | Glu | Glutamic acid |
| G | Gly | Glycine |
| H | His | Histidine |
| I | Ile | Isoleucine |
| L | Leu | Leucine |
| K | Lys | Lysine |
| M | Met | Methionine |
| F | Phe | Phenylalanine |
| P | Pro | Proline |
| S | Ser | Serine |
| T | Thr | Threonine |
| W | Trp | Tryptophan |
| Y | Tyr | Tyrosine |
| V | Val | Valine |

A stop marker (`*` or `STOP`) is not an amino acid. IGV may label methionine as `START`, but that does not prove translation begins there. An unresolved or ambiguous codon need not produce a resolved amino-acid letter; inspect the underlying bases and CDS annotation rather than treating a blank or unknown letter as a missing residue.

## Codon sun mapping

This table gives the standard-genetic-code mapping shown by a codon sun (codon wheel), grouped by amino acid. Read each codon in the coding direction, 5′ to 3′; on a wheel, read the first, second, and third bases from the center outward. DNA codons use `T` here to match the viewer; RNA wheels use `U` instead. For reverse-strand features, use the reverse complement, not the forward reference letters. For an annotated CDS, follow its reading frame and join coding exons before interpreting codons.

| Letter | Abbreviation | Amino acid | DNA codons |
|---|---|---|---|
| A | Ala | Alanine | GCT, GCC, GCA, GCG |
| R | Arg | Arginine | CGT, CGC, CGA, CGG, AGA, AGG |
| N | Asn | Asparagine | AAT, AAC |
| D | Asp | Aspartic acid | GAT, GAC |
| C | Cys | Cysteine | TGT, TGC |
| Q | Gln | Glutamine | CAA, CAG |
| E | Glu | Glutamic acid | GAA, GAG |
| G | Gly | Glycine | GGT, GGC, GGA, GGG |
| H | His | Histidine | CAT, CAC |
| I | Ile | Isoleucine | ATT, ATC, ATA |
| L | Leu | Leucine | TTA, TTG, CTT, CTC, CTA, CTG |
| K | Lys | Lysine | AAA, AAG |
| M | Met | Methionine | ATG |
| F | Phe | Phenylalanine | TTT, TTC |
| P | Pro | Proline | CCT, CCC, CCA, CCG |
| S | Ser | Serine | TCT, TCC, TCA, TCG, AGT, AGC |
| T | Thr | Threonine | ACT, ACC, ACA, ACG |
| W | Trp | Tryptophan | TGG |
| Y | Tyr | Tyrosine | TAT, TAC |
| V | Val | Valine | GTT, GTC, GTA, GTG |
| `*` | — | Stop (not an amino acid) | TAA, TAG, TGA |

ATG encodes methionine; a start site requires biological context, and some organisms also use alternative initiation codons. This mapping does not cover alternative genetic codes or resolve ambiguous bases. See [NCBI’s genetic code tables](https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi) when checking the code appropriate to an organism or organelle.

## Sources and errors

Sources and provenance in the `?` menu identifies the source files; verified imported files retain their recorded checksums. Browsing does not modify the accession cache or create an index beside the FASTA. When an index is missing, GenoPilot prepares it in memory. Supplied indexes must match the reference's sequence names, lengths, byte offsets, and line layout; an incompatible index is refused.

GenoPilot checks files before opening and retains the file identities used for checksum verification through view preparation. A change between verification and publication is refused rather than served with an outdated checksum. If a file later disappears or changes, reopen the view from the CLI after correcting the problem; the browser must not silently continue using a changed source. Reference-loading and track-loading errors, including failures during zoom or resize, are shown explicitly. When a review locus or preset changes, the viewer hides superseded evidence and shows an updating state until the selected evidence is ready; outdated queued selections are skipped. Leaving the opening screen or exiting GenoPilot cancels pending checksum reads.

After GenoPilot disconnects, already loaded content may remain visible, but navigating into an unloaded region needs the local server. Scientific exports and decision drafting are not available in this read-only view.
