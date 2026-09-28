# Deferred and optional work

Ideas that are intentionally outside the current task list in [`resources/tasks.md`](resources/tasks.md). Revisit them when a concrete requirement exists.

## Performance review

Performance is a non-functional requirement: a run should finish in a time and within a disk and memory budget a researcher can plan for, also on machines much slower than a developer's. The initial release needs no deep performance review; obvious problems are fixed when they show up, as in cohort aggregation (consensus Task 4.2), and expectations are set by the [systems check](resources/concepts/systems-check.md).

A later review should start from measurements, the job benchmarks every run already writes, on real cohorts and slower machines, and consider:

- **Disk**: about 1.1 GB is kept per isolate of a 30 Mb genome, mostly the alignment and the all-sites calls. Options are CRAM instead of BAM, which is typically much smaller but needs the backbone to read, and keeping the all-sites calls only as long as a later step needs them. Both change what a run preserves as evidence and need a provenance decision.
- **Cohort support tables**: the sites table has one column per isolate and the intervals table one letter per isolate and row, so their size grows faster than the cohort. Measure them on a large real cohort before changing the format again.
- **Single-threaded steps**: aggregation, callability classification, and the other Python scripts use one core. Per-contig parallelism is possible where a step's output can be concatenated, and `bgzip` accepts threads.
- **Scheduling**: Snakemake group jobs or resource declarations (memory, disk) could keep many small jobs from overloading a small machine.

## Comparing LiftOn GFF3 files

LiftOn outputs for two assemblies of the same genome, such as an initial assembly and a later consensus, are retained but do not require semantic comparison in the first implementation. A later comparison should match features by stable transformed IDs rather than line-by-line text comparison.

Potential classifications include:

- unchanged;
- coordinate shift only;
- exon or transcript structure changed;
- CDS sequence changed;
- protein sequence changed;
- premature stop introduced or repaired;
- newly mapped or no longer mapped;
- duplicated, split, or merged candidate.

A possible report contains:

```text
feature_id
mapped_initial
mapped_consensus
coordinate_change
exon_structure_change
cds_sequence_change
protein_sequence_change
initial_protein_status
consensus_protein_status
review_status
```

## Workflow code layout

Revisit once the reference-consensus workflow is complete (consensus tasks 4a–4c), when two finished workflows show what is actually reused.

- **Snakemake assets:** reference-consensus keeps its own rules, scripts, and environments under `workflows/reference-consensus/` (consensus Task 4.1). Annotation-transfer's still sit in `workflows/shared/` next to what both workflows use: the run-events logger plugin, the `ncbi-datasets-cli` environment, `resolve_input.py`, and the FASTA/GFF3 parsers inside `validate_inputs.py`. Move annotation-transfer's files into its own `rules/`, `scripts/`, and `envs/`. Before moving `envs/lifton/`, change `collect_run_provenance.py`: it reads the pins of every environment next to it and rejects a package pinned to two different versions.
- **TypeScript:** each workflow has its own `src/workflows/<id>/configuration.ts` and `run-configuration.ts`, plus a configuration screen under `src/ui/new-run-screen/`, that map generic manifest parameters to and from `config.yaml`. Check which of these a manifest-driven mapping could replace, and keep only the workflow-specific parts, such as the isolate snapshot and the review details.

## Reads without Illumina headers

Reference-consensus derives each read pair's read group from Illumina read headers (`@<instrument>:<run>:<flowcell>:<lane>:…`) and fails a pair whose headers do not follow that form. Reads downloaded from a public archive often lost those headers: `fasterq-dump` from the NCBI Sequence Read Archive renames them `@SRR1234567.1`, `@SRR1234567.2`, and so on, so flowcell, lane, and barcode are gone.

