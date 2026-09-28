# Reference-guided cohort consensus

Builds one consensus genome from the paired Illumina reads of many isolates. Every isolate's reads are called against one backbone assembly. The isolates' alleles, and optionally the backbone's, then vote at each position, and the winning allele by strict majority or plurality forms the cohort consensus.

Status: the initial cohort consensus is implemented. Every isolate gets its alignment, callable mask, normalized variants, and reference-guided FASTA. The votes of the backbone and the callable isolates are counted at every backbone position, and the configured voting method picks the winning allele or leaves the position unresolved. A saved cohort decision reruns only the cohort steps as a new iteration, for example to exclude an isolate (see *Iterations*). GenoPilot shows the results of every isolate and iteration, but does not yet offer a screen to review ties and save such a decision.

## Inputs

- **Backbone**: one assembly FASTA, either a local file or a versioned NCBI assembly accession. It supplies the coordinates and every base an isolate does not change.
- **Isolates**: the selected isolates and their read pairs (R1/R2 FASTQ files), taken from a snapshot of the isolate catalog made when the run was created. Later catalog edits never change an existing run.

The reads must keep their original Illumina read names, because the read groups are derived from them (see *Read groups*).

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| Voting method | strict majority | Strict majority needs more than half of the votes cast; plurality needs the unique highest vote count. |
| Backbone vote | yes | Whether the backbone casts one vote next to the callable isolates. |
| Minimum callable isolates | 0 | Voting isolates a position needs; below it the consensus writes `N`. At most the number of selected isolates. |
| Unresolved SNPs | N | How an unresolved SNP (a tie or no majority) is written: `N`, or the IUPAC code of the alleles that received votes. |
| Ploidy | 1 | Fixed: isolates are called haploid. |
| Minimum read depth | 10 | Reads needed at a position, counted after the quality filters and without duplicates. |
| Minimum mapping quality | 20 | Reads mapped with a lower quality are not counted. |
| Minimum base quality | 20 | Bases with a lower quality are not counted. |
| Minimum allele fraction | 0.8 | Share of the counted reads the winning allele needs; above 0.5 and at most 1. |

## Background

This section explains the terms the rest of this page uses. Numbers in brackets, such as [1], refer to the *References* at the end.

### Reads and quality

Every isolate is sequenced with Illumina paired-end sequencing [1]: its DNA is broken into fragments a few hundred bases long, and each fragment is read from both ends. The two reads of a fragment land in two FASTQ files, R1 and R2 [2]. Every letter of a read carries a base quality, a Phred score for the chance that the letter is wrong [3]: 20 means 1 error in 100, and 30 means 1 in 1,000. Reads are trimmed only lightly [4] (see *Tools*).

### Alignment

Short reads cannot be assembled into a complete genome on their own, so each read is aligned, or mapped, to the backbone [5, 6] and stored in a BAM file [7]. The aligner reports a mapping quality: its confidence that the read belongs where it was placed. It is low when a read fits equally well in several places, as in repeats and duplicated genes, and such reads are not counted. **Depth**, or coverage, is the number of usable reads at a position. The best backbone is a telomere-to-telomere (T2T) assembly, complete from end to end and built from long reads [8].

### Haploid isolates

Isolates are called haploid: each has one copy of every position, so a clean isolate shows a single **allele**, one variant form of the position. Mixed reads at a position therefore point to contamination, a mixed culture, or reads of duplicated genes collapsed onto one copy, never to a heterozygous site as in a diploid organism. This is why a position with mixed reads is *ambiguous* rather than a call (see *Callability*).

### Variants

Variant calling lists where an isolate differs from the backbone, in a VCF file [9]:

- **SNP**: one base exchanged for another;
- **indel**: bases inserted or deleted;
- **multiallelic site**: more than two alleles at one position across the cohort, for example backbone `C`, one isolate `A`, another `T`.

The same deletion in a repeat, such as one `A` removed from `AAAA`, can be written at several positions. **Normalization** writes every variant in one canonical form: shifted as far left as possible, with one record per alternative allele [10]. The same event then looks the same in every isolate and can be counted.

