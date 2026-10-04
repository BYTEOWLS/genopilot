# Science background: reviewing unresolved consensus loci in the genome view

Design-time notes on what a researcher gains from the [genome view](genome.md) when reviewing a tie or another unresolved locus of the reference-guided cohort consensus. Once implemented, what researchers need moves into the workflow's `README.md` and `results.md`.

## What a review can decide

A cohort decision changes which isolates vote and the four cohort settings, then reruns the cohort steps. It does not choose an allele at one locus. The genome view therefore helps judge **whether each vote at the locus can be trusted, and what kind of disagreement it is**:

1. **A bad vote**: an isolate's call is an artefact, or the isolate is contaminated. Seen at many loci, it argues for excluding that isolate.
2. **A real split**: the cohort carries two alleles, for example two lineages. The unresolved base is the honest result; the researcher may still reconsider the voting settings, such as the backbone vote.
3. **An unresolvable region**: a repeat, collapsed paralogs, or a structural variant, where short-read votes say little. `N` is the right result.

## The backbone

The backbone is always the reference: every alignment, variant call, and mask is in its coordinates. It also carries evidence of its own:

- **Context**: homopolymers and low-complexity sequence are where assembly and short-read errors cluster.
- **Its vote**: with the backbone vote on, the backbone allele is one side of a tie. If only the backbone and one weak isolate oppose the rest, the backbone vote may be the deciding question; the backbone is one assembled strain and may carry an assembly error.
- **Gaps**: `N` in the backbone casts no vote.

An isolate's own consensus FASTA is in its own coordinates and is not shown as a track on the backbone.

## The isolates

All isolates' variant calls and consensus masks fit on one screen as compact rows: the masks show why an isolate cast no vote (ambiguous or uncallable). Reads are shown for the voters at the locus, grouped by the allele they voted for, so both sides of a tie are next to each other; ambiguous isolates' reads are added on demand, because mixed reads are evidence too.

| What the reads show | What it suggests |
|---|---|
| Low depth, or an allele fraction just above the threshold | a weak vote |
| The allele on one strand only, or only near read ends or soft clips | an artefact, often a misalignment next to an indel |
| Low mapping quality, a coverage spike, many mismatches across the window | a repeat or collapsed paralogs: unresolvable |
| A nearby indel that isolates represent differently (`competing_indel`) | alignment ambiguity rather than a real difference |
| Mixed reads in an isolate that is ambiguous at many sites | contamination or a mixed culture: exclude the isolate |
| The split follows lineage (`derived_from`) | real divergence: the unresolved base is correct |
| The same isolate on the minority side at many loci | that isolate is the problem: exclude it |

The Sites table shows the pattern across loci; the genome view confirms its cause at a few of them.

## Features

- **The loci track**: zoomed out, clusters of unresolved loci within a few kilobases point to a repeat, a structural variant, or a duplication rather than to point differences.
- **Gene annotation**, when the backbone has one (for example the GFF3 of an NCBI accession): an `N` between genes is mostly harmless, one in a coding sequence can break a gene model when annotation is later transferred onto the consensus. With the annotation shown, igv.js translates codons, so a researcher sees whether the alternative alleles would change an amino acid.
