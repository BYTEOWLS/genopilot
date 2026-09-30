# Reference-guided cohort consensus results

This page explains every item of the cohort consensus result page, grouped by its tabs. The science behind it is explained in the workflow's [README](README.md); the terms at the end of this page summarize what the tables refer to. The run metadata and run files every workflow shows are explained in the general [run results](../../docs/run-results.md) page.

## Run status

Whether a cohort consensus is available, worked out from the records the workflow wrote: it is available once any cohort completed, and the active one is the latest. Without one, the status names the isolates that have not completed. Paths marked missing should exist but do not.

## Overview

### Backbone

| Item | Meaning |
|---|---|
| Source | Where the backbone assembly came from: a local FASTA file or a versioned NCBI assembly accession. |
| Accession | The NCBI accession or the local file the backbone was copied from when the run resolved it. |
| SHA-256 | SHA-256 of the resolved backbone FASTA. Every isolate and cohort result of this run was computed against exactly this file. |
| Origin | Imported: the backbone came from outside the workflow. For an NCBI accession it also says whether it was downloaded in this run or reused from the verified download cache. |

### Active cohort

| Item | Meaning |
|---|---|
| Active iteration | The cohort whose consensus is current: the highest-numbered completed one. The initial cohort is iteration 1; every saved decision adds an iteration without changing earlier ones. |
| Voting method | How a winner is chosen. Strict majority needs more than half of the votes cast; plurality needs the unique highest vote count. |
| Backbone votes | Whether the backbone casts one vote of its own at every position of the active cohort, next to the callable isolates. It never votes where its own base is not A, C, G, or T, such as `N` in an assembly gap. |
| Minimum callable isolates | How many isolates must vote at a position. Below it the position is unresolved and written as `N`, also when the backbone voted. 0 lets the backbone vote alone decide where no isolate is callable. |
| Unresolved SNPs written as | How an unresolved single-base position is written: `N`, or the IUPAC code of every base that received a vote, such as `R` for A or G. |
| Voting isolates | The isolates whose calls vote in this cohort. An isolate votes at a position only where it is callable, and each isolate has one vote regardless of its read depth. |

### Consensus

Loci are counted in loci, bases in bases; a locus is explained under *Terms*.

| Item | Meaning |
|---|---|
| Selected loci | Loci where the voting method chose an allele. A locus is one row of the support table: a variant position, or several overlapping variants merged into one ballot. |
| Selected loci differing from the backbone | Selected loci whose winning allele differs from the backbone's, so the consensus changes the backbone there. |
| Unresolved loci: tie | Loci where several alleles share the highest vote count. |
| Unresolved loci: no majority | Loci where, with strict majority, no allele received more than half of the votes and the top allele is not tied. Plurality has no such loci. |
| Unresolved loci: no votes | Loci where nobody voted: no isolate was callable there and the backbone did not vote. |
| Unresolved loci: too few callable isolates | Loci where fewer isolates voted than the minimum of callable isolates. |
| Multiallelic loci | Loci with more than two alleles, the backbone's included, whether selected or unresolved. |
| Loci with competing indels | Loci where an insertion or deletion competes with at least one other allele that is not the backbone's, whether selected or unresolved. |
| Bases from the backbone vote alone | Consensus bases taken from the backbone because only the backbone voted, for example in repeats where no isolate is callable. Only possible with a minimum of 0 callable isolates. |
| Bases written as IUPAC codes | Consensus bases written as an IUPAC ambiguity code for an unresolved single-base position. |
| Bases written as N | Consensus bases written as `N`: every unresolved locus, every base without enough votes, and every backbone base that is not A, C, G, or T. The consensus summary splits them by reason. |

## Isolates

### Isolate list

| Item | Meaning |
|---|---|
| Isolate | The isolate's stable ID in the isolate catalog; it names its result directory. |
| Wild type | Wild-type status as the catalog recorded it when the run was created. It informs a researcher but never changes a vote. |
| Derived from | The isolate this one derives from, as recorded when the run was created. |
| State | Whether the isolate's processing completed; see *Isolate states* under *Terms*. |
| Depth | Average number of reads over every backbone base, after the quality filters and without duplicates, in reads per base. |
| Callable | Share of backbone bases where the isolate is callable, so it can vote there. |
| SNPs | Single-base changes against the backbone that passed every filter. |
| Indels | Insertions and deletions against the backbone that passed every filter. |
| Votes | Whether the isolate votes in the active cohort. |
| Candidate | Whether the isolate FASTA has a promotion candidate: the record needed to save it to the isolate catalog. Its checksums are verified only when it is saved. |

### Isolate details

| Item | Meaning |
|---|---|
| Name | The isolate's name as recorded when the run was created. |
| Reads trimmed by the provider | Whether the read files were already adapter-trimmed by the provider, as recorded per read pair. |
| Covered backbone bases | Share of backbone bases with at least one read. |
| Unreadable records | Records of this isolate that exist but cannot be read by this application version. |