## Steps

The workflow runs three stages before any isolate is processed:

1. **Resolve backbone**: copy the local FASTA or download the NCBI accession, and record its checksum.
2. **Validate inputs**: check the backbone FASTA's structure and that every read file can be read.
3. **Index backbone**: build the bwa and samtools indexes.

Then, for every read pair of every isolate:

4. **Validate read pair**: check the read names and record counts, derive the read group, and checksum both files.
5. **Trim**: fastp read QC and light adapter trimming.
6. **Align**: bwa mem with the pair's read group, then samtools fixmate and sort.

And for every isolate:

7. **Mark duplicates**: merge the isolate's read pairs and mark duplicates per library.
8. **Alignment metrics**: samtools stats, flagstat, and per-contig coverage.
9. **Call all sites**: bcftools mpileup and call, haploid, at every covered position.
10. **Classify callability**: decide for every backbone base whether it is callable, ambiguous, or uncallable.
11. **Filter and normalize variants**: mark every variant `PASS` or with a named filter, split multiallelic records, and left-align them.
12. **Build isolate consensus**: apply the `PASS` variants to the backbone and mask every base that is not callable with `N`.
13. **Summarize isolate**: metrics, provenance, and the promotion candidate.

Once every isolate is processed:

14. **Aggregate support**: count the backbone's and the callable isolates' votes at every backbone position (see *Cohort support*).
15. **Generate consensus**: pick the winning allele at every position with the voting method, and record every selected and unresolved site (see *Cohort consensus*).

Finally, **record provenance** writes the run's artifact index and provenance record.

Isolates are processed independently and in parallel. A failing isolate is reported as a failed job while the others finish. The cohort steps then do not run, so an isolate never drops out of the vote unnoticed; leaving it out is a separate, reviewed decision.

The other isolates still finish, although the cohort steps wait, because:

- every failure shows up in one pass, instead of one per attempt, which matters when a run takes hours;
- finished isolates are kept, and the next attempt in the same run directory redoes only what is missing: the fixed isolate and the cohort steps;
- each isolate's results, such as its FASTA, variants, and callable mask, are valid on their own, also without a cohort consensus;
- an isolate that cannot be fixed can be excluded later with a reason, in the same run, without processing the others again.

## Read groups

A read group labels where reads came from: the sequencing run, lane, library, and sample. Every read in a BAM file carries its read group, so reads from different read pairs remain distinguishable after they are merged into one isolate alignment.

Every read pair gets its own read group, derived from its Illumina read names and file name. A read name looks like this:

```text
@A00123:45:HXYZ7DSX2:2:1101:1000:2000 1:N:0:ACGTACGT+TGCATGCA
```

Its fields are instrument (`A00123`), run (`45`), flowcell (`HXYZ7DSX2`), lane (`2`), tile and position, and, after the space, the barcode (`ACGTACGT+TGCATGCA`). The R1 file name follows the pattern `<sample>_S<n>[_L<lane>]_R1_<chunk>.fastq.gz`, for example `NID42_S7_L002_R1_001.fastq.gz`.

| Field | Meaning | Derived from | Example |
|---|---|---|---|
| `ID` | Unique key of the read group | flowcell, lane, barcode | `HXYZ7DSX2.2.ACGTACGT+TGCATGCA` |
| `PU` | Platform unit | same as `ID` | `HXYZ7DSX2.2.ACGTACGT+TGCATGCA` |
| `SM` | Sample | isolate ID | the isolate ID |
| `LB` | Library | sample name from the R1 file name, barcode | `NID42.ACGTACGT+TGCATGCA` |
| `PL` | Platform | fixed | `ILLUMINA` |

- The lane is part of `ID` and `PU` only when every read of the pair has the same lane. A lane-merged delivery combines all lanes of a flowcell in one file, so its read group carries no lane.
- The barcode keeps the `ID` distinct when two libraries were sequenced on the same lane. It is taken from the first read.
- When the R1 file name does not follow the Illumina pattern, the isolate ID is used as the library's sample name.

