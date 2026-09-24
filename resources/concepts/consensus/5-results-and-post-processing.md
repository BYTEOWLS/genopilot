# Task 5 — Results and post-processing

## Goal

Present the complete initial run, make ties and supporting evidence reviewable, save post-run voting decisions, and rerun only cohort aggregation and dependent outputs after isolates are excluded or the voting method changes.

## Initial results

Show:

- backbone identity, source, checksum, and one-vote policy;
- all analyzed isolates with wild-type/lineage metadata and QC/callability summaries;
- direct paths to each isolate's BAM, VCF, callable mask, consensus FASTA, metrics, and logs;
- whether each isolate FASTA is eligible for promotion or already saved in **Manage isolates**;
- configured voting method and participating voters;
- selected, unresolved, tied, multiallelic, no-call, and competing-indel counts;
- paths to the support table, initial cohort FASTA, diagnostics, provenance, and complete logs.

Labels state their counting unit and remain presentation-only. Machine-readable artifacts are authoritative.

## Review action

From a completed result, the researcher can open a review screen that:

- lists currently voting isolates with name, stable ID, wild-type status, `derived_from`, QC, coverage, and callable fraction;
- filters or navigates tied/no-majority SNPs and competing indels while showing backbone and per-isolate support;
- allows whole isolates to be included or excluded from voting;
- allows strict-majority/plurality to be changed;
- previews how many unresolved sites the proposed decision would create or resolve when this can be calculated from the support table;
- requires a reason before saving a changed voting set or method.

Exclusion is global for the cohort iteration, not a hidden site-by-site choice. At least one isolate remains selected for voting in addition to the backbone. Lineage and wild-type metadata inform the researcher but never make the decision automatically.

## Saved decision and rerun

Save a versioned decision before invoking Snakemake:

```yaml
schema_version: 1
iteration: 2
voting_method: plurality
voting_isolates:
  - isolate-a
  - isolate-c
excluded_from_voting:
  - isolate-b
reason: Excluded isolate-b after failed coverage review.
created_at: 2026-01-01T13:00:00.000Z
```

The rerun targets support aggregation, consensus generation, validation, metrics, and result summaries only. It reuses all per-isolate artifacts. Preserve the initial result and every reviewed iteration in separate, checksummed locations rather than overwriting diagnostic evidence. The result screen makes the active iteration clear and allows earlier iterations to be inspected.

Changing an isolate's catalog metadata after the run does not rewrite the run snapshot or its decision. Saving a result to the catalog copies it into managed storage using Task 4.1's validated promotion manifest; scientific outputs never depend on that user-local action.

## Post-processing actions in scope

- Inspect per-isolate and cohort artifacts.
- Open tie/disagreement review.
- Save a new voting subset and/or voting method.
- Dry-run and execute only affected Snakemake targets.
- Compare initial and reviewed ambiguity summaries.
- Explicitly save selected generated isolate FASTAs into catalog-owned storage.
- Resume an interrupted post-processing rerun.

Annotation transfer, legacy-reference comparison, repeat analysis, antiSMASH, and manual site editing are later concepts rather than actions hidden inside this task.

## Work

- [ ] Define the versioned decision and consensus-iteration directory contracts.
- [ ] Extend the result schema with per-isolate, support, initial-consensus, and iteration artifacts.
- [ ] Present completion metrics, artifacts, catalog-promotion state, and help for scientific terms.
- [ ] Implement tie/disagreement navigation and whole-isolate voting selection.
- [ ] Implement voting-method changes and an evidence-based before/after preview.
- [ ] Validate and atomically save a reasoned decision before preparing the rerun.
- [ ] Invoke explicit Snakemake targets without implementing a scheduler in TypeScript.
- [ ] Preserve and load every iteration, including failure, interruption, resume, and incompatible-artifact states.
- [ ] Add tests for exclusion, method changes, no-op decisions, retained upstream artifacts, iteration comparison, catalog promotion, resizing, cancellation, and complete logs.

## Acceptance

A researcher can understand the initial cohort result, save validated isolate FASTAs into durable catalog-owned storage, identify why positions are unresolved, exclude a poorly suited isolate or change voting policy with a recorded reason, and produce a new traceable consensus without rerunning any isolate's QC, alignment, callability, or variant calling.