### Isolate files

| Item | Meaning |
|---|---|
| Alignment (BAM) | All reads of the isolate aligned to the backbone, duplicates marked. |
| Alignment index | Index of the alignment, needed by genome browsers. |
| Variants (VCF) | Normalized variants, each `PASS` or with the filter that rejected it. |
| Variants index | Index of the variants. |
| Callable mask (BED) | The state of every backbone base: callable, ambiguous, or uncallable. |
| N mask (BED) | Only the ambiguous and uncallable intervals, the ones written as `N`. |
| Isolate FASTA | The isolate FASTA: the backbone with the isolate's `PASS` variants, and `N` wherever it is not callable. |
| Isolate FASTA index | Index of the isolate FASTA. |
| Coordinate chain | Maps backbone coordinates onto the isolate FASTA's, which indels shift. |
| Metrics | Read, alignment, coverage, callability, and variant metrics of the isolate (JSON). |
| Provenance | The isolate's read pairs, parameters, tool versions, and checksums (JSON). |
| Promotion candidate | What is needed to save the isolate FASTA to the isolate catalog (JSON). |
| Logs | The log and benchmark of every per-isolate step, also of a failed one. |

## Iterations

### Iteration list

| Item | Meaning |
|---|---|
| Iteration | The cohort's number: 1 is the initial cohort of all selected isolates, and every saved decision adds the next one. The active cohort is marked. |
| State | Whether the cohort finished; see *Cohort states* under *Terms*. |
| Date | When the cohort finished, or for a pending iteration when its decision was saved, in local time. |
| Voters | Number of isolates that vote in the cohort. |
| Reason | The reason saved with the decision; the initial cohort has none. |

### Iteration details

| Item | Meaning |
|---|---|
| Decision saved | When the decision that created this iteration was saved, in local time. |
| Finished | When the cohort's provenance record was written, which is when the cohort finished, in local time. |
| Reason | The reason the researcher saved with the decision that created this iteration. |
| Voting method, backbone votes, minimum callable isolates, unresolved SNPs, voting isolates | The cohort's settings and voters, as explained under *Active cohort*. |
| Excluded isolates | Selected isolates that do not vote in this cohort, with whether their processing completed. Their results and logs stay in the run directory. |
| Initial cohort existed | Whether the initial cohort of all selected isolates existed when this iteration ran. It does not when an isolate failed and the first decision excluded it. |
| Comparison with the first completed cohort | The same counts for the first completed cohort and the inspected one, and the change. A negative change in unresolved loci means the decision resolved them. |
| Unreadable or contradicting records | Records of this cohort that cannot be read, or that contradict each other. |

### Iteration files

| Item | Meaning |
|---|---|
| Support table (sites) | One row per locus: the backbone allele, every voted allele with its votes, the flags, and each isolate's allele or state. |
| Support table (intervals) | Every backbone base in runs with the same voters, with each isolate's callability. |
| Support summary | Voters, vote and callability histograms, loci per flag, and per-isolate counts (JSON). |
| Cohort consensus FASTA | The cohort consensus FASTA, with the backbone's sequence names and order. |
| Consensus sites | Every locus with its decision, reason, and the sequence written, in backbone and consensus coordinates. |
| Consensus summary | The settings, voters, checksums, and loci and bases by decision and reason (JSON). |
| Decision | The saved decision: voting and excluded isolates, settings, and reason (YAML). |
| Provenance | Checksums of every input and output, tool versions, and commands of the cohort. For the initial cohort this is the run's provenance record. |
| Logs | The logs and benchmarks of the cohort steps. |

## Sites

### Locus list

| Item | Meaning |
|---|---|
| Filter | Which loci of the iteration selected on the Iterations tab are listed: ties, no majority, loci with competing indels (also selected ones), or every unresolved locus. Runs of bases outside every locus that stayed unresolved, such as regions where no isolate is callable, are counted on the overview but not listed here. |
| Position | Where the locus lies on the backbone: the sequence name and the 1-based position, or its first and last base when it spans several. |
| Backbone | The backbone's own sequence at the locus. |
| Alleles: votes | Every allele that received a vote, the backbone's first, each with its number of votes. The backbone's own vote, when it casts one, is counted for the backbone allele. Long alleles are shortened in the list; the detail shows them whole. |
| Outcome | The allele the voting method selected, or why the locus stayed unresolved; see *Unresolved reasons* under *Terms*. |
| Flags | The support flags of the locus; see *Support flags* under *Terms*. |

### Locus details

| Item | Meaning |
|---|---|
| Backbone voted | Whether the backbone cast its own vote at this locus. It does not when the cohort excludes its vote or its allele contains a base other than A, C, G, or T. |
| Voting isolates | How many isolates voted here: callable over the whole locus, with variants that could be applied. The minimum of callable isolates is compared with this number. |
| Votes cast | All votes cast at the locus: the voting isolates and the backbone's own vote. |
| Allele | One version of the locus that received at least one vote. |
| Votes | How many voters chose this version, the backbone's own vote included. |
| Isolate, name, wild type, derived from | The isolate as recorded when the run was created, as on the Isolates tab. |
| Vote | What the isolate voted for, or why it cast no vote here: ambiguous or uncallable at a base of the locus (see *Callability*), or unsupported when its own variants could not be applied together. |