A read pair fails validation when:

- a read name is not an Illumina read name;
- a read name disagrees with the first one on instrument, run, or flowcell (lanes may differ);
- R1 and R2 hold different numbers of reads, which bwa does not check.

An isolate fails when two of its read pairs have the same read group `ID`, which means the same lane and barcode were listed twice.

Reads downloaded from a public archive often lost their Illumina read names and cannot be processed yet.

## Duplicates

PCR duplicates arise when one library preparation is amplified, so the same library sequenced in several runs can contain duplicates across those runs. Reads of different libraries are never duplicates of each other, even at identical coordinates.

Duplicates are therefore marked per library, using the read groups' `LB`. Each library's read pairs are merged and marked on their own, and the marked libraries are then merged into the isolate's alignment. samtools markdup alone would compare read groups, which are one per read pair, instead of libraries.

Duplicates are marked, never removed, and the variant caller ignores them [11]. Removing them has little effect on the accuracy of the calls [12], and marking keeps the evidence in the alignment.

## Callability

Every backbone base of an isolate gets one of three states, from the calls of bcftools [11, 13]. Depth is the number of reads at the position after the mapping-quality, base-quality, and duplicate filters.

| State | Meaning |
|---|---|
| callable | depth reaches the minimum read depth, and one allele reaches the minimum allele fraction |
| ambiguous | enough reads, but no allele reaches the fraction; in a haploid isolate this points to contamination, a mixed culture, or collapsed paralogs |
| uncallable | too few usable reads, including positions without any coverage and repeats where reads map with low quality |

Indels refine the bases they span. A callable deletion makes the backbone bases it removes callable, because the reads carry the deletion. An indel whose allele has more than `1 - fraction` but less than the fraction of the reads makes its span ambiguous. A smaller indel allele is treated as noise.

## Isolate FASTA

The isolate FASTA is the backbone with the isolate's `PASS` variants applied and every ambiguous or uncallable base replaced by `N`. It contains only `A`, `C`, `G`, `T`, and `N`, and keeps the backbone's sequence names and order. Lowercase soft-masking in the backbone is dropped, because it is annotation rather than sequence. A chain file maps backbone coordinates onto the FASTA's, and the callable mask says why a base is `N`.

The FASTA is checked before anything depends on it: samtools must index it, its sequences must match the backbone's in name and order, and it must contain no other characters.

## The backbone's role

Short reads cannot be assembled into a complete genome on their own, so every isolate is read against the backbone. The backbone supplies the coordinates, so a position such as `chr1:1100` means the same base in every isolate, and it supplies the genome's structure: its chromosomes, their order, and its repeats. A complete telomere-to-telomere (T2T) assembly, built from long reads, is the best available choice [8].

This has known limits, which apply to every result of this workflow:

- **Reference bias**: regions where an isolate differs strongly from the backbone map poorly and become uncallable, so the consensus leans towards the backbone there [14].
- **Structural variation is not seen**: sequence the isolates have but the backbone lacks, such as extra genes or large insertions, and rearrangements do not appear. The consensus has the backbone's architecture with the cohort's alleles. Pangenome graphs are designed to represent such variation [15].
- **Backbone-only regions**: where no isolate is callable, as in repeats, the backbone's vote is the only evidence, or there is none when the backbone does not vote.
- **The backbone is one strain**: its vote counts like one more isolate. When the backbone's strain is also among the isolates, that strain votes twice.

## Cohort support

Before a winner is chosen, the evidence is counted like ballots at every backbone position:

- the backbone casts one vote when the backbone vote is on, but not where its own base is not `A`, `C`, `G`, or `T`, such as `N` in an assembly gap;
- every isolate that is callable at the position casts one vote: for its variant allele when it has a `PASS` variant there, and for the backbone allele otherwise;
- an ambiguous or uncallable isolate casts no vote, so missing evidence never counts as agreement with the backbone;
- read depth never adds votes: an isolate with 200 reads counts the same as one with 20.

