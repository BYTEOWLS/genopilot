# INSDC submission preparation

## Goal

Prepare a genome and the isolates' raw reads for submission to any node of the International Nucleotide Sequence Database Collaboration (INSDC): NCBI (GenBank and SRA), EMBL-EBI (ENA), or DDBJ (DDBJ and DRA). A typical input is the target FASTA and final GFF3 of an annotation-transfer run, and the isolates of the isolate catalog. GenoPilot prepares and checks; the researcher uploads.

The official validators (`table2asn` at NCBI, Webin-CLI at ENA, DDBJ's checking tools) report problems as text logs and leave the fixing to the researcher. GenoPilot runs the pinned validator of the chosen node, shows its findings, and guides the fixes that need a decision: each is saved as YAML, and the next target reads it. Mechanical preparation, such as trimming `N` at sequence ends, is recorded; nothing that changes the science is fixed silently.

This concept depends on the [GFF3 ID find-and-replace](../annotation-id-rewriting.md), a general application feature implemented first. This workflow uses it unchanged and adds only what the repositories need on top of it: locus tags and transcript and protein IDs (see [Identifier preparation](#identifier-preparation)).

## Repositories

The three nodes exchange their data daily, so a record submitted to one is visible in all three. Choosing a node therefore decides the submission route, the account, and the formats, not who can see the data. Institutions, funders, or national data policies may require a specific node, for example ENA for many European projects; GenoPilot never assumes one.

| | NCBI | ENA | DDBJ |
|---|---|---|---|
| Account | NCBI account, Submission Portal | Webin account | DDBJ account |
| Project, sample | BioProject, BioSample | study, sample (mirrored as BioProject, BioSample) | BioProject, BioSample |
| Genome | GenBank/WGS: `.sqn` from `table2asn` | Webin-CLI `genome` context: manifest with FASTA or EMBL flat file, optional AGP and chromosome list | Mass Submission System: annotation table and FASTA |
| Reads | SRA: metadata sheet and FASTQ upload | Webin-CLI `reads` context: manifest per read set with FASTQ | DRA: metadata and FASTQ upload |
| Validator | `table2asn` (offline) | Webin-CLI `-validate` | DDBJ's parser and checking tools |

The table is the reason for the design, not a contract: every cell is verified at kickoff for the node implemented first.

**Scope.** The preparation shared by all nodes is repository-neutral: FASTA preparation, identifier preparation, the uncertain-feature decisions, and the read checks. Packaging and validation are per node. The first release implements one node end to end, chosen at kickoff; a second follows only when it is needed, reusing the shared stages unchanged.

## Why the upload stays manual

Submitting publishes unpublished data to an external service. That is outward-facing, hard to reverse, and needs the researcher's account, project, samples, and registered locus-tag prefix, which each node creates interactively. GenoPilot therefore never uploads, never stores repository credentials, and never contacts a portal. The completion view shows the exact package paths and the remaining steps.

A validator that must contact its repository to validate, as Webin-CLI may need to for the account, study, and sample, is run only with the researcher's explicit consent, with credentials passed through the child-process environment and never saved, like the NCBI API key. Revisit automated upload only if a concrete batch need appears and the node offers a supported, non-interactive route for it.

## Requirements this relies on

Verify each point against the node's current pages and the pinned validator at kickoff; they are the reason for the stages below, not a contract GenoPilot defines.

### Shared by all nodes

- The INSDC feature table defines the feature keys and qualifiers (`gene`, `CDS`, `locus_tag`, `product`, `pseudo`, …) for all three nodes; the file formats that carry them differ.
- Every submitted genome needs a registered locus-tag prefix, and every gene a unique locus tag.
- Reads are archived raw or minimally processed; assembled sequences are never read submissions.

### NCBI

- **FASTA** ([submission guide](https://www.ncbi.nlm.nih.gov/genbank/genomesubmit/)): no leading or trailing `N`; a run of at least the declared minimum number of `N`s (10 or less) becomes an `assembly_gap` with a gap type and evidence of linkage; shorter runs stay as ambiguous bases. Very short sequences and high overall `N` content may be rejected; confirm the thresholds. The guide does not mention IUPAC codes other than `N`; confirm with `table2asn` that a reference-consensus FASTA written with them (`R`, `Y`, …, `V`) validates, since only raw reads are documented to accept them ([SRA standards](https://www.ncbi.nlm.nih.gov/sra/docs/sra-data-submission-standards/)).
- **GFF3** ([annotating genomes with GFF3](https://www.ncbi.nlm.nih.gov/genbank/genomes_gff/)): column 1 matches the FASTA ID up to the first space; every gene carries `locus_tag` (GFF3 `ID` is used only for parent–child links and never becomes the locus tag; `Name` is ignored); CDS and RNA features carry `product`, otherwise a CDS becomes `hypothetical protein`; `transcript_id` and `protein_id` use `gnl|<dbname>|<id>` or are both omitted and generated; broken genes carry `pseudo=true` and pseudogenes `pseudogene=<type>`. A missing `locus_tag` fails with `FATAL: MISSING_GENES`.
- **`table2asn`** ([documentation](https://www.ncbi.nlm.nih.gov/genbank/table2asn/)): for GFF3 genomes NCBI recommends `-M n -Z -J -c w`, plus `-euk` for eukaryotes, `-j "[organism=…] [strain=…]"` source modifiers, `-t <template.sbt>`, `-gaps-min`, `-gaps-unknown`, `-l <linkage evidence>`, `-V b` for a GenBank flatfile. It writes `.sqn`, `.val`, `.dr`, `.gbf`, and `.stats`. It also silently fixes some things, such as extending a CDS to an adjacent stop codon and copying CDS products to mRNAs, so its output is compared with its input rather than trusted blindly.

### ENA (to verify)

- **Genomes** are submitted with Webin-CLI and a manifest file naming the study, sample, assembly name, assembly type, coverage, assembly program, sequencing platform, minimum gap length, molecule type, and the sequence files. An annotated genome is an EMBL flat file rather than FASTA plus GFF3, so the prepared GFF3 is converted, and the conversion is validated like any other step.
- **Reads** are submitted with Webin-CLI and one manifest per read set naming the study, sample, instrument, library source, selection, and strategy, and both FASTQ files of a pair.
- Webin-CLI can validate without submitting; whether validation needs the Webin login is an open question.

### DDBJ (to verify)

- Annotated genomes go through the Mass Submission System as an annotation table with the FASTA, checked with DDBJ's own tools before submission. Reads go to the DDBJ Sequence Read Archive (DRA).

## Inputs

- the target node, chosen explicitly;
- a genome FASTA and a GFF3 whose sequence IDs match it, chosen as local paths in the first version;
- the node's submission metadata: for NCBI the submission template `.sbt`, created by the researcher on NCBI's template page; for ENA the manifest fields;
- the lineage, prokaryote or eukaryote, chosen explicitly and never inferred (for NCBI it selects `-euk` and the lineage-specific checks);
- organism, strain or isolate, the genetic code, and other source modifiers for the whole genome;
- optional per-sequence source modifiers for sequences that differ, such as an organellar location (`mitochondrion`, `chloroplast`, …) with its own genetic code, or a plasmid name (for NCBI a source table rather than `-j`);
- the registered locus-tag prefix;
- for NCBI, the `gnl` database name for `transcript_id` and `protein_id`;
- gap settings: minimum gap length, the length that means "unknown size", gap type, and linkage evidence;
- optionally a callable mask BED from reference-consensus, which says why a position is `N`.

Nothing about an organism, its genetic code, its organelles, or its gene structure is built in; every such value comes from the saved configuration.

Choosing an annotation-transfer run or a saved isolate sequence directly, instead of paths, is a later convenience once both sides have stable result contracts.

## Stages

A new packaged workflow, `insdc-submission`, runnable directly through Snakemake like the others. The TUI validates and saves the configuration; rules only execute it.

```text
validate inputs (reuse the shared FASTA/GFF3 validation)
  -> prepare FASTA: trim leading/trailing N, report short and N-rich sequences
  -> shift GFF3 coordinates for trimmed sequences
  -> rewrite identifiers (reused shared step, optional)
  -> assign locus tags, transcript and protein IDs
  -> find features over N runs or ambiguous codons           # decision point
  -> node packaging and validation:
       NCBI: table2asn -> .sqn, .val, .dr, .gbf, .stats
       ENA:  EMBL flat file and manifest -> Webin-CLI -validate
  -> summarize validation and discrepancies                  # review
  -> package: files, checksums, provenance, manual checklist
```

Every stage before the node packaging is repository-neutral and its outputs are the same whichever node is chosen.

- **FASTA preparation.** Trimming is deterministic and recorded per sequence (bases removed at each end). A feature that lies in a trimmed end fails the stage rather than being dropped. Sequences below the node's minimum length and sequences above its `N` threshold are reported for the researcher to exclude explicitly; they are never removed silently. The original FASTA and GFF3 are kept unchanged.
- **Gaps.** For reference-guided genomes an `N` run is not an assembly gap in the usual sense: its length is known from the backbone and the linkage evidence is the alignment, not paired ends. The configuration therefore records gap type and linkage evidence explicitly instead of defaulting to `paired-ends`; the correct values for reference-guided genomes are an open question below. `table2asn` converts `N` runs itself from these settings; for ENA the manifest's minimum gap length plays that role.
- **Features over uncertain sequence.** A CDS that overlaps an `N` run or contains an ambiguous codon usually fails translation checks. The stage lists these features, with the mask reason when a mask is given. The researcher decides per feature: `pseudo=true`, partial ends, or exclusion. The decision is saved to YAML and the next target reads it. Nothing is marked automatically.
- **Review.** The validator's errors block the package; warnings and discrepancy findings are shown with counts and paths and must be acknowledged. Changing only decisions or identifiers reruns from that stage and reuses earlier outputs.
- **Package.** `submission/` holds the node's submission files (for NCBI the `.sqn`; for ENA the manifest and flat file), the prepared FASTA and GFF3, the ID mapping, the validation reports, checksums, and a checklist naming the project, sample, locus-tag prefix, and upload step of the chosen node. Provenance records the validator's version and full command.

## Identifier preparation

ID rewriting is the [GFF3 ID find-and-replace](../annotation-id-rewriting.md), with its contract, preview, validation, and `id-mapping.tsv`. It runs in the application before the submission workflow starts, which reads the rewritten GFF3 as an imported input. When the input GFF3 already has its final IDs, it is skipped.

**Locus tags** are specific to this workflow, because the repositories do not read them from `ID`. Two modes, chosen explicitly:

- **numbered**: `<prefix>_<number>` in genome order, with a configured start and step (for example 10, so later insertions fit), zero-padded to a configured width;
- **from ID**: a regex capture from the final gene ID, rejected unless every gene matches and the resulting tags are unique and in the INSDC format.

For NCBI, `transcript_id` and `protein_id` are generated as `gnl|<dbname>|<locus_tag>` plus a per-isoform suffix, or omitted so `table2asn` generates them; the mode is recorded. Existing values in the input are kept only when they already have NCBI's form, and the choice is shown in the preview. Locus tags and generated IDs are added as columns to the ID mapping, so every submitted identifier traces back to the raw LiftOn ID.

## Isolate reads

A publication usually also needs the isolates' raw reads in a read archive (NCBI SRA, ENA, or DDBJ DRA), linked to the genome through the same project. This is a second, independent preparation: it needs no genome or annotation and can be done before either exists. The same principle applies: GenoPilot prepares and checks, and the researcher uploads.

The reads come from the isolate catalog, which already records every isolate's R1/R2 pairs:

- **Files.** The submitted files are the delivered FASTQ files, unchanged. Read validation already checks that they are readable, that R1 and R2 hold the same number of reads, and that their Illumina read names are consistent. The package lists each file with its checksum; nothing is copied or renamed unless the node requires it.
- **Raw reads.** The archives take raw or minimally processed reads ([NCBI SRA standards](https://www.ncbi.nlm.nih.gov/sra/docs/sra-data-submission-standards/)). The catalog flags reads the provider already trimmed, and the report shows them so the researcher can submit the untrimmed delivery instead where one exists.
- **Metadata.** One record per read set, keyed by the isolate's sample: library strategy `WGS`, source `GENOMIC`, selection `RANDOM`, layout `PAIRED`, platform `ILLUMINA`, and the instrument model, plus a library name and design description. The same fields fill NCBI's SRA metadata sheet and ENA's reads manifest. The read names give instrument, run, flowcell, and lane, but not the instrument model, which the researcher enters once per instrument. Several read pairs of one library, from different lanes or runs, are listed under that library rather than as separate libraries.
- **Samples.** Every isolate needs a sample (BioSample), registered with the genome's project. The report maps each isolate to its sample accession, entered by the researcher; the catalog may later keep it as isolate metadata.
- **Ambiguous bases.** Reads may use every IUPAC nucleotide code, but NCBI may flag or reject a file when more than half of its bases are ambiguous. The read QC reports already give the numbers.

Verify each node's current metadata fields, file-format and naming rules, and whether trimmed reads are accepted before building this; the points above are the reason for the stage, not a contract.

## Open questions

Decide these at kickoff:

- Which node is implemented first. A European research group may be expected to submit through ENA; confirm with the group and its funder.
- Does the chosen node accept reference-guided isolate genomes as assemblies, and with which assembly-method statement? A cohort consensus is a mosaic of several individuals and probably is not submittable as one organism's genome; confirm with the node's genome team (for NCBI genomes@ncbi.nlm.nih.gov) before building anything that suggests otherwise.
- Which gap type and linkage evidence describe an uncallable run in a reference-guided genome?
- The current `N`-content and minimum-length thresholds of the chosen node.
- Which locus-tag numbering the node and the research group prefer.
- How a transferred gene refers to its source gene in the reference annotation (for example a `note` or an `inference` qualifier), since the reference's locus tag belongs to another genome and must not be reused.
- Whether an organellar or plasmid sequence is submitted with the main genome or separately.
- Whether ambiguous positions should be submitted as `N` or IUPAC codes: NCBI's genome guide mentions only `N`, so confirm with the chosen validator that IUPAC codes validate (see the [consensus science background](../done/consensus/science-background.md#open-point)).
- For ENA: how the GFF3 becomes an EMBL flat file (a pinned converter or an own step), and whether Webin-CLI validation needs the Webin login.
- For isolate reads: which metadata fields the chosen node requires, whether provider-trimmed reads are accepted, and whether the sample accession becomes an isolate catalog field.
- How to pin the validator: a Bioconda package if one exists at the needed version, otherwise a checksum-verified download from the node, recorded like the other pinned tools.

## Work

- [ ] Kickoff: confirm the [GFF3 ID find-and-replace](../annotation-id-rewriting.md) is done, choose the first node, resolve the open questions, and record the answers in this file.
- [ ] Add the `insdc-submission` manifest, parameters, configuration schema, and form, with the node as an explicit choice.
- [ ] Implement FASTA trimming with GFF3 coordinate shifting and the short/N-rich report.
- [ ] Implement locus-tag, transcript-ID, and protein-ID assignment with the ID mapping.
- [ ] Implement the uncertain-feature report, its saved decisions, and the rerun from that point.
- [ ] Pin the first node's validator, run it, and parse its reports into a versioned summary.
- [ ] Build the package with checksums, provenance, and the manual checklist; show it in the TUI.
- [ ] Prepare isolate reads for the first node: the metadata sheet or manifests, the file list with checksums, the trimmed-read and ambiguous-base report, and the upload checklist.
- [ ] Add synthetic fixtures and tests: leading/trailing `N`, a feature in a trimmed end, `N` runs around the gap threshold, a CDS over a gap, missing products, prokaryotic and eukaryotic fixtures, a sequence with its own location and genetic code, both locus-tag modes, duplicate generated locus tags, and a decision-only rerun. Gate real validator runs like the Conda integration tests.

## Acceptance

- The prepared files pass the first node's pinned validator without errors on the synthetic fixtures, and the package holds everything the checklist names.
- The repository-neutral stages produce the same outputs whichever node is chosen.
- Every change to sequence or identifiers is recorded and traceable to the original input through the trim record and `id-mapping.tsv`.
- No feature is marked pseudo, partial, or excluded, and no sequence is removed, without a saved researcher decision.
- The workflow never uploads, and it runs directly through Snakemake with an application-saved configuration.
