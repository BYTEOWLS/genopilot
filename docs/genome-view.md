# Reading a genome view

A genome view shows a reference's chromosomes or contigs and their annotation. It is read-only: panning, zooming, and hiding a track do not change source files or saved settings.

## Moving around

Enter a region as `sequence:start-end` and press Go or Enter. Coordinates are 1-based and include both ends. Use the exact sequence name from the reference; for example, `contig1:100-200`. Choose a chromosome or contig from the selector. Its overview shows where the current region lies within that sequence. The plus and minus buttons zoom in and out; drag within the tracks to pan. Scroll within a track to zoom around the mouse pointer, keeping the pointed position in place except at sequence boundaries. The crosshair marks the pointer's position. Genome views cannot search public genomes or load files from a URL or your disk.

Choose All chromosomes / contigs, or enter `all`, to see the whole reference when it contains multiple sequences. The chromosome ruler track shows every sequence, including short contigs. Click a chromosome on that track, choose it from the selector, or scroll up over it to enter its local coordinates. The plus and minus buttons become available in the single-sequence view.

The track chooser shows available annotation and its file size. Unindexed annotation loads whole, so large files start hidden and can be enabled explicitly. A track with sequence names or coordinates that do not fit the reference is marked as incompatible instead of being silently hidden. Matching names do not prove that two files use the same coordinates; the source of the view must provide compatible files.

Click the `?` icon or press `?` to open or close this explanation and the source paths/checksums. Help and track controls are above the viewer; nothing is placed underneath it. The genome viewer uses the available window width and a tall, resizable track area. Theme switching changes the viewer background, ruler, annotation tracks, labels, and details panel without resetting the region or reloading tracks. Nucleotide hues stay recognizable in both themes, with brightness adjusted for contrast; annotation tracks use blue in light mode and a lighter blue in dark mode. Annotation colors do not encode confidence.

## Sequence and annotation

Viewer text starts at 16 px. Use A− and A+ beside Text to adjust track labels, feature labels, DNA letters, and bp coordinates between 12 and 24 px. Row spacing grows with the text; these controls do not change the region, reload source files, or save a setting. Zoom further in if larger DNA letters need more horizontal space.

Zoom in to see individual reference bases. The letters identify nucleotides even without color: A, C, G, and T are resolved bases; N is unresolved. Other letters may represent IUPAC ambiguity codes. DNA letters are filled rather than outlined, with faint colored backplates. Color is an aid, not a confidence score.

At close zoom, coding exons can show translated amino-acid letters on opaque, alternating blue codon backgrounds. Text contrasts with those fills in both themes. IGV highlights methionine/start markers in green and stop codons (`*`) in red; these display cues do not establish a true translation start or a functional protein.

Annotation tracks show features such as genes, transcripts, and coding regions. Arrows indicate strand and boxes indicate annotated spans. Click a feature to see the attributes recorded in its annotation in GenoPilot's inline details panel, not an IGV dialog. Hovering does not open details. Click a track label for its track information, and use Close to dismiss the panel. On smaller windows, the panel sits above the genome rather than squeezing the tracks. An annotation is evidence about a sequence, not proof that a gene is functional. A blank region may simply have no annotation.

## Sources and errors

The `?` panel identifies the source files; verified imported files retain their recorded checksums. Browsing does not modify the accession cache or create an index beside the FASTA. When an index is missing, GenoPilot prepares it in memory. Supplied indexes must match the reference's sequence names, lengths, byte offsets, and line layout; an incompatible index is refused.

GenoPilot checks files before opening and retains the file identities used for checksum verification through view preparation. A change between verification and publication is refused rather than served with an outdated checksum. If a file later disappears or changes, reopen the view from the CLI after correcting the problem; the browser must not silently continue using a changed source. Reference-loading and track-loading errors, including failures during zoom or resize, are shown explicitly. Leaving the opening screen or exiting GenoPilot cancels pending checksum reads.

After GenoPilot disconnects, already loaded content may remain visible, but navigating into an unloaded region needs the local server. Scientific exports and decision drafting are not available in this read-only view.
