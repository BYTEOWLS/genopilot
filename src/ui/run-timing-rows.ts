import {formatDuration, type RunTiming} from '../workflows/run-timing.js';
import {formatMemory} from '../workflows/systems-check.js';

export type TimingRow = {id: string; label: string; value: string};

/**
 * Started, finished, duration, peak memory, and attempts of an execution's timing, as rows any result
 * section shows under its own ID prefix. Parts the timing lacks are left out.
 */
export function timingRows(
  timing: Pick<RunTiming, 'durationMs'> & Partial<Pick<RunTiming, 'startedAt' | 'finishedAt' | 'attempts' | 'peakMemoryBytes'>>,
  idPrefix: string,
  formatDateTime: (value: string) => string,
): TimingRow[] {
  const rows: TimingRow[] = [];
  if (timing.startedAt) {
    rows.push({id: `${idPrefix}.started_at`, label: 'Started', value: formatDateTime(timing.startedAt)});
  }
  if (timing.finishedAt) {
    rows.push({id: `${idPrefix}.finished_at`, label: 'Finished', value: formatDateTime(timing.finishedAt)});
  }
  rows.push({id: `${idPrefix}.duration`, label: 'Duration', value: formatDuration(timing.durationMs)});
  if (timing.peakMemoryBytes !== undefined) {
    rows.push({id: `${idPrefix}.peak_memory`, label: 'Peak memory', value: formatMemory(timing.peakMemoryBytes)});
  }
  if (timing.attempts && timing.attempts.length > 1) {
    rows.push({
      id: `${idPrefix}.attempts`,
      label: 'Attempts',
      value: `${String(timing.attempts.length)} (duration counts only while Snakemake ran)`,
    });
  }
  return rows;
}

/** One row per stage that ran, labeled with the stage's label. */
export function stageDurationRows(
  timing: Pick<RunTiming, 'stages'>,
  stages: readonly {id: string; label: string}[],
  idPrefix: string,
): TimingRow[] {
  return timing.stages.map(stage => ({
    id: `${idPrefix}.stage.${stage.id}`,
    label: stages.find(candidate => candidate.id === stage.id)?.label ?? 'Remaining steps',
    value: formatDuration(stage.durationMs),
  }));
}
