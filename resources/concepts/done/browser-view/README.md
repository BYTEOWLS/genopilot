# Browser view

## Goal

Show what a terminal cannot show well in a local browser tab that the CLI opens and leads: the help documents, genomes with their evidence, charts, and large tables. One key press opens the view; the files stay where they are, nothing is uploaded or imported into a standalone tool, and every chart or table can be downloaded with its provenance.

The container knows no workflow and no kind of content in particular. It provides the tab, the connection to the CLI, navigation, guidance, decision drafting, downloads, and the server. **Kinds** fill its main area:

| Kind | Library | Concept | State |
|---|---|---|---|
| `document` | none; the existing Markdown parser | [document.md](document.md) | first; the help documents, and the kind the container is built with |
| `genome` | [igv.js](https://github.com/igvteam/igv.js) | [genome.md](genome.md) | accession catalog development preview implemented; next the review of unresolved consensus loci, then the [annotation review](../../annotation-review.md) |
| `chart` | [Mantine charts](https://mantine.dev/charts/getting-started/) with [Recharts](https://recharts.org/) | sketched below | later; run metrics, durations, LiftOn summaries |
| `table` | none | sketched below | later; tables too large or wide for the terminal |

This takes over the interactive part of [Browser-based HTML reports](../../../later.md#browser-based-html-reports); static, self-contained report files stay deferred there.

## Principles

- **The CLI leads.** The browser is a second view of the CLI's state. Every browser interaction is a request the CLI validates and turns into a state change; the page only shows what the CLI sends back, so the CLI's selection and the view never drift apart.
- **Nothing leaves the machine.** The page is served from `127.0.0.1`, loads its libraries from the installed package, and is barred from any other origin by its Content Security Policy.
- **No science in the browser.** Charts and tables show the values the workflows recorded (their JSON and TSV); the page never recalculates them. What it computes is presentation only: layout, sorting, zoom.
- **Read-only on files.** The server never writes next to what it shows; what a file lacks, such as a FASTA index, it builds in memory. Downloads go to the browser's download folder through its save dialog.
- **Decisions are saved in the CLI.** The browser may draft; only a CLI screen saves.
- **Generic.** Shared code (`src/browser/`, the provider, `docs/`) names no workflow. A workflow or catalog contributes a view builder next to its own code, such as `src/workflows/<id>/views.ts`.

## The view contract

A **view** is everything one tab shows at a time:

```ts
type BrowserView = {
  /** Stable for the same content, so showing it again only moves the selection instead of rebuilding. */
  id: string;
  title: string;
  /** Where it comes from, such as the run and iteration; shown in the header and in every download. */
  provenance: ViewProvenance;
  content: DocumentContent | GenomeContent | ChartContent | TableContent;
  /** An ordered list the CLI navigates, such as unresolved loci or a table's flagged rows. */
  items?: {name: string; entries: ViewItem[]};
  /** Actions the opening screen accepts from the browser; see Decision drafting. */
  actions?: ViewAction[];
  /** The Markdown the guide panel shows: a packaged document and one of its sections. */
  guide?: {document: string; section: string};
};
type ViewItem = {
  id: string;
  label: string;
  /** Where the item is in the content: a locus for a genome, a row key for a table, a point for a chart. */
  target: unknown;
  /** What the item card shows, as the CLI's detail view shows it. */
  details?: {title: string; rows: {label: string; value: string}[]}[];
};
type ViewProvenance = {
  application: {name: string; version: string};
  run?: {id: string; name?: string; workflow: {id: string; version: number}};
  /** The records the content was read from, run-relative where they belong to a run. */
  sources: {label: string; path: string; sha256?: string}[];
};
```

Each kind defines its `content` and what its items' `target` is. Paths are absolute and resolved by the builder; the browser only ever sees opaque IDs.

## Opening from the CLI

A screen offers a view only when it can build one, with one shared key, `v — View in browser`, from a shared constant so it is the same everywhere. Like `h — Home`, the key is ignored while a text field has focus, so typing a `v` into a reason never opens a view. Pressing it calls `show(view, {selectedItemId}, handlers)` on the app-wide provider:

- the first call starts the server and opens the default browser; the CLI shows the URL in any case, because over SSH there is no local browser and the researcher forwards the port;
- a later call with the same view ID only moves the selection; another view replaces the tab's content;
- when no tab is connected, the next call opens one again, so closing the tab is harmless.

One tab shows one view at a time. Opening another view, such as the help in the middle of a review, replaces the current one; pressing `v` again on the review screen rebuilds the review at the CLI's selected item, which the CLI kept all along, so nothing of the review is lost but the browser's own zoom and track choices. A shared status line in the CLI shows the tab's state (`starting`, `open at <URL>`, `waiting for the browser`, `failed: <reason>`) and what the last browser request did, such as `Browser selected locus 12 of 40`, so changes made in the browser never surprise the researcher returning to the terminal.

## Interaction from the browser

The page talks to the CLI through the same server: `POST` requests from the page, Server-Sent Events from the CLI. Both need only Node built-ins.

### Navigation

- **Previous and next** item: the page asks; the CLI moves its selection in its own list, with its own filter and order, and sends back the item to show.
- **Select an item** in the content, such as a locus in the genome or a row in a table: the CLI selects it and may open its detail.
- **Follow the view**: when the researcher moves onto an item, the CLI highlights it.

Navigation goes only to the screen that opened the view (its `onSelectItem` handler). When that screen is no longer shown, the page still works on its own but says that the CLI list is not open. Kinds add their own navigation, such as region selection in a genome.

### Decision drafting

A view may declare actions its screen accepts:

```ts
type ViewAction = {id: string; label: string; target: string; note: 'none' | 'optional' | 'required'};
```

`target` names what the action applies to, as the kind defines it, such as `item`, `track-group`, or `region` in a genome. The page offers the action there. Choosing one sends the action ID, its target, and the researcher's note; the opening screen's `onAction` handler adds it to its **draft**, and the CLI answers with the outcome, which the page shows (`added to the draft`, `refused: …`).

The draft is the CLI's ordinary unsaved state, such as the cohort review form. It must live in a screen that stays mounted while the view is open, so actions arriving from the browser always have a draft to go to; for the cohort review, that is the run's result screen rather than the review form, as [genome.md](genome.md#decision-drafting) describes. Nothing is saved from the browser: the researcher saves in the CLI, where the draft is shown with everything it contains and the usual validation runs. The first actions belong to the [genome kind](genome.md#decision-drafting).

### What stays in the CLI

Starting, rerunning, or cancelling Snakemake; saving decisions or catalogs; writing files other than downloads; and leaving the application. The page has no command for these.

## Page

The page is GenoPilot's own frame around the kind's main area. Libraries such as igv.js offer every feature with little guidance; the frame knows why the view was opened and says so. A first sketch, to iterate on, here with a genome:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ GenoPilot · Run 2026-09-30 · Iteration 2     ● connected       [Theme ◐]  │
│ ◀ Prev   Tie 12 of 40 · chr3:1,204,551   Next ▶      View: [Votes ▾]     │
├───────────────────────────────────────────────┬──────────────────────────┤
│                                               │ THIS LOCUS               │
│   main area of the kind                       │ Tie · A 4 votes, G 4     │
│   (genome, chart, or table)                   │ backbone: A (voted)      │
│                                               │ ambiguous: iso-7         │
│                                               │                          │
│                                               │ WHAT TO CHECK            │
│                                               │ ☐ Depth & allele fraction│
│                                               │ ☐ Strand balance  [show] │
│                                               │ ☐ Mapping quality [show] │
│                                               │                          │
│                                               │ HOW TO READ THIS ▸       │
├───────────────────────────────────────────────┴──────────────────────────┤
│ Draft: exclude iso-7 · 2 notes        Save the draft in GenoPilot (r)    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Header**: the view's title and provenance, the connection to the CLI, previous and next with the position in the CLI's list (`12 of 40`), and the kind's own controls, such as a genome's view selector. The theme icon is the last control. Documents have no download menu; scientific exports below remain future work.
- **Item card**: the selected item's `details`, the same facts as the CLI's detail view.
- **Guide**: the view's `guide` section, rendered from Markdown. For a review it is a checklist of what to look at, each step optionally with a `show` button the kind defines, such as a genome view that colors reads by strand. The checkboxes help the researcher and are never saved. The text belongs to the source's documentation, such as a section of a workflow's `results.md`, so it is written for researchers, follows the documentation subset, and changes without code.
- **How to read this**: a collapsible legend per kind, as a general page in `docs/`, such as what igv.js's colors and marks mean or how a chart's axes and error bars are drawn.
- **Draft tray**: what the opening screen's draft holds now, as the CLI reports it, with the reminder that it is saved in GenoPilot. Shown only when the view has actions.
- **Visible states**: loading, a missing source with its path, content the kind cannot show, and a disconnected CLI, never a blank area.
- **Keys**: `n` and `p` for the next and previous item, `?` for the legend, matching the CLI where it has the same action.
- **Usable without color** for the frame, as in the terminal; a kind's own color encoding, such as nucleotides or chart series, is explained in its legend.

The page is a small React application under `src/browser/page/`, built for the browser by the same esbuild step as the [bundled package](../../bundled-package.md) into `dist/vendor/browser/`. Each kind is a component of its own, loaded only when a view of that kind is shown.

### Design and themes

Use [Mantine](https://mantine.dev/) for a modern, restrained frame: clear typography, subtle borders, and color reserved for meaningful states. Its ready-made accessible components and built-in theme handling keep custom UI code small; libraries and styles are bundled locally. Charts use Mantine's Recharts-based charts package, not Chart.js. Mantine and Recharts are MIT-licensed.

- A single **theme icon**, last in the header, cycles **Automatic → Light → Dark → Automatic**. The monitor, sun, and moon icons show the preference; its tooltip and accessible name describe the current mode and the next one. Automatic is the default and follows `prefers-color-scheme`, including changes while the page is open. Remember the choice in browser-local storage when available; unavailable storage must not prevent theme switching. This is a presentation preference, not a saved workflow setting.
- Apply theme tokens consistently to the frame, documents, tables, and charts. Check contrast, focus indicators, tooltips, and disabled states in both themes. Genome-library styling is checked separately; do not invert scientific imagery or alter its nucleotide and evidence colors to fake a dark theme.
- Print and downloaded images use a legible light background independently of the page theme, preserving meaningful series and evidence colors.
- **Desktop and smaller laptops**, not phones, are the design target. The main area flexes with the window; the guide and item sidebar can collapse, secondary header controls move into menus, and wide tables scroll horizontally. Keep genome tracks useful rather than squeezing them to fit. At reduced widths and browser zoom, controls remain reachable and content never overlaps.
- Test theme selection, automatic theme changes, unavailable storage, keyboard navigation, and the compact layout alongside the visible states.

## Downloads

Document views have no download menu or source-download endpoint. Printing and saving PDF use the browser's normal Print command. For future scientific kinds, exports remain a separate, unimplemented step, generated from exactly what the CLI sent:

| Kind | Downloads |
|---|---|
| `genome` | the current view as SVG and PNG (igv.js renders both) |
| `chart` | PNG; the chart's data as TSV; XLSX with the data, the chart as an image, and an *About* sheet |
| `table` | TSV of the rows shown, TSV of all rows, XLSX with the rows and an *About* sheet |

- **Provenance travels with the file.** The file name carries the run ID and view ID (`<run>_<view>.<ext>`). An image gets a footer line with the source, the run, and GenoPilot's version; an XLSX gets an *About* sheet with the full `provenance`, including each source's path and checksum. A download is a presentation, not a result: the authoritative records stay the workflow's JSON and TSV.
- **XLSX through [ExcelJS](https://github.com/exceljs/exceljs).** ExcelJS writes cells, styles, and images but not native Excel charts. A chart therefore goes into the workbook as an image beside its data, from which a researcher can build an Excel chart. If native charts become a demonstrated need, choose a library for them then.
- **Sources as they are.** Where a view is read from a file, such as a workflow's TSV, the menu also offers that file unchanged, served by its opaque ID.
- **Loaded on demand.** ExcelJS is large (about 1 MB minified, to measure) and only needed when an XLSX is requested, so esbuild splits it into its own file that the page loads on the first XLSX download.

## Server

- `node:http` on `127.0.0.1`, port 0, so the operating system picks a free port; no custom hostname, because the tab is always opened from the CLI.
- A random token as the first path segment of every URL. A request is refused when it lacks the token, when its `Host` header is not the loopback address and port, or when it carries an `Origin` header other than the page's own. Every `POST` must carry the page's `Origin`. Browsers send no `Origin` when the tab loads the page or the page reads files from its own server, as igv.js does, so plain reads rely on the token and the `Host` check. This keeps other local users' processes and other websites open in the same browser out, including through DNS rebinding.
- Files are served only by opaque ID from the current view, never by a path from the request, and support `Range` requests (206, `Content-Range`). Data the CLI prepared, such as chart values or a page of table rows, is served as JSON by the same kind of ID.
- Browser requests are a closed set (`navigate`, `select-item`, `action`, and each kind's own, such as a genome's `region`) with validated bodies: known item and action IDs, the kind's target syntax, and a bounded note length.
- Content Security Policy `default-src 'self'`, widened only by what the libraries need (for example inline styles, `blob:` workers, or `blob:` URLs for downloads), and never to another origin.
- One server per CLI process, started lazily and closed on exit and on cancellation; the page then shows that the CLI has disconnected.

## Packaging

The page's libraries are exact-version development dependencies; nothing is added at runtime.

- React, `react-dom`, Mantine core and hooks, Mantine charts with Recharts, and ExcelJS are bundled into the page by esbuild; chart code is loaded with its kind and ExcelJS as a separate file loaded on demand. Mantine styles and the page's CSS are bundled into a local CSS asset; no CDN or runtime styling service is used.
- Import only the Mantine components the current view needs. Add Mantine charts and Recharts with the first chart kind, not with the initial document view. Dependencies are pinned exactly, and bundled packages' license texts are included in the package.
- igv.js uses the full npm development package during integration; no minified-file extraction is needed. Its release browser bundle and license collection belong to [Bundled package](../../bundled-package.md); see [genome.md](genome.md#packaging).
- Every bundled or copied library is listed in `THIRD-PARTY-LICENSES.md`, as the [bundled package](../../bundled-package.md) describes.

Until the bundled package exists, retain the current page build beside the TypeScript output. Development integration may use installed development dependencies; do not add library-specific release-copy steps ahead of the packaging task.

## Later kinds

These are sketches so the container fits them; each kind gets its own concept when its first screen needs it.

**Chart.** Values a workflow recorded, as rows with named columns, plus a declarative description of the chart type and which columns become axes and series. The page renders these through Mantine's Recharts-based chart components, with theme-aware axes, legends, and tooltips; the contract contains no executable callbacks or library-specific configuration. Items are data points or categories, such as one stage in a duration chart, so the CLI can select what was clicked. PNG downloads rasterize the rendered SVG on a light background, including the provenance footer; the same image goes into XLSX. The first candidates are the open run-metrics task (durations and resources per stage) and LiftOn's mapped, unmapped, and rescued summaries.

**Table.** Columns with labels and types, and rows read by the server from a workflow's TSV (bgzip included) in pages, so a table of hundreds of thousands of rows never loads whole. Sorting and filtering are on the server, by one linear pass per request until measurements ask for an index. Items are rows by key, such as a site's locus, so a table can drive a genome view: selecting a row in the CLI or the browser can open its locus in the genome kind.

## Out of scope

- Uploading or opening files from the browser; everything comes from a CLI view.
- Editing sequences, annotations, or tables in the browser.
- Saving decisions, settings, or catalogs from the browser.
- Several tabs at once; one tab follows the CLI.
- Static report files that open without GenoPilot ([later](../../../later.md#browser-based-html-reports)).
- Native Windows; WSL follows the [Windows task](../../../tasks.md#windows-support-last), where opening the browser needs `wslview` or `explorer.exe`.

## Release scope

The current document and read-only genome views, including Sites navigation, are sufficient for the next release. Remaining browser work is deferred to the [follow-up checklist](../../browser-view-follow-up.md), starting with researcher requirements. Existing verification limitations remain documented in [compatibility findings](compatibility-findings.md); release packaging remains a separate active task.

## Completed scope

- Local server, provider, shared CLI shortcut/status, and document view.
- Read-only genome views for verified accessions and run-result evidence, with Range handling, track controls, themes, and help.
- Sites navigation synchronized between CLI and browser, with recorded evidence cards, locus markers, and presentation presets.
- Researcher documentation for the implemented views.

The sections above retain the original design, including capabilities not yet implemented. Decision drafting, exports, additional kinds and sources, and remaining verification are tracked in the separate [follow-up concept](../../browser-view-follow-up.md), not as completed work here.
