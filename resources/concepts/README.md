# Concepts

One folder per concept: `concept.md` owns durable decisions; `tasks.md`, where present, owns ordered implementation work. Read both before changing a feature.
[Release plans](../releases/README.md) select what ships; [later.md](../later.md) holds unscheduled work.

Update status and task checkboxes with behavior changes. Status is **not started**, **in progress**, or **done**; a proposed design is not implementation progress.
After the last required step, retain the folder under `completed/` and update all links. Picking up a follow-up reopens the folder and adds a task.

## Open concepts

| Concept | Status | Work |
|---|---|---|
| [AI-assisted interpretation](ai-interpretation/concept.md) | not started | [Tasks](ai-interpretation/tasks.md); deferred |
| [Annotation formats](annotation-formats/concept.md) | not started | [Tasks](annotation-formats/tasks.md) |
| [Annotation ID rewriting](annotation-id-rewriting/concept.md) | not started | [Tasks](annotation-id-rewriting/tasks.md) |
| [Annotation review decision](annotation-review-decision/concept.md) | not started | [Tasks](annotation-review-decision/tasks.md) |
| [Browser view follow-up](browser-view-follow-up/concept.md) | not started | [Tasks](browser-view-follow-up/tasks.md); deferred, browser tests remain parked |
| [INSDC submission](insdc-submission/concept.md) | not started | [Tasks](insdc-submission/tasks.md); read preparation depends on sequencing read sets |
| [Project website](project-website/concept.md) | not started | [Tasks](project-website/tasks.md) |
| [Public release](public-release/concept.md) | in progress | [Tasks](public-release/tasks.md); foundations shipped, environment locks remain |
| [Remote execution](remote-execution/concept.md) | not started | [Tasks](remote-execution/tasks.md) |
| [Reruns](reruns/concept.md) | in progress | [Tasks](reruns/tasks.md); cohort iterations shipped, general reruns deferred |
| [Run export](run-export/concept.md) | not started | [Tasks](run-export/tasks.md) |
| [Saved isolate sequences](saved-isolate-sequences/concept.md) | not started | [Tasks](saved-isolate-sequences/tasks.md); extends the sequencing-read-set catalog contract |
| [Sequencing read sets](sequencing-read-sets/concept.md) | not started | [Tasks](sequencing-read-sets/tasks.md); planned for [0.0.3](../releases/0.0.3/02_sequencing_read_sets.md) |
| [Workflow modules](workflow-modules/concept.md) | not started | [Tasks](workflow-modules/tasks.md) |
| [Zenodo release archiving](zenodo-release-archiving/concept.md) | not started | Setup and release-flow decisions; no implementation checklist yet |

## Completed concepts

Completed means the recorded implementation scope, not every original design idea. Remaining browser and annotation follow-ups have their own open concepts.
Existing supporting step files are retained as contract and implementation history.

| Concept | Status | Record |
|---|---|---|
| [Annotation review](completed/annotation-review/concept.md) | done | [Tasks](completed/annotation-review/tasks.md) |
| [Annotation-transfer results](completed/annotation-transfer-results/concept.md) | done | Implemented slices and compatibility contract |
| [Annotation-transfer workflow](completed/annotation-transfer-workflow/concept.md) | done | Workflow design and delivery slices |
| [Browser view](completed/browser-view/concept.md) | done | [Tasks](completed/browser-view/tasks.md); verification limits remain explicit |
| [Bundled package](completed/bundled-package/concept.md) | done | [Tasks](completed/bundled-package/tasks.md) |
| [Citing runs](completed/citing-runs/concept.md) | done | Version and citation contract |
| [Community files](completed/community-files/concept.md) | done | Contribution and security policies |
| [Cohort consensus](completed/consensus/concept.md) | done | [Tasks](completed/consensus/tasks.md) and retained step files |
| [Systems check](completed/systems-check/concept.md) | done | [Tasks](completed/systems-check/tasks.md); included in [0.0.3](../releases/0.0.3/done_01_system_check.md) |
| [Transfer genome view](completed/transfer-genome-view/concept.md) | done | [Tasks](completed/transfer-genome-view/tasks.md) |
| [Workflow documentation](completed/workflow-documentation/concept.md) | done | [Tasks](completed/workflow-documentation/tasks.md) |
