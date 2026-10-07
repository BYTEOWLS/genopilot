# Citing runs

Implemented as part of the [public release](../public-release.md): every run records the GenoPilot that saved it and says how to cite it, so citing never depends on the researcher reconstructing versions afterwards.

## The GenoPilot version in provenance

Every saved configuration has a required `genopilot` section: the `package.json` version and, when known, the build's commit, its committer date, whether the working tree had uncommitted changes, and whether it is a release build (`released`: the build `pnpm publish` makes through `prepublishOnly`, which refuses uncommitted changes; a local build or running the sources is never a release, and the tag is not checked). The provenance scripts copy it into `provenance/run.json` and each iteration's provenance, so a direct Snakemake run reports the version that saved its configuration. The result page and the browser's provenance footer show it; a release shows only its version.

Decisions:

- A reference-consensus iteration records the version that saved the configuration, not the one that ran the iteration. Passing the running version as a `--config` override would change the configuration Snakemake sees and make the iteration's dry-run check refuse it; an iteration runs the same workflow version, and the result page already flags a mismatch.
- The section is required. No runs exist from before it, so there is no fallback for a missing version.

## Citation file per run

Every finished run writes `citation/CITATION.md`, with `citation/references.bib` and `citation/references.ris` beside it, from its `provenance/run.json` (the shared rule `write_citation`). It contains:

- whether the run is citable: only a run saved by a release build is; a development build is marked as not citable, following [Coordinating with a publication](../zenodo-release-archiving.md#coordinating-with-a-publication);
- the workflow ID and version, and the GenoPilot version;
- the tools that ran, with the versions the run observed, falling back to the pinned version where the run could not observe one;
- a draft methods paragraph naming every parameter that changes a result, which the researcher checks and adapts;
- the GenoPilot citation and the tools' references, written out in full, and the same references as BibTeX and RIS.

The tool references are written out in full rather than linked. Researchers cite what is in front of them; a link to the workflow README alone would leave most papers citing GenoPilot only, and GenoPilot is the wrapper, not the method. The file lists only the tools that ran in this run, for example not the NCBI Datasets CLI when no input was an accession.

Each workflow keeps, by convention, `citation/references.json` (its README's references with structured fields, and its `## Tools` rows mapped to them) `citation/methods.txt` (the methods paragraph as a template), and `citation/phrases.json` (the wording of setting values in it, so a value without wording fails rather than appearing raw); `workflows/shared/citation/genopilot.json` holds GenoPilot's own entry. A test keeps the README lists and `CITATION.cff` equal to these files, and the workflow tests fill every template. JSON, because rule scripts use only the standard library.

The result page has a Citation tab, and the run's files list the file. `v` on the tab opens the citation in the [browser view](../../../docs/browser-view.md), and every view opened from the run's results has a **Cite this run** button in its header that shows it in a dialog. There, the whole citation and each `##` section (methods, references, BibTeX, RIS) get a copy button that copies plain text without Markdown markup; if the clipboard is refused, the button says so and shows the text selected. The page is served from `127.0.0.1`, which browsers treat as a secure origin, so the clipboard API is available, also through an SSH port forward. The terminal offers no copy action; terminal clipboard support varies too much to rely on.

Decisions:

- **The version DOI.** A version's DOI exists only after its release is published, so it cannot be compiled into that release. The citation file names the version and, once one exists, the concept DOI, whose Zenodo record lists every version DOI. Looking the version DOI up through Zenodo's records API when the citation is shown is deferred until the first release has a concept DOI, since there is nothing to look up before.
- **The methods paragraph names every parameter** that changes a result, not only those that differ from the defaults.
- **Snakemake's paper** is a versioned F1000Research article whose DOIs name a version and which has no version-free DOI, so the references cite its latest version (3). A new paper version is rare and independent of the Snakemake pin; update the reference when one appears.
