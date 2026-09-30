# Workflow documentation

## Goal

All documentation a researcher reads is Markdown, readable on GitHub and inside GenoPilot from the same files. Every packaged workflow explains its science and its results itself; the general documentation and the repository README never describe a workflow beyond listing it, so a new workflow adds files in its own directory and changes nothing shared.

## Files

A workflow contributes by convention, next to the manifest that discovery already resolved; the manifest gets no new field:

- `workflows/<id>/README.md` explains the science: inputs, parameters, steps, scientific decisions such as read groups and callability, outputs, a `## Tools` table of the pinned rule tools, including shared environments the workflow uses, and references.
- `workflows/<id>/results.md` explains the workflow's result page: one `##` section per result tab or section, each an `| Item | Meaning |` table in the order of the page, plus tables of the values a status or class can take, including the workflow's own run status.
- `workflows/<id>/development.md`, optional, holds maintainer notes such as what a tool upgrade must re-verify. It is neither shown in the application nor packaged.

The general documentation in `docs/` never names a workflow or a tool only one workflow uses:

- `docs/README.md` is the entry point on GitHub; it links the general pages and the `workflows/` directory.
- `docs/help.md` is the in-app help: what GenoPilot does, runs, catalogs, and the key and mouse conventions.
- `docs/import-review.md` explains the isolate import review.
- `docs/run-results.md` explains the run metadata and run files every workflow's result page shows.

The repository README lists the supported workflows under `## Workflows`, each linked to its README with one plain sentence, and otherwise covers installation and development only. TUI usage is documented in `docs/`, not in the README.

A workflow's documentation changes together with its rules: a change to a step, a default, an output, a result item, or a pinned tool updates its README or results page in the same change.

## Format

Only a Markdown subset is used, so the terminal can render it without a Markdown library:

- `#`, `##`, and `###` headings;
- paragraphs, one per line;
- `-` bullet lists and `1.` numbered lists, one level;
- pipe tables with a header row;
- fenced code blocks;
- GitHub alerts: a blockquote starting with `> [!NOTE]`, `> [!TIP]`, or `> [!WARNING]`;
- inline `code`, `**bold**`, and links.

No HTML, images, other blockquotes, nested lists, or footnotes. Links are shown as their text in the terminal, so the text around a link must make sense without following it.

## In-app display

Ink renders text, not Markdown. A small built-in parser maps each block to Ink elements; no runtime dependency is added, because `marked` and `marked-terminal` would bring in a dependency tree for a subset this small. Headings, inline code, and alerts are colored, and every element also keeps a cue that works without color: bold, indentation, bullets, or a border. Tables use the `Table` component, whose last column wraps aligned; unsupported syntax is shown as plain text so nothing is lost.

Help pages show whole documents rather than entries per result item: a researcher looks up the label they see in a table grouped like the page. One document page shows one or more documents as tabs named by their `#` headings, scrolls like the rest of the application, and is built on `Page`. It is opened:

- from the welcome screen's Help, as an index of topics: GenoPilot, then one per discovered workflow;
- from the workflow selection when a new run is created, with the highlighted workflow's README;
- from a run's results, with the workflow's results page and the general run results page;
- from the import review, with the import review page.

A missing file shows that no documentation is available.

## Work

- [x] Write the reference-consensus README.
- [x] Write the annotation-transfer README.
- [x] Add the Markdown-subset parser and renderer with tests for every supported block, wrapping, narrow terminals, missing color, and unsupported syntax shown as plain text.
- [x] Move the in-app help texts into `docs/` and each workflow's `results.md`, and replace the structured help model with the document page.
- [x] Add the documentation index and open documents from workflow selection, run results, and the import review.
- [x] Remove workflow specifics from the repository README and list the supported workflows.
- [x] Add a test that every packaged document uses only the supported subset, that `docs/` names no workflow, and that the README lists exactly the discovered workflows.
