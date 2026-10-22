# AI-assisted interpretation

## Goal

A researcher asks an AI assistant about a finished run, and the assistant answers from the run's recorded results, their documented meaning, and their evidence, instead of from pasted fragments. GenoPilot provides the data; the assistant brings the model. GenoPilot ships no model client and holds no API keys.

## How a researcher uses it

1. Add `genopilot mcp` once as a Model Context Protocol (MCP) server in an assistant app such as Claude Desktop or Claude Code, or in a client for a local model.
2. Run workflows in GenoPilot as usual.
3. Ask the assistant about a run. The app starts the server when it needs it; the server only reads run directories, so the TUI may stay open.

## What stays in GenoPilot, what the assistant adds

Everything deterministic and repeatable stays in GenoPilot, and works without any assistant. These values must be the same on every reading and citable:

- counts, summaries, charts, and validation;
- **run comparison**: what changed between iterations or reruns, in the [reruns concept](reruns.md)'s comparison view;
- **triage**: ordering warnings and unresolved loci by documented, visible criteria, such as whether a coding sequence is affected and how ([later.md](../later.md#result-triage)). The criteria are explained in the workflow's `results.md`; no hidden score decides what the researcher sees first.

The assistant builds on these results and adds what needs judgement, outside knowledge, or a question no screen answers:

- **Connecting findings** across tabs and files, for example unmapped features that lie on contigs with many unresolved bases.
- **Explaining** a comparison or a triaged item in context: why a locus changed between iterations, or what a high-impact item likely means.
- **Causes**: why a locus or gene failed (repeat, paralog, low coverage, assembly error) and which evidence would tell them apart.
- **Biological context**: gene functions, gene families, and literature. This knowledge is the model's, not GenoPilot's, and is labelled as such.
- **Ad-hoc questions** answered by bounded queries on the result tables.
- **Failure diagnosis**: reading a failed run's logs and suggesting a configuration fix.
- **Writing**: drafts of methods and results paragraphs and figure captions from the recorded values and the run's citation.
- **Teaching**: explaining a value or step, grounded in the workflow's README and `results.md`.

The assistant can be fluently wrong. Its answers name the result IDs and files they rest on, so the researcher can check them.

## Parts

### Stable result IDs

Workflows already write versioned summary JSON files. Each item that `results.md` explains names the JSON key it describes, so the assistant matches a value to its definition, unit, and denominator rather than guessing from a label. A test keeps every summary key and its `results.md` entry equal, as for `citation/references.json` and the `## Tools` table.

### The MCP server

`genopilot mcp` serves the MCP protocol over stdio with read-only tools:

| Tool | Returns |
|---|---|
| `list_runs` | Runs found by the existing run discovery: ID, workflow, status, creation time. |
| `get_run` | A run's configuration, decisions, status, warnings, summaries, and provenance. |
| `compare_runs` | GenoPilot's own comparison of two runs or iterations, once the comparison view exists. |
| `explain` | The `results.md` section of a result ID and the README sections and references it links to. |
| `query_table` | Rows of a result TSV, filtered and limited, with the total row count. |
| `read_log` | A step's log or a Snakemake attempt's stdout and stderr, in pages. |
| `locus_evidence` | What the genome view shows at a region, as data: features, variants, and support. |

Each tool works by workflow-neutral convention: tables, logs, and summaries come from the manifest and the run directory, and `locus_evidence` from what a workflow's genome views already declare. The per-vote evidence in [later.md](../later.md#per-vote-evidence-and-per-locus-overrides) makes `locus_evidence` much more useful for unresolved loci.

### Proposed decisions

A later step lets the assistant write a decision proposal, never the decision itself. The TUI shows a proposal marked as AI-proposed, and it takes effect only when the researcher saves it. The saved decision records that a proposal existed and which model made it. This keeps the rule that ambiguities are never resolved silently and makes the assistant's part auditable.

### Privacy

Everything a tool returns reaches the assistant's provider. Paths, isolate names, and unpublished accessions are handled as in the [run export's privacy review](run-export.md#privacy-review): the server replaces path prefixes with placeholders, and the researcher is told before first use that names and accessions are sent as they are. Restricted data belongs with a local model.

### Citing AI-assisted review

When a run holds AI-proposed decisions, its citation adds a methods sentence naming the model and what it was used for.

## Decisions

- **Protocol.** MCP, because it is the common interface of current assistant apps and works with local models. Read-only first; proposals later.
- **Implementation.** The official TypeScript SDK as a new runtime dependency, or a small JSON-RPC handler over stdio on Node built-ins. Decide at the kickoff.
- **Shared code.** The server reuses run discovery and result loading, and after the [workflow modules](workflow-modules.md) each module's result reader. It computes no value of its own.

## Open questions

- Should a non-interactive CLI (`genopilot run show --json`) come first, with the server on top of it, so scripts benefit too?
- Which runs may the server see: all discovered runs, or only those the researcher marks?
- Is a genome-view image (`snapshot`) worth adding for models that read images, given that the browser view runs only while GenoPilot leads it?
- How does a proposal reach the TUI: a file in `decisions/proposals/`, or only through the server?

## Work

- [ ] Kickoff: the implementation decision and the open questions.
- [ ] Map every summary key to its `results.md` item, with the test that keeps them equal.
- [ ] The read-only server with `list_runs`, `get_run`, `explain`, `query_table`, and `read_log`, and its privacy handling.
- [ ] `locus_evidence`, after per-vote evidence.
- [ ] Decision proposals, their display in the TUI, and their record in decisions and the citation.
- [ ] Tests on a fixture run: each tool's output, limits on large tables and logs, replaced paths, an incomplete and a corrupt run.
- [ ] Document the setup and the privacy notice in `docs/`.

## Acceptance

A researcher adds GenoPilot to an assistant app once and asks it about any run. Every answer rests on values and documentation the assistant can name, nothing in the run changes, and nothing leaves the machine that the researcher was not told about.
