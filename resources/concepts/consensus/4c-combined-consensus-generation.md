# Task 4.3 — Combined consensus generation

## Goal

Interpret Task 4.2's support evidence with the configured voting method and produce the initial T2T-backed cohort consensus plus unresolved-site diagnostics.

## Voting methods

The required single-select configuration supports:

- `strict-majority`: an allele wins only with more than half of all votes cast at the position;
- `plurality`: the unique allele with the highest vote count wins.

Examples:

| Votes | Strict majority | Plurality |
|---|---|---|
| `A=6, C=4` | `A` | `A` |
| `A=5, C=5` | unresolved | unresolved |
| `A=4, C=3, G=3` | unresolved | `A` |
| `A=4, C=4, G=2` | unresolved | unresolved |

Both methods operate on votes already filtered by Task 4.2. There is no coverage weighting, and the backbone has weight one.

## Consensus and diagnostics

Produce:

- the initial cohort-consensus FASTA;
- a machine-readable record for every selected and unresolved site;
- SNP tie/no-majority counts and allele support;
- separate competing-indel diagnostics;
- callable-isolate and total-vote summaries;
- affected sequence IDs and coordinates;
- complete checksums and provenance linking the support table, voting method, backbone, and selected isolates.

Before implementation, finalize how unresolved SNPs appear in the diagnostic FASTA (`IUPAC`, `N`, or retained backbone with a mandatory report), how unresolved indels are represented, and the minimum callable-isolate requirement. Never silently turn uncertainty into a concrete publication base.

The result is described as a cohort consensus that may combine alleles from different isolates. It is not represented as the genome of one individual or as de novo/T2T assembly.

## Work

- [ ] Finalize unresolved-SNP, unresolved-indel, and minimum-callability policies.
- [ ] Implement strict-majority and plurality interpretation against the same support schema.
- [ ] Generate and validate the diagnostic consensus FASTA without losing sequence identifiers or unsupported regions.
- [ ] Emit versioned selected-site, unresolved-site, and summary outputs.
- [ ] Record all effective policies and input/output checksums in provenance.
- [ ] Add synthetic tests for each voting example, missing calls, multiallelic SNPs, ties, indels, deterministic output, and a backbone-only region.
- [ ] Verify that changing only the voting method reuses Task 4.1 and support evidence where valid and reruns only interpretation and dependent summaries.

## Acceptance

The initial combined FASTA and every unresolved site are reproducible from the saved support table and configuration. Strict-majority and plurality results differ only where their documented rules require them to differ.
