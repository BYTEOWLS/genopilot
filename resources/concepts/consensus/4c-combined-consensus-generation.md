# Task 4.3 — Combined consensus generation

## Goal

Interpret Task 4.2's support evidence with the configured voting method and produce the initial T2T-backed cohort consensus plus unresolved-site diagnostics.

Voting, IUPAC codes, and the cohort consensus are explained for researchers in the [workflow README](../../../workflows/reference-consensus/README.md#cohort-consensus); the open IUPAC question for INSDC submission is in the [science background](science-background.md#open-point).

## Kickoff decisions

- **Evidence.** Only the support outputs and the backbone are read, so the consensus is reproducible from them and three settings: the voting method, `consensus.min_callable_isolates`, and `consensus.unresolved_snp`. Changing any of them reruns consensus generation alone.
- **Order of checks** at a locus, or a run of bases outside the loci where every vote is for the backbone base: no votes (`no_votes`); fewer voting isolates than the minimum (`few_callable`); then the method, which leaves a `tie` when several alleles share the highest count and `no_majority` otherwise.
- **Unresolved SNPs** are a researcher's choice, `n` (default) or `iupac`, because submission checks and downstream tools do not all accept IUPAC codes. `iupac` writes the code of every allele that received a vote, so `A=4, C=3, G=3` becomes `V`.
- **Unresolved indels** are fixed, not configurable: `N` for every base of the backbone allele. IUPAC cannot express an indel, and retaining the backbone allele would write a sequence the evidence does not support. The span keeps backbone coordinates there, and the competing alleles stay in the sites table.
- **Minimum callable isolates** is an integer parameter from 0 to the number of selected isolates, default 0, compared with the isolates that actually vote. Below it, a base or locus is `N`, also when the backbone voted. With 0, backbone-only bases keep the backbone base and are counted.
- **No votes** are written as `N`. A selected allele's base that is not `A/C/G/T`, which comes only from the backbone itself, is also `N`, so an IUPAC code in the consensus always means unresolved votes.
- **Coordinates.** Every sites row carries its backbone and consensus span; a chain file is deferred to [`later.md`](../../later.md#consensus-chain-file).
- **Outputs** in `results/cohort/initial/`: `consensus.fasta(.fai)`, `consensus-sites.tsv.gz(.tbi)` (one row per support locus and per run of unresolved bases outside the loci), and `consensus-summary.json`.

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

Both methods operate on votes already filtered by Task 4.2. There is no coverage weighting, and the backbone has weight one when `consensus.include_backbone_vote` is true and casts no vote otherwise. Define how a position without any vote is represented, which can happen only where the backbone does not vote: when its vote is off, or where its own base is not `A/C/G/T`. Task 4.2's votes at a locus are for whole alleles of the locus's span, so a winning allele replaces the whole span, and a tied locus is unresolved as a whole.

## Consensus and diagnostics

Produce:

- the initial cohort-consensus FASTA;
- a machine-readable record for every selected and unresolved site;
- SNP tie/no-majority counts and allele support;
- separate competing-indel diagnostics;
- callable-isolate and total-vote summaries;
- affected sequence IDs and coordinates;
- complete checksums and provenance linking the support table, voting method, backbone, and selected isolates.

Before implementation, finalize how unresolved SNPs appear in the diagnostic FASTA (`IUPAC`, `N`, or retained backbone with a mandatory report), how unresolved indels are represented, and the minimum callable-isolate requirement. Never silently turn uncertainty into a concrete publication base. Task 4.1 writes only `A/C/G/T/N` into isolate FASTAs, so IUPAC codes first become possible here: an unresolved SNP whose tied alleles are known, such as `A=5, G=5`, could be written as `R`. Decide at this task's kickoff whether IUPAC is the fixed representation or a researcher-selectable option.

The result is described as a cohort consensus that may combine alleles from different isolates. It is not represented as the genome of one individual or as de novo/T2T assembly.

## Work

- [x] Finalize unresolved-SNP, unresolved-indel, and minimum-callability policies.
- [x] Implement strict-majority and plurality interpretation against the same support schema.
- [x] Generate and validate the diagnostic consensus FASTA without losing sequence identifiers or unsupported regions.
- [x] Emit versioned selected-site, unresolved-site, and summary outputs.
- [x] Record all effective policies and input/output checksums in provenance.
- [x] Add synthetic tests for each voting example, missing calls, multiallelic SNPs, ties, indels, deterministic output, and a backbone-only region.
- [x] Verify that changing only the voting method reuses Task 4.1 and support evidence where valid and reruns only interpretation and dependent summaries.

## Acceptance

The initial combined FASTA and every unresolved site are reproducible from the saved support table and configuration. Strict-majority and plurality results differ only where their documented rules require them to differ.
