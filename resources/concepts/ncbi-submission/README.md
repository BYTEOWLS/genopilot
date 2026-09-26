# NCBI genome submission preparation

## Goal

Turn a genome FASTA and its GFF3 annotation into a validated GenBank submission package, typically the target FASTA and final GFF3 of an annotation-transfer run. The package contains a `.sqn` file built by NCBI's `table2asn`, its validation and discrepancy reports, and a checklist of the manual steps that remain. GenoPilot prepares and checks; the researcher uploads.

This concept depends on [Post-LiftOn identifier rewriting](../annotation-id-rewriting.md), which is implemented first in annotation transfer. This workflow reuses that shared find-and-replace step unchanged and adds only what NCBI needs on top of it: locus tags and transcript and protein IDs (see [Identifier preparation](#identifier-preparation)).

## Why the upload stays manual

Submitting publishes unpublished data to an external service. That is outward-facing, hard to reverse, and needs the researcher's NCBI account, BioProject, BioSample, and registered locus-tag prefix, which are created interactively in the NCBI Submission Portal. GenoPilot therefore never uploads, never stores NCBI credentials, and never contacts the portal. The completion view shows the exact package paths and the remaining steps.

Revisit automated upload only if a concrete batch need appears and NCBI offers a supported, non-interactive route for it.

## NCBI requirements this relies on

Verify each point against NCBI's current pages and the pinned `table2asn` at kickoff; they are the reason for the stages below, not a contract GenoPilot defines.

- **FASTA** ([submission guide](https://www.ncbi.nlm.nih.gov/genbank/genomesubmit/)): no leading or trailing `N`; a run of at least the declared minimum number of `N`s (10 or less) becomes an `assembly_gap` with a gap type and evidence of linkage; shorter runs stay as ambiguous bases. Very short sequences and high overall `N` content may be rejected; confirm the thresholds.
- **GFF3** ([annotating genomes with GFF3](https://www.ncbi.nlm.nih.gov/genbank/genomes_gff/)): column 1 matches the FASTA ID up to the first space; every gene carries `locus_tag` (GFF3 `ID` is used only for parent–child links and never becomes the locus tag; `Name` is ignored); CDS and RNA features carry `product`, otherwise a CDS becomes `hypothetical protein`; `transcript_id` and `protein_id` use `gnl|<dbname>|<id>` or are both omitted and generated; broken genes carry `pseudo=true` and pseudogenes `pseudogene=<type>`. A missing `locus_tag` fails with `FATAL: MISSING_GENES`.
- **`table2asn`** ([documentation](https://www.ncbi.nlm.nih.gov/genbank/table2asn/)): for GFF3 genomes NCBI recommends `-M n -Z -J -c w`, plus `-euk` for eukaryotes, `-j "[organism=…] [strain=…]"` source modifiers, `-t <template.sbt>`, `-gaps-min`, `-gaps-unknown`, `-l <linkage evidence>`, `-V b` for a GenBank flatfile. It writes `.sqn`, `.val`, `.dr`, `.gbf`, and `.stats`. It also silently fixes some things, such as extending a CDS to an adjacent stop codon and copying CDS products to mRNAs, so its output is compared with its input rather than trusted blindly.

## Inputs

- a genome FASTA and a GFF3 whose sequence IDs match it, chosen as local paths in the first version;
- the submission template `.sbt`, created by the researcher on NCBI's template page;
- the lineage, prokaryote or eukaryote, chosen explicitly and never inferred (it selects `-euk` and NCBI's lineage-specific checks);
- organism, strain or isolate, the genetic code, and other source modifiers for the whole genome;
- optional per-sequence source modifiers for sequences that differ, such as an organellar location (`mitochondrion`, `chloroplast`, …) with its own genetic code, or a plasmid name, passed to `table2asn` as a source table rather than in `-j`.

Nothing about an organism, its genetic code, its organelles, or its gene structure is built in; every such value comes from the saved configuration.
- the locus-tag prefix NCBI registered for the BioSample;
- the `gnl` database name for `transcript_id` and `protein_id`;
- gap settings: minimum gap length, the length that means "unknown size", gap type, and linkage evidence;
- optionally a callable mask BED from reference-consensus, which says why a position is `N`.

Choosing an annotation-transfer run or a catalog isolate genome directly, instead of paths, is a later convenience once both sides have stable result contracts.

## Stages

A new packaged workflow, `ncbi-submission`, runnable directly through Snakemake like the others. The TUI validates and saves the configuration; rules only execute it.

```text
validate inputs (reuse the shared FASTA/GFF3 validation)
  -> prepare FASTA: trim leading/trailing N, report short and N-rich sequences
  -> shift GFF3 coordinates for trimmed sequences
  -> rewrite identifiers (reused shared step, optional)
  -> assign locus tags, transcript and protein IDs
  -> find features over N runs or ambiguous codons           # decision point
  -> table2asn: .sqn, .val, .dr, .gbf, .stats
  -> summarize validation and discrepancies                  # review
  -> package: files, checksums, provenance, manual checklist
```

- **FASTA preparation.** Trimming is deterministic and recorded per sequence (bases removed at each end). A feature that lies in a trimmed end fails the stage rather than being dropped. Sequences below NCBI's minimum length and sequences above the `N` threshold are reported for the researcher to exclude explicitly; they are never removed silently. The original FASTA and GFF3 are kept unchanged.
- **Gaps.** `table2asn` converts `N` runs itself from the configured gap settings. For reference-guided genomes an `N` run is not an assembly gap in the usual sense: its length is known from the backbone and the linkage evidence is the alignment, not paired ends. The configuration therefore records gap type and linkage evidence explicitly instead of defaulting to `paired-ends`; the correct values for reference-guided genomes are an open question below.
- **Features over uncertain sequence.** A CDS that overlaps an `N` run or contains an ambiguous codon usually fails translation checks. The stage lists these features, with the mask reason when a mask is given. The researcher decides per feature: `pseudo=true`, partial ends, or exclusion. The decision is saved to YAML and the next target reads it. Nothing is marked automatically.
- **Review.** `.val` errors block the package; warnings and discrepancy-report findings are shown with counts and paths and must be acknowledged. Changing only decisions or identifiers reruns from that stage and reuses earlier outputs.
- **Package.** `submission/` holds the `.sqn`, the prepared FASTA and GFF3, the ID mapping, the validation and discrepancy reports, checksums, and a checklist naming BioProject, BioSample, locus-tag prefix, template, and portal upload. Provenance records the `table2asn` version and full command.

## Identifier preparation

ID rewriting is the shared step from [Post-LiftOn identifier rewriting](../annotation-id-rewriting.md), used with the same contract, preview, validation, and `id-mapping.tsv`. When the input GFF3 already comes from an annotation-transfer run with final IDs, the step is left empty and skipped.

**Locus tags** are specific to this workflow, because NCBI does not read them from `ID`. Two modes, chosen explicitly:

- **numbered**: `<prefix>_<number>` in genome order, with a configured start and step (for example 10, so later insertions fit), zero-padded to a configured width;
- **from ID**: a regex capture from the final gene ID, rejected unless every gene matches and the resulting tags are unique and in NCBI's format.

`transcript_id` and `protein_id` are generated as `gnl|<dbname>|<locus_tag>` plus a per-isoform suffix, or omitted so `table2asn` generates them; the mode is recorded. Existing values in the input are kept only when they already have NCBI's form, and the choice is shown in the preview. Locus tags and generated IDs are added as columns to the ID mapping, so every submitted identifier traces back to the raw LiftOn ID.

## Open questions

Decide these at kickoff:

- Does NCBI accept reference-guided isolate genomes as assemblies, and with which assembly-method statement? A cohort consensus is a mosaic of several individuals and probably is not submittable as one organism's genome; confirm with NCBI (genomes@ncbi.nlm.nih.gov) before building anything that suggests otherwise.
- Which gap type and linkage evidence describe an uncallable run in a reference-guided genome?
- The current `N`-content and minimum-length thresholds.
- Which locus-tag numbering NCBI and the research group prefer.
- How a transferred gene refers to its source gene in the reference annotation (for example a `note` or an `inference` qualifier), since the reference's locus tag belongs to another genome and must not be reused.
- Whether an organellar or plasmid sequence is submitted with the main genome or separately.
- Whether ambiguous positions should be submitted as `N` or IUPAC codes; see the IUPAC question in [`later.md`](../../../later.md).
- How to pin `table2asn`: a Bioconda package if one exists at the needed version, otherwise a checksum-verified download from NCBI's FTP, recorded like the other pinned tools.

## Work

- [ ] Kickoff: confirm [Post-LiftOn identifier rewriting](../annotation-id-rewriting.md) is done, resolve the open questions, and record the answers in this file.
- [ ] Add the `ncbi-submission` manifest, parameters, configuration schema, and form.
- [ ] Implement FASTA trimming with GFF3 coordinate shifting and the short/N-rich report.
- [ ] Implement locus-tag, transcript-ID, and protein-ID assignment with the ID mapping.
- [ ] Implement the uncertain-feature report, its saved decisions, and the rerun from that point.
- [ ] Pin `table2asn`, run it, and parse `.val` and `.dr` into a versioned summary.
- [ ] Build the package with checksums, provenance, and the manual checklist; show it in the TUI.
- [ ] Add synthetic fixtures and tests: leading/trailing `N`, a feature in a trimmed end, `N` runs around the gap threshold, a CDS over a gap, missing products, prokaryotic and eukaryotic fixtures, a sequence with its own location and genetic code, both locus-tag modes, duplicate generated locus tags, and a decision-only rerun. Gate real `table2asn` runs like the Conda integration tests.

## Acceptance

- The prepared FASTA and GFF3 pass the pinned `table2asn` without errors on the synthetic fixtures, and the package holds everything the checklist names.
- Every change to sequence or identifiers is recorded and traceable to the original input through the trim record and `id-mapping.tsv`.
- No feature is marked pseudo, partial, or excluded, and no sequence is removed, without a saved researcher decision.
- The workflow never contacts NCBI and runs directly through Snakemake with an application-saved configuration.
