#!/usr/bin/env python3
"""Write how to cite a finished run: CITATION.md, with BibTeX and RIS beside it.

The citation names the GenoPilot that saved the run's configuration, the workflow, the
tools that ran with the versions the run observed, the genome viewer with the version
GenoPilot bundles, their references, and a draft methods paragraph built from the effective
configuration. A run saved by a development build is marked as not citable, because only a
release has a DOI.

Inputs, all found by convention:
  provenance/run.json                    the run's provenance: configuration, versions
  <workflow>/citation/references.json    the workflow's references and its tools
  <workflow>/citation/methods.txt        the methods paragraph, as a template
  <workflow>/citation/phrases.json       wording for setting values in the paragraph
  shared/citation/genopilot.json         how GenoPilot itself is cited
  shared/citation/igv.json               how its genome viewer, igv.js, is cited

A tool is cited only when it ran: a tool with an `input_source` ran only when an input
came from that source, for example an NCBI download. A tool's version is the observed one,
or the pinned one when the run did not observe it.

Methods placeholders: `${genopilot.version}`, `${workflow.id}`, `${workflow.version}`,
`${tool.<version key>}`, `${input.<role>}`, and `${config.<path>}` for a value of the
effective configuration (a list gives its number of items, a boolean `yes` or `no`).
`phrases.json` replaces a placeholder's value by its wording: each placeholder maps its values to
text, and `*`, with `{}` for the value, covers any other value. A value without wording is an
error, so a new setting value never reaches the paragraph unworded.

Standard library only.
"""

from __future__ import annotations

import argparse
import re
import string
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from provenance import read_json  # noqa: E402


class MethodsTemplate(string.Template):
    braceidpattern = r"[a-z][a-z0-9_.-]*"


def citable(genopilot: dict) -> bool:
    return bool(genopilot.get("build", {}).get("released"))


def tool_version(provenance: dict, keys: list[str]) -> str | None:
    """The first version the run observed under one of `keys`, else the first pinned one."""
    versions = provenance["tool_versions"]
    for key in keys:
        observed = versions.get("observed", {}).get(key)
        if isinstance(observed, dict) and observed.get("version"):
            return str(observed["version"])
    for key in keys:
        configured = versions.get("configured", {}).get(key)
        if configured:
            return str(configured)
    return None


def input_sources(configuration: dict) -> set[str]:
    return {
        value["source"]
        for value in configuration.get("inputs", {}).values()
        if isinstance(value, dict) and "source" in value
    }


def tools_that_ran(provenance: dict, tools: list[dict]) -> list[dict]:
    sources = input_sources(provenance["effective_configuration"])
    return [tool for tool in tools if tool.get("input_source") in (None, *sources)]


def describe_input(value: dict) -> str:
    if value.get("source") == "ncbi":
        return f"NCBI assembly {value['accession']}"
    files = [key for key, path in value.items() if key != "source" and isinstance(path, str)]
    return "a local file" if len(files) == 1 else "local files"


def render_value(value: object) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        return str(len(value))
    if isinstance(value, (dict, type(None))):
        raise ValueError(f"cannot write {value!r} into the methods paragraph")
    return str(value)


