# Annotation-transfer fixtures

Synthetic, redistributable test data for the annotation-transfer workflow. Nothing here comes from a real organism or assembly: the contigs are synthetic sequence, as their FASTA headers say (an even base composition and no repeated 12-mers), and the annotation is written by hand with placeholder IDs. The files were written once with the first version of the workflow; no generator is kept, so a change to them is made by hand and checked against the coordinates below.

## Files

| File | Contents |
|---|---|
| `reference.fasta` | Two contigs, `chr1` (3,000 bp) and `chr2` (2,400 bp). |
| `reference.gff3` | One gene on each contig, each with an mRNA, its exons, and its CDS: `gene1` on `chr1:1001–1400` with two exons (`1001–1150`, `1251–1400`) and a two-part CDS sharing the ID `cds1`; `gene2` on `chr2:801–1100` with one exon and one CDS. |
| `target.fasta` | The reference contigs with 30 bp inserted after position 500 of each (`chr1` 3,030 bp, `chr2` 2,430 bp); everything else is identical. |

## Expected transfer

The insertion lies before both genes, so a correct transfer moves every feature 30 bp downstream without changing it: `gene1` to `chr1:1031–1430` and `gene2` to `chr2:831–1130`. The direct-Snakemake tests check these coordinates. Tests that need a broken or unusual input derive it from these files in a temporary directory, rather than adding more fixtures.
