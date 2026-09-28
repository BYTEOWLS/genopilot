import {createHash} from 'node:crypto';
import {readdir, readFile, stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import type {ResultPath} from '../annotation-transfer/results.js';
import {isRecord, type RecordValue} from '../configuration-validation.js';
import {
  COHORT_DECISIONS_DIRECTORY,
  parseCohortDecision,
  type CohortDecision,
  type CohortSettings,
} from './cohort-decision.js';
import type {ReferenceConsensusConfiguration} from './configuration.js';
import type {IsolateSnapshot} from './snapshot.js';

/** Every persisted record this reader interprets carries this schema version. */
export const REFERENCE_CONSENSUS_RECORD_SCHEMA_VERSION = 1 as const;

/** A problem with one persisted record; the rest of the run still loads. */
export type RecordIssue = {path: string; message: string};

export type UnresolvedReason = 'tie' | 'no_majority' | 'no_votes' | 'few_callable';
export const unresolvedReasons: readonly UnresolvedReason[] = ['tie', 'no_majority', 'no_votes', 'few_callable'];

/** Counts of one cohort's consensus, from its `consensus-summary.json`. */
export type CohortCounts = {
  /** Loci of the support table, by decision. */
  lociSelected: number;
  lociUnresolved: Record<UnresolvedReason, number>;
  /** Selected loci whose written allele differs from the backbone's. */
  lociChanged: number;
  multiallelicLoci: number;
  competingIndelLoci: number;
  /** Consensus bases taken from the backbone because only the backbone voted. */
  basesBackboneOnly: number;
  basesIupac: number;
  basesN: Record<UnresolvedReason | 'backbone_not_acgt', number>;
};

export type IsolateState = 'completed' | 'incomplete';

export const isolatePathKeys = [
  'alignment', 'alignment-index', 'variants', 'variants-index', 'callable-mask', 'consensus-mask',
  'consensus-fasta', 'consensus-fasta-index', 'consensus-chain', 'metrics', 'provenance',
  'promotion-candidate', 'logs',
] as const;
export type IsolatePathKey = typeof isolatePathKeys[number];

const isolateFiles: Record<IsolatePathKey, string> = {
  'alignment': 'alignment.bam',
  'alignment-index': 'alignment.bam.bai',
  'variants': 'variants.vcf.gz',
  'variants-index': 'variants.vcf.gz.csi',
  'callable-mask': 'callable-mask.bed',
  'consensus-mask': 'consensus-mask.bed',
  'consensus-fasta': 'consensus.fasta',
  'consensus-fasta-index': 'consensus.fasta.fai',
  'consensus-chain': 'consensus.chain',
  'metrics': 'metrics.json',
  'provenance': 'provenance.json',
  'promotion-candidate': 'promotion-candidate.json',
  'logs': '',
};

export type IsolateMetrics = {
  meanDepth: number;
  coveredFraction: number;
  callableFraction: number;
  snps: number;
  indels: number;
  trimmed: string;
};

export type IsolateResult = {
  id: string;
  name: string;
  wildtype: boolean | null;
  derivedFrom: string | null;
  state: IsolateState;
  metrics?: IsolateMetrics;
  /** The promotion candidate parses and its FASTA and index exist; nothing is hashed. */
  promotionCandidate: boolean;
  paths: Record<IsolatePathKey, ResultPath>;
  issues: RecordIssue[];
};

/**
 * A cohort's state: `completed` with its provenance; `incomplete` (initial cohort) with outputs
 * but no provenance; `not-aggregated` (initial cohort) without any output; `pending` (iteration)
 * with a decision but no provenance; `invalid` when its records cannot be read or disagree.
 */
export type CohortState = 'completed' | 'incomplete' | 'not-aggregated' | 'pending' | 'invalid';

export const cohortPathKeys = [
  'support-sites', 'support-intervals', 'support-summary', 'consensus-fasta', 'consensus-sites',
  'consensus-summary', 'decision', 'provenance', 'logs',
] as const;
export type CohortPathKey = typeof cohortPathKeys[number];

export type ExcludedIsolate = {id: string; processing: IsolateState};

export type CohortResult = {
  /** `initial` or `iteration-<n>`, the name of its results directory. */
  id: string;
  /** 1 for the initial cohort. */
  iteration: number;
  state: CohortState;
  /** The voters and settings the configuration or the saved decision asked for. */
  voters?: string[];
  settings?: CohortSettings;
  excluded: ExcludedIsolate[];
  reason?: string;
  decidedAt?: string;
  /** When its provenance was written, which is when the cohort finished. */
  finishedAt?: string;
  /** From an iteration's provenance: whether the initial cohort existed when it ran. */
  initialAggregated?: boolean;
  counts?: CohortCounts;
  paths: Partial<Record<CohortPathKey, ResultPath>>;
  issues: RecordIssue[];
};

export type BackboneResult = {
  source?: 'local' | 'ncbi';
  accession?: string;
  path?: string;
  sha256?: string;
  origin?: string;
  downloaded?: boolean;
  paths: {fasta: ResultPath; provenance: ResultPath};
  issues: RecordIssue[];
};

export type ResultStatus = {variant: 'success' | 'warning'; explanation: string};

export type ReferenceConsensusResult = {
  backbone: BackboneResult;
  isolates: IsolateResult[];
  /** The initial cohort first, then every iteration in order. */
  cohorts: CohortResult[];
  /** The highest-numbered completed cohort. */
  activeCohortId?: string;
  /** The first completed cohort, which every other one is compared with. */
  baselineCohortId?: string;
  /** Why the initial cohort was never aggregated, from the first decision, when that is the case. */
  initialNotAggregatedReason?: string;
  status: ResultStatus;
  generatedAt?: string;
  effectiveCpus: number;
  runFiles: {configuration: ResultPath; snapshot: ResultPath; inputValidation: ResultPath};
  /** Paths that should exist now; the shell counts the unavailable ones as missing. */
  linkedPaths: ResultPath[];
};

function runPath(runDirectory: string, path: string): ResultPath {
  const absolutePath = resolve(runDirectory, path);
  const fromRoot = relative(runDirectory, absolutePath);
  if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error(`Result path '${path}' lies outside the run directory.`);
  }
  return {path, absolutePath, available: false};
}