The votes come from each isolate's normalized variants and callable mask, not from its FASTA. In the FASTA, indels shift the positions, so the same position number means different bases in different isolates, and `N` no longer says whether the reads disagreed or were missing.

### Overlapping variants

A variant covers one or more backbone bases: a SNP covers one base, a deletion covers the bases it removes plus the base before them, and an insertion covers the base it follows. Two variants overlap when they cover a common base. Within one haploid isolate this should not happen, but variants of different isolates often do. For example, around `chr1:2200`:

```text
position  2200 2201 2202 2203 2204
backbone    A    T    C    C    T
isolate 1   A    -    -    -    -     deletion of TCCT
isolate 2   A    T    C    C    T     no variant
isolate 3   A    T    G    C    T     SNP C to G at 2202
```

Counted base by base, isolate 1 has no base at 2202 at all, so it could neither vote for `C` nor for `G`, although its reads clearly show the deletion. Overlapping variants of different isolates therefore form one **locus**, and every voter chooses one complete version of it:

| Allele of 2200–2204 | Voters | Votes |
|---|---|---|
| `ATCCT` | backbone, isolate 2 | 2 |
| `A` | isolate 1 | 1 |
| `ATGCT` | isolate 3 | 1 |

Every voter casts at most one vote at a locus, and it votes only when every base of the locus is callable for it. Such a locus is flagged, so it can be reviewed. Most loci are a single SNP and are unaffected. This is how the evidence is written down, not a choice between scientific methods, so it is not a parameter.

### Flags

| Flag | Meaning |
|---|---|
| `snp` | a single base, and no isolate's variant there is an indel |
| `indel` | at least one isolate's variant or allele is longer or shorter than the backbone allele |
| `multiallelic` | more than two alleles, the backbone's included, for example backbone `C`, one isolate `A`, another `T` |
| `overlapping` | variants of different isolates with different spans were merged into this locus |
| `competing_indel` | an indel competes with at least one other non-backbone allele |
| `unsupported` | an isolate's variants could not be applied, for example its own variants overlap or its allele is not written in `A`, `C`, `G`, and `T`; it casts no vote. A base change and an indel at the same position, which the caller reports as two variants, are combined and supported |
| `backbone_not_acgt` | the backbone's allele has another base than `A`, `C`, `G`, or `T`; the backbone casts no vote |

## Cohort consensus

The consensus counts the ballots of the support table. At every locus, and in every run of bases outside the loci, it decides in this order:

1. **No votes**: nobody voted, because the backbone does not vote and no isolate is callable. The position is unresolved.
2. **Too few callable isolates**: fewer isolates voted than the minimum of callable isolates. The position is unresolved, also when the backbone voted.
3. **The voting method**: with strict majority, an allele wins with more than half of the votes cast; with plurality, the allele with the unique highest count wins. Otherwise the position is unresolved, as a tie when several alleles share the highest count, and as no majority otherwise.

| Votes | Strict majority | Plurality |
|---|---|---|
| `A=6, C=4` | `A` | `A` |
| `A=5, C=5` | unresolved (tie) | unresolved (tie) |
| `A=4, C=3, G=3` | unresolved (no majority) | `A` |
| `A=4, C=4, G=2` | unresolved (tie) | unresolved (tie) |

A winning allele replaces the locus's whole backbone span. When a deletion wins, the consensus becomes shorter, and when an insertion wins, longer, so a position in the consensus can differ from the same position in the backbone. The consensus sites table lists both coordinates.

An unresolved position never becomes a concrete base:

- **An unresolved SNP**, where every allele that received a vote is one base, is written as `N`, or as the IUPAC ambiguity code of those alleles [16] when *Unresolved SNPs* is set so. For example, `A=5, G=5` becomes `R` (`A` or `G`), and `A=4, C=3, G=3` becomes `V` (`A`, `C`, or `G`). Some tools and submission checks do not accept every IUPAC code, so `N` is the default.
- **An unresolved indel** is always written as `N` for every backbone base of the locus, because no IUPAC code can say "`ATCCT` or `A`". The consensus therefore keeps the backbone's length there. For example, in the locus of *Overlapping variants* (backbone `ATCCT` at `chr1:2200–2204`), when the backbone does not vote, the three isolates vote `A`, `ATCCT`, and `ATGCT` once each, and the consensus holds `NNNNN` there.
- **Positions without enough votes** are written as `N` for every base.

