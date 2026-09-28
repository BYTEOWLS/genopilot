import {access, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ToolingPaths} from '../../tooling/paths.js';
import {prepareSnakemakeRun, type SnakemakeRun, type SnakemakeRunMode} from '../execution.js';
import {RunEventReader} from '../run-events.js';

/**
 * The only rules an iteration may run. Anything else in its dry run, such as a voter's variant
 * calling that Snakemake considers outdated, would recompute per-isolate evidence, which needs a
 * new run instead; see consensus Task 5.1.
 */
export const iterationRules = ['aggregate_support', 'generate_consensus', 'record_iteration_provenance'] as const;

export function iterationName(iteration: number): string {
  return `iteration-${String(iteration)}`;
}

/** The run-relative target that runs an iteration: its provenance, written last. */
export function iterationTarget(iteration: number): string {
  return `provenance/cohort/${iterationName(iteration)}.json`;
}

/**
 * Prepares a dry run or an execution of one cohort iteration in its run directory, with the
 * run's own configuration and its CPUs (`resources.effective_cpus`). Its Snakemake logs are kept
 * with the iteration's other logs, and a dry run records what it would schedule, which
 * `checkIterationDryRun` reads.
 */
export function prepareIterationRun({
  runDirectory,
  iteration,
  mode,
  snakefilePath,
  cores,
  paths,
  startedAt,
}: {
  runDirectory: string;
  iteration: number;
  mode: SnakemakeRunMode;
  snakefilePath: string;
  cores: number;
  paths?: ToolingPaths;
  startedAt?: Date;
}): SnakemakeRun {
  return prepareSnakemakeRun({
    mode,
    runDirectory,
    configurationPath: join(runDirectory, 'config.yaml'),
    snakefilePath,
    cores,
    targets: [iterationTarget(iteration)],
    logDirectory: join('logs', 'cohort', iterationName(iteration)),
    recordDryRunEvents: true,
    // Continuing an interrupted iteration: a job killed while writing leaves its output marked
    // incomplete, which Snakemake would otherwise refuse. The dry run shows the same plan, so a
    // per-isolate output that is incomplete still makes the rerun refused.
    rerunIncomplete: true,
    ...(paths ? {paths} : {}),
    ...(startedAt ? {startedAt} : {}),
  });
}

export type IterationDryRunCheck =
  | {allowed: true}
  | {allowed: false; reason: string; otherRules?: Readonly<Record<string, number>>};

/**
 * Decides from a successful dry run's events whether the iteration may be executed: only when
 * every scheduled job belongs to one of the `iterationRules`. Console output is never read.
 */
export async function checkIterationDryRun(
  run: Pick<SnakemakeRun, 'dryRunEventsPath' | 'runDirectory'>,
  iteration: number,
): Promise<IterationDryRunCheck> {
  let content: string;
  try {
    if (!run.dryRunEventsPath) {
      throw new Error('no events path');
    }
    content = await readFile(run.dryRunEventsPath, 'utf8');
  } catch {
    return {allowed: false, reason: 'The dry run left no record of the jobs it would schedule.'};
  }
  // Snakemake reports the planned jobs more than once in a dry run; the last report counts.
  const plan = new RunEventReader().append(`${content}\n`).filter(event => event.type === 'run-info').at(-1);
  if (!plan) {
    try {
      await access(join(run.runDirectory, iterationTarget(iteration)));
    } catch {
      return {
        allowed: false,
        reason: 'The dry run scheduled nothing, although the iteration has no provenance yet.',
      };
    }
    return {allowed: false, reason: `Iteration ${String(iteration)} is already complete; nothing needs to run.`};
  }
  const allowed = new Set<string>(iterationRules);
  const otherRules = Object.fromEntries(
    Object.entries(plan.jobs).filter(([rule, count]) => !allowed.has(rule) && count > 0),
  );
  if (Object.keys(otherRules).length > 0) {
    return {
      allowed: false,
      reason: `Snakemake would also run ${Object.entries(otherRules)
        .map(([rule, count]) => `${rule} (${String(count)})`)
        .join(', ')}, which recomputes per-isolate results. The decision stays saved as a pending iteration; this change needs a new run.`,
      otherRules,
    };
  }
  return {allowed: true};
}