async function checked(path: ResultPath): Promise<ResultPath> {
  try {
    await stat(path.absolutePath);
    return {...path, available: true};
  } catch {
    return path;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type JsonRead = {kind: 'missing'} | {kind: 'invalid'; issue: RecordIssue} | {kind: 'ok'; value: RecordValue};

/** Reads a JSON record and checks its schema version; a missing file is not an issue by itself. */
async function readRecord(path: ResultPath): Promise<JsonRead> {
  let source: string;
  try {
    source = await readFile(path.absolutePath, 'utf8');
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? {kind: 'missing'}
      : {kind: 'invalid', issue: {path: path.path, message: `cannot be read: ${detail(error)}`}};
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    return {kind: 'invalid', issue: {path: path.path, message: `is not valid JSON: ${detail(error)}`}};
  }
  if (!isRecord(value)) {
    return {kind: 'invalid', issue: {path: path.path, message: 'must be a JSON object'}};
  }
  if (value.schema_version !== REFERENCE_CONSENSUS_RECORD_SCHEMA_VERSION) {
    return {
      kind: 'invalid',
      issue: {
        path: path.path,
        message: `has schema version ${JSON.stringify(value.schema_version)}; this application reads version ${String(REFERENCE_CONSENSUS_RECORD_SCHEMA_VERSION)}`,
      },
    };
  }
  return {kind: 'ok', value};
}

/** Follows a chain of object keys; undefined when any step is missing or not an object. */
function field(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

class Fields {
  readonly problems: string[] = [];

  count(value: unknown, name: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      this.problems.push(`${name} must be a non-negative integer`);
      return 0;
    }
    return value as number;
  }

  number(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.problems.push(`${name} must be a number`);
      return 0;
    }
    return value;
  }

  string(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      this.problems.push(`${name} must be a non-empty string`);
      return '';
    }
    return value;
  }

  strings(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      this.problems.push(`${name} must be a list of strings`);
      return [];
    }
    return value as string[];
  }

  issue(path: string): RecordIssue | undefined {
    return this.problems.length === 0 ? undefined : {path, message: this.problems.join('; ')};
  }
}

