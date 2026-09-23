import {open} from 'node:fs/promises';

/**
 * Reader and progress model for the run-event contract written by the packaged
 * `genopilot-run-events` Snakemake logger plugin (see
 * `workflows/shared/logging/snakemake_logger_plugin_genopilot_run_events`).
 *
 * Workflow state comes from these structured events only. Snakemake's console output is
 * captured in full as the run's stdout/stderr logs and shown as a live log, but it is never
 * parsed to decide what a run is doing.
 */

export const RUN_EVENT_SCHEMA_VERSION = 1;

export const RUN_EVENTS_FILENAME = 'events.jsonl';

export type RunEvent =
  | {type: 'workflow-started'; snakemakeVersion?: string; command?: string}
  | {type: 'run-info'; jobs: Readonly<Record<string, number>>; total: number}
  | {type: 'job-started'; jobId: number; rule: string}
  | {type: 'job-finished'; jobId: number}
  | {type: 'job-failed'; jobId?: number; rule?: string; message?: string; logs: readonly string[]}
  | {type: 'progress'; done: number; total: number}
  | {type: 'error'; exception?: string; message?: string};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function paths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Converts one parsed JSON line into a run event.
 *
 * Unknown event types and unknown fields are ignored so a newer producer of the same schema
 * version stays readable; a line carrying a different `schema_version` is rejected outright
 * rather than reinterpreted under assumptions that may no longer hold.
 */
