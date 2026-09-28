# Task 5.2 — Results view

## Goal

Present a completed or partly completed reference-consensus run in the TUI: the backbone, every isolate's results, the cohort outputs of every iteration, and help for the scientific terms. Today the application interprets results of annotation-transfer runs only.

Depends on the iteration contract of [Task 5.1](5a-cohort-iterations.md).

## Initial results

Show:

- backbone identity, source, checksum, and whether it cast a vote;
- all analyzed isolates with wild-type/lineage metadata and QC/callability summaries;
- direct paths to each isolate's BAM, VCF, callable mask, consensus FASTA, metrics, and logs;
- whether each isolate FASTA is eligible for promotion or already saved in **Manage isolates** (the action itself is [Task 5.4](5d-catalog-owned-genomes.md));
- configured voting method and participating voters;
- selected, unresolved, tied, multiallelic, no-call, and competing-indel counts;
- paths to the support table, initial cohort FASTA, diagnostics, provenance, and complete logs.

Labels state their counting unit and remain presentation-only. Machine-readable artifacts are authoritative.

The help for scientific terms explains a locus that spans several bases, why overlapping variants of different isolates form one ballot, and every support flag, so the results stay understandable without a bioinformatics background.

## Iterations

The result screen makes the active iteration clear and allows earlier iterations to be inspected. The active iteration is the highest-numbered one whose provenance exists. A run whose initial cohort was never aggregated states so and why, from the first iteration's decision and provenance. Initial and reviewed ambiguity summaries can be compared.

Changing an isolate's catalog metadata after the run does not rewrite the run snapshot or its decisions.

## Work

- [ ] Load reference-consensus results through an explicit reader in `src/workflows/results.ts`, with per-isolate, support, consensus, and iteration artifacts.
- [ ] Present completion metrics, artifacts, iterations, and help for scientific terms.
- [ ] Load every iteration, including failure, interruption, and incompatible-artifact states.
- [ ] Compare initial and reviewed ambiguity summaries.
- [ ] Add tests for missing generated artifacts, a run with an excluded failed isolate, iteration comparison, and resizing.

## Acceptance

A researcher can understand the initial cohort result and every later iteration, and find each artifact, log, and provenance record.