function parseIsolateMetrics(value: RecordValue): {metrics: IsolateMetrics; problems: Fields} {
  const fields = new Fields();
  const metrics = {
    meanDepth: fields.number(field(value, 'coverage', 'mean_depth'), 'coverage.mean_depth'),
    coveredFraction: fields.number(field(value, 'coverage', 'covered_fraction'), 'coverage.covered_fraction'),
    callableFraction: fields.number(field(value, 'callability', 'callable_fraction'), 'callability.callable_fraction'),
    // bcftools stats leaves out a count it did not observe.
    snps: fields.count(field(value, 'variants', 'snps') ?? 0, 'variants.snps'),
    indels: fields.count(field(value, 'variants', 'indels') ?? 0, 'variants.indels'),
    trimmed: fields.string(value.trimmed, 'trimmed'),
  };
  return {metrics, problems: fields};
}

function parseCounts(value: RecordValue): {counts: CohortCounts; problems: Fields} {
  const fields = new Fields();
  const reasons = (source: unknown, name: string): Record<UnresolvedReason, number> =>
    Object.fromEntries(unresolvedReasons.map(reason => [reason, fields.count(field(source, reason), `${name}.${reason}`)])) as
      Record<UnresolvedReason, number>;
  const lociOfFlag = (flag: string): number => {
    const selected = fields.count(field(value, 'loci_by_flag', flag, 'selected'), `loci_by_flag.${flag}.selected`);
    const unresolved = reasons(field(value, 'loci_by_flag', flag, 'unresolved'), `loci_by_flag.${flag}.unresolved`);
    return selected + Object.values(unresolved).reduce((total, count) => total + count, 0);
  };
  const counts: CohortCounts = {
    lociSelected: fields.count(field(value, 'loci', 'selected'), 'loci.selected'),
    lociUnresolved: reasons(field(value, 'loci', 'unresolved'), 'loci.unresolved'),
    lociChanged: fields.count(field(value, 'loci', 'changed'), 'loci.changed'),
    multiallelicLoci: lociOfFlag('multiallelic'),
    competingIndelLoci: lociOfFlag('competing_indel'),
    basesBackboneOnly: fields.count(field(value, 'bases', 'backbone_only'), 'bases.backbone_only'),
    basesIupac: fields.count(field(value, 'bases', 'iupac'), 'bases.iupac'),
    basesN: {
      ...reasons(field(value, 'bases', 'n'), 'bases.n'),
      backbone_not_acgt: fields.count(field(value, 'bases', 'n', 'backbone_not_acgt'), 'bases.n.backbone_not_acgt'),
    },
  };
  return {counts, problems: fields};
}

async function readIsolate(
  runDirectory: string,
  isolate: IsolateSnapshot['isolates'][number],
): Promise<IsolateResult> {
  const directory = `results/isolates/${isolate.id}`;
  const paths = Object.fromEntries(await Promise.all(isolatePathKeys.map(async key => [
    key,
    await checked(runPath(runDirectory, key === 'logs' ? `logs/isolates/${isolate.id}` : `${directory}/${isolateFiles[key]}`)),
  ]))) as Record<IsolatePathKey, ResultPath>;
  const issues: RecordIssue[] = [];
  const state: IsolateState = paths['promotion-candidate'].available ? 'completed' : 'incomplete';

  let metrics: IsolateMetrics | undefined;
  const metricsRecord = await readRecord(paths.metrics);
  if (metricsRecord.kind === 'invalid') {
    issues.push(metricsRecord.issue);
  } else if (metricsRecord.kind === 'ok') {
    const parsed = parseIsolateMetrics(metricsRecord.value);
    const issue = parsed.problems.issue(paths.metrics.path);
    if (issue) {
      issues.push(issue);
    } else {
      metrics = parsed.metrics;
    }
  }

  let promotionCandidate = false;
  const candidateRecord = await readRecord(paths['promotion-candidate']);
  if (candidateRecord.kind === 'invalid') {
    issues.push(candidateRecord.issue);
  } else if (candidateRecord.kind === 'ok') {
    const candidate = candidateRecord.value;
    if (candidate.isolate_id !== isolate.id ||
        field(candidate, 'fasta', 'path') !== paths['consensus-fasta'].path ||
        field(candidate, 'fasta_index', 'path') !== paths['consensus-fasta-index'].path) {
      issues.push({path: paths['promotion-candidate'].path, message: 'does not describe this isolate\'s FASTA and index'});
    } else {
      promotionCandidate = paths['consensus-fasta'].available && paths['consensus-fasta-index'].available;
    }
  }

  return {
    id: isolate.id,
    name: isolate.name,
    wildtype: isolate.wildtype,
    derivedFrom: isolate.derived_from,
    state,
    ...(metrics ? {metrics} : {}),
    promotionCandidate,
    paths,
    issues,
  };
}

