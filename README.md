<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.png">
    <img src=".github/assets/logo-light.png" alt="GenoPilot" width="280">
  </picture>
</p>
<p align="center"><strong><code>@byteowls/genopilot</code></strong></p>
<p align="center">Guided, reproducible genome workflows for researchers without deep bioinformatics expertise.</p>

<p align="center">
  <a href="https://github.com/BYTEOWLS/genopilot/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/BYTEOWLS/genopilot/ci.yml?branch=main&style=flat-square&label=tests" alt="Test status on main" /></a>
  <img src="https://img.shields.io/maintenance/yes/2026?style=flat-square" alt="Maintained in 2026" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square" alt="AGPL-3.0-or-later license" /></a>
  <a href="https://www.npmjs.com/package/@byteowls/genopilot"><img src="https://img.shields.io/npm/v/@byteowls/genopilot?style=flat-square" alt="npm version" /></a>
</p>

The terminal interface configures and runs packaged Snakemake workflows. Linux and macOS are supported.

## Workflows

- [Reference Cohort Consensus](workflows/reference-consensus/README.md): builds a consensus genome of a cohort of isolates from their short reads, aligned to a reference assembly.
- [Transfer genome annotation](workflows/annotation-transfer/README.md): copies the gene annotation of a reference genome onto a related target genome.

How to use GenoPilot is documented in [`docs/`](docs/README.md), which the application also shows under Help.

## Installation

Node.js is the only manual prerequisite because the CLI itself requires Node.js to start.

### One-command installation with NVM

Linux and macOS users can install Node.js 24 with NVM, install the CLI, and start it with one copy-and-paste command:

```bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}" && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash && . "$NVM_DIR/nvm.sh" && nvm install 24 && npm install --global @byteowls/genopilot && genopilot
```

> This convenience command downloads and executes the pinned NVM installation script. Review the script first or use the downloaded Node.js installer below if this does not match your security policy.

### Installation with a downloaded Node.js installer

Linux and macOS users who prefer not to use NVM can:

