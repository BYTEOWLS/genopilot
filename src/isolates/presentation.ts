import {readPairs, type Isolate} from './catalog.js';
import type {ReadPairsCheck} from './reads.js';

/** Technique names from read sets, without duplicating lanes or deliveries. */
export function isolateTechnique(isolate: Pick<Isolate, 'read_sets'>): string {
  return [...new Set(isolate.read_sets.map(set => set.platform))].sort()
    .map(platform => platform.charAt(0).toUpperCase() + platform.slice(1)).join(' + ');
}

/** Whether an isolate's read pairs were trimmed before reaching GenoPilot. */
export function trimmedStatus(isolate: Isolate): 'untrimmed' | 'trimmed' | 'partly trimmed' | 'processing unknown' {
  const pairs = readPairs(isolate);
  if (pairs.some(pair => pair.trimmed === null)) {
    return 'processing unknown';
  }
  const trimmedCount = pairs.filter(pair => pair.trimmed).length;
  return trimmedCount === 0 ? 'untrimmed' : trimmedCount === pairs.length ? 'trimmed' : 'partly trimmed';
}

/** How many read pairs an isolate has, and whether they were trimmed. */
export function readPairsLabel(isolate: Isolate): string {
  const count = readPairs(isolate).length;
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
  return problems.length === 0 ? pairs : `${pairs} · reads: ${problems.join(', ')}`;
}

export function wildtypeLabel(isolate: Isolate): string {
  return isolate.wildtype === null
    ? 'wild type not recorded'
    : isolate.wildtype ? 'wild type' : 'not wild type';
}

/** Compact list badges: only a positive wild-type flag and any recorded parent. */
export function isolateListLineage(isolate: Isolate): string {
  return [
    isolate.wildtype === true ? wildtypeLabel(isolate) : '',
    isolate.derived_from === null ? '' : `derived from ${isolate.derived_from}`,
  ].filter(Boolean).join(', ');
}

/** Wild-type status and, when recorded, the parent isolate. */
export function lineage(isolate: Isolate): string {
  const wildtype = wildtypeLabel(isolate);
  return isolate.derived_from === null ? wildtype : `${wildtype}, derived from ${isolate.derived_from}`;
}
