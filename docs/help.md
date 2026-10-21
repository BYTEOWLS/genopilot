# Using GenoPilot

GenoPilot helps you configure and run curated Snakemake workflows. It saves your settings, tracks progress, and shows results. Saved runs also work directly through Snakemake without GenoPilot.

## Runs

Choose a workflow and configure it. You can open its documentation from the workflow selection. The review shows available disk space, CPUs, and memory. Where supported, it estimates disk needs and warns if space may be insufficient. After the same workflow has completed on this machine, estimates use that run's measurements and include duration and peak memory. The review names the source run.

Start a dry run to preview Snakemake's jobs, or execute the workflow. Nothing is saved until a dry run or execution starts. Each run has its own directory with its configuration, results, and complete logs. Its provenance records commands, tool versions, checksums, and effective settings.

Open existing runs to view their results or delete them. The workflow list shows run counts, and the run list shows durations. Press `?` on a result page to learn what it shows.

Files copied into a run from outside are marked **imported**. Files the run computes are **generated**. Stages whose results are reused from elsewhere instead of computed are **cached**.

## Catalogs

- **Isolates** store isolate details and read-file paths for reuse across runs. Each entry records a name, wild-type status, and any parent isolate. You can import a sequencing delivery in one step.
- **NCBI accessions** store versioned assembly accessions, NCBI metadata, and locations of download caches. Workflows download an assembly only when a run needs it.

Catalogs are stored locally for your user. Runs save snapshots of the catalog entries they use, so later catalog edits do not change those runs. Removing an isolate from the catalog never deletes its read files.

## Tooling

At launch, GenoPilot checks that Pixi, Conda, Snakemake, and Python match its requirements. With your consent, it installs them in its own data directory without administrator rights. Snakemake creates each workflow step's pinned environment when first needed.

The tooling page shows GenoPilot's version. Development builds also show the Git commit and its date when known, with a warning if the build included uncommitted changes. This distinguishes development builds that share a version number.

## Keys

| Key | Action |
|---|---|
| ↑/↓ | Select a row, move between form fields, or scroll |
| PageUp/PageDown (or fn + ↑/↓) | Scroll by a page |
| Space, ←/→ | Change the selected choice in a form |
| Ctrl+A | Select all isolates matching the search in the isolate chooser. Press again to deselect them. |
| Tab, Shift+Tab | Switch tabs, or move between form fields |
| Enter | Open, choose, or press the selected button |
| Esc | Go back one step |
| `h` | Return home from any screen |
| `?` | Show the help of the current screen |
| `v` | Open the current document page in the browser |
| Ctrl+C twice within two seconds | Exit GenoPilot |

The run screen shows elapsed time. You cannot leave it with Esc or `h` until the workflow finishes or is stopped.

## Browser documents

Press `v` on a document page to open it in a local browser tab. The browser view supports links, an outline, themes, and printing. If it cannot open automatically, the terminal shows the URL. See [Browser view](browser-view.md) for details, including privacy and SSH port forwarding.