A base where only the backbone voted keeps the backbone base when the minimum of callable isolates is 0. Such bases, for example in repeats no isolate can be called in, are counted as *backbone only* in the summary. With a minimum of 1 or more, they become `N` instead. A backbone base that is not `A`, `C`, `G`, or `T`, such as `N` in an assembly gap, stays `N`. Lowercase soft-masking is dropped, as in the isolate FASTA.

The result is a cohort consensus: the backbone's structure with the cohort's most supported alleles. It can combine alleles that no single isolate carries together. It is not the genome of one individual and not an assembly.

## Iterations

After a run, the researcher may decide that an isolate should not vote, for example because its coverage turned out too low, or that another voting method fits better. Such a change touches only the cohort steps, so it is made in the same run directory as a new iteration instead of a new run, and no isolate is aligned or called again. The first cohort, in `results/cohort/initial/`, is iteration 1 and stays unchanged, as does every later iteration.

A decision is saved as `decisions/iteration-<n>.yaml`, numbered from 2, and names:

- the isolates that vote and the isolates excluded from voting, which together are the run's selected isolates; at least one isolate votes;
- the four cohort settings: the voting method, the backbone vote, the minimum of callable isolates (at most the number of voting isolates), and the representation of unresolved SNPs;
- the reason for the decision and when it was made.

Excluding an isolate applies to the whole genome, never to single positions. Wild-type status and lineage can inform the decision but never make it. A change to the calling thresholds, the backbone, or the reads still needs a new run, because every isolate's results depend on them.

The iteration runs by asking Snakemake for its provenance record, `provenance/cohort/iteration-<n>.json`. It aggregates the support of the voting isolates only, generates the consensus with the decision's settings, and records the result, all in `results/cohort/iteration-<n>/`, with the same files as the first cohort. Run it as a dry run first: it must plan only `aggregate_support`, `generate_consensus`, and `record_iteration_provenance`. If it plans more, the per-isolate results are out of date, for example after an update of the workflow, and the change needs a new run.

**An isolate that failed**, for example because its reads are unusable, stops the first cohort, so the run cannot complete. When the failure cannot be fixed, a decision that excludes it creates the first cohort as iteration 2, from the other isolates' existing results. The failed isolate's logs and partial results stay in place, and the iteration's provenance records it as excluded and `incomplete`, and that the first cohort was never aggregated.

## Outputs

Paths are inside the run directory. Positions in the support tables are 1-based and inclusive, like in a VCF.

