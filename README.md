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
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a>
  <a href="https://www.npmjs.com/package/@byteowls/genopilot"><img src="https://img.shields.io/npm/v/@byteowls/genopilot?style=flat-square" alt="npm version" /></a>
</p>

The terminal interface configures and runs packaged Snakemake workflows. Every workflow remains runnable directly through Snakemake without the TUI, using a run configuration GenoPilot saved; the workflows do not validate edited configurations and must not be modified. Linux and macOS are supported.

## Running a workflow directly

Each Snakefile's header lists its steps and the direct command for a run directory GenoPilot saved. GenoPilot adds `--keep-going`, so independent jobs, such as other isolates, finish when one fails, and its run-events logger, which records each job's progress and command in the run's `events.jsonl`. To record them in a direct run too, make the packaged plugin importable and name the logger:

```bash
PYTHONPATH=<package>/workflows/shared/logging snakemake ... \
  --logger genopilot-run-events --logger-genopilot-run-events-path <run-dir>/events.jsonl
```

Without it, the reference-consensus provenance lists its commands as unavailable.

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

The CLI checks Pixi, Conda, Snakemake, and the workflow runtime after launch. With explicit consent, guided setup downloads a checksum-verified Pixi release into the application data directory and uses it to install the pinned Conda and Snakemake versions. No `sudo` access is required. Native Windows execution is unsupported; WSL2 support is planned.

## Development

Packaged workflow resources are stored separately from the TypeScript source:

```text
workflows/
├── annotation-transfer/
│   ├── Snakefile
│   ├── manifest.yaml
│   └── manifest.parameters.yaml
├── comparison/              Comparison workflow scaffold
├── reference-consensus/     Cohort consensus; per-isolate processing and support aggregation so far
│   ├── Snakefile
│   ├── manifest.yaml
│   ├── manifest.parameters.yaml
│   ├── rules/               This workflow's rules
│   ├── scripts/             Their standard-library scripts
│   └── envs/                Their pinned Conda environments
└── shared/                  Annotation-transfer's rules, scripts, and environments, and what both
                             workflows use, including the run-events logger plugin
```

Only selected, redistributable workflow resources in this directory are included in the npm package. TypeScript application tests and Python workflow tests share `tests/`; their runners distinguish them by filename.

Run all commands in this document from the repository root.

Install dependencies:

```bash
pnpm install
```

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

## Tooling policy

The packaged policy runs on Linux or macOS on x64 or arm64. Managed setup downloads Pixi from immutable release URLs verified by SHA-256 checksums, and Pixi installs Snakemake and Conda together; Snakemake then uses Conda to provision the environments declared by workflow rules. Managed paths live under the platform user-data directory rather than the current working directory.

### Runtime

| Tool | Pinned version | Accepted range | Installed by | Pinned in |
|---|---|---|---|---|
| Node.js | 24 LTS (tested 24.19.0) | ≥ 24.0.0, < 26.0.0 | User | `src/tooling/policy.ts`, `package.json` `engines` |
| Pixi | 0.79.0 | ≥ 0.79.0, < 0.79.1 | Guided setup | `src/tooling/policy.ts` |
| Snakemake | 9.26.1 | ≥ 9.26.1, < 9.26.2 | Pixi | `src/tooling/policy.ts` |
| Conda | 25.11.1 | ≥ 25.11.1, < 25.11.2 | Pixi | `src/tooling/policy.ts` |

### Workflow rule environments