## Run records

| Item | Meaning |
|---|---|
| Run configuration | The saved run configuration the workflow read (YAML). |
| Isolate snapshot | The selected isolates and their read files as the catalog described them when the run was created. Later catalog edits do not change it. |
| Input validation | The check of the backbone FASTA and every read file before any isolate was processed (JSON). |
| Resolved backbone FASTA | The resolved copy of the backbone that every step read. |
| Backbone provenance | Where the backbone came from, and its checksum (JSON). |

## Terms

### Callability

Every backbone base of an isolate gets one state from its reads, counted after the quality filters and without duplicates. Only a callable isolate votes at a position, so missing evidence never counts as agreement with the backbone.

| State | Meaning |
|---|---|
| `callable` | Enough reads, and one allele reaches the minimum allele fraction. |
| `ambiguous` | Enough reads, but no allele reaches the fraction. Isolates are haploid, so this points to contamination, a mixed culture, or reads of duplicated genes collapsed onto one copy. |
| `uncallable` | Too few usable reads, including positions without any coverage. |

### Locus

A position where at least one isolate has a variant. A variant can span several backbone bases: a deletion covers the bases it removes. When variants of different isolates overlap, counting base by base would leave an isolate with a deletion unable to vote for anything at the deleted bases. Overlapping variants therefore form one locus, a single ballot, and every voter chooses one complete version of it, such as `ATCCT`, `A`, or `ATGCT`. A voter votes at a locus only when every base of it is callable.

### Support flags

The support table marks every locus with the flags that apply, so unusual loci can be reviewed.

| Flag | Meaning |
|---|---|
| `snp` | A single base, and no isolate's variant there is an insertion or deletion. |
| `indel` | At least one allele is longer or shorter than the backbone allele. |
| `multiallelic` | More than two alleles, the backbone's included. |
| `overlapping` | Variants of different isolates with different spans were merged into this locus. |
| `competing_indel` | An indel competes with at least one other allele that is not the backbone's. |
| `unsupported` | An isolate's variants could not be applied here, for example because they overlap each other; it casts no vote at this locus. |
| `backbone_not_acgt` | The backbone's allele contains a base other than A, C, G, or T; the backbone does not vote. |

### Unresolved reasons

The consensus decides in this order and never invents a base where it cannot decide.

| Reason | Meaning |
|---|---|
| `no_votes` | Nobody voted. |
| `few_callable` | Fewer isolates voted than the minimum of callable isolates. |
| `tie` | Several alleles share the highest vote count. |
| `no_majority` | With strict majority, no allele received more than half of the votes. |

### What an unresolved position becomes

An unresolved single-base position is written as `N`, or as the IUPAC code of the voted bases when configured, such as `R` for A or G. An unresolved indel is written as `N` for every backbone base of the locus, because no code can say "`ATCCT` or `A`", so the consensus keeps the backbone's length there.

### Cohort consensus

The backbone's structure with the cohort's most supported allele at every locus. It can combine alleles no single isolate carries together, so it is not the genome of one individual and not an assembly.

### Reviewing a cohort

Review saves a decision: which isolates vote and the cohort settings, with a reason. It becomes the next iteration and never changes an earlier one. Excluding an isolate removes its votes everywhere, never at single positions, and an isolate whose processing failed can be excluded to complete the cohort without it. Wild-type status and lineage are shown to inform the decision; they never select anything.

### Rerunning an iteration

A saved decision runs only the cohort steps: support aggregation, consensus generation, and the iteration's provenance. A dry run first shows what Snakemake would do. When it would also run a per-isolate step, for example because a voter's results are older than a changed rule, the rerun is refused, because that would recompute evidence: such a change needs a new run. The decision then stays saved as a pending iteration. A pending iteration, also an interrupted one, is continued from the Iterations tab.

### Isolate states

| State | Meaning |
|---|---|
| `completed` | Every per-isolate step finished and the isolate FASTA passed its checks. |
| `incomplete` | The isolate has no promotion candidate yet: a step failed or the run was interrupted. The files cannot tell which; its logs can. A failed isolate stops the initial cohort until it is fixed or excluded by a decision. |

### Cohort states

| State | Meaning |
|---|---|
| `completed` | The cohort finished and its provenance was recorded. |
| `incomplete` | Some outputs of the initial cohort exist, but it did not finish. |
| `not-aggregated` | The initial cohort has no outputs, because an isolate is incomplete or the run has not reached the cohort steps. |
| `pending` | A decision is saved, but its iteration has not run or was interrupted. |
| `invalid` | A record of the cohort cannot be read or contradicts another, for example a decision edited after its iteration ran. Its outputs are not interpreted. |