Supporting such reads needs its own design: where the read group comes from (for example, the run accession and the archive's run metadata), how libraries are identified for duplicate marking, and how the substitute is recorded in provenance so it is never mistaken for header-derived evidence.

## Open question: IUPAC codes in isolate FASTAs

**Question:** Should an isolate's ambiguous positions be visible in a FASTA as IUPAC codes rather than only as `N`?

Reference-consensus writes only `A`, `C`, `G`, `T`, and `N` into `results/isolates/{isolate}/consensus.fasta` (consensus Task 4.1). An ambiguous position (enough reads, but no allele reaching `min_allele_fraction`) and an uncallable position (too few reads) both become `N`, so the FASTA alone loses that distinction and the competing alleles: a biallelic SNP with `A=55%, G=45%` could be written as `R`. The run keeps this evidence in `all-sites.bcf` (per-allele depth) and `callable-mask.bed` (the reason for every `N`), and cohort aggregation reads those rather than the FASTA, so nothing is lost for voting. The gap only affects someone who uses the isolate FASTA on its own.

Take this up only when a concrete downstream use needs it. A likely answer is a separate diagnostic `consensus.iupac.fasta` beside the unchanged `A/C/G/T/N` FASTA, restricted to biallelic ambiguous SNPs, because IUPAC cannot express indels, a three-allele code says little, and downstream tools treat IUPAC codes inconsistently in a haploid sequence. Making the representation a configuration option would change the saved configuration schema. Decide together with the IUPAC rendering of the cohort consensus in [Task 4.3](resources/concepts/consensus/4c-combined-consensus-generation.md).

## Advanced LiftOn controls

The first annotation-transfer workflow uses one pinned same-species profile without researcher-facing LiftOn tuning. Revisit advanced controls only if baseline results demonstrate a concrete need.

Potential controls include minimum alignment coverage, minimum sequence identity, extra-copy search, selected feature types, and chromosome correspondence. Before exposing any of them, verify the exact semantics and defaults of the pinned LiftOn release, define how the setting affects Liftoff- and miniprot-derived evidence, and preserve rejected or additional mappings as diagnostic candidates rather than automatic biological conclusions.

## Browser-based HTML reports

Static browser reports are deferred until workflow selection, configuration, execution, progress, live logs, completion metrics, and result presentation work reliably in the TUI.

A later reporting layer may use React and Chart.js to present interactive summaries for completed runs. It must consume the same versioned JSON and TSV metrics produced for the TUI rather than reimplementing scientific calculations in JavaScript. Reports should be self-contained static artifacts where practical, retain links to authoritative result and provenance files, and clearly identify generated, imported, and cached inputs.

Potential capabilities include:

- per-stage duration and resource charts;
- LiftOn mapped, unmapped, duplicated, rescued, and validation summaries;
- comparisons between compatible run directories;
- report opening and export from the TUI;
- optional specialist genome views, such as JBrowse, when aggregate charts are insufficient.

## Future TUI capabilities

### General

- [ ] Offer manual installation instructions followed by a `Check again` action.
- [ ] Add a `Repair tooling` path for previously installed but missing or incompatible tooling.
- [ ] Add explicit approval and coherent-bundle validation before supporting external tooling from `PATH`.

### Workflow cancellation

- [ ] Propagate cancellation to Snakemake, wait for child-process cleanup, and preserve logs before exiting.

Deferred rather than unstarted: `executeSnakemakeRun` already spawns Snakemake
detached as its own process group and, on abort, sends `SIGTERM` to that group
with a `SIGKILL` fallback, closing and flushing both log streams either way. The
execution screen aborts on unmount, so quitting the application does terminate a
running workflow.

What is missing is the deliberate part: no key cancels a run from the execution
screen, and the application does not wait for Snakemake to finish unlocking its
working directory and cleaning up partial outputs before the process exits. A
run interrupted that way can therefore leave a stale `.snakemake` lock that the
next run must recover from.

Take this up with resume, since the two share the same question of what an
interrupted run directory should look like when it is opened again.

### Interactive-decision manifest contract

Workflow-manifest schema version 1 supports the current non-interactive annotation-transfer workflow and contains no interactive-decision fields. Do not predict an execution contract before a workflow actually needs one.

When implementation reaches the first consensus decision boundary, define the smallest manifest and saved-decision contract required by that concrete workflow. At that point, decide whether explicit Snakemake targets, stage references, or another mechanism is necessary, update the schema version deliberately, and add migration or compatibility handling for persisted manifests. Snakemake must remain the execution authority; the TUI must not become a second scheduler.

Potential additions after the core run/resume/presentation interface works:

- direct GFF3 correction and review screens;
- integration with an external genome-annotation editor;
- field-level curated-claim review;
- catalog search and Git source management;
- source and target FASTA validation dashboards;
- richer resource monitoring;
- local and HPC profiles;
- container execution;
- immutable demonstration snapshots for teaching and presentations.

Interactive decisions remain outside Snakemake rules. The TUI saves decisions, and deterministic commands or rules apply them.

### Managed tooling version updates

- [ ] Detect newer releases of the Snakemake, Conda, and Pixi versions pinned in `src/tooling/policy.ts`. Dependabot covers npm, GitHub Actions, and the conda environments under `workflows/shared/envs/`, but cannot read these TypeScript constants; a scheduled check or a custom update manager could propose bumps that still require validation.

### Isolate catalog

Follow-ups from the review of the first isolate-catalog implementation:

- [ ] Make stale-lock recovery in `src/file-lock.ts` race-free. When two processes find the same stale lock, both remove it, and the slower one can delete the lock the faster one just created, so both proceed. The catalog's revision check narrows but does not close the window. Shared with tooling setup.
- [ ] Reload the catalog automatically after a save is refused because another window changed it, instead of leaving the list stale until the researcher presses `r`.
- [ ] Detect one read file reached through different paths across isolates, not only within one: symlinks and hard links, and differently cased paths on case-insensitive filesystems such as the macOS default.
- [ ] Replace fixed keystroke delays in `tests/ui/isolates-screen.test.tsx` with waits on injected callbacks or rendered state, so the suite does not become flaky on slower CI runners.

### Illumina import: provider processing reports

The Illumina importer (consensus Task 1b) suggests raw or trimmed reads from read lengths only. Parsing BaseSpace processing reports was implemented, evaluated against a real delivery, and dropped because read lengths alone classified every pair correctly and no current delivery needs more. Findings for a later attempt:

- A processing app writes `ReportStats.json`, `ReportMetadata.json`, `Readme.txt`, and `ResourceUsageLog.txt` into a dataset folder named after the **input** sample (`<input>-ds.<hex id>`), without FASTQ files. The processed FASTQ files sit in a separate dataset folder named after the **output** sample (`<output>-ds.<hex id>`, e.g. an `adq30ft` suffix), and keep the input's file names.
- `ReportMetadata.json` explicitly names `inputSampleName` and `outputSampleName`; this, not `ReportStats.json`, is the reliable link to the processed dataset folder.
- `ReportStats.json` holds `version`, `command`, a `parameters` object (`fastq`/`fastq2` input paths and every trimming and filtering option, with empty strings and `"False"` for unused ones), read and base counts before and after processing (`inputreadpairs`, `outputreadpairs`, …), and per-length histograms.
- The app merges all lanes of a sample into one output file per mate while keeping a single-lane name such as `_L001_`. In a multi-lane delivery the importer would then treat that file as a copy of lane 1 although it holds every lane; choosing it together with raw reads of another lane would count those reads twice. A report whose input files differ from the processed pair's names detects this.
- Output sample names repeat across deliveries, so linking must prefer a report in the same parent folder as the processed dataset and flag ambiguous matches.
- File sizes are not evidence: processed copies were about 15% smaller here, but gzip compression settings change sizes as much.

Revisit when a multi-lane delivery with processed copies appears, or when raw reads are already adapter-trimmed during demultiplexing so that read lengths no longer tell raw and processed copies apart.

## Run verification command

Researchers should be able to inspect and rerun a released workflow without repository access. Every run records package and workflow versions, workflow checksums, effective configuration, input/output checksums, reference versions, tool versions, commands, logs, events, timestamps, and platform.

A later verification command may distinguish:

1. integrity verification through checksums;
2. reproduction with the same inputs and versions;
3. scientific inspection of readable methods and parameters.

npm distributes software; it does not replace transparent workflows, provenance, pinned environments, or access to required scientific inputs.

## Manual annotation review and correction

Any LiftOn-produced GFF3 may require review for genes that appear shifted, inserted, deleted, split, merged, duplicated, or structurally changed. These are candidate interpretations, not automatic conclusions:

- a coordinate shift can result from an upstream insertion or deletion rather than biological gene movement;
- an unmapped LiftOn feature is not automatically a confirmed gene deletion;
- LiftOn transfers known genes but does not discover genuinely novel genes;
- short-read coverage loss is evidence but not proof of gene absence;
- repetitive regions make gene and transposon placement difficult.

Later decide whether review and correction should be supported directly by the Ink TUI or delegated to a specialist genome-annotation editor. Any correction workflow must preserve:

- the unmodified LiftOn output;
- exact assembly and GFF3 checksums;
- the affected feature IDs;
- the original and selected structures or values;
- reviewer, timestamp, rationale, and supporting evidence;
- valid GFF3 IDs, `Parent` relationships, coordinates, strands, and CDS phases;
- reproducible export of the corrected GFF3.

Manual corrections must never modify the nucleotide consensus without independent sequencing evidence.

## Optional curated annotation from external workbooks

Curated Excel data may improve a LiftOn GFF3 after the final consensus exists. The core workflows must remain complete if such files never arrive.

Final coordinate-based integration requires:

- the resolved consensus FASTA that will receive the annotation;
- the original workbook or source annotation;
- the exact source assembly FASTA on which coordinates are based;
- source assembly metadata and checksums;
- permission to use unpublished or restricted data;
- recorded mappings and review decisions.

Do not assume one workbook layout before representative files exist. A contributor may provide one record per gene, separate sheets for genes and transcripts, only names and functions, coordinates, proteins, transcripts, free-text notes, or meaningful formatting.

### Responsibility boundary

```text
Researcher
  -> interactive importer/TUI
  -> immutable source package and saved mapping decisions
  -> deterministic normalization
  -> Snakemake annotation integration
  -> reviewed GFF3 export
```

The interactive application interprets ambiguous source structure with the researcher. Snakemake consumes already recorded decisions and runs deterministic normalization, integration, validation, and export.

### Source packages

Use one portable package per contributed dataset:

```text
curation/sources/<dataset-id>/
├── original/
│   └── curated-genes.xlsx
├── metadata.yaml
├── mapping.yaml
├── reviewed-decisions.tsv
└── checksums.sha256
```

A package may contain several related files if all are listed in its metadata. Preserve original workbooks unchanged because formulas, comments, colors, hidden sheets, or merged cells may carry meaning.

Example metadata:

```yaml
schema_version: 1

dataset:
  id: CURATION-0001
  title: Curated nitrogen-metabolism genes
  labels:
    - aspergillus-nidulans
    - nitrogen-metabolism
    - gene-structure
    - experimentally-validated

files:
  - path: original/curated-genes.xlsx
    sha256: "..."
    role: primary-annotation

contributors:
  - id: person-jane-smith
    name: Jane Smith
    orcid: 0000-0000-0000-0000
    roles:
      - curator
      - data-provider
    affiliation:
      name: University of Example
      ror: https://ror.org/...

organism:
  scientific_name: Aspergillus nidulans
  taxon_id: 162425

annotation_context:
  assembly_accession: null
  assembly_version: null
  coordinate_system: unknown
  chromosome_naming: unknown
  access: restricted

license: CC-BY-4.0
contact: jane.smith@example.org
```

Labels are user-defined search metadata and should use normalized lowercase kebab-case where practical. Organism, assembly, contributor, institution, licence, and access remain dedicated structured fields rather than labels alone.

### Catalog and Git federation

Treat source packages as a searchable catalog. Keep authoritative metadata beside each source and generate a disposable search index. A local catalog may combine project-local packages and multiple Git repositories.

```text
Local catalog
├── project-local packages
├── University A repository
└── University B repository
```

The TUI may later add, clone, fetch, pin, remove, search, and verify repositories. Index by labels, organism, contributor, institution, source assembly, annotation category, validation status, licence, publication, and received date.

A curation repository may contain:

```text
curation-repository/
├── curation-catalog.yaml
├── sources/
│   ├── CURATION-0001/
│   └── CURATION-0002/
└── README.md
```

Record remote URL and exact Git commit. Excel files can be committed when permitted and reasonably small. If Git LFS is used, validation must detect missing LFS objects rather than interpreting pointer files as workbooks.

Remote repositories and workbooks are untrusted data. Do not execute macros, formulas, Git hooks, or repository scripts during catalog loading. Reject path traversal, handle symbolic links cautiously, and require explicit trust before executing external code.

### Public and restricted sources

Support `public`, `restricted`, `embargoed`, and `local-only` access. Never put unpublished source genomes, workbooks, or other restricted material in public Git or npm without permission.

Public software can contain schemas, synthetic fixtures, workflows, and permitted checksums. Restricted data belongs in collaborator-controlled repositories, institutional storage, or local paths. Without authorized access to the exact source FASTA, another researcher can inspect methods and integrity records but cannot reproduce coordinate transfer.

### Deferred validation

Workbook and metadata validation can occur before a source or target FASTA exists. Validate readability, checksums, worksheets, headers, mappings, identifier syntax, coordinate shape, strand normalization, duplicates, and internal parent-child relationships.

Mark sequence-dependent checks as blocked until the correct FASTA exists: sequence-ID existence, coordinate bounds, sequence extraction, CDS phase and translation, start and stop codons, assembly gaps, and coordinate transfer.

Every check and subcheck has a structured result:

```yaml
status: blocked
reason: Coordinate validation requires the exact source FASTA.
code: source_reference_missing
checked_at: 2026-08-31T10:15:00Z
validator:
  name: coordinate-validator
  version: 2026.8.0
prerequisites:
  - source_fasta
issues: []
```

Persisted statuses are `pending`, `blocked`, `passed`, `failed`, and `skipped`. Warnings are structured issues rather than statuses. Store reports separately because results depend on source checksum, mapping, Git revision, FASTA, validator version, and time. Mark old reports stale when that context changes.

### Interactive mapping and canonical claims

The importer should inspect workbook sheets, columns, sample values, formulas, merged cells, comments, and hidden content. It may suggest mappings, but the researcher confirms column meanings, chromosome aliases, identifier types, strands, coordinate conventions, and exclusions.

Do not convert every row directly to GFF3. Normalize into a genome-agnostic intermediate claim model:

```text
claim_id
dataset_id
source_file
source_sheet
source_row
source_assembly
target_gene
property
value
feature_type
parent_id
seqid
start
end
strand
phase
contributor_id
evidence_type
publication_id
comment
```

Classify claims as structural annotation, functional annotation, identifier mapping, sequence evidence, review note, or unresolved data. Missing information is never invented.

### Multiple sources, collisions, and attribution

Normalize each source independently before merging:

```text
Excel A -> claims A --┐
Excel B -> claims B --+-> conflict review -> integrated annotation
Excel C -> claims C --┘
```

Detect duplicate IDs, missing parents, unknown sequences, out-of-bounds coordinates, incompatible models, one-to-many and many-to-one mappings, conflicting names/functions, invalid strands, and invalid CDS phase/frame.

Preserve field-level provenance because structure, name, function, and status may come from different scientists:

```text
final_feature_id
field
value
dataset_id
claim_id
contributor_id
evidence_type
decision_id
```

Conflict decisions record selected and rejected claims, reviewer, date, and rationale. Rejected claims remain preserved. Compatible support from multiple sources credits every contributor.

The GFF3 `source` column may say `integrated`, and compact source IDs may appear in custom attributes, but companion provenance files remain authoritative because GFF3 cannot fully represent field-level attribution.

Possible exports:

```text
exports/
├── integrated/
│   ├── annotation.gff3
│   ├── feature-provenance.tsv
│   ├── contributors.tsv
│   ├── decisions.tsv
│   └── unresolved-conflicts.tsv
└── by-source/
    ├── CURATION-0001.gff3
    └── CURATION-0002.gff3
```

A workbook containing only functions or notes may not support a standalone GFF3 but can still enrich unambiguously linked integrated features.

Contributor metadata supports names, ORCID, roles, affiliations, laboratories, ROR, publications, licences, and citations. Generate attribution suitable for acknowledgements, publication citations, and `CITATION.cff`; do not infer publication authorship automatically.

### Reproducible merge manifests

Labels help discovery, but a merge freezes exact dataset IDs, repository revisions, and checksums:

```yaml
schema_version: 1
merge:
  id: ANIDULANS-ANNOTATION-2026-01

target:
  fasta: references/consensus.fasta
  sha256: "..."

sources:
  - dataset_id: CURATION-0001
    repository: https://example.org/curation-a.git
    revision: 4d08e4c
    workbook_sha256: "..."
```

Never define a reproducible merge as whichever datasets currently carry a label.

## Advanced comparative genomics

A comparison workflow needs its own concept first. Its first contract should define only the compatibility fields needed to compare two runs (input checksums, workflow and tool versions, effective scientific parameters, and standardized metrics) and then add its manifest; browser visualization is deferred.

The first comparison remains intentionally small. Possible later analyses include:

- semantic initial-versus-final GFF3 comparison;
- gene presence/absence with explicit evidence categories;
- split, merged, duplicated, or novel gene candidates;
- isolate-level structural-variant calling;
- isolate-specific transposon insertion candidates;
- copy-number changes;
- richer synteny and rearrangement visualization;
- comparative biosynthetic-cluster boundary and gene-content analysis;
- miniprot evidence for divergent or unmapped source proteins;
- BRAKER-based de novo gene-model confirmation when justified by suitable evidence.

Short Illumina reads provide limited evidence in repetitive regions and for large novel insertions. Candidate structural differences should not be described as confirmed without suitable evidence or isolate assemblies.