async function readBackbone(runDirectory: string): Promise<BackboneResult> {
  const paths = {
    fasta: await checked(runPath(runDirectory, 'resolved/backbone.fasta')),
    provenance: await checked(runPath(runDirectory, 'provenance/backbone.fasta.json')),
  };
  const record = await readRecord(paths.provenance);
  if (record.kind === 'missing') {
    return {paths, issues: []};
  }
  if (record.kind === 'invalid') {
    return {paths, issues: [record.issue]};
  }
  const value = record.value;
  const source = value.source === 'local' || value.source === 'ncbi' ? value.source : undefined;
  const sha256 = field(value, 'checksum', 'value');
  return {
    ...(source ? {source} : {}),
    ...(typeof value.accession === 'string' ? {accession: value.accession} : {}),
    ...(typeof value.path === 'string' ? {path: value.path} : {}),
    ...(typeof sha256 === 'string' ? {sha256} : {}),
    ...(typeof value.origin === 'string' ? {origin: value.origin} : {}),
    ...(typeof value.downloaded === 'boolean' ? {downloaded: value.downloaded} : {}),
    paths,
    issues: source && typeof sha256 === 'string'
      ? []
      : [{path: paths.provenance.path, message: 'has no source or checksum'}],
  };
}

async function cohortPaths(runDirectory: string, id: string): Promise<Partial<Record<CohortPathKey, ResultPath>>> {
  const directory = `results/cohort/${id}`;
  const files: Partial<Record<CohortPathKey, string>> = {
    'support-sites': `${directory}/support-sites.tsv.gz`,
    'support-intervals': `${directory}/support-intervals.tsv.gz`,
    'support-summary': `${directory}/support-summary.json`,
    'consensus-fasta': `${directory}/consensus.fasta`,
    'consensus-sites': `${directory}/consensus-sites.tsv.gz`,
    'consensus-summary': `${directory}/consensus-summary.json`,
    'provenance': id === 'initial' ? 'provenance/run.json' : `provenance/cohort/${id}.json`,
    'logs': `logs/cohort/${id}`,
    ...(id === 'initial' ? {} : {decision: `${COHORT_DECISIONS_DIRECTORY}/${id}.yaml`}),
  };
  return Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await checked(runPath(runDirectory, path))]),
  )) as Partial<Record<CohortPathKey, ResultPath>>;
}

/** Reads a cohort's counts; an absent summary of a finished cohort is an issue. */
async function readCounts(
  paths: Partial<Record<CohortPathKey, ResultPath>>,
  required: boolean,
  issues: RecordIssue[],
): Promise<CohortCounts | undefined> {
  const path = paths['consensus-summary']!;
  const record = await readRecord(path);
  if (record.kind === 'missing') {
    if (required) {
      issues.push({path: path.path, message: 'is missing'});
    }
    return undefined;
  }
  if (record.kind === 'invalid') {
    issues.push(record.issue);
    return undefined;
  }
  const parsed = parseCounts(record.value);
  const issue = parsed.problems.issue(path.path);
  if (issue) {
    issues.push(issue);
    return undefined;
  }
  return parsed.counts;
}

