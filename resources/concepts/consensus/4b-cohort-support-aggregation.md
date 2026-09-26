# Task 4.2 — Cohort support aggregation

## Goal

Combine the backbone and Task 4.1's per-isolate callable calls into a deterministic support table without yet choosing the final cohort base.

## Voting evidence

At each relevant backbone position:

- the backbone contributes one vote when `consensus.include_backbone_vote` is true, and none otherwise;
- each selected isolate contributes one allele vote only when that position and call pass the configured callability filters;
- an uncallable or filtered isolate contributes no vote;
- an unchanged isolate contributes a backbone-allele vote only when the position is proven callable;
- isolate coverage depth never creates multiple votes;
- aggregation is independent of isolate-list order.

Use normalized VCF plus callable masks as authority. The generated isolate FASTAs are validation and reuse artifacts, not the aggregation input, because a copied backbone base in a FASTA may represent a no-call and indels can shift sequence coordinates.

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

## Rerun boundary

The initial table includes every isolate selected for analysis. Task 5 may supply a saved voting subset; aggregation must be able to regenerate from existing Task 4.1 artifacts without rerunning QC, alignment, or calling. Preserve the initial all-selected support output when a reviewed decision creates a later iteration.

## Work

- [ ] Define the versioned support-table and summary schemas for SNPs, multiallelic sites, and normalized indels.
- [ ] Implement callable reference-allele votes rather than treating missing VCF rows as evidence by themselves.
- [ ] Add the configured backbone contribution (one vote or none) explicitly to provenance and output.
- [ ] Make aggregation deterministic across isolate ordering and repeated runs.
- [ ] Emit ambiguity, callability, and allele-frequency summaries without selecting a winner.
- [ ] Add synthetic tests for no-calls, low-quality calls, all-reference sites, multiallelic sites, normalized equivalent indels, competing indels, and one or many isolates.
- [ ] Verify direct Snakemake targeting and reuse of all Task 4.1 outputs.

## Acceptance

Every downstream cohort base can be traced to an explicit backbone or callable-isolate vote. Missing evidence never becomes an implicit reference vote, and changing only the voting subset does not rerun per-isolate processing.