export function toRunEvent(line: unknown): RunEvent | undefined {
  if (typeof line !== 'object' || line === null || Array.isArray(line)) {
    return undefined;
  }
  const record = line as Record<string, unknown>;
  if (record.schema_version !== RUN_EVENT_SCHEMA_VERSION) {
    return undefined;
  }
  switch (record.type) {
    case 'workflow-started': {
      return {
        type: 'workflow-started',
        snakemakeVersion: optionalText(record.snakemake_version),
        command: optionalText(record.command),
      };
    }
    case 'run-info': {
      const jobs: Record<string, number> = {};
      if (typeof record.jobs === 'object' && record.jobs !== null && !Array.isArray(record.jobs)) {
        for (const [rule, count] of Object.entries(record.jobs as Record<string, unknown>)) {
          const parsed = optionalInteger(count);
          if (parsed !== undefined) {
            jobs[rule] = parsed;
          }
        }
      }
      const declaredTotal = optionalInteger(record.total);
      return {
        type: 'run-info',
        jobs,
        total: declaredTotal ?? Object.values(jobs).reduce((sum, count) => sum + count, 0),
      };
    }
    case 'job-started': {
      const jobId = optionalInteger(record.job_id);
      const rule = optionalText(record.rule);
      return jobId === undefined || rule === undefined ? undefined : {type: 'job-started', jobId, rule};
    }
    case 'job-finished': {
      const jobId = optionalInteger(record.job_id);
      return jobId === undefined ? undefined : {type: 'job-finished', jobId};
    }
    case 'job-failed': {
      return {
        type: 'job-failed',
        jobId: optionalInteger(record.job_id),
        rule: optionalText(record.rule),
        message: optionalText(record.message),
        logs: paths(record.logs),
      };
    }
    case 'progress': {
      const done = optionalInteger(record.done);
      const total = optionalInteger(record.total);
      return done === undefined || total === undefined ? undefined : {type: 'progress', done, total};
    }
    case 'error': {
      return {
        type: 'error',
        exception: optionalText(record.exception),
        message: optionalText(record.message),
      };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Splits appended file content into events, holding back a trailing partial line.
 *
 * The event file is followed while Snakemake writes it, so a read can land mid-line; that
 * fragment is kept until the rest of the line arrives.
 */
export class RunEventReader {
  private remainder = '';

  append(chunk: string): RunEvent[] {
    const parts = (this.remainder + chunk).split('\n');
    this.remainder = parts.pop() ?? '';
    const events: RunEvent[] = [];
    for (const part of parts) {
      const text = part.trim();
      if (text.length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A malformed line is skipped rather than failing the run being watched.
        continue;
      }
      const event = toRunEvent(parsed);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }
}

export type StageState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'up-to-date'
  | 'not-implemented';

export type StageProgress = {
  id: string;
  label: string;
  state: StageState;
  done: number;
  total: number;
};

export type RunProgress = {
  stages: readonly StageProgress[];
  done: number;
  total: number;
  /** True once Snakemake has reported which jobs it scheduled. */
  planned: boolean;
  failureMessage?: string;
};

/** Groups rules the manifest does not classify, so no executed job goes unreported. */
export const unclassifiedStageId = 'unclassified';

type ProgressStages = {id: string; label: string; rules?: readonly string[]}[];

export function initialRunProgress(stages: ProgressStages): RunProgress {
  return {
    stages: stages.map(stage => ({
      id: stage.id,
      label: stage.label,
      // A stage that declares no rules has no implementation behind it yet; saying "pending"
      // would promise work that this workflow version cannot do.
      state: stage.rules && stage.rules.length > 0 ? 'pending' : 'not-implemented',
      done: 0,
      total: 0,
    })),
    done: 0,
    total: 0,
    planned: false,
  };
}

/**
 * Folds one event into the progress model.
 *
 * `jobStages` maps a scheduled job to the stage that owns it; Snakemake reports the rule name
 * when a job starts but only its identifier when it finishes.
 */
export function applyRunEvent(
  progress: RunProgress,
  event: RunEvent,
  jobStages: Map<number, string>,
  stages: ProgressStages,
): RunProgress {
  const ownerOf = (rule: string): string =>
    stages.find(stage => stage.rules?.includes(rule))?.id ?? unclassifiedStageId;
  const update = (
    id: string,
    change: (stage: StageProgress) => StageProgress,
  ): readonly StageProgress[] => {
    const known = progress.stages.some(stage => stage.id === id);
    const stagesWithUnclassified = known
      ? progress.stages
      : [
          ...progress.stages,
          {id, label: 'Other jobs', state: 'pending' as StageState, done: 0, total: 0},
        ];
    return stagesWithUnclassified.map(stage => (stage.id === id ? change(stage) : stage));
  };

  switch (event.type) {
    case 'run-info': {
      let stagesWithTotals = progress.stages.map(stage => {
        const rules = stages.find(candidate => candidate.id === stage.id)?.rules ?? [];
        const total = rules.reduce((sum, rule) => sum + (event.jobs[rule] ?? 0), 0);
        if (stage.state === 'not-implemented') {
          return stage;
        }
        // A scheduled stage starts pending; one Snakemake did not schedule is already
        // satisfied by artifacts this run directory holds.
        return {...stage, total, state: total > 0 ? ('pending' as StageState) : 'up-to-date'};
      });
      const unclassifiedTotal = Object.entries(event.jobs)
        .filter(([rule]) => !stages.some(stage => stage.rules?.includes(rule)))
        .reduce((sum, [, count]) => sum + count, 0);
      if (unclassifiedTotal > 0) {
        stagesWithTotals = [
          ...stagesWithTotals,
          {
            id: unclassifiedStageId,
            label: 'Other jobs',
            state: 'pending',
            done: 0,
            total: unclassifiedTotal,
          },
        ];
      }
      return {...progress, stages: stagesWithTotals, total: event.total, planned: true};
    }
    case 'job-started': {
      const owner = ownerOf(event.rule);
      jobStages.set(event.jobId, owner);
      return {
        ...progress,
        stages: update(owner, stage =>
          stage.state === 'failed' ? stage : {...stage, state: 'running'},
        ),
      };
    }
    case 'job-finished': {
      const owner = jobStages.get(event.jobId);
      if (owner === undefined) {
        return progress;
      }
      return {
        ...progress,
        stages: update(owner, stage => {
          const done = stage.done + 1;
          const total = Math.max(stage.total, done);
          return {
            ...stage,
            done,
            total,
            state: stage.state === 'failed' ? 'failed' : done >= total ? 'completed' : 'running',
          };
        }),
      };
    }
    case 'job-failed': {
      const owner =
        (event.jobId === undefined ? undefined : jobStages.get(event.jobId)) ??
        (event.rule === undefined ? undefined : ownerOf(event.rule));
      const failureMessage =
        progress.failureMessage ??
        (event.rule ? `Rule ${event.rule} failed.` : event.message) ??
        undefined;
      if (owner === undefined) {
        return {...progress, failureMessage};
      }
      return {
        ...progress,
        failureMessage,
        stages: update(owner, stage => ({...stage, state: 'failed'})),
      };
    }
    case 'progress': {
      return {...progress, done: event.done, total: event.total};
    }
    case 'error': {
      return {...progress, failureMessage: progress.failureMessage ?? event.message};
    }
    default: {
      return progress;
    }
  }
}

/**
 * Reads whatever has been appended to the event file since `offset`.
 *
 * The file is followed while Snakemake writes it, so it may not exist yet and may grow between
 * reads; a missing file simply yields nothing.
 */
export async function readAppendedRunEvents(
  path: string,
  offset: number,
  reader: RunEventReader,
): Promise<{events: RunEvent[]; offset: number}> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return {events: [], offset};
  }
  try {
    const {size} = await handle.stat();
    if (size <= offset) {
      return {events: [], offset};
    }
    const buffer = Buffer.alloc(size - offset);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
    return {
      events: reader.append(buffer.subarray(0, bytesRead).toString('utf8')),
      offset: offset + bytesRead,
    };
  } finally {
    await handle.close();
  }
}