def methods_values(provenance: dict, tools: list[dict]) -> dict[str, str]:
    configuration = provenance["effective_configuration"]
    values = {
        "genopilot.version": provenance["genopilot"]["version"],
        "workflow.id": provenance["workflow"]["id"],
        "workflow.version": str(provenance["workflow"]["version"]),
    }
    for tool in tools:
        version = tool_version(provenance, tool["versions"])
        if version is not None:
            for key in tool["versions"]:
                values[f"tool.{key}"] = version
    for role, value in configuration.get("inputs", {}).items():
        if isinstance(value, dict) and "source" in value:
            values[f"input.{role}"] = describe_input(value)

    def flatten(prefix: str, value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                flatten(f"{prefix}.{key}", child)
        elif value is not None:
            values[prefix] = render_value(value)

    flatten("config", configuration)
    return values


def apply_phrases(values: dict[str, str], phrases: dict[str, dict[str, str]]) -> dict[str, str]:
    worded = dict(values)
    for placeholder, wording in phrases.items():
        if placeholder not in values:
            raise ValueError(f"phrases for unknown placeholder {placeholder}")
        value = values[placeholder]
        if value in wording:
            worded[placeholder] = wording[value]
        elif "*" in wording:
            worded[placeholder] = wording["*"].replace("{}", value)
        else:
            raise ValueError(f"no wording for {placeholder} = {value!r}")
    return worded


def render_methods(template: str, values: dict[str, str]) -> str:
    """Fills every placeholder; an unknown one is an error, never left in the text."""
    try:
        return MethodsTemplate(template).substitute(values).strip()
    except KeyError as error:
        raise ValueError(f"unknown methods placeholder {error.args[0]}") from None


def genopilot_reference(genopilot: dict, citation: dict) -> dict:
    """GenoPilot's own entry, with the version that saved the run and the year of the latest release."""
    year = (citation.get("date_released") or "")[:4]
    doi = citation.get("concept_doi")
    location = f"https://doi.org/{doi}" if doi else citation["repository"]
    text = f"{', '.join(citation['authors'])}. {citation['title']}, version {genopilot['version']}"
    text += f" ({year}). {location}" if year else f". {location}"
    entry = {
        "id": "genopilot",
        "text": text,
        "type": "software",
        "authors": citation["authors"],
        "others": False,
        "title": citation["title"],
        "version": genopilot["version"],
        "url": citation["repository"],
    }
    if year:
        entry["year"] = int(year)
    if doi:
        entry["doi"] = doi
    return entry


def initials(author: str) -> tuple[str, str]:
    """`Chao KH` as its family name and spaced initials; a group name has no initials."""
    match = re.fullmatch(r"(.+) ([A-Z]+)", author)
    if not match:
        return author, ""
    return match.group(1), " ".join(f"{letter}." for letter in match.group(2))


def bibtex_entry(entry: dict) -> str:
    authors = []
    for author in entry["authors"]:
        family, given = initials(author)
        authors.append(f"{family}, {given}" if given else f"{{{family}}}")
    if entry.get("others"):
        authors.append("others")
    kind = "article" if entry["type"] == "article" else "misc"
    fields = [("author", " and ".join(authors)), ("title", f"{{{entry['title']}}}")]
    if entry["type"] == "article":
        fields.append(("journal", entry["journal"]))
        fields.append(("volume", entry["volume"]))
        if "issue" in entry:
            fields.append(("number", entry["issue"]))
        fields.append(("pages", entry["pages"].replace("–", "--")))
    if entry["type"] == "preprint":
        fields += [("eprint", entry["number"]), ("archivePrefix", entry["repository"])]
    if "version" in entry:
        fields.append(("version", entry["version"]))
    if "year" in entry:
        fields.append(("year", str(entry["year"])))
    if "doi" in entry:
        fields.append(("doi", entry["doi"]))
    if "url" in entry:
        fields.append(("url", entry["url"]))
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields)
    return f"@{kind}{{{entry['id']},\n{body}\n}}"


RIS_TYPES = {"article": "JOUR", "preprint": "UNPB", "software": "COMP", "specification": "STAND"}


def ris_entry(entry: dict) -> str:
    lines = [("TY", RIS_TYPES[entry["type"]])]
    for author in entry["authors"]:
        family, given = initials(author)
        lines.append(("AU", f"{family}, {given.replace(' ', '')}" if given else family))
    lines.append(("TI", entry["title"]))
    if entry["type"] == "article":
        lines.append(("JO", entry["journal"]))
        lines.append(("VL", entry["volume"]))
        if "issue" in entry:
            lines.append(("IS", entry["issue"]))
        start, _, end = entry["pages"].partition("–")
        lines.append(("SP", start))
        if end:
            lines.append(("EP", end))
    if "version" in entry:
        lines.append(("ET", entry["version"]))
    if "year" in entry:
        lines.append(("PY", str(entry["year"])))
    if "doi" in entry:
        lines.append(("DO", entry["doi"]))
    if "url" in entry:
        lines.append(("UR", entry["url"]))
    lines.append(("ER", ""))
    return "\n".join(f"{tag}  - {value}".rstrip() for tag, value in lines)


