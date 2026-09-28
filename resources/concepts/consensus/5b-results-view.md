# Task 5.2 — Results view

## Goal

Present a completed or partly completed reference-consensus run in the TUI: the backbone, every isolate's results, the cohort outputs of every iteration, and help for the scientific terms. Today the application interprets results of annotation-transfer runs only.

Depends on the iteration contract of [Task 5.1](5a-cohort-iterations.md).

## Kickoff decisions

- **No new workflow output.** The reader in `src/workflows/reference-consensus/results.ts` reads what the workflow already persists: `config.yaml`, the `isolates.yaml` snapshot, `provenance/backbone.fasta.json`, each isolate's `metrics.json` and `promotion-candidate.json`, each cohort's `support-summary.json` and `consensus-summary.json`, the saved decisions, `provenance/run.json`, and `provenance/cohort/iteration-<n>.json`. There is no run-level `summary.json` as in annotation transfer, and no Snakemake rule is added. The reader requires each record's `schema_version` 1 and rejects what it cannot interpret per record, so one unreadable file never hides the rest.
- **Dispatch.** `loadWorkflowResult` in `src/workflows/results.ts` returns a compatible result for either workflow, discriminated by workflow ID and version; unknown identities stay `unsupported-workflow`. The linked-path list that the shell and run discovery count as missing comes from the loaded result instead of from annotation-transfer fields, because this is the second workflow that needs it.
- **Derived states, not a scientific status.** An isolate is `completed` when its promotion candidate exists, otherwise `incomplete`: as in [Task 5.1](5a-cohort-iterations.md#kickoff-decisions), a missing candidate cannot tell failed from interrupted, so the view says so and links the isolate's logs. A cohort iteration is `completed` when its provenance exists and its recorded decision checksum matches the saved decision, `pending` when a decision is saved without provenance (not run yet, or interrupted), and `invalid` when its decision or provenance cannot be read or disagrees. The initial cohort is `completed` when `provenance/run.json` exists. The run's discovery status is `completed` when any iteration is completed and `incomplete` otherwise.
- **Active iteration.** The highest-numbered completed iteration. When the initial cohort was never aggregated, the view states it together with the reason of the first decision and the `initial_cohort.aggregated: false` of its provenance.
- **Screen.** The existing `RunResultsScreen` shell keeps run metadata, the execution outcome, the run files, and `?` help, and renders a tabbed body for reference consensus, with the tab bar under the title:
  - **Overview**: the backbone (source, accession or file name, checksum, origin, whether it votes in the active iteration), the active iteration's voting method, settings, and voters, and its counts: loci selected and unresolved by reason (tie, no majority, no votes, too few callable isolates), multiallelic and competing-indel loci, and bases written as `N` or IUPAC codes.
  - **Isolates**: one row per selected isolate from the run's snapshot, with wild-type status, `derived_from`, processing state, mean depth, callable fraction, PASS SNPs and indels, whether it votes in the active iteration, and whether a promotion candidate is available. Enter opens the isolate's detail with the paths to its BAM, VCF, callable mask, FASTA, metrics, provenance, promotion candidate, and logs; Esc returns to the list.
  - **Iterations**: one row per iteration with its state, date, voters, and reason; the selected iteration's settings, paths (support tables, consensus FASTA, consensus sites, summaries, decision, provenance, logs), and its comparison.
  - **Files**: run-level records (`config.yaml`, `isolates.yaml`, `artifacts.yaml`, `provenance/run.json`, input validation, logs).
- **Comparison.** The inspected iteration is compared with the first aggregated cohort, `initial` or the first completed iteration when the initial one never ran: the same counts as on the overview in two columns and their difference. Comparing arbitrary pairs of iterations is not needed yet.
- **Promotion.** The isolate list shows *promotion candidate available* when the candidate parses and its FASTA and index exist. The files are not hashed when a run opens; checksum verification and the *already saved to the isolate catalog* state belong to [Task 5.4](5d-saved-isolate-sequences.md), which introduces saved sequences.
- **Snapshot metadata.** Wild-type status and `derived_from` come from the run's `isolates.yaml`, never from the current catalog, so a later catalog edit changes nothing in the view.
- **Help.** Longer explanations live in `src/workflows/reference-consensus/result-help.ts`, keyed by stable item IDs and bound to `reference-consensus` version 1, as for annotation transfer: callability states, locus and why overlapping variants form one ballot, every support flag, every unresolved reason, the voting methods, the backbone vote, `N` and IUPAC bases, iterations and the active one, and the isolate and iteration states. Every item ID the view renders has a help entry.
- **Out of scope.** Rows of the support and consensus-site tables are not rendered; navigating them is [Task 5.3](5c-review-and-rerun.md). Large files are neither read nor hashed; only the small decision files are hashed.

## Initial results

Show:

- backbone identity, source, checksum, and whether it cast a vote;
- all analyzed isolates with wild-type/lineage metadata and QC/callability summaries;
- direct paths to each isolate's BAM, VCF, callable mask, consensus FASTA, metrics, and logs;
- whether each isolate FASTA has a promotion candidate; whether it is already saved in **Manage isolates**, and the action itself, are [Task 5.4](5d-saved-isolate-sequences.md);
- configured voting method and participating voters;
- selected, unresolved, tied, multiallelic, no-call, and competing-indel counts;
- paths to the support table, initial cohort FASTA, diagnostics, provenance, and complete logs.

Labels state their counting unit and remain presentation-only. Machine-readable artifacts are authoritative.

The help for scientific terms explains a locus that spans several bases, why overlapping variants of different isolates form one ballot, and every support flag, so the results stay understandable without a bioinformatics background.

## Iterations

The result screen makes the active iteration clear and allows earlier iterations to be inspected. The active iteration is the highest-numbered one whose provenance exists. A run whose initial cohort was never aggregated states so and why, from the first iteration's decision and provenance. Initial and reviewed ambiguity summaries can be compared.

Changing an isolate's catalog metadata after the run does not rewrite the run snapshot or its decisions.

## Work

- [x] Record the kickoff decisions.
- [x] Read reference-consensus results in `src/workflows/reference-consensus/results.ts`: snapshot, backbone, per-isolate metrics and candidates, every cohort's summaries, decisions, and provenance, with the derived isolate and iteration states and the active iteration.
- [x] Dispatch both workflows in `src/workflows/results.ts`, and take the linked paths for the shell and run discovery from the loaded result.
- [x] Render the tabbed body: overview, isolates with detail, iterations with comparison, and files.
- [x] Add the help entries for every rendered item and the scientific terms.
- [x] Update the workflow README's status and the CHANGELOG.
- [x] Test the reader against synthetic run directories: a completed run, missing generated artifacts, an unsupported record schema, a run with an excluded failed isolate whose initial cohort never ran, pending and invalid iterations, and a decision checksum mismatch; and the screen: tab and isolate-detail navigation, iteration selection and comparison, help coverage of rendered IDs, and resizing.

## Acceptance

A researcher can understand the initial cohort result and every later iteration, and find each artifact, log, and provenance record.
