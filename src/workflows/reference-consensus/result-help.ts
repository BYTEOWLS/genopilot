import type {HelpEntry, HelpValue} from '../../ui/components/help.js';

/**
 * Explanations of the reference-consensus result items, keyed by their stable IDs, for workflow
 * `reference-consensus` version 1. The workflow README explains the same science at length.
 */
export const referenceConsensusExplanations: Record<string, string> = {
  // Backbone
  'backbone.source': 'Where the backbone assembly came from: a local FASTA file or a versioned NCBI assembly accession.',
  'backbone.identity': 'The NCBI accession or the local file the backbone was copied from when the run resolved it.',
  'backbone.checksum': 'SHA-256 of the resolved backbone FASTA. Every isolate and cohort result of this run was ' +
    'computed against exactly this file.',
  'backbone.origin': 'Imported: the backbone came from outside the workflow. For an NCBI accession it also says whether ' +
    'it was downloaded in this run or reused from the verified download cache.',
  'backbone.vote': 'Whether the backbone casts one vote of its own at every position of the active cohort, next to the ' +
    'callable isolates. It never votes where its own base is not A, C, G, or T, such as N in an assembly gap.',

  // Active cohort
  'cohort.active': 'The cohort whose consensus is current: the highest-numbered completed one. The initial cohort is ' +
    'iteration 1; every saved decision adds an iteration without changing earlier ones.',
  'cohort.voting_method': 'How a winner is chosen. Strict majority needs more than half of the votes cast; plurality ' +
    'needs the unique highest vote count.',
  'cohort.min_callable_isolates': 'How many isolates must vote at a position. Below it the position is unresolved and ' +
    'written as N, also when the backbone voted. 0 lets the backbone vote alone decide where no isolate is callable.',
  'cohort.unresolved_snp': 'How an unresolved single-base position is written: N, or the IUPAC code of every base that ' +
    'received a vote, such as R for A or G.',
  'cohort.voters': 'The isolates whose calls vote in this cohort. An isolate votes at a position only where it is ' +
    'callable, and each isolate has one vote regardless of its read depth.',
  'cohort.excluded': 'Selected isolates that do not vote in this cohort, with whether their processing completed. ' +
    'Their results and logs stay in the run directory.',
  'cohort.reason': 'The reason the researcher saved with the decision that created this iteration.',
  'cohort.state': 'Whether this cohort finished; see Cohort states below.',
  'cohort.decided_at': 'When the decision that created this iteration was saved, in local time.',
  'cohort.finished_at': 'When the cohort\'s provenance record was written, which is when the cohort finished, in local time.',
  'cohort.initial_aggregated': 'Whether the initial cohort of all selected isolates existed when this iteration ran. It ' +
    'does not when an isolate failed and the first decision excluded it.',

  // Counts
  'counts.loci_selected': 'Loci where the voting method chose an allele. A locus is one row of the support table: a ' +
    'variant position, or several overlapping variants merged into one ballot. Unit: loci.',
  'counts.loci_changed': 'Selected loci whose winning allele differs from the backbone\'s, so the consensus changes the ' +
    'backbone there. Unit: loci.',
  'counts.loci_unresolved.tie': 'Loci where several alleles share the highest vote count. Unit: loci.',
  'counts.loci_unresolved.no_majority': 'Loci where, with strict majority, no allele received more than half of the ' +
    'votes and the top allele is not tied. Plurality has no such loci. Unit: loci.',
  'counts.loci_unresolved.no_votes': 'Loci where nobody voted: no isolate was callable there and the backbone did not ' +
    'vote. Unit: loci.',
  'counts.loci_unresolved.few_callable': 'Loci where fewer isolates voted than the minimum of callable isolates. Unit: loci.',
  'counts.loci_multiallelic': 'Loci with more than two alleles, the backbone\'s included, whether selected or ' +
    'unresolved. Unit: loci.',
  'counts.loci_competing_indel': 'Loci where an insertion or deletion competes with at least one other allele that is ' +
    'not the backbone\'s, whether selected or unresolved. Unit: loci.',
  'counts.bases_backbone_only': 'Consensus bases taken from the backbone because only the backbone voted, for example in ' +
    'repeats where no isolate is callable. Only possible with a minimum of 0 callable isolates. Unit: bases.',
  'counts.bases_iupac': 'Consensus bases written as an IUPAC ambiguity code for an unresolved single-base position. ' +
    'Unit: bases.',
  'counts.bases_n': 'Consensus bases written as N: every unresolved locus, every base without enough votes, and every ' +
    'backbone base that is not A, C, G, or T. The consensus summary splits them by reason. Unit: bases.',

  // Isolates
  'isolates.id': 'The isolate\'s stable ID in the isolate catalog; it names its result directory.',
  'isolates.wildtype': 'Wild-type status as the catalog recorded it when the run was created. It informs a researcher ' +
    'but never changes a vote.',
  'isolates.derived_from': 'The isolate this one derives from, as recorded when the run was created.',
  'isolates.state': 'Whether the isolate\'s processing completed; see Isolate states below.',
  'isolates.mean_depth': 'Average number of reads over every backbone base, after the quality filters and without ' +
    'duplicates. Unit: reads per base.',
  'isolates.callable_fraction': 'Share of backbone bases where the isolate is callable, so it can vote there. Unit: ' +
    'share of backbone bases.',
  'isolates.snps': 'Single-base changes against the backbone that passed every filter. Unit: variants.',
  'isolates.indels': 'Insertions and deletions against the backbone that passed every filter. Unit: variants.',
  'isolates.votes': 'Whether the isolate votes in the active cohort.',
  'isolates.candidate': 'Whether the isolate FASTA has a promotion candidate: the record needed to save it to the ' +
    'isolate catalog. Its checksums are verified only when it is saved.',

  // Isolate detail
  'isolate.name': 'The isolate\'s name as recorded when the run was created.',
  'isolate.trimmed': 'Whether the read files were already adapter-trimmed by the provider, as recorded per read pair.',
  'isolate.covered_fraction': 'Share of backbone bases with at least one read. Unit: share of backbone bases.',
  'isolate.issues': 'Records of this isolate that exist but cannot be read by this application version.',
  'isolate.path.alignment': 'All reads of the isolate aligned to the backbone, duplicates marked (BAM).',
  'isolate.path.alignment-index': 'Index of the alignment, needed by genome browsers.',
  'isolate.path.variants': 'Normalized variants, each PASS or with the filter that rejected it (VCF).',
  'isolate.path.variants-index': 'Index of the variants.',
  'isolate.path.callable-mask': 'The state of every backbone base: callable, ambiguous, or uncallable (BED).',
  'isolate.path.consensus-mask': 'Only the ambiguous and uncallable intervals, the ones written as N (BED).',
  'isolate.path.consensus-fasta': 'The isolate FASTA: the backbone with the isolate\'s PASS variants, and N wherever it ' +
    'is not callable.',
  'isolate.path.consensus-fasta-index': 'Index of the isolate FASTA.',
  'isolate.path.consensus-chain': 'Maps backbone coordinates onto the isolate FASTA\'s, which indels shift.',
  'isolate.path.metrics': 'Read, alignment, coverage, callability, and variant metrics of the isolate (JSON).',
  'isolate.path.provenance': 'The isolate\'s read pairs, parameters, tool versions, and checksums (JSON).',
  'isolate.path.promotion-candidate': 'What is needed to save the isolate FASTA to the isolate catalog (JSON).',
  'isolate.path.logs': 'The log and benchmark of every per-isolate step, also of a failed one.',

  // Cohorts
  'cohorts.iteration': 'The cohort\'s number: 1 is the initial cohort of all selected isolates, and every saved decision ' +
    'adds the next one. The active cohort is marked.',
  'cohorts.state': 'Whether the cohort finished; see Cohort states below.',
  'cohorts.date': 'When the cohort finished, or for a pending iteration when its decision was saved, in local time.',
  'cohorts.voters': 'Number of isolates that vote in the cohort.',
  'cohorts.reason': 'The reason saved with the decision; the initial cohort has none.',
  'cohort.issues': 'Records of this cohort that cannot be read, or that contradict each other.',
  'cohort.path.support-sites': 'One row per locus: the backbone allele, every voted allele with its votes, the flags, ' +
    'and each isolate\'s allele or state.',
  'cohort.path.support-intervals': 'Every backbone base in runs with the same voters, with each isolate\'s callability.',
  'cohort.path.support-summary': 'Voters, vote and callability histograms, loci per flag, and per-isolate counts (JSON).',
  'cohort.path.consensus-fasta': 'The cohort consensus FASTA, with the backbone\'s sequence names and order.',
  'cohort.path.consensus-sites': 'Every locus with its decision, reason, and the sequence written, in backbone and ' +
    'consensus coordinates.',
  'cohort.path.consensus-summary': 'The settings, voters, checksums, and loci and bases by decision and reason (JSON).',
  'cohort.path.decision': 'The saved decision: voting and excluded isolates, settings, and reason (YAML).',
  'cohort.path.provenance': 'Checksums of every input and output, tool versions, and commands of the cohort. For the ' +
    'initial cohort this is the run\'s provenance record.',
  'cohort.path.logs': 'The logs and benchmarks of the cohort steps.',
  'comparison': 'The same counts for the first completed cohort and the inspected one, and the change. A negative ' +
    'change in unresolved loci means the decision resolved them.',

  // Run files
  'run.configuration': 'The saved run configuration the workflow read (YAML).',
  'run.snapshot': 'The selected isolates and their read files as the catalog described them when the run was created. ' +
    'Later catalog edits do not change it.',
  'run.input_validation': 'The check of the backbone FASTA and every read file before any isolate was processed (JSON).',
  'backbone.fasta': 'The resolved copy of the backbone that every step read.',
  'backbone.provenance': 'Where the backbone came from, and its checksum (JSON).',
};

