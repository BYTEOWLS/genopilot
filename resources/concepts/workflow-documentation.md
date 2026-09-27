# Workflow documentation

## Goal

Every packaged workflow explains its science to researchers: its inputs, parameters, steps, decisions such as read groups and callability, and outputs. The same text is readable on GitHub and inside GenoPilot, and it is not part of the repository README, which covers installation and development.

## Format

- One Markdown file per workflow, `workflows/<id>/README.md`, next to its manifest. GitHub shows it when the directory is browsed, and the npm package already ships it with the workflow. [`reference-consensus`](../../workflows/reference-consensus/README.md) has one.
- A workflow's documentation changes together with its rules: a change to a step, a default, an output, or a pinned tool updates the README in the same change.
- It describes the science and the files, not TUI usage (screens, keys), just like the repository README.

Only a Markdown subset is used, so the terminal can render it without a Markdown library:

- `#`, `##`, and `###` headings;
- paragraphs, one per line;
- `-` bullet lists and `1.` numbered lists, one level;
- pipe tables with a header row;
- fenced code blocks;
- inline `code` and `**bold**`.

No HTML, images, nested lists, or footnotes. Links are allowed but shown as plain text in the terminal, so the text around a link must make sense without following it.

## In-app display

Ink renders text, not Markdown. Raw Markdown is readable in a terminal, but tables with long cells wrap into unreadable pipes, and GenoPilot's layouts are expected to adapt to the terminal width.

Render the subset above with a small built-in parser that maps each block to Ink elements: headings to bold text, lists to indented rows, tables to the existing `Table` component, and code blocks to a bordered box like the help page's examples. No runtime dependency is added: `marked` and `marked-terminal` would bring in a dependency tree for a subset this small.

The page is found by convention next to the manifest that discovery already resolved; the manifest gets no new field. A workflow without a README shows that no documentation is available.

Open it where a researcher decides or interprets:

- from the workflow selection when a new run is created;
- from a run's results, next to the existing result help.

The viewer scrolls like `HelpPage` and is built on `Page`.

## Work

- [x] Write the reference-consensus README.
- [ ] Write the annotation-transfer README.
- [ ] Add the Markdown-subset renderer with tests for every supported block, wrapping, narrow terminals, and unsupported syntax shown as plain text.
- [ ] Add the workflow documentation page and open it from workflow selection and run results.
- [ ] Add a test that every packaged workflow's README uses only the supported subset.
