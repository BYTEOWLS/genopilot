# Science background — reference-guided cohort consensus

The science for researchers is in the packaged [workflow README](../../../workflows/reference-consensus/README.md), which ships with the workflow and will be shown in the application: reads, alignment, duplicates, callability, variants, cohort support, the cohort consensus, known limits, the tools used, and their references. This note keeps the design-time research the README does not need: the tools considered instead, and why none of them was used. Numbers in brackets, such as [1], refer to the references at the end.

## Tools considered

| Tool | What it does | Why it is not used here |
|---|---|---|
| GATK HaplotypeCaller with joint genotyping [1] | local reassembly and cohort-wide genotyping | Heavier setup and a Java runtime. Its per-site genotypes still need callable masks and a voting rule on top. BCFtools calls haploid genomes directly. |
| freebayes [2] | haplotype-based calling, including of pooled samples | Also a caller only; it does not decide a cohort allele or report the reason behind an unresolved one. |
| Pilon [3] | polishes one assembly with short reads | Improves one genome from one read set, not a vote across a cohort. |
| iVar consensus [4] | consensus from one sample's reads by an allele-frequency threshold, with IUPAC codes | Per sample. It weighs reads, so depth would count, and it has no backbone vote and no whole-locus ballots. |
| EMBOSS cons [5] | majority consensus of a multiple sequence alignment | Needs aligned full sequences. FASTA-level input would lose the difference between `N` for "no reads" and `N` for "reads disagree", and would lose indel identity. |
| Snippy / snippy-core (GitHub, no DOI) | haploid bacterial calling and a core-SNP alignment | Aimed at bacterial phylogenies. Its core alignment drops or masks non-core sites instead of reporting their votes. |
| vg [6], Minigraph-Cactus [7] | pangenome graphs | Represent structural variation but need assemblies or graph-based calling. That is a different, larger design, and no alternative to a backbone consensus from short reads. |

No existing tool combines whole-locus ballots, authoritative callable masks, an optional backbone vote, and reported ties with their reasons. The workflow therefore uses established tools up to the normalized variants and callable masks, and counts and interprets the votes in small, tested scripts.

## Open point

Which IUPAC codes a GenBank genome submission accepts is not confirmed yet:

- NCBI's [SRA submission standards](https://www.ncbi.nlm.nih.gov/sra/docs/sra-data-submission-standards/) accept every IUPAC nucleotide code (`R Y S W K M B D H V N`), but only for raw reads, which is not where a consensus genome goes.
- The [genome submission guide](https://www.ncbi.nlm.nih.gov/genbank/genomesubmit/) does not mention IUPAC codes. It only restricts `N`: no leading or trailing `N`, and a run of at least the declared minimum length (10 or less) becomes an assembly gap. Both points are handled in the [INSDC submission concept](../insdc-submission/README.md), which also covers ENA and DDBJ.

Until `table2asn` validation confirms it, the consensus writes an unresolved SNP as `N` by default, and IUPAC codes are the researcher's explicit choice ([Task 4.3](4c-combined-consensus-generation.md#kickoff-decisions)). Either way, a coding sequence over such a base needs the same feature review before submission.

## References

1. McKenna A, et al. The Genome Analysis Toolkit: a MapReduce framework for analyzing next-generation DNA sequencing data. *Genome Res* 20:1297–1303 (2010). doi:10.1101/gr.107524.110
2. Garrison E, Marth G. Haplotype-based variant detection from short-read sequencing. arXiv:1207.3907 (2012).
3. Walker BJ, et al. Pilon: an integrated tool for comprehensive microbial variant detection and genome assembly improvement. *PLoS ONE* 9:e112963 (2014). doi:10.1371/journal.pone.0112963
4. Grubaugh ND, et al. An amplicon-based sequencing framework for accurately measuring intrahost virus diversity using PrimalSeq and iVar. *Genome Biol* 20:8 (2019). doi:10.1186/s13059-018-1618-7
5. Rice P, Longden I, Bleasby A. EMBOSS: the European Molecular Biology Open Software Suite. *Trends Genet* 16:276–277 (2000). doi:10.1016/S0168-9525(00)02024-2
6. Garrison E, et al. Variation graph toolkit improves read mapping by representing genetic variation in the reference. *Nat Biotechnol* 36:875–879 (2018). doi:10.1038/nbt.4227
7. Hickey G, et al. Pangenome graph construction from genome alignments with Minigraph-Cactus. *Nat Biotechnol* 42:663–673 (2024). doi:10.1038/s41587-023-01793-w