const isolateStates: HelpValue[] = [
  {value: 'completed', explanation: 'Every per-isolate step finished and the isolate FASTA passed its checks.'},
  {
    value: 'incomplete',
    explanation: 'The isolate has no promotion candidate yet: a step failed or the run was interrupted. The files ' +
      'cannot tell which; its logs can. A failed isolate stops the initial cohort until it is fixed or excluded ' +
      'by a decision.',
  },
];

const cohortStates: HelpValue[] = [
  {value: 'completed', explanation: 'The cohort finished and its provenance was recorded.'},
  {value: 'incomplete', explanation: 'Some outputs of the initial cohort exist, but it did not finish.'},
  {
    value: 'not-aggregated',
    explanation: 'The initial cohort has no outputs, because an isolate is incomplete or the run has not reached ' +
      'the cohort steps.',
  },
  {value: 'pending', explanation: 'A decision is saved, but its iteration has not run or was interrupted.'},
  {
    value: 'invalid',
    explanation: 'A record of the cohort cannot be read or contradicts another, for example a decision edited after ' +
      'its iteration ran. Its outputs are not interpreted.',
  },
];

/** Background entries for the scientific terms the result page uses. */
export const referenceConsensusTerms: HelpEntry[] = [
  {
    id: 'term.callability',
    label: 'Callability',
    explanation: 'Every backbone base of an isolate gets one state from its reads, counted after the quality filters ' +
      'and without duplicates. Only a callable isolate votes at a position, so missing evidence never counts as ' +
      'agreement with the backbone.',
    values: [
      {value: 'callable', explanation: 'Enough reads, and one allele reaches the minimum allele fraction.'},
      {
        value: 'ambiguous',
        explanation: 'Enough reads, but no allele reaches the fraction. Isolates are haploid, so this points to ' +
          'contamination, a mixed culture, or reads of duplicated genes collapsed onto one copy.',
      },
      {value: 'uncallable', explanation: 'Too few usable reads, including positions without any coverage.'},
    ],
  },
  {
    id: 'term.locus',
    label: 'Locus',
    explanation: 'A position where at least one isolate has a variant. A variant can span several backbone bases: a ' +
      'deletion covers the bases it removes. When variants of different isolates overlap, counting base by base would ' +
      'leave an isolate with a deletion unable to vote for anything at the deleted bases. Overlapping variants ' +
      'therefore form one locus, a single ballot, and every voter chooses one complete version of it, such as ATCCT, ' +
      'A, or ATGCT. A voter votes at a locus only when every base of it is callable.',
  },
  {
    id: 'term.flags',
    label: 'Support flags',
    explanation: 'The support table marks every locus with the flags that apply, so unusual loci can be reviewed.',
    values: [
      {value: 'snp', explanation: 'A single base, and no isolate\'s variant there is an insertion or deletion.'},
      {value: 'indel', explanation: 'At least one allele is longer or shorter than the backbone allele.'},
      {value: 'multiallelic', explanation: 'More than two alleles, the backbone\'s included.'},
      {value: 'overlapping', explanation: 'Variants of different isolates with different spans were merged into this locus.'},
      {value: 'competing_indel', explanation: 'An indel competes with at least one other allele that is not the backbone\'s.'},
      {
        value: 'unsupported',
        explanation: 'An isolate\'s variants could not be applied here, for example because they overlap each other; ' +
          'it casts no vote at this locus.',
      },
      {value: 'backbone_not_acgt', explanation: 'The backbone\'s allele contains a base other than A, C, G, or T; the backbone does not vote.'},
    ],
  },
  {
    id: 'term.unresolved',
    label: 'Unresolved reasons',
    explanation: 'The consensus decides in this order and never invents a base where it cannot decide.',
    values: [
      {value: 'no_votes', explanation: 'Nobody voted.'},
      {value: 'few_callable', explanation: 'Fewer isolates voted than the minimum of callable isolates.'},
      {value: 'tie', explanation: 'Several alleles share the highest vote count.'},
      {value: 'no_majority', explanation: 'With strict majority, no allele received more than half of the votes.'},
    ],
  },
  {
    id: 'term.written',
    label: 'What an unresolved position becomes',
    explanation: 'An unresolved single-base position is written as N, or as the IUPAC code of the voted bases when ' +
      'configured, such as R for A or G. An unresolved indel is written as N for every backbone base of the locus, ' +
      'because no code can say "ATCCT or A", so the consensus keeps the backbone\'s length there.',
  },
  {
    id: 'term.consensus',
    label: 'Cohort consensus',
    explanation: 'The backbone\'s structure with the cohort\'s most supported allele at every locus. It can combine ' +
      'alleles no single isolate carries together, so it is not the genome of one individual and not an assembly.',
  },
  {id: 'term.isolate_states', label: 'Isolate states', values: isolateStates},
  {id: 'term.cohort_states', label: 'Cohort states', values: cohortStates},
];
