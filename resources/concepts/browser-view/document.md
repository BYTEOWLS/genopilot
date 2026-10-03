# Document view

The `document` kind of the [browser view](README.md): the help documents a CLI screen shows, rendered in the browser. It needs no library and no files beyond the packaged documentation, which makes it the kind the container is built with first.

## Why

The terminal shows the documentation well enough to look something up, but some of it reads poorly there:

- **Wide tables**, such as a workflow README's outputs and `## Tools` tables or the `| Item | Meaning |` tables of `results.md`, wrap into tall columns.
- **Links** are shown as their text only.
- **Reading at length**, such as a workflow's science before a run, is easier with a browser's typography, outline, and search.
- **Printing**: a researcher may want a workflow's README as a PDF, for example for a methods section.

## Content

The documents the CLI screen already loaded, in the same order, and which one is open:

```ts
type DocumentContent = {
  kind: 'document';
  /** The documents of the screen, as `readGeneralDocuments` and `readWorkflowDocuments` return them. */
  documents: {id: string; title: string; blocks: Block[]}[];
  openId: string;
};
/** A view item's target in a document: a heading, by its anchor. */
type DocumentTarget = {documentId: string; anchor: string};
```

The view's `items` are its documents, in the order of the screen's tabs, so choosing one in either window is ordinary item selection. The view's `provenance` names GenoPilot's version and, for a workflow's documents, the workflow and its version. A document view has no `actions`.

## Rendering

The browser renders the blocks of the existing parser (`src/docs/markdown.ts`), not the Markdown again. The parser is pure TypeScript without Node imports, so the page bundles it as it is, and both renderers show exactly the [documentation subset](../done/workflow-documentation.md#format). The packaged-docs test that keeps every document within the subset covers both.

- A second renderer, `src/browser/page/document/`, maps each block to HTML elements with React: headings with anchors, paragraphs, lists, tables, code blocks, and alerts with their names (`Note`, `Tip`, `Warning`), so they read without color as in the terminal.
- Links need their target, which the parser drops today because the terminal shows only the text. The `link` span gains an `href`; the terminal keeps ignoring it.
- A link to another packaged document, such as from `docs/README.md` to `help.md`, opens that document in the same tab when it is one of the view's documents, and otherwise shows its path. An external link, such as a reference's DOI, opens in a new browser tab with `rel="noopener noreferrer"`; that is navigation by the researcher, not a request of the page, so the Content Security Policy is unaffected.
- React escapes every text, so a document can never inject markup.

## Page

What the document kind adds to the container's [page](README.md#page):

- **Contents**: the view's documents as a side list, like the tabs of the terminal's document page, and the open document's `##` and `###` headings as an outline.
- **Search**: the browser's own find; no search index.
- **Print**: a print stylesheet without the frame, side list, and connection state, with the provenance as a footer line, so the browser's print dialog produces a clean PDF.
- **Downloads**: the open document's original Markdown file, unchanged.

## Opening from the CLI

Every screen that shows documents today offers the shared `v — View in browser` key with the same documents: the welcome screen's help index, the workflow selection, a run's result help, and the import review. A document view follows the CLI: switching the document tab in the terminal switches it in the browser, and choosing a document in the browser's side list switches the terminal's tab, as `select-item` does for any view's items.

The guide panel and the per-kind legends of the container render Markdown sections with the same renderer.

## Work

1. The `href` on links in the parser, with tests; the terminal renderer unchanged.
2. The HTML renderer and the document kind, with tests for every block, links within and outside the view, escaping, and the print stylesheet.
3. The `v` key on the four screens that show documents, routed through the provider.
