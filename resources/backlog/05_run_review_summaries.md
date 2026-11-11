# Shorten run-review summaries

## Outcome

Researchers can scan chosen settings before a run without rereading the workflow's explanations and examples.

## Scope and contract

- Workflow-owned review sections show concise effective values, including voting and read-set/preprocessing choices; shared screens do not interpret scientific settings.
- Workflow Markdown help owns explanations and worked examples. Keep it reachable from review rather than repeating it there.
- Preserve exact commands, input identity, warnings, and scientific decision distinctions. This is a presentation change, not a change to defaults, snapshots, validation, or execution.

## Acceptance criteria

- [ ] Review exposes the effective choices in short summaries, with explanatory prose available in help.
- [ ] Distinct scientific choices remain distinguishable without relying on color or truncated values.
- [ ] Warnings and the exact execution command remain visible; narrow terminals remain usable.
- [ ] Reviewing and saving identical inputs produces unchanged configuration and scientific behavior.