def status_paragraph(genopilot: dict, citation: dict) -> str:
    version = genopilot["version"]
    build = genopilot.get("build")
    if citable(genopilot):
        doi = citation.get("concept_doi")
        where = (
            f"Its version DOI is listed on the record of the concept DOI https://doi.org/{doi}, which always"
            " resolves to the latest release."
            if doi
            else "This version has no DOI yet; cite its repository."
        )
        return (
            f"This run was produced by GenoPilot {version}, a release. Cite GenoPilot {version} by its version"
            f" DOI together with the tools listed below: GenoPilot ran them, the tools are the method. {where}"
        )
    if build:
        origin = f"a development build of GenoPilot {version} (commit {build['commit'][:12]}"
        origin += ", with uncommitted changes)" if build["modified"] else ")"
    else:
        origin = f"a build of GenoPilot {version} from an unknown commit"
    return (
        f"**Not citable.** This run was produced by {origin}. Only a released version has a DOI;"
        " rerun the analysis with a released version before citing it."
    )


def citation_markdown(
    provenance: dict, citation: dict, tools: list[dict], viewer: dict, references: list[dict], methods: str
) -> str:
    genopilot = provenance["genopilot"]
    numbers = {entry["id"]: index for index, entry in enumerate(references, 1)}
    lines = [
        "# Citing this run",
        "",
        status_paragraph(genopilot, citation),
        "",
        "The methods paragraph is a draft built from the run's configuration; check and adapt it before using it.",
        "",
        "## Workflow",
        "",
        f"`{provenance['workflow']['id']}`, version {provenance['workflow']['version']}, run by GenoPilot"
        f" {genopilot['version']}.",
        "",
        "## Tools",
        "",
        "| Tool | Version | References |",
        "|---|---|---|",
    ]
    for tool in tools:
        cited = "[" + ", ".join(str(numbers[reference]) for reference in tool["references"]) + "]"
        lines.append(f"| {tool['name']} | {tool_version(provenance, tool['versions']) or 'unknown'} | {cited} |")
    lines.append(f"| {viewer['name']} | {genopilot['igv']} | [{numbers[viewer['reference']['id']]}] |")
    lines += ["", "## Methods", "", methods, "", "## References", ""]
    lines += [f"{number}. {entry['text']}" for number, entry in enumerate(references, 1)]
    lines += ["", "## BibTeX", "", "```bibtex", "\n\n".join(bibtex_entry(entry) for entry in references), "```"]
    lines += ["", "## RIS", "", "```", "\n".join(ris_entry(entry) for entry in references), "```", ""]
    return "\n".join(lines)


def write_citation(args: argparse.Namespace) -> None:
    provenance = read_json(args.provenance)
    workflow = read_json(args.references)
    citation = read_json(args.genopilot)
    viewer = read_json(args.viewer)
    tools = tools_that_ran(provenance, workflow["tools"])
    by_id = {entry["id"]: entry for entry in workflow["references"]}
    references = [genopilot_reference(provenance["genopilot"], citation)]
    for tool in tools:
        for reference in tool["references"]:
            if all(entry["id"] != reference for entry in references):
                references.append(by_id[reference])
    # Shows the results; cited after the tools that ran.
    references.append(viewer["reference"])
    values = apply_phrases(methods_values(provenance, workflow["tools"]), read_json(args.phrases))
    methods = render_methods(args.methods.read_text(encoding="utf-8"), values)

    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.write_text(citation_markdown(provenance, citation, tools, viewer, references, methods), encoding="utf-8")
    args.bibtex.write_text("\n\n".join(bibtex_entry(entry) for entry in references) + "\n", encoding="utf-8")
    args.ris.write_text("\n".join(ris_entry(entry) for entry in references) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("provenance", "references", "methods", "phrases", "genopilot", "viewer", "markdown", "bibtex", "ris"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    write_citation(parse_args(sys.argv[1:] if argv is None else argv))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
