"""Write how to cite the finished run.

What it does
  Runs after the provenance, from which it takes the GenoPilot version and
  build, the workflow, the effective configuration, and the tool versions.

  Reads:  provenance/run.json
          <workflow>/citation/references.json, methods.txt, and phrases.json
          shared/citation/genopilot.json and igv.json
  Writes: citation/CITATION.md     - the tools that ran with their versions and
                                     references, the genome viewer that shows
                                     the results, a draft methods paragraph, and
                                     BibTeX and RIS; a run of a development build
                                     is marked as not citable
          citation/references.bib, citation/references.ris

Maintainer notes
  Requires `WORKFLOW_DIR`, `SHARED_DIR`, and `PYTHON_SH` from the including
  Snakefile; the citation files are found there by convention.
"""

import shlex

WRITE_CITATION_SH = shlex.quote(str(SHARED_DIR / "scripts" / "write_citation.py"))


rule write_citation:
    input:
        provenance="provenance/run.json",
        # Packaged files: installing another GenoPilot version touches them, which must not
        # rewrite the citation of a finished run.
        references=ancient(WORKFLOW_DIR / "citation" / "references.json"),
        methods=ancient(WORKFLOW_DIR / "citation" / "methods.txt"),
        phrases=ancient(WORKFLOW_DIR / "citation" / "phrases.json"),
        genopilot=ancient(SHARED_DIR / "citation" / "genopilot.json"),
        viewer=ancient(SHARED_DIR / "citation" / "igv.json"),
    output:
        markdown="citation/CITATION.md",
        bibtex="citation/references.bib",
        ris="citation/references.ris",
    log:
        "logs/write-citation.log",
    shell:
        "{PYTHON_SH} {WRITE_CITATION_SH}"
        " --provenance {input.provenance:q}"
        " --references {input.references:q}"
        " --methods {input.methods:q}"
        " --phrases {input.phrases:q}"
        " --genopilot {input.genopilot:q}"
        " --viewer {input.viewer:q}"
        " --markdown {output.markdown}"
        " --bibtex {output.bibtex}"
        " --ris {output.ris}"
        " > {log} 2>&1"
