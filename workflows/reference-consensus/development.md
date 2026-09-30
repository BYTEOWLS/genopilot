# Reference consensus: maintainer notes

## Updating the short-read-calling tools

fastp, bwa, samtools, bcftools, and HTSlib are pinned together in the [`short-read-calling`](envs/short-read-calling/environment.yaml) environment. A version change updates that pin, and additionally requires re-verifying everything that depends on the exact options, files, and values these tools write. Check the release notes of every changed tool, then update any changed behavior in:

| File | Depends on |
|---|---|
| `workflows/reference-consensus/rules/align_reads.smk` | fastp options and its JSON report; `bwa mem -K`, which keeps alignments independent of the thread count |
| `workflows/reference-consensus/scripts/samtools_markdup_per_library.py` | `samtools merge` and `samtools markdup` options, and the fields of `samtools markdup --json` |
| `workflows/reference-consensus/rules/call_variants.smk` | `bcftools mpileup`, `call`, `filter`, and `norm` options, the default base-alignment quality, and the `bcftools query` layout `CHROM POS REF ALT AD` |
| `workflows/reference-consensus/scripts/classify_callability.py` | How `FORMAT/AD` counts reads at reference-only and indel records |
| `workflows/reference-consensus/scripts/summarize_isolate.py` | fastp JSON fields, the `QC-passed reads` section of `samtools flagstat -O json`, the columns of `samtools coverage`, and the `SN` lines of `bcftools stats` |
| `workflows/reference-consensus/README.md` | The options listed under *Tools*, when a default or an explicit option changes |

Then run the full verification including the per-rule Conda integration tests, as described under *Updating a pinned version* in the repository README. Their expected results on the synthetic fixtures detect changes in alignment, calling, and callability.