| Path | Content |
|---|---|
| `resolved/backbone.fasta` | the resolved backbone and its indexes |
| `results/input-validation.json` | backbone and read-file validation |
| `results/isolates/<isolate>/pairs/<n>/read-validation.json` | read group, sequencing run fields, and checksums of read pair `n` |
| `results/isolates/<isolate>/pairs/<n>/fastp.json`, `fastp.html` | read QC and trimming report |
| `results/isolates/<isolate>/alignment.bam` | merged, duplicate-marked alignment and index |
| `results/isolates/<isolate>/markdup.json` | duplicates per library |
| `results/isolates/<isolate>/samtools-stats.txt`, `flagstat.json`, `coverage.tsv` | alignment metrics |
| `results/isolates/<isolate>/all-sites.bcf` | calls at every covered position, the evidence behind the mask |
| `results/isolates/<isolate>/callable-mask.bed` | the state of every backbone base |
| `results/isolates/<isolate>/consensus-mask.bed` | the ambiguous and uncallable intervals only |
| `results/isolates/<isolate>/callability.json` | bases per state, per contig and in total |
| `results/isolates/<isolate>/variants.vcf.gz` | normalized variants, each `PASS`, `LowDepth`, or `LowAlleleFraction` |
| `results/isolates/<isolate>/consensus.fasta` | the isolate FASTA, its index, and `consensus.chain` |
| `results/isolates/<isolate>/metrics.json` | the isolate's metrics |
| `results/isolates/<isolate>/provenance.json` | the isolate's read pairs, parameters, tool versions, and checksums |
| `results/isolates/<isolate>/promotion-candidate.json` | what is needed to copy the isolate FASTA into the isolate catalog |
| `results/cohort/initial/support-sites.tsv.gz` | one row per variant locus: the backbone allele and its vote, the alleles and their votes, flags, and every isolate's allele or state; indexed with tabix |
| `results/cohort/initial/support-intervals.tsv.gz` | every backbone base in runs with the same voters: the backbone vote, the number of callable, ambiguous, and uncallable isolates, and every isolate's state as one letter (`c` callable, `a` ambiguous, `u` uncallable) in the order of the `## isolates:` header line, so `cau` means the first isolate is callable, the second ambiguous, and the third uncallable; inside a locus, the sites table is authoritative; indexed with tabix |
| `results/cohort/initial/support-summary.json` | voters, the backbone vote, input checksums, bases by number of votes, loci per flag, the allele frequency spectrum, and per-isolate counts |
| `results/cohort/initial/consensus.fasta` | the cohort consensus, with the backbone's sequence names and order, and its index |
| `results/cohort/initial/consensus-sites.tsv.gz` | one row per locus of the support table with its decision (`selected` or `unresolved`), reason (`tie`, `no_majority`, `no_votes`, `few_callable`), selected allele, the sequence written, its span in the backbone and in the consensus, votes, and flags; and one row per run of unresolved bases outside the loci (`kind` `region`), which are `N` throughout; indexed with tabix |
| `results/cohort/initial/consensus-summary.json` | the voting method, the minimum, the SNP representation, voters, checksums of the inputs and the FASTA, sequence lengths, loci by decision and reason (also per support flag and by total votes), and bases written from the backbone alone, as IUPAC codes, and as `N` per reason |
| `decisions/iteration-<n>.yaml` | a saved cohort decision (see *Iterations*) |
| `results/cohort/iteration-<n>/` | the support tables, consensus, and summaries of iteration `n`, with the same files as `results/cohort/initial/` |
| `provenance/cohort/iteration-<n>.json` | the decision's checksum, the voting isolates with the checksums of what they voted with, every excluded isolate as `completed` or `incomplete`, whether the first cohort was aggregated, the iteration's checksummed outputs, and its commands |
| `artifacts.yaml` | every artifact of the run with its checksum and origin |
| `provenance/run.json` | configuration, inputs, tool versions, and commands of the whole run; with `artifacts.yaml`, the record of the first cohort |
| `logs/` | the log and benchmark of every step |

Trimmed reads and per-pair alignments are temporary: the isolate's alignment keeps every read, and the fastp reports record what trimming did.

## Tools

Every scientific step runs in one pinned environment; Snakemake schedules the steps.

| Tool | Version | Role | Reference |
|---|---|---|---|
| Snakemake | 9.26.1 | scheduling, per-step environments, reruns | [17] |
| fastp | 1.3.7 | read QC and light adapter trimming | [4] |
| bwa mem | 0.7.19 | read alignment | [5, 6] |
| samtools | 1.24 | sorting, duplicate marking, alignment statistics, FASTA indexes | [7, 11] |
| bcftools | 1.24 | pileup, haploid calling, normalization, isolate FASTA | [11, 13] |
| htslib (bgzip, tabix) | 1.24 | compressed, indexed support and consensus tables | [11, 18] |

Callability, cohort support, and consensus generation are small scripts that read these tools' outputs.

Publications that use this workflow's results should cite the tools above, next to the GenoPilot version that produced them.

Every option that changes a result is set explicitly rather than left to a tool default:

- **fastp**: adapters detected for paired-end reads; quality filtering off, because the aligner soft-clips and the caller weighs base qualities; reads shorter than 30 bp dropped; poly-G tails of at least 10 bases trimmed on every instrument.
- **bwa mem**: a fixed batch size, so alignments do not depend on the number of threads.
- **bcftools mpileup**: maximum depth 10000; unmapped, secondary, QC-failed, and duplicate reads skipped; indel candidates need at least 2 reads and a 5% share. Base-alignment quality stays at the pinned default, which the recorded command and version document.
- **bgzip and tabix** (HTSlib): compress and index the support and consensus tables.

Trimmed input runs through the same steps, which then change little. Untrimmed input is preferred, because aggressive provider trimming mostly discards data the aligner and caller could use. Whether an isolate's reads were trimmed is recorded in its metrics and provenance.

## References

1. Bentley DR, et al. Accurate whole human genome sequencing using reversible terminator chemistry. Nature 456:53–59 (2008). doi:10.1038/nature07517
2. Cock PJA, Fields CJ, Goto N, Heuer ML, Rice PM. The Sanger FASTQ file format for sequences with quality scores, and the Solexa/Illumina FASTQ variants. Nucleic Acids Res 38:1767–1771 (2010). doi:10.1093/nar/gkp1137
3. Ewing B, Green P. Base-calling of automated sequencer traces using Phred. II. Error probabilities. Genome Res 8:186–194 (1998). doi:10.1101/gr.8.3.186
4. Chen S, Zhou Y, Chen Y, Gu J. fastp: an ultra-fast all-in-one FASTQ preprocessor. Bioinformatics 34:i884–i890 (2018). doi:10.1093/bioinformatics/bty560
5. Li H, Durbin R. Fast and accurate short read alignment with Burrows–Wheeler transform. Bioinformatics 25:1754–1760 (2009). doi:10.1093/bioinformatics/btp324
6. Li H. Aligning sequence reads, clone sequences and assembly contigs with BWA-MEM. arXiv:1303.3997 (2013).
7. Li H, et al. The Sequence Alignment/Map format and SAMtools. Bioinformatics 25:2078–2079 (2009). doi:10.1093/bioinformatics/btp352
8. Nurk S, et al. The complete sequence of a human genome. Science 376:44–53 (2022). doi:10.1126/science.abj6987
9. Danecek P, et al. The variant call format and VCFtools. Bioinformatics 27:2156–2158 (2011). doi:10.1093/bioinformatics/btr330
10. Tan A, Abecasis GR, Kang HM. Unified representation of genetic variants. Bioinformatics 31:2202–2204 (2015). doi:10.1093/bioinformatics/btv112
11. Danecek P, et al. Twelve years of SAMtools and BCFtools. GigaScience 10:giab008 (2021). doi:10.1093/gigascience/giab008
12. Ebbert MTW, et al. Evaluating the necessity of PCR duplicate removal from next-generation sequencing data and a comparison of approaches. BMC Bioinformatics 17(Suppl 7):239 (2016). doi:10.1186/s12859-016-1097-3
13. Li H. A statistical framework for SNP calling, mutation discovery, association mapping and population genetical parameter estimation from sequencing data. Bioinformatics 27:2987–2993 (2011). doi:10.1093/bioinformatics/btr509
14. Günther T, Nettelblad C. The presence and impact of reference bias on population genomic studies of prehistoric human populations. PLoS Genet 15:e1008302 (2019). doi:10.1371/journal.pgen.1008302
15. Eizenga JM, et al. Pangenome graphs. Annu Rev Genomics Hum Genet 21:139–162 (2020). doi:10.1146/annurev-genom-120219-080406
16. Cornish-Bowden A. Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984. Nucleic Acids Res 13:3021–3030 (1985). doi:10.1093/nar/13.9.3021
17. Mölder F, et al. Sustainable data analysis with Snakemake. F1000Research 10:33 (2021). doi:10.12688/f1000research.29032.2
18. Li H. Tabix: fast retrieval of sequence features from generic TAB-delimited files. Bioinformatics 27:718–719 (2011). doi:10.1093/bioinformatics/btq671
