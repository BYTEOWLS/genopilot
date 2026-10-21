import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export type ProcessEntry = {pid: number; ppid: number; rssKilobytes: number};

/** Every process's ID, parent, and resident memory; `ps` exists on macOS and Linux alike. */
export type ProcessListReader = () => Promise<ProcessEntry[]>;

const run = promisify(execFile);

export function parseProcessList(text: string): ProcessEntry[] {
  return text.split('\n').flatMap(line => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return pid !== undefined && ppid !== undefined && rss !== undefined && [pid, ppid, rss].every(Number.isSafeInteger)
      ? [{pid, ppid, rssKilobytes: rss}]
      : [];
  });
}

export const readProcessList: ProcessListReader = async () =>
  parseProcessList((await run('ps', ['-A', '-o', 'pid=,ppid=,rss='])).stdout);

/** The resident memory of a process and all its descendants, such as Snakemake and its jobs. */
export function treeMemoryBytes(processes: readonly ProcessEntry[], rootPid: number): number {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of processes) {
    children.set(entry.ppid, [...children.get(entry.ppid) ?? [], entry]);
  }
  let total = 0;
  const pending = processes.filter(entry => entry.pid === rootPid);
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    total += entry.rssKilobytes * 1024;
    pending.push(...children.get(entry.pid) ?? []);
  }
  return total;
}

/**
 * Samples the memory of a process tree every `intervalMs` until stopped, and returns the highest
 * total seen. A peak shorter than the interval can be missed, and memory that processes share is
 * counted once for each, so the figure errs high. A sample that cannot be read is skipped.
 */
export function sampleTreeMemory(
  rootPid: number,
  {intervalMs = 5000, readProcesses = readProcessList}: {intervalMs?: number; readProcesses?: ProcessListReader} = {},
): {stop: () => number | undefined} {
  let peak: number | undefined;
  let sampling = false;
  const sample = () => {
    if (sampling) {
      return;
    }
    sampling = true;
    readProcesses().then(
      processes => {
        const bytes = treeMemoryBytes(processes, rootPid);
        if (bytes > 0) {
          peak = Math.max(peak ?? 0, bytes);
        }
      },
      () => undefined,
    ).finally(() => {
      sampling = false;
    });
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  return {
    stop: () => {
      clearInterval(timer);
      return peak;
    },
  };
}
