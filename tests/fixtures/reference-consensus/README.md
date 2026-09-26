# Reference-consensus fixtures

Synthetic, redistributable test data for the reference-consensus workflow. Nothing here comes from a real organism, sample, or sequencing run: [`generate.py`](generate.py) simulates every file from a fixed seed using only the Python standard library, and rerunning it reproduces the committed files byte for byte.

```bash
python3 tests/fixtures/reference-consensus/generate.py
```

## Files

| File | Contents |
|---|---|
| `backbone.fasta` | Two random contigs, `chr1` (3,000 bp) and `chr2` (2,400 bp). `chr2:901–1500` is an exact copy of `chr1:301–900`, so reads inside that repeat map with low mapping quality. |
| `reads/<isolate>/*.fastq.gz` | Paired 100 bp reads with Illumina headers and Illumina file names, about 30× per isolate. About 5 % of fragments are shorter than a read, so untrimmed reads run into the adapter. |
| `expected.json` | The truth the reads were simulated from: each isolate's read pairs with their header fields, its normalized variants in 1-based backbone coordinates, and probe positions that must be ambiguous or uncallable. |

## Isolates

| Isolate | Read pairs | Cases |
|---|---|---|
| `iso-a` | one lane-merged pair (records on lanes 1 and 2) | three SNPs, a 3 bp insertion, a 4 bp deletion, a mixed site where 60 % of fragments carry another base (ambiguous), a position read only with base quality 2 (uncallable), and a 150 bp span without any reads (uncallable) |
| `iso-b` | two pairs of one library (same sample name and barcode) from different instruments, runs, and flowcells; the second is marked `trimmed` and has variable read lengths without adapters | three SNPs, one shared with `iso-a`; 40 fragments sequenced in both runs, which must be marked as duplicates |
| `iso-c` | two pairs of two libraries (different barcodes) on one flowcell lane | two SNPs; the same 40 fragments in both libraries, which must not be marked as duplicates of each other |

Every isolate is uncallable inside the repeat. Tests that need a broken or unusual read pair derive it from these files in a temporary directory, rather than adding more fixtures.
