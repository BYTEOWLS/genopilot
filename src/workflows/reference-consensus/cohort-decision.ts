import {randomUUID} from 'node:crypto';
import {link, mkdir, open, readdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {parse} from 'yaml';
import {
  isRecord,
  rejectUnknownFields,
  requireNonEmptyString,
  validateTimestamp,
  type ConfigurationValidationIssue,
} from '../configuration-validation.js';
import {stringifyRunFile} from '../run-preparation.js';
import {
  parseReferenceConsensusConfiguration,
  validateConsensus,
  type ReferenceConsensusConfiguration,
} from './configuration.js';
import {completedIsolates} from './isolate-results.js';

export const COHORT_DECISION_SCHEMA_VERSION = 1 as const;
/** The run-relative directory of saved cohort decisions. */
export const COHORT_DECISIONS_DIRECTORY = 'decisions' as const;

export type CohortSettings = ReferenceConsensusConfiguration['consensus'];

/**
 * A reasoned change of the voting isolates and cohort settings of a run, saved as
 * `decisions/iteration-<n>.yaml` and applied by the workflow as the cohort iteration `n`. The
 * initial run is iteration 1, so decisions start at 2. See consensus Task 5.1.
 */
export type CohortDecision = {
  schema_version: typeof COHORT_DECISION_SCHEMA_VERSION;
  iteration: number;
  voting_isolates: string[];
  excluded_from_voting: string[];
  consensus: CohortSettings;
  reason: string;
  created_at: string;
};

export class CohortDecisionError extends Error {
  readonly issues: readonly ConfigurationValidationIssue[];

  constructor(issues: ConfigurationValidationIssue[]) {
    super(`Invalid cohort decision:\n${issues.map(issue => `- ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'CohortDecisionError';
    this.issues = issues;
  }
}

const decisionFilePattern = /^iteration-([1-9][0-9]*)\.yaml$/;

export function cohortDecisionPath(runDirectory: string, iteration: number): string {
  return join(runDirectory, COHORT_DECISIONS_DIRECTORY, `iteration-${String(iteration)}.yaml`);
}

function validateIsolateList(value: unknown, path: string, issues: ConfigurationValidationIssue[]): string[] | undefined {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) {
    issues.push({path, message: 'must be a list of isolate IDs'});
    return undefined;
  }
  return value as string[];
}

/** Checks a decision's own shape, independent of the run it belongs to. */
export function validateCohortDecision(value: unknown): CohortDecision {
  const issues: ConfigurationValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new CohortDecisionError([{path: '$', message: 'must be an object'}]);
  }
  rejectUnknownFields(
    value,
    ['schema_version', 'iteration', 'voting_isolates', 'excluded_from_voting', 'consensus', 'reason', 'created_at'],
    '$',
    issues,
  );
  if (value.schema_version !== COHORT_DECISION_SCHEMA_VERSION) {
    issues.push({path: '$.schema_version', message: `must be ${String(COHORT_DECISION_SCHEMA_VERSION)}`});
  }
  if (!Number.isSafeInteger(value.iteration) || (value.iteration as number) < 2) {
    issues.push({path: '$.iteration', message: 'must be an integer of at least 2; the initial run is iteration 1'});
  }
  const voting = validateIsolateList(value.voting_isolates, '$.voting_isolates', issues);
  validateIsolateList(value.excluded_from_voting, '$.excluded_from_voting', issues);
  if (voting && voting.length === 0) {
    issues.push({path: '$.voting_isolates', message: 'must name at least one isolate'});
  }
  validateConsensus(value.consensus, voting?.length, issues, 'voting isolates');
  if (requireNonEmptyString(value.reason, '$.reason', issues) && value.reason.trim().length === 0) {
    issues.push({path: '$.reason', message: 'must explain the decision'});
  }
  validateTimestamp(value.created_at, '$.created_at', issues);
  if (issues.length > 0) {
    throw new CohortDecisionError(issues);
  }
  return value as CohortDecision;
}

export function parseCohortDecision(source: string): CohortDecision {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    throw new CohortDecisionError([
      {path: '$', message: `is not valid YAML: ${error instanceof Error ? error.message : String(error)}`},
    ]);
  }
  return validateCohortDecision(value);
}

