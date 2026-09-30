# Using GenoPilot

GenoPilot configures and runs curated genome workflows. Each workflow is a packaged Snakemake workflow: GenoPilot saves its configuration, starts it, follows its progress, and shows its results, and every run stays runnable directly through Snakemake without GenoPilot.

## Runs

A new run starts by choosing a workflow; its documentation is available from the selection. Configure the run, then start it as a dry run, which only previews the jobs Snakemake would execute, or execute it. Each run gets its own directory with the saved configuration, all results, the complete logs, and a provenance record of commands, tool versions, checksums, and the effective configuration.

Open existing runs to view their results again or to delete them. On a result page, `?` explains every item it shows.

Files a run copied in from outside are marked **imported**, files it computed are **generated**, and stages reused from elsewhere instead of computed are **cached**.

## Catalogs

- **Isolates**: isolates and their sequencing reads, reused across runs. An isolate records its name, wild-type status, the isolate it derives from, and its read files. A sequencing delivery can be imported in one step.
- **NCBI accessions**: versioned NCBI assembly accessions with the metadata NCBI reports, and the output directories whose download caches GenoPilot checks. Workflows download an accession only when a run needs it.

Catalogs keep paths on this machine, so they stay private to your user and never become part of a run or repository. Removing an isolate never deletes its read files.

## Tooling

GenoPilot checks its runtime after launch: Pixi, Conda, and Snakemake at the pinned versions. With your consent it installs them into its own data directory, without administrator rights. Snakemake then provisions a pinned environment for each workflow step the first time it is needed.

## Keys

| Key | Action |
|---|---|
| ↑/↓ | Select a row, move between form fields, or scroll |
| PageUp/PageDown (or fn + ↑/↓) | Scroll by a page |
| Space, ←/→ | Change the selected choice in a form |
| Tab, Shift+Tab | Switch tabs, or move between form fields |
| Enter | Open, choose, or press the selected button |
| Esc | Go back one step |
| `h` | Return home from any screen |
| `?` | Show the help of the current screen |
| Ctrl+C twice | Exit GenoPilot |

A running workflow is not left by Esc or `h` until it finished or was stopped.

## Mouse

The mouse wheel and the trackpad scroll and move the selection wherever ↑/↓ do; they never change a value in a form. While GenoPilot runs, the terminal passes mouse clicks and drags to it, so selecting text to copy needs a modifier key while dragging: Shift in most terminals, Option in iTerm2. If neither works, your terminal's documentation names the key for bypassing mouse reporting.
