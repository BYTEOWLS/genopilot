import type {WorkflowStage} from './manifest.js';
import type {RunEvent} from './run-events.js';

export type IsolateProgressState = 'pending' | 'running' | 'completed' | 'failed';

export type IsolateProgress = {
  id: string;
  label: string;
  state: IsolateProgressState;
  /** Finished jobs of this isolate in this attempt. */
  done: number;
  /** Jobs a complete run performs for this isolate: its read-pair rules per pair plus its isolate rules. */
  total: number;
  /** The rule of the isolate's most recently started job while it is running. */
  currentRule?: string;
};

export type ProgressIsolate = {id: string; label: string; readPairs: number};

type PerIsolateRules = NonNullable<WorkflowStage['per_isolate']>;

/** The per-isolate rule split of the first stage that declares one, if any. */
export function perIsolateRules(stages: readonly Pick<WorkflowStage, 'per_isolate'>[]): PerIsolateRules | undefined {
  return stages.find(stage => stage.per_isolate)?.per_isolate;
}

export function initialIsolateProgress(
  isolates: readonly ProgressIsolate[],
  rules: PerIsolateRules | undefined,
): IsolateProgress[] {
  if (!rules) {
    return [];
  }
  return isolates.map(isolate => ({
    id: isolate.id,
    label: isolate.label,
    state: 'pending',
    done: 0,
    total: rules.read_pair_rules.length * isolate.readPairs + rules.isolate_rules.length,
  }));
}

/**
 * Folds one run event into per-isolate progress. A job belongs to an isolate when its rule is one
 * of the per-isolate rules and its `isolate` wildcard names a selected isolate. `jobIsolates`
 * remembers that owner, because Snakemake names a finished job only by its identifier.
 */
export function applyIsolateEvent(
  isolates: readonly IsolateProgress[],
  event: RunEvent,
  jobIsolates: Map<number, string>,
  rules: PerIsolateRules | undefined,
): readonly IsolateProgress[] {
  const update = (id: string | undefined, change: (isolate: IsolateProgress) => IsolateProgress) =>
    id === undefined ? isolates : isolates.map(isolate => (isolate.id === id ? change(isolate) : isolate));

  switch (event.type) {
    case 'job-started': {
      const id = event.wildcards?.isolate;
      const perIsolate = rules && [...rules.read_pair_rules, ...rules.isolate_rules].includes(event.rule);
      if (!perIsolate || id === undefined || !isolates.some(isolate => isolate.id === id)) {
        return isolates;
      }
      jobIsolates.set(event.jobId, id);
      return update(id, isolate =>
        isolate.state === 'failed' ? isolate : {...isolate, state: 'running', currentRule: event.rule});
    }
    case 'job-finished': {
      return update(jobIsolates.get(event.jobId), isolate => {
        const done = isolate.done + 1;
        if (isolate.state === 'failed') {
          return {...isolate, done};
        }
        if (done >= isolate.total) {
          const {currentRule: _finished, ...rest} = isolate;
          return {...rest, done, state: 'completed'};
        }
        return {...isolate, done};
      });
    }
    case 'job-failed': {
      const id = event.jobId === undefined ? undefined : jobIsolates.get(event.jobId);
      return update(id, isolate => ({...isolate, state: 'failed'}));
    }
    default: {
      return isolates;
    }
  }
}

/**
 * Settles progress once Snakemake has exited successfully: every isolate is then complete, also
 * when some of its jobs were not rerun because an earlier attempt's results were reused.
 */
export function settleIsolateProgress(isolates: readonly IsolateProgress[]): readonly IsolateProgress[] {
  return isolates.map(isolate => {
    if (isolate.state === 'failed') {
      return isolate;
    }
    const {currentRule: _finished, ...rest} = isolate;
    return {...rest, state: 'completed'};
  });
}
