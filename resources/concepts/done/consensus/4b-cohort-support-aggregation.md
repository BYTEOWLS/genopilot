# Task 4.2 — Cohort support aggregation

## Goal

Combine the backbone and Task 4.1's per-isolate callable calls into a deterministic support table without yet choosing the final cohort base.

The ballots are explained for researchers in the [workflow README](../../../../workflows/reference-consensus/README.md#cohort-support).

## Kickoff decisions

- **Evidence.** Votes come from each isolate's normalized `variants.vcf.gz`, of which only `PASS` records count, and its `callable-mask.bed`. The isolate FASTAs are not used: indels shift their coordinates, `N` merges ambiguous and uncallable bases, equivalent indels are recognized only as normalized records, and a FASTA carries no evidence behind a base.
- **Loci.** `PASS` records of different isolates whose backbone spans overlap form one locus. Every voter's allele there is the locus's backbone sequence with its own records applied. A SNP inside another isolate's deletion, competing indels, and different SNPs at one base are therefore one ballot with at most one vote per voter. This is fixed behavior, not a configuration option, because it only represents the evidence and does not judge it; the workflow README explains it with an example for researchers without a bioinformatics background.
- **An isolate's vote.** It votes only when every base of the position or locus is `callable`; otherwise it is `ambiguous` when any base is ambiguous, and `uncallable` otherwise. A SNP and an indel the caller reports at the same position are combined into one allele. Its other overlapping records within a locus, or an allele with another base than `A/C/G/T` (a symbolic allele, for example), make it `unsupported`, without a vote.
- **The mask is authoritative.** A `PASS` record on a base the mask marks ambiguous, such as a SNP inside an ambiguous indel's span, casts no vote, just as the isolate FASTA shows `N` there. This settles the question Task 4.1 left open.
- **The backbone's vote.** One vote when `consensus.include_backbone_vote` is true, none otherwise, and never where its base is not `A/C/G/T`. Soft-masked bases are compared uppercase.
- **A failed isolate** blocks aggregation, because the rule depends on every selected isolate; excluding it is a Task 5.1 decision with a reason.
- **Determinism.** Contigs follow the backbone, positions ascend, isolate columns are sorted by ID, and alleles list the backbone allele first, then by votes and alphabetically. The support outputs carry no timestamps.
- **Voters** are every `selected_isolates` ID in the initial run. The script takes the voters as arguments, so Task 5.1 can pass a saved subset.
- **Configuration.** Only the backbone vote is read, so changing it reruns aggregation alone and changing the voting method does not.

## Voting evidence

At each relevant backbone position:

- the backbone contributes one vote when `consensus.include_backbone_vote` is true, and none otherwise;
- each selected isolate contributes one allele vote only when that position and call pass the configured callability filters;
- an uncallable or filtered isolate contributes no vote;
- an unchanged isolate contributes a backbone-allele vote only when the position is proven callable;
- isolate coverage depth never creates multiple votes;
- aggregation is independent of isolate-list order.

Use normalized VCF plus callable masks as authority. The generated isolate FASTAs are validation and reuse artifacts, not the aggregation input (see *Kickoff decisions*).

## Support output

Emit a versioned TSV (compressed and indexed if required by realistic genome size) containing enough information to reproduce the later decision, including:

- backbone sequence ID and coordinate;
- backbone allele and its vote;
- normalized observed alleles;
- callable/no-call state and allele for each selected isolate, or a stable link to a normalized per-isolate detail table;
- total callable isolate count;
- vote count per allele;
- participating isolate IDs;
- flags for multiallelic SNPs, indels, conflicting indels, and unsupported representation.

Do not force SNP and indel evidence into one lossy base column. IUPAC rendering and winner selection belong to Task 4.3.

The outputs, in `results/cohort/initial/`, use 1-based inclusive coordinates, are bgzip-compressed and indexed with tabix, and start with a `## schema_version: 1` line and a `#`-prefixed header:

- `support-sites.tsv.gz`, one row per locus: `chrom`, `start`, `end`, `backbone_allele`, `backbone_votes`, `alleles`, `allele_votes`, `callable_isolates`, `total_votes`, `flags` (`snp`, `indel`, `multiallelic`, `overlapping`, `competing_indel`, `unsupported`, `backbone_not_acgt`), and one `isolate:<id>` column per isolate holding its allele's index or `ambiguous`, `uncallable`, or `unsupported`;
- `support-intervals.tsv.gz`, every backbone base in runs of constant voter states: `chrom`, `start`, `end`, `backbone_votes`, `callable_isolates`, `ambiguous_isolates`, `uncallable_isolates`, and `states`, one letter per isolate (`c`, `a`, `u`) in the order of a `## isolates:` header line. Inside a locus, its row in the sites table is authoritative. The letters cost one byte per isolate and row, and the script updates only the isolates whose state changes at a boundary, so large cohorts stay fast;
- `support-summary.json`: voters, the backbone vote, input checksums, bases by callable isolates and by total votes, site counts per flag and of disagreeing loci, the allele frequency spectrum of biallelic loci, and per-isolate base and vote counts.

## Rerun boundary

The initial table includes every isolate selected for analysis. Task 5.1 may supply a saved voting subset; aggregation must be able to regenerate from existing Task 4.1 artifacts without rerunning QC, alignment, or calling. Preserve the initial all-selected support output when a reviewed decision creates a later iteration.

## Work

- [x] Define the versioned support-table and summary schemas for SNPs, multiallelic sites, and normalized indels.
- [x] Implement callable reference-allele votes rather than treating missing VCF rows as evidence by themselves.
- [x] Add the configured backbone contribution (one vote or none) explicitly to provenance and output.
- [x] Make aggregation deterministic across isolate ordering and repeated runs.
- [x] Emit ambiguity, callability, and allele-frequency summaries without selecting a winner.
- [x] Add synthetic tests for no-calls, low-quality calls, all-reference sites, multiallelic sites, normalized equivalent indels, competing indels, and one or many isolates.
- [x] Verify direct Snakemake targeting and reuse of all Task 4.1 outputs.

## Acceptance

Every downstream cohort base can be traced to an explicit backbone or callable-isolate vote. Missing evidence never becomes an implicit reference vote, and changing only the voting subset does not rerun per-isolate processing.
