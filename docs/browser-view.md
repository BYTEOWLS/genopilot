# Browser view

Open a document page in GenoPilot and press `v` to read the same documents in your browser. This works from Help, workflow selection help, result help, and import-review help. GenoPilot shows the URL in the terminal even if the browser could not be opened automatically; copy that URL into a browser when needed.

## Navigation

The browser's document list follows the terminal's document tabs. Selecting a document in the browser changes the terminal's tab while that document page remains open. Previous and Next, or `p` and `n`, move between documents. The outline jumps to headings within the open document; use your browser's Find command to search its text.

Contents collapses the sidebar to leave more reading space on a smaller laptop screen. The theme icon at the right end of the header cycles Automatic → Light → Dark → Automatic. A monitor means Automatic, a sun Light, and a moon Dark; the button's tooltip names the current mode and the next one. Automatic follows your operating system's preference, including changes while the page is open. The browser remembers your choice when local storage is available.

Opening another document page with `v` replaces the browser's view. Closing the tab is harmless; pressing `v` again reopens it. After leaving the terminal's document page, browser navigation no longer changes the terminal. The browser keeps the documents readable after GenoPilot exits.

## Printing

There is no download menu. Use your browser's normal Print command to print or save a PDF. Printing uses a light background and omits navigation and connection controls; the footer identifies GenoPilot and the source documents.

## Local connection

GenoPilot serves the page only on `127.0.0.1`, with a randomly chosen port and a secret path in the URL. The page's libraries and styles are included in the installed package; no document is uploaded. External reference links open a separate tab only when you choose them.

> [!WARNING]
> Treat the complete URL as private: its secret path grants access to the current document view. The server stops when GenoPilot exits. Do not expose the port on a public network.

## Remote terminals

Over SSH, the automatic opener runs on the remote machine, not your laptop. Forward the displayed port to the same port on your laptop, then open the exact URL GenoPilot displayed. Matching the ports is required by the server's Host check.

```text
ssh -L PORT:127.0.0.1:PORT user@host
```

Replace both occurrences of `PORT` with the displayed port. Keep the forwarding session open while reading. If that local port is already occupied, restart GenoPilot to obtain another port.

Genome, chart, table, and decision-drafting views are planned; this version shows documentation only.