1. Download and install **Node.js 24 LTS** for their operating system and architecture from [nodejs.org/download](https://nodejs.org/en/download).
2. Open a new terminal and verify the installation:

   ```bash
   node --version
   npm --version
   ```

3. Install and start the CLI:

   ```bash
   npm install --global @byteowls/genopilot && genopilot
   ```

The installed command is `genopilot`, with `gnp` as a short alias.

Update an existing global installation without entering an npm command:

```bash
genopilot update
```

The TUI checks for a newer release in the background and shows an update notice when one is available. The `genopilot update` command checks npm's `latest` release, skips installation when the current version is up to date, and otherwise installs the exact version it checked.

The CLI checks Pixi, Conda, Snakemake, and the workflow runtime after launch. With explicit consent, guided setup downloads a checksum-verified Pixi release into the application data directory and uses it to install the pinned Conda, Snakemake, and Python versions. No `sudo` access is required. Native Windows execution is unsupported; WSL2 support is planned.

## Running a workflow directly

Every workflow remains runnable directly through Snakemake without the TUI, using a run configuration GenoPilot saved; the workflows do not validate edited configurations and must not be modified.

Each Snakefile's header lists its steps and the direct command for a run directory GenoPilot saved. GenoPilot adds `--keep-going`, so independent jobs, such as other isolates, finish when one fails, and its run-events logger, which records each job's progress and command in the run's `events.jsonl`. To record them in a direct run too, make the packaged plugin importable and name the logger:

```bash
PYTHONPATH=<package>/workflows/shared/logging snakemake ... \
  --logger genopilot-run-events --logger-genopilot-run-events-path <run-dir>/events.jsonl
```

Without it, a workflow's provenance lists its commands as unavailable.

## Development

Packaged workflow resources are stored separately from the TypeScript source:

```text
docs/                        General documentation, also shown in the application
workflows/
├── <id>/                    One directory per workflow
│   ├── Snakefile
│   ├── manifest.yaml
│   ├── manifest.parameters.yaml
│   ├── README.md            Its science, inputs, parameters, steps, outputs, and tools
│   ├── results.md           Its result page, explained
│   ├── development.md       Optional maintainer notes, not packaged
│   ├── rules/               Optional: its own rules
│   ├── scripts/             Their standard-library scripts
│   └── envs/                Their pinned Conda environments
└── shared/                  Rules, scripts, and environments several workflows use, including the
                             run-events logger plugin
```

Only selected, redistributable workflow resources in this directory are included in the npm package. TypeScript application tests and Python workflow tests share `tests/`; their runners distinguish them by filename.

Run all commands in this document from the repository root.

Install dependencies:

```bash
pnpm install
```

`pnpm build` type-checks the sources and then bundles them with esbuild (`scripts/build.mjs`): the CLI with every dependency into one `dist/cli.js`, and the browser page and IGV into `dist/browser/assets/`. The package therefore has no runtime dependencies: an installation runs exactly the versions `pnpm-lock.yaml` pins, and dependencies are added as `devDependencies`. The build writes every bundled package's license into `dist/THIRD-PARTY-LICENSES.md` and fails for a license outside the permitted list or a package without a license file; such a package's reviewed upstream license goes into `resources/licenses/`. The bundle also embeds the commit it was built from, its date, and whether the working tree had uncommitted changes, which the tooling page shows; `pnpm dev` reads them from Git instead. Run `pnpm build` before opening browser documents or genome views from the source CLI; rebuild after changing browser code or styles.

Run the CLI from source:

```bash
pnpm dev
```

Restart the CLI from source whenever a file under `src/` changes:

```bash
pnpm dev:watch
```

Each change restarts the application, so UI state is lost and any running workflow is stopped. `Ctrl+C` stops the watcher itself; run `reset` if the terminal is left in a broken state.

Run the TypeScript tests, Python workflow tests, and type checking:

```bash
pnpm test:all
pnpm typecheck
```

The Python suite can also be run independently with `pnpm test:python`.

Build and run the compiled CLI:

```bash
pnpm build
pnpm start
```

## Releasing

`CHANGELOG.md` holds the highlights of each version and is the source of the GitHub release notes.

1. On `main`, set the version in `package.json`, the version and `date-released` in `CITATION.cff`, and move the *Unreleased* entries into a `## [X.Y.Z] - YYYY-MM-DD` section.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The release workflow checks the tag against `package.json` and creates the GitHub release from the version's CHANGELOG section, followed by GitHub's generated list of merged pull requests.
4. Publish to npm from the tagged commit, after the release workflow succeeded: `pnpm build && pnpm publish`. Published versions are immutable.

## Tooling policy

The packaged policy runs on Linux or macOS on x64 or arm64. Managed setup downloads Pixi from immutable release URLs verified by SHA-256 checksums, and Pixi installs Snakemake, Conda, and Python together from the packaged `runtime/pixi.lock`. The lock fixes every package, including transitive dependencies, by URL and SHA-256, and setup installs it with `pixi install --locked`, so every installation of a release gets the same runtime. Snakemake then uses Conda to provision the environments declared by workflow rules, and runs the scripts of rules without their own environment on that pinned Python. Managed paths live under `~/.byteowlsGenopilot` rather than the current working directory.

### Runtime

| Tool | Installed by | Pinned in |
|---|---|---|
| Node.js | User | `src/tooling/policy.ts`, `package.json` `engines` |
| Pixi | Guided setup | `src/tooling/policy.ts` |
| Snakemake | Pixi | `runtime/pixi.toml`, locked in `runtime/pixi.lock` |
| Conda | Pixi | `runtime/pixi.toml`, locked in `runtime/pixi.lock` |
| Python | Pixi | `runtime/pixi.toml`, locked in `runtime/pixi.lock` |

`src/tooling/policy.ts` repeats the Snakemake, Conda, and Python versions to verify an installation, and a test keeps them equal to the lock. GenoPilot's tooling check shows each tool's target version and the version it found.

To change a runtime pin, edit `runtime/pixi.toml` and `src/tooling/policy.ts`, run `pnpm lock:runtime` with the pinned Pixi version on `PATH`, and review the lock diff. A release with a changed lock installs its runtime into a new directory, so existing users are asked to run setup again.

### Workflow rule environments

Each workflow step runs in a pinned Conda environment under `workflows/*/envs/`. Each workflow README's *Tools* table names its tools and links the environment that pins them; version numbers are written only in these files, `runtime/pixi.toml`, and `src/tooling/policy.ts`, never repeated in documentation. Every run records the versions it used in its provenance. These files pin each tool but not its dependencies, which Conda resolves when Snakemake first creates an environment.

Dependabot proposes updates for the rule environments, npm, and GitHub Actions, but it changes only the environment file. Runtime pins in `runtime/pixi.toml` and `src/tooling/policy.ts` are updated manually, including the Pixi download checksums.

### Updating a pinned version

Every rule-environment bump changes:

1. `workflows/<shared or workflow>/envs/<environment>/environment.yaml`: the pin itself. Run provenance reads its configured tool versions from these files, so nothing else records the version.
2. `CHANGELOG.md`: an entry under *Unreleased*.

A tool's own output may also need re-verification; a workflow's `development.md` lists what depends on the exact files and values its tools write.

Then run the full verification, including the per-rule Conda integration tests, which run only locally:

```bash
RUN_SNAKEMAKE_CONDA_INTEGRATION=1 python3 -m unittest discover -s tests -p "test_*.py"
```
CI skips these tests, so run them before merging any change to a `workflows/*/envs/` directory, including Dependabot updates. Their expected coordinates on the synthetic fixtures detect changes in transfer results.

Windows support through WSL2 is planned after the core Linux and macOS implementation is complete. Native Windows execution is out of scope.

Tool version validation, actionable per-tool failure diagnostics, guided installation, stale-lock recovery, and manual rechecks are implemented. A repair path for broken installations is deferred in [`resources/later.md`](resources/later.md).

## Isolate catalog

Isolates reused across runs are stored in a user-local catalog, `isolates/isolates.yaml`, beside the managed tooling directory, on Linux and macOS alike:

```text
$HOME/.byteowlsGenopilot/isolates/isolates.yaml
```

The catalog records local research paths, so it is owner-only and never belongs in a repository or run workspace. Each isolate has a stable ID, a name, an optional description, a `wildtype` value (`true`, `false`, or `null` when not recorded), an optional `derived_from` parent ID, and one or more R1/R2 FASTQ pairs (plain or gzip-compressed) given as absolute paths. Sequencing providers deliver one pair per lane or run, so a library sequenced twice has two pairs. Each pair records whether the provider already trimmed or filtered it; untrimmed reads are preferred, and one isolate may mix trimmed and untrimmed pairs:

```yaml
schema_version: 1
isolates:
  - id: "isolate-a"
    name: "Isolate A"
    wildtype: true
    derived_from: null
    read_pairs:
      - r1: "/data/isolate-a_S1_L001_R1_001.fastq.gz"
        r2: "/data/isolate-a_S1_L001_R2_001.fastq.gz"
        trimmed: false
      - r1: "/data/isolate-a_S1_L002_R1_001.fastq.gz"
        r2: "/data/isolate-a_S1_L002_R2_001.fastq.gz"
        trimmed: false
```

The CLI validates the whole file on every load and save: duplicate or malformed IDs, relative paths, a read file used more than once, missing parents, and lineage cycles are rejected. Saves take an exclusive lock, refuse to overwrite changes made by another GenoPilot window, and replace the file atomically. A file that fails validation is reported with its path and left untouched; fix or move it aside to continue. Removing an isolate from the catalog never deletes its read files.

## Accession catalog

Versioned NCBI assembly accessions (`GCA_…`/`GCF_…` with a version suffix) are cataloged in `accessions/accessions.yaml`, beside the isolate catalog and with the same private, locked, atomic saves:

```text
$HOME/.byteowlsGenopilot/accessions/accessions.yaml
```

Each entry keeps an optional local name and description apart from the facts NCBI reports (organism, taxon, assembly name, level, status, and type such as haploid, submitter, and the RefSeq category and strain only when NCBI provides them), which record when and from where they were retrieved: the NCBI Datasets v2 API, or the report cached with a download. Cataloging an accession never downloads its assembly; workflows download it on demand. Metadata lookups use the optional NCBI API key when one is configured and work without it at NCBI's lower rate limit.

```yaml
schema_version: 1
output_roots:
  - "/analysis/genopilot"
accessions:
  - accession: "GCF_000149205.2"
    name: "Preferred backbone"
    ncbi:
      organism: "Example organism"
      assembly_name: "Example assembly"
      assembly_type: "haploid"
      refseq_category: "reference genome"
      submitter: "Example submitter"
      retrieved_at: "2026-01-01T12:00:00.000Z"
      source: "datasets-v2-rest"
    cached_copies:
      - path: "/analysis/genopilot/ncbi-accessions-cache/GCF_000149205.2"
        verified_at: "2026-01-01T12:00:00.000Z"
        fasta_sha256: "…"
```

`cached_copies` lists the workflow caches that matched their recorded checksums when they were last discovered. Discovery reads only `ncbi-accessions-cache/` directly inside `./runs` and the listed `output_roots`, never contacts NCBI, and adds any verified cache it finds; incomplete or checksum-invalid caches are reported but never recorded. A successful run that used an NCBI input adds its output root. Two verified copies with different files for one versioned accession are reported as a conflict that needs inspection. Removing an accession from the catalog **deletes its cache directories** under the known output roots, so a later workflow that needs it downloads it again.

## Reset managed tooling for installation tests

Stop the CLI before removing its managed tooling. These commands remove Pixi, Conda, Snakemake, Python, and temporary setup files while preserving previous setup logs.

```bash
TOOLING_DIR="$HOME/.byteowlsGenopilot/tooling" && rm -rf "$TOOLING_DIR/runtimes" "$TOOLING_DIR/pixi" "$TOOLING_DIR/temporary" "$TOOLING_DIR/tooling-setup.lock"
```

Start `genopilot` again to repeat guided installation. During the limited MVP, external Pixi, Conda, and Snakemake installations on `PATH` are intentionally ignored so every tester uses the same managed runtime.

The pinned per-rule environments Snakemake provisions for workflows are kept separately in `$TOOLING_DIR/conda-envs` and shared by every run, so they are deliberately not removed above: they are unrelated to guided installation, and rebuilding them costs hundreds of megabytes and several minutes. Remove that directory on its own to reclaim the space; the next run provisions whatever it needs again.

```bash
rm -rf "$TOOLING_DIR/conda-envs"
```

To also delete setup logs and completely reset the application-managed tooling directory, set `TOOLING_DIR` as in the first command of this section, followed by:

```bash
rm -rf "$TOOLING_DIR"
```

These commands do not remove tools installed elsewhere on the system, and they never touch the [isolate catalog](#isolate-catalog) or the [accession catalog](#accession-catalog), which live outside `$TOOLING_DIR`.

## Test a global installation

Build a package tarball and install it globally with npm:

```bash
pnpm install:global
```

Run the installed CLI:

```bash
genopilot
```

Rebuild and reinstall it after making changes:

```bash
pnpm reinstall:global
```

Create `byteowls-genopilot-local.tgz` without installing it:

```bash
pnpm pack:local
```

Install that tarball into a clean temporary prefix and check that the bundled CLI starts without any `node_modules`, as CI does:

```bash
pnpm verify:package
```

Remove the global test installation:

```bash
npm uninstall --global @byteowls/genopilot
```

## License

Copyright (C) 2026 Michael Oberwasserlechner

GenoPilot is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

For use under other terms, such as a commercial license, contact the author.
