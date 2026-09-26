import type {Isolate} from './catalog.js';
import type {ReadPairsCheck} from './reads.js';

/** Whether an isolate's read pairs were trimmed before reaching GenoPilot. */
export function trimmedStatus(isolate: Isolate): 'untrimmed' | 'trimmed' | 'partly trimmed' {
  const trimmedCount = isolate.read_pairs.filter(pair => pair.trimmed).length;
  return trimmedCount === 0 ? 'untrimmed' : trimmedCount === isolate.read_pairs.length ? 'trimmed' : 'partly trimmed';
}

/** How many read pairs an isolate has, and whether they were trimmed. */
export function readPairsLabel(isolate: Isolate): string {
  const count = isolate.read_pairs.length;
  const status = trimmedStatus(isolate);
  return `${String(count)} read pair${count === 1 ? '' : 's'}${status === 'untrimmed' ? '' : `, ${status}`}`;
}

/** An isolate's read pairs and, once checked, whether their files are usable. */
export function readSummary(isolate: Isolate, check: ReadPairsCheck | undefined): string {
  const pairs = readPairsLabel(isolate);
  if (!check) {
    return `${pairs} · checking reads`;
  }
  const problems = check.pairs.flatMap((pair, index) => [
    pair.r1.state === 'ok' ? undefined : `pair ${String(index + 1)} R1 ${pair.r1.state}`,
    pair.r2.state === 'ok' ? undefined : `pair ${String(index + 1)} R2 ${pair.r2.state}`,
  ]).filter((problem): problem is string => problem !== undefined);
  if (check.sameFiles.length > 0) {
    problems.push('linked duplicate files');
  }
  return `${pairs} · ${problems.length === 0 ? 'reads ok' : `reads: ${problems.join(', ')}`}`;
}

export function wildtypeLabel(isolate: Isolate): string {
  return isolate.wildtype === null
    ? 'wild type not recorded'
    : isolate.wildtype ? 'wild type' : 'not wild type';
}

/** Wild-type status and, when recorded, the parent isolate. */
export function lineage(isolate: Isolate): string {
  const wildtype = wildtypeLabel(isolate);
  return isolate.derived_from === null ? wildtype : `${wildtype}, derived from ${isolate.derived_from}`;
}