| Tool | Pinned version | Channel | Environment |
|---|---|---|---|
| LiftOn | 1.0.13 | PyPI | [`lifton`](workflows/shared/envs/lifton/environment.yaml) |
| minimap2 | 2.31 | bioconda | [`lifton`](workflows/shared/envs/lifton/environment.yaml) |
| miniprot | 0.18 | bioconda | [`lifton`](workflows/shared/envs/lifton/environment.yaml) |
| parasail-python | 1.3.4 | bioconda | [`lifton`](workflows/shared/envs/lifton/environment.yaml) |
| Python | 3.11.16 | conda-forge | [`lifton`](workflows/shared/envs/lifton/environment.yaml), [`ncbi-datasets-cli`](workflows/shared/envs/ncbi-datasets-cli/environment.yaml), [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |
| NCBI Datasets CLI | 18.37.0 | conda-forge | [`ncbi-datasets-cli`](workflows/shared/envs/ncbi-datasets-cli/environment.yaml) |
| fastp | 1.3.7 | bioconda | [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |
| BWA | 0.7.19 | bioconda | [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |
| samtools | 1.24 | bioconda | [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |
| BCFtools | 1.24 | bioconda | [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |
| HTSlib | 1.24 | bioconda | [`short-read-calling`](workflows/reference-consensus/envs/short-read-calling/environment.yaml) |

Dependabot proposes updates for the rule environments, npm, and GitHub Actions, but it changes only the environment file. Runtime pins in `src/tooling/policy.ts` are updated manually, including the Pixi download checksums.

### Updating a pinned version

Every rule-environment bump changes:

1. `workflows/<shared or workflow>/envs/<environment>/environment.yaml`: the pin itself. Run provenance reads its configured tool versions from these files, so nothing else records the version.
2. This README: the version table above.
3. `CHANGELOG.md`: an entry under *Unreleased*.

A LiftOn bump additionally requires re-verifying everything that depends on the exact files and values LiftOn writes. Check the release notes and the LiftOn source for the new version, then update the version references and any changed behavior in:

| File | Depends on |
|---|---|
| `workflows/shared/rules/transfer_annotation.smk` | Output layout; the declared `lifton_output/` directory must contain every file LiftOn writes (1.0.10 and 1.0.11 wrote `liftoff/` and `miniprot/` beside it) |
| `workflows/shared/scripts/collect_transfer_metrics.py` | Mutation classes that count as unchanged proteins |
| `src/workflows/annotation-transfer/result-help.ts` | Gene `source`, transcript `status`, and mutation-class values explained on the result help page |
| `resources/concepts/done/annotation-transfer-results.md` | The documented metric and value contract |

Then run the full verification, including the per-rule Conda integration tests, which run only locally:

```bash
RUN_SNAKEMAKE_CONDA_INTEGRATION=1 python3 -m unittest discover -s tests -p "test_*.py"
```
CI skips these tests, so run them before merging any change to a `workflows/*/envs/` directory, including Dependabot updates. Their expected coordinates on the synthetic fixtures detect changes in transfer results.

Windows support through WSL2 is planned after the core Linux and macOS implementation is complete. Native Windows execution is out of scope.

Tool version validation, actionable per-tool failure diagnostics, guided installation, stale-lock recovery, and manual rechecks are implemented. A repair path for broken installations is deferred in [`later.md`](later.md).

## Isolate catalog

Isolates reused across consensus runs are stored in a user-local catalog, `isolates/isolates.yaml`, beside the managed tooling directory:

| Platform | Catalog file |
|---|---|
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/byteowlsGenopilot/isolates/isolates.yaml` |
| macOS | `$HOME/.byteowlsGenopilot/isolates/isolates.yaml` |

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

| Platform | Catalog file |
|---|---|
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/byteowlsGenopilot/accessions/accessions.yaml` |
| macOS | `$HOME/.byteowlsGenopilot/accessions/accessions.yaml` |

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

Stop the CLI before removing its managed tooling. These commands remove Pixi, Conda, Snakemake, and temporary setup files while preserving previous setup logs.

Linux:

```bash
TOOLING_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/byteowlsGenopilot/tooling" && rm -rf "$TOOLING_DIR/runtimes" "$TOOLING_DIR/pixi" "$TOOLING_DIR/temporary" "$TOOLING_DIR/tooling-setup.lock"
```

macOS:

```bash
TOOLING_DIR="$HOME/.byteowlsGenopilot/tooling" && rm -rf "$TOOLING_DIR/runtimes" "$TOOLING_DIR/pixi" "$TOOLING_DIR/temporary" "$TOOLING_DIR/tooling-setup.lock"
```

Start `genopilot` again to repeat guided installation. During the limited MVP, external Pixi, Conda, and Snakemake installations on `PATH` are intentionally ignored so every tester uses the same managed runtime.

The pinned per-rule environments Snakemake provisions for workflows are kept separately in `$TOOLING_DIR/conda-envs` and shared by every run, so they are deliberately not removed above: they are unrelated to guided installation, and rebuilding them costs hundreds of megabytes and several minutes. Remove that directory on its own to reclaim the space; the next run provisions whatever it needs again.

```bash
rm -rf "$TOOLING_DIR/conda-envs"
```

To also delete setup logs and completely reset the application-managed tooling directory, run the applicable command above to set `TOOLING_DIR`, followed by:

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

Remove the global test installation:

```bash
npm uninstall --global @byteowls/genopilot
```

## License

[MIT](LICENSE)
