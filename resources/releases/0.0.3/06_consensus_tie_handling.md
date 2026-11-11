# Settle reference-consensus ties

## Outcome

Researchers can let the backbone or a trusted isolate settle tied loci, either in the run configuration or in a later cohort iteration, which reuses every per-isolate result.

## Scope and contract

- Two cohort settings in `consensus`, in the run configuration and in every cohort decision:
  - `tie_source`: `none` (default, today's behavior), `backbone`, or `isolate` with `tie_isolate: <id>`.
  - `tie_scope`: `tied-alleles` (the source's allele wins only if it is one of the tied alleles) or `any-allele` (it wins even with fewer votes or none).
- Only `tie` loci change. `no_votes`, `few_callable`, and `no_majority` keep their decisions; plurality and a minimum of 0 already address them.
- The source's allele: the backbone allele of the support table, also when the backbone vote is off; the trusted isolate's vote at the locus. Without one (backbone base not `A/C/G/T`; isolate ambiguous, uncallable, or unsupported there), the locus stays `tie`.
- A settled tie is `selected` with reason `tie_broken` (one of the tied alleles) or `tie_overruled` (another allele), under both voting methods, also with half the votes or fewer. Its votes stay in `consensus-sites.tsv.gz`; `consensus-summary.json` records the settings and counts both reasons.
- An iteration runs the existing cohort steps unchanged: it aggregates its own support and regenerates the consensus. Its provenance records the tie settings.
- `tie_scope` is always saved, with default `tied-alleles`; `tie_isolate` is saved only with `isolate`. With `tie_source: none` the duplicate-decision check ignores both.
- Validation stays in the application: `tie_isolate` is a selected isolate in the run configuration and a voting isolate in a decision. Excluding the trusted isolate in the cohort review is reported on save; nothing changes automatically. The duplicate-decision check compares the new settings.
- Parameter definitions gain an `in: [...]` condition for `visible_when`, so `tie-scope` shows for both sources. The trusted isolate is picked in the forms' existing choice rows; in the new-run form, an `options_from: isolates` choice offers the IDs of the currently selected isolates and follows changes to the selection.
- The results overview counts and the Sites filter shows `tie_broken` and `tie_overruled`.
- A settled tie is written as a plain base, so downstream steps such as the annotation transfer do not flag it, and `tie_overruled` can write an allele without votes. The overview count and `consensus-sites.tsv.gz` are its record.
- The new-run vote preview shows a broken and an overruled tie, with a backbone allele and a trusted isolate's vote in its examples.
- The workflow README and `results.md` explain the settings in plain language for researchers: what a tie is, what each source and scope does, worked examples for both scopes and a tie that remains, and that a settled tie looks like any other base downstream.
- The citation methods sentence states how ties were settled, including that with `any-allele` the source's allele can win without being among the leaders.

## Acceptance criteria

- [ ] With `tie_source: none`, consensus outputs are unchanged.
- [ ] `tied-alleles` settles a tie only when the source's allele is tied; `any-allele` settles it whenever the source has an allele; both record the reason and keep the votes.
- [ ] A tie where the source has no allele remains `tie`; `no_votes`, `few_callable`, and `no_majority` loci are unaffected.
- [ ] A decision that changes only tie settings runs as an iteration without reprocessing any isolate; its provenance records the settings.
- [ ] Invalid tie settings are rejected by the application with field-level messages.
- [ ] Help explains the settings and their downstream effect in plain language, with worked examples.
- [ ] The new-run and cohort review forms show `tie-scope` and `tie-isolate` only when they apply; the results view counts and filters both reasons.
- [ ] Python tests cover both scopes, both sources, a remaining tie, and deterministic output; TypeScript tests cover validation, the duplicate-decision check, and the `in` condition.