/** The run's saved decisions in iteration order. A file that does not satisfy the schema is an error. */
export async function listCohortDecisions(runDirectory: string): Promise<CohortDecision[]> {
  let names: string[];
  try {
    names = await readdir(join(runDirectory, COHORT_DECISIONS_DIRECTORY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const decisions: CohortDecision[] = [];
  for (const name of names) {
    const match = decisionFilePattern.exec(name);
    if (!match) {
      continue;
    }
    const decision = parseCohortDecision(await readFile(join(runDirectory, COHORT_DECISIONS_DIRECTORY, name), 'utf8'));
    if (decision.iteration !== Number(match[1])) {
      throw new CohortDecisionError([
        {path: `${COHORT_DECISIONS_DIRECTORY}/${name}`, message: `holds iteration ${String(decision.iteration)}`},
      ]);
    }
    decisions.push(decision);
  }
  return decisions.sort((left, right) => left.iteration - right.iteration);
}

function sameCohort(
  left: {voting_isolates: readonly string[]; consensus: CohortSettings},
  right: {voting_isolates: readonly string[]; consensus: CohortSettings},
): boolean {
  const voters = (ids: readonly string[]): string => [...ids].sort().join('\n');
  return voters(left.voting_isolates) === voters(right.voting_isolates) &&
    left.consensus.include_backbone_vote === right.consensus.include_backbone_vote &&
    left.consensus.voting_method === right.consensus.voting_method &&
    left.consensus.min_callable_isolates === right.consensus.min_callable_isolates &&
    left.consensus.unresolved_snp === right.consensus.unresolved_snp;
}

/**
 * Checks a decision against its run: the voting and excluded isolates split the run's selected
 * isolates, every voter completed its processing, the iteration is the next free one, and the
 * voters and settings differ from the initial run's and every saved decision's.
 */
export function checkCohortDecision(
  decision: CohortDecision,
  {configuration, completed, saved}: {
    configuration: ReferenceConsensusConfiguration;
    completed: ReadonlySet<string>;
    saved: readonly CohortDecision[];
  },
): ConfigurationValidationIssue[] {
  const issues: ConfigurationValidationIssue[] = [];
  const selected = configuration.inputs.selected_isolates;
  const seen = new Set<string>();
  for (const [field, ids] of [
    ['voting_isolates', decision.voting_isolates],
    ['excluded_from_voting', decision.excluded_from_voting],
  ] as const) {
    ids.forEach((id, index) => {
      const path = `$.${field}[${String(index)}]`;
      if (!selected.includes(id)) {
        issues.push({path, message: `'${id}' is not selected in this run`});
      } else if (seen.has(id)) {
        issues.push({path, message: `'${id}' is listed more than once`});
      }
      seen.add(id);
    });
  }
  for (const id of selected) {
    if (!seen.has(id)) {
      issues.push({path: '$.excluded_from_voting', message: `'${id}' must either vote or be excluded`});
    }
  }
  decision.voting_isolates.forEach((id, index) => {
    if (selected.includes(id) && !completed.has(id)) {
      issues.push({
        path: `$.voting_isolates[${String(index)}]`,
        message: `'${id}' has not completed its processing and can only be excluded`,
      });
    }
  });
  const nextIteration = Math.max(1, ...saved.map(earlier => earlier.iteration)) + 1;
  if (decision.iteration !== nextIteration) {
    issues.push({path: '$.iteration', message: `must be ${String(nextIteration)}, the next free iteration`});
  }
  const initial = {voting_isolates: selected, consensus: configuration.consensus};
  const same = [{iteration: 1, ...initial}, ...saved].find(earlier => sameCohort(decision, earlier));
  if (same) {
    issues.push({
      path: '$',
      message: `changes nothing: iteration ${String(same.iteration)} has the same voting isolates and settings`,
    });
  }
  return issues;
}

/**
 * Writes `content` to `path` only when no file exists there: it is written and synced under a
 * temporary name, then hard-linked into place, which fails instead of replacing a file that
 * appeared in the meantime, for example one another GenoPilot window saved.
 */
export async function writeNewFile(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
  } finally {
    await rm(temporaryPath, {force: true});
  }
}

/** Validates a decision against its run and saves it without ever replacing a saved one. */
export async function saveCohortDecision(runDirectory: string, value: CohortDecision): Promise<string> {
  const decision = validateCohortDecision(value);
  const configuration = parseReferenceConsensusConfiguration(await readFile(join(runDirectory, 'config.yaml'), 'utf8'));
  const issues = checkCohortDecision(decision, {
    configuration,
    completed: await completedIsolates(runDirectory, configuration.inputs.selected_isolates),
    saved: await listCohortDecisions(runDirectory),
  });
  if (issues.length > 0) {
    throw new CohortDecisionError(issues);
  }

  const path = cohortDecisionPath(runDirectory, decision.iteration);
  await mkdir(join(runDirectory, COHORT_DECISIONS_DIRECTORY), {recursive: true, mode: 0o700});
  try {
    await writeNewFile(path, stringifyRunFile(decision));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CohortDecisionError([
        {path: '$.iteration', message: `iteration ${String(decision.iteration)} was saved meanwhile`},
      ]);
    }
    throw error;
  }
  return path;
}
