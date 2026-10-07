# Project website

## Goal

One public page that shows researchers what GenoPilot does, what working with it looks like, and how to install it. A few screenshots explain the highlights better than the README, which addresses installers and developers, or `docs/`, which explains usage step by step.

The website complements the README and `docs/` and does not replace them: it links to them for everything beyond a short caption.

## Decisions

- **GitHub Pages from this repository.** The source lives in `site/` and is deployed by a GitHub Actions workflow. It goes live when the repository becomes public ([public release](public-release.md)); Pages for a private repository needs a paid plan.
- **Plain static HTML and CSS.** `site/index.html`, `site/style.css`, and `site/screenshots/`, written by hand. No site generator, framework, or build step. The page follows the system's light or dark mode through `prefers-color-scheme` and reuses the logos in `.github/assets/`, as the README does.
- **No external resources.** No tracking, analytics, web fonts, or CDNs, consistent with the local [browser view](../../docs/browser-view.md#local-connection). The page works at phone width and without JavaScript.
- **Reproducible screenshots.** Every screenshot is produced by a script from the real application and public or synthetic data, so all of them can be regenerated for a release instead of going stale one by one (see [Screenshots](#screenshots)).
- **Facts are not repeated.** The site names no version numbers; they stay where they are pinned. The install command is the README's one-command installation, and a test checks that the two match. Usage links to `docs/`, the science of a workflow to its `workflows/<id>/README.md`.
- **Workflows are named on the site.** The site is product material like the README's workflow list, not shared documentation, so it may describe each workflow. Its workflow sections are written by hand; adding a workflow adds a site section in the same change, as it adds a README entry.
- **Not packaged.** `site/` and the screenshot scripts stay out of the npm package; the `files` allowlist in `package.json` already excludes them.

## Page

Each highlight is a short heading, two or three sentences, and one screenshot with descriptive alt text.

1. **Hero**: logo, the `package.json` description as tagline, the install command with a copy button, and the home screen.
2. **Guided setup**: the tooling page checks Pixi, Conda, Snakemake, and Python and, with consent, installs the pinned versions from checksum-verified downloads without administrator rights.
3. **Configure a run**: workflow selection with its documentation, and a run form with validation problems shown on save.
4. **Watch it run**: the running workflow's progress and the exact Snakemake command GenoPilot started.
5. **Results with provenance**: a result page with its generated, imported, and cached labels, and the `?` help that explains every item.
6. **Catalogs**: the import review of a sequencing delivery, and the NCBI accession catalog.
7. **Genome view in the browser**: the IGV-based view of a verified accession or a run result, opened with `v`.
8. **Workflows**: one short section per workflow with a screenshot of its result page and a link to its README.
9. **Runs without GenoPilot**: every workflow stays runnable directly through Snakemake. A code block instead of a screenshot, linking to the README's *Running a workflow directly*.

The footer links the GitHub repository, the npm package, the license (AGPL-3.0-or-later), and how to cite GenoPilot. The concept DOI appears there once [Zenodo release archiving](zenodo-release-archiving.md) is set up.

## Screenshots

### Terminal

`scripts/screenshots/` holds one [VHS](https://github.com/charmbracelet/vhs) tape per terminal screenshot. VHS starts the built CLI in a real terminal of fixed size, font, and theme, types the keys a tape lists, and writes a PNG. The tapes are the specification of each screenshot: which screen, which keys, which data.

VHS, and the ttyd and ffmpeg it needs, are developer tools installed locally, not package dependencies. The README's *Development* section documents how to install them.

A tape for the home and tooling screens could look like this. The screen texts it waits for are examples; the real tapes wait for whatever text marks each screen as ready.

```text
# scripts/screenshots/home.tape
Set Shell bash
Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Width 1400
Set Height 800
Set Padding 24
Set Theme "Catppuccin Mocha"

Env HOME "/tmp/genopilot-screenshots"

Hide
Type "node dist/cli.js" Enter
Wait+Screen /GenoPilot/
Show

Screenshot site/screenshots/home.png

Down Down Enter
Wait+Screen /Tooling/
Screenshot site/screenshots/tooling.png

Ctrl+C Ctrl+C
```

- `Hide` and `Show` keep the start command out of a recorded video; `Output site/screenshots/<name>.gif` would record the whole tape as an animation.
- Tapes wait with `Wait+Screen` for text that marks a screen as ready, not with a fixed `Sleep`, which breaks on slower machines.
- The font named in the tapes is a free monospace font that every developer installs; otherwise VHS falls back to another font and screenshots differ between machines.
- VHS sends no mouse input. GenoPilot is fully keyboard-driven, so nothing is lost.

### Tooling in the temporary home

A fresh `HOME` has no managed tooling, so the tooling page would show Pixi, Snakemake, and Conda as missing and no run could start. The screenshot script therefore keeps one temporary home for all captures, outside the repository, and runs guided setup into it once before the first tape, with the same consent prompt a user sees. Later runs reuse that home until the runtime lock changes, as an installation does ([Runtime](../../README.md#runtime)). The tooling screenshot can show both states: the first check before setup, and the ready state after it.

Rule environments that runs need are provisioned in the same home by the first run that uses them, so the first `pnpm screenshots` takes long and later ones are fast.

### Browser

The genome view is captured with a Playwright script that opens the URL GenoPilot prints. It is a capture script, not a test: it stays outside test discovery and CI, in line with the parked browser tests in `AGENTS.md`.

### Data

- Every capture runs under a temporary `HOME`, so the catalogs, managed tooling, and paths shown belong to that directory and reveal nothing of the developer's machine. GenoPilot resolves its data directory from `homedir()`, which follows `HOME`.
- Inputs are the synthetic fixtures in `tests/fixtures/` and, once they exist, the worked examples on public data from the [public release](public-release.md#a-worked-example-on-public-data). Real-looking results need the latter; the fixtures are too small to look like a real run.
- Never private reads, unpublished assemblies, or collaborator data, also not cropped or blurred.

### Regenerating

`pnpm screenshots` builds the CLI, runs every tape and the browser capture, and writes optimized PNGs of a fixed width into `site/screenshots/`. The PNGs are committed, so the site deploys without running GenoPilot. Regenerating them, and reviewing the diff, becomes a step of the README's *Releasing* section.

## Deployment

`.github/workflows/pages.yml` uploads `site/` with `actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`, pinned by commit SHA like the other workflows. It runs on changes to `site/` and on manual dispatch.

## Open questions

- Deploy on every push to `main`, or only on release tags so the site never shows unreleased behavior?
- `byteowls.github.io/genopilot` or a custom domain? A custom domain needs a `CNAME` file and DNS records.
- One theme per screenshot, or light and dark captures shown through `<picture>` like the README logo? Doubling the captures doubles the review work per release.
- Animated demos rendered from the same tapes (GIF or MP4) in addition to stills? They show the flow better but are larger and harder to keep accessible.
- Should the site wait for the public worked examples, or launch with fixture-based screenshots and replace them later?

## Order

1. The page with placeholder images, reviewed locally.
2. The VHS tapes for the terminal screenshots and `pnpm screenshots`.
3. The Playwright capture of the genome view.
4. The Pages workflow and the release-checklist step.
5. Going live with the public repository; link the site from the README header and set `homepage` in `package.json`.