async function readInitialCohort(
  runDirectory: string,
  configuration: ReferenceConsensusConfiguration,
): Promise<CohortResult> {
  const paths = await cohortPaths(runDirectory, 'initial');
  const issues: RecordIssue[] = [];
  const provenance = await readRecord(paths.provenance!);
  let state: CohortState;
  let finishedAt: string | undefined;
  if (provenance.kind === 'ok') {
    state = 'completed';
    finishedAt = typeof provenance.value.generated_at === 'string' ? provenance.value.generated_at : undefined;
  } else if (provenance.kind === 'invalid') {
    state = 'invalid';
    issues.push(provenance.issue);
  } else {
    const outputs = cohortPathKeys.filter(key => key !== 'provenance' && key !== 'logs' && paths[key]?.available);
    state = outputs.length > 0 ? 'incomplete' : 'not-aggregated';
  }
  // A missing or unreadable summary of a completed cohort is a missing artifact, not a contradiction.
  const counts = await readCounts(paths, state === 'completed', issues);
  return {
    id: 'initial',
    iteration: 1,
    state,
    voters: configuration.inputs.selected_isolates,
    settings: configuration.consensus,
    excluded: [],
    ...(finishedAt ? {finishedAt} : {}),
    ...(counts ? {counts} : {}),
    paths,
    issues,
  };
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** The iteration numbers with a saved decision or an iteration provenance, in order. */
async function iterationNumbers(runDirectory: string): Promise<number[]> {
  const numbers = new Set<number>();
  for (const [directory, pattern] of [
    [COHORT_DECISIONS_DIRECTORY, /^iteration-([1-9][0-9]*)\.yaml$/],
    ['provenance/cohort', /^iteration-([1-9][0-9]*)\.json$/],
  ] as const) {
    let names: string[] = [];
    try {
      names = await readdir(resolve(runDirectory, directory));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }
    for (const name of names) {
      const match = pattern.exec(name);
      if (match && Number(match[1]) >= 2) {
        numbers.add(Number(match[1]));
      }
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

async function readIteration(
  runDirectory: string,
  iteration: number,
  configuration: ReferenceConsensusConfiguration,
  completed: ReadonlySet<string>,
): Promise<CohortResult> {
  const id = `iteration-${String(iteration)}`;
  const paths = await cohortPaths(runDirectory, id);
  const issues: RecordIssue[] = [];

  let decision: CohortDecision | undefined;
  let decisionChecksum: string | undefined;
  const decisionPath = paths.decision!;
  if (decisionPath.available) {
    try {
      const content = await readFile(decisionPath.absolutePath);
      decisionChecksum = sha256(content);
      decision = parseCohortDecision(content.toString('utf8'));
      if (decision.iteration !== iteration) {
        issues.push({path: decisionPath.path, message: `holds iteration ${String(decision.iteration)}`});
        decision = undefined;
      }
    } catch (error) {
      issues.push({path: decisionPath.path, message: detail(error)});
    }
  } else {
    issues.push({path: decisionPath.path, message: 'is missing, although the iteration has a provenance record'});
  }

  const provenancePath = paths.provenance!;
  const provenance = await readRecord(provenancePath);
  let finishedAt: string | undefined;
  let initialAggregated: boolean | undefined;
  // Until the provenance records their processing state, the decision names the excluded isolates.
  let excluded: ExcludedIsolate[] | undefined;
  if (provenance.kind === 'invalid') {
    issues.push(provenance.issue);
  } else if (provenance.kind === 'ok') {
    const value = provenance.value;
    finishedAt = typeof value.generated_at === 'string' ? value.generated_at : undefined;
    const aggregated = field(value, 'initial_cohort', 'aggregated');
    initialAggregated = typeof aggregated === 'boolean' ? aggregated : undefined;
    if (value.cohort !== id) {
      issues.push({path: provenancePath.path, message: `records cohort ${JSON.stringify(value.cohort)}`});
    }
    if (field(value, 'run', 'id') !== configuration.run.id) {
      issues.push({path: provenancePath.path, message: `belongs to another run than '${configuration.run.id}'`});
    }
    if (decisionChecksum !== undefined && field(value, 'decision', 'checksum', 'value') !== decisionChecksum) {
      issues.push({
        path: provenancePath.path,
        message: `records another checksum of ${decisionPath.path} than the saved file has now`,
      });
    }
    const excludedRecord = field(value, 'excluded_isolates');
    if (isRecord(excludedRecord)) {
      excluded = Object.entries(excludedRecord).map(([isolateId, entry]) => ({
        id: isolateId,
        processing: field(entry, 'processing') === 'completed' ? 'completed' : 'incomplete',
      }));
    }
  }

  let state: CohortState;
  if (issues.length > 0) {
    state = 'invalid';
  } else if (provenance.kind === 'ok') {
    state = 'completed';
  } else {
    state = 'pending';
  }
  const counts = await readCounts(paths, state === 'completed', issues);
  return {
    id,
    iteration,
    state,
    ...(decision ? {voters: decision.voting_isolates, settings: decision.consensus, reason: decision.reason, decidedAt: decision.created_at} : {}),
    excluded: excluded ?? decision?.excluded_from_voting.map(isolateId => ({
      id: isolateId,
      processing: completed.has(isolateId) ? 'completed' : 'incomplete',
    })) ?? [],
    ...(finishedAt ? {finishedAt} : {}),
    ...(initialAggregated === undefined ? {} : {initialAggregated}),
    ...(counts ? {counts} : {}),
    paths,
    issues,
  };
}

function statusOf(
  active: CohortResult | undefined,
  isolates: readonly IsolateResult[],
): ResultStatus {
  const incomplete = isolates.filter(isolate => isolate.state === 'incomplete').map(isolate => isolate.id);
  if (active) {
    const name = active.iteration === 1 ? 'the initial cohort' : `iteration ${String(active.iteration)}`;
    return {variant: 'success', explanation: `The cohort consensus of ${name} is available.`};
  }
  if (incomplete.length > 0) {
    return {
      variant: 'warning',
      explanation: `No cohort consensus yet: ${String(incomplete.length)} of ${String(isolates.length)} isolates ` +
        `have not completed their processing (${incomplete.join(', ')}); they failed or were interrupted, ` +
        'as their logs show. The cohort steps run only when every voting isolate is complete.',
    };
  }
  return {
    variant: 'warning',
    explanation: 'No cohort consensus yet: every isolate is processed, but no cohort has completed.',
  };
}

/**
 * Reads a reference-consensus run from the records its workflow wrote. Nothing is recomputed, and
 * no large file is read or hashed: only the saved decisions are hashed, to check them against
 * their iterations' provenance.
 */
export async function readReferenceConsensusResult(
  runDirectory: string,
  configuration: ReferenceConsensusConfiguration,
  snapshot: IsolateSnapshot,
): Promise<ReferenceConsensusResult> {
  const directory = resolve(runDirectory);
  const [backbone, isolates] = await Promise.all([
    readBackbone(directory),
    Promise.all(snapshot.isolates.map(isolate => readIsolate(directory, isolate))),
  ]);
  const completed = new Set(isolates.filter(isolate => isolate.state === 'completed').map(isolate => isolate.id));
  const initial = await readInitialCohort(directory, configuration);
  const iterations = await Promise.all(
    (await iterationNumbers(directory)).map(iteration => readIteration(directory, iteration, configuration, completed)),
  );
  const cohorts = [initial, ...iterations];
  const completedCohorts = cohorts.filter(cohort => cohort.state === 'completed');
  const active = completedCohorts.at(-1);
  const baseline = completedCohorts[0];

  const firstDecision = iterations.find(iteration => iteration.reason !== undefined);
  const initialNotAggregatedReason = initial.state === 'not-aggregated' ? firstDecision?.reason : undefined;

  const runFiles = {
    configuration: await checked(runPath(directory, 'config.yaml')),
    snapshot: await checked(runPath(directory, 'isolates.yaml')),
    inputValidation: await checked(runPath(directory, 'results/input-validation.json')),
  };
  const expectedCohortPaths = (cohort: CohortResult): ResultPath[] =>
    cohort.state === 'completed' || cohort.state === 'invalid'
      ? Object.values(cohort.paths).filter(path => path !== undefined)
      : [];
  const linkedPaths = [
    ...Object.values(runFiles),
    ...(backbone.paths.provenance.available ? [backbone.paths.fasta] : []),
    ...isolates.filter(isolate => isolate.state === 'completed').flatMap(isolate => Object.values(isolate.paths)),
    ...cohorts.flatMap(expectedCohortPaths),
  ];

  return {
    backbone,
    isolates,
    cohorts,
    ...(active ? {activeCohortId: active.id} : {}),
    ...(baseline ? {baselineCohortId: baseline.id} : {}),
    ...(initialNotAggregatedReason ? {initialNotAggregatedReason} : {}),
    status: statusOf(active, isolates),
    ...(active?.finishedAt ? {generatedAt: active.finishedAt} : {}),
    effectiveCpus: configuration.resources.effective_cpus,
    runFiles,
    linkedPaths,
  };
}
