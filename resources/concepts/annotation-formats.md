# Annotation formats

## Goal

Annotation-transfer reads its reference annotation as GFF3 only, and says so clearly when a researcher brings another format. Other formats are added when a researcher needs one, by converting them to GFF3 at the input, so everything after the input step keeps working on one format.

## Current state

The reference annotation comes from a local file or from an NCBI accession, whose download is always GFF3. `check_gff3` in `workflows/annotation-transfer/scripts/validate_inputs.py` checks it before LiftOn starts, and the same check runs on LiftOn's output.

A gap: the check only requires the first line to start with `##gff-version`, whatever the version. GFF2 files, which start with `##gff-version 2`, can therefore pass. Their attributes are written `key value` instead of `key=value`, so every attribute is skipped: each feature only gets the warning that it has no `ID`, and with no `Parent` links read, the hierarchy check finds nothing to reject. LiftOn then receives a format the workflow does not promise to handle. A GTF file without a pragma line is rejected, but the message does not say that it is GTF or what to do.

## Formats researchers bring

| Format | Where it comes from |
|---|---|
| GTF (GFF2-based) | Ensembl and GENCODE publish it next to GFF3; the default of RNA-seq tools such as STAR, featureCounts, and RSEM; NCBI Datasets offers it too. |
| GenBank and EMBL flat files (`.gbk`, `.gbff`, `.embl`) | Sequence and annotation in one file; common for bacteria (Prokka and Bakta write it), RefSeq downloads, and INSDC records. |
| GFF2 | Older files and some tools' output. |
| BED12, genePred, refFlat | UCSC and genome browsers; gene models without a feature hierarchy. |
| NCBI feature table (`.tbl`) | Mainly for submission with `table2asn` (see [INSDC submission](insdc-submission/README.md)). |

## Now: reject other formats clearly

Independent of supporting any other format:

- Require `##gff-version 3` on the first line, and reject every other version.
- When the first feature line looks like GTF or GFF2 (attributes written `key "value";` or `key value`), say which format it appears to be and that it must be converted to GFF3 first, for example with AGAT or gffread.
- Document in the annotation-transfer README that the reference annotation must be GFF3, with the same conversion hint.

## When a format is needed

Convert at the input, not throughout the workflow:

- The researcher chooses the format of a local annotation file in the configuration. GenoPilot never guesses it from the file name or content, because a misread file would silently change the transfer.
- A conversion step after resolving the input turns it into `resolved/reference.gff3` with a converter pinned in its own rule environment, such as AGAT or gffread. Provenance records the original file and its checksum, the converted file and its checksum, and the converter's version and command, and marks the original as `imported` and the GFF3 as `generated`.
- `check_gff3` then validates the converted file like any other, so input validation, LiftOn, the metrics, and the result views stay GFF3-only.
- GenBank and EMBL files also carry the sequence, so they could supply the reference FASTA as well. Whether one file may then fill both inputs is decided with the first such request.

Before choosing between conversion and reading a format directly, check whether LiftOn accepts it as input. Liftoff, which LiftOn builds on, reads GTF; even then, conversion keeps the validation and the metrics on one format.

## Work

- [ ] Reject other GFF3 versions and recognizable GTF or GFF2 files with a clear message; document the GFF3 requirement in the workflow README. Test with a GFF2 file, a GTF file, and a valid GFF3 file.
- [ ] When a researcher needs another format: choose the converter, add the format choice and the conversion step with its provenance, and test the conversion on a small synthetic fixture of that format.

## Acceptance

A researcher who brings a GTF, GFF2, or other non-GFF3 annotation learns before LiftOn starts that it must be GFF3 and how to convert it. A format added later reaches LiftOn as GFF3 that passed the same check, with its original file and the conversion recorded in the run.
