# Browser view

Open a document page in GenoPilot and press `v` to read the same documents in your browser. This works from Help, workflow selection help, result help, and import-review help. GenoPilot shows the URL in the terminal even if the browser could not be opened automatically; copy that URL into a browser when needed.

## Navigation

The browser's document list follows the terminal's document tabs. Selecting a document in the browser changes the terminal's tab while that document page remains open. Previous and Next, or `p` and `n`, move between documents. The outline jumps to headings within the open document; use your browser's Find command to search its text.

Contents collapses the sidebar to leave more reading space on a smaller laptop screen. The theme icon at the right end of the header cycles Automatic → Light → Dark → Automatic. A monitor means Automatic, a sun Light, and a moon Dark; the button's tooltip names the current mode and the next one. Automatic follows your operating system's preference, including changes while the page is open. The browser remembers your choice when local storage is available.

Opening another document page with `v` replaces the browser's view. Closing the tab is harmless; pressing `v` again reopens it. After leaving the terminal's document page, browser navigation no longer changes the terminal. The browser keeps the documents readable after GenoPilot exits.

## Genome views

Select a verified cached accession under Manage NCBI accessions and press `v` to view its sequence and available annotation. GenoPilot checks the recorded checksums again before opening; conflicting or damaged copies cannot be viewed. It does not download an accession just to display it.

Run-result screens can also offer genome views through the same `v` shortcut when their reference and provenance are available; each workflow's result help explains its entry points and coordinate system.

The genome view offers a chromosome/contig selector and overview, local region navigation, pointer-anchored wheel zoom, a crosshair, and an evidence/annotation track chooser. The `?` button opens a menu of reading topics, any current review guide, and source provenance; no footer or controls sit below the genome. See [Using the genome viewer](genome-view.md) for coordinates, annotation, and error states. Opening another view replaces the tab's content; pressing `v` again for the same unchanged genome preserves its zoom and track choices.

Review views can also offer a locus selector, Previous/Next (`p`/`n`), recorded item details, an evidence preset selector, and a review guide in the `?` help menu. Locus selection follows the opening CLI screen in both directions; panning is local and does not select a CLI item. Leaving that review disables browser item navigation. Choosing another locus or preset intentionally reapplies its evidence tracks and zoom; workflow result help explains the choices.

The genome viewer (IGV) is included in GenoPilot; if it is missing from an installation, the shortcut is marked unavailable rather than claiming the viewer is ready. Scientific exports and decision drafting remain planned.

## Copying a citation

Press `v` on a result page's Citation tab to open the run's citation, or use **Cite this run** in the header of any view opened from a run's results, which shows the citation in a dialog. Both offer a copy button for the whole citation and for each part, such as the methods paragraph, the reference list, BibTeX, and RIS. A button copies plain text without Markdown markup. If the browser refuses the clipboard, the button says so and shows the text selected for copying by hand.

## Printing

There is no download menu. Use your browser's normal Print command to print or save a PDF. Printing uses a light background and omits navigation and connection controls; the footer identifies GenoPilot and the source documents.

## Local connection

GenoPilot serves the page only on `127.0.0.1`, with a randomly chosen port and a secret path in the URL. The page's libraries, styles, and IGV are included in the installed package. Genome views read local files; nothing is uploaded. Default public-genome loading is disabled. IGV may attempt a remote fallback lookup after some loading errors; Content Security Policy blocks it, and external origins are never permitted. External reference links open a separate tab only when you choose them.

> [!WARNING]
> Treat the complete URL as private: its secret path grants access to the current view and any registered genome files. The server stops when GenoPilot exits. Do not expose the port on a public network.

## Remote terminals

Over SSH, the automatic opener runs on the remote machine, not your laptop. Forward the displayed port to the same port on your laptop, then open the exact URL GenoPilot displayed. Matching the ports is required by the server's Host check.

```text
ssh -L PORT:127.0.0.1:PORT user@host
```

Replace both occurrences of `PORT` with the displayed port. Keep the forwarding session open while reading. If that local port is already occupied, restart GenoPilot to obtain another port.

Chart, table, and decision-drafting views remain planned. After GenoPilot exits, documents stay readable; genome navigation may require sequence regions the stopped server can no longer serve.
