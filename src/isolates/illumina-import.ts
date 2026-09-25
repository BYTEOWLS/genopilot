import {suggestIsolateId, type IsolateCatalog, type ReadPair} from './catalog.js';
import type {DeliveryCandidate, DeliveryReadSet, DeliveryScan} from './illumina-delivery.js';

/**
 * The researcher's choice for one read set: one variant by index, none of them, or no choice yet
 * because the suggestions did not single out one untrimmed copy.
 */
export type ReadSetDecision = {variant: number | 'none' | 'undecided'; trimmed: boolean};

export type NewIsolateFields = {
  name: string;
  id: string;
  wildtype: boolean | null;
  derivedFrom: string | null;
};

export type CandidateDecision = {
  target: 'new' | 'skip' | {existingId: string};
  /** Kept while another target is chosen, so switching back does not lose edits. */
  newIsolate: NewIsolateFields;
  readSets: ReadSetDecision[];
};

/** Decisions that cannot be saved yet, such as a read set whose copy was not chosen. */
export class ImportDecisionError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Import not ready:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
    this.name = 'ImportDecisionError';
    this.problems = problems;
  }
}

/**
 * Preselects one variant only when it is unambiguous: the only copy, or the only copy that looks
 * untrimmed. Otherwise the researcher chooses.
 */
export function initialReadSetDecision(readSet: DeliveryReadSet): ReadSetDecision {
  const [only] = readSet.variants;
  if (readSet.variants.length === 1 && only) {
    return {variant: 0, trimmed: only.suggestedTrimmed};
  }
  const untrimmed = readSet.variants.flatMap((variant, index) => variant.suggestedTrimmed ? [] : [index]);
  const [single] = untrimmed;
  return untrimmed.length === 1 && single !== undefined
    ? {variant: single, trimmed: false}
    : {variant: 'undecided', trimmed: false};
}

/** Choosing a variant resets the flag to that variant's suggestion. */
export function chooseVariant(readSet: DeliveryReadSet, variant: number | 'none'): ReadSetDecision {
  return {variant, trimmed: variant === 'none' ? false : readSet.variants[variant]?.suggestedTrimmed ?? false};
}

/**
 * Proposes a decision per candidate: add to an existing isolate whose name or ID equals the
 * sample name, as for a top-up run, and otherwise create a new isolate with a unique suggested ID.
 */
export function initialDecisions(scan: DeliveryScan, catalog: IsolateCatalog): CandidateDecision[] {
  const usedIds = new Set(catalog.isolates.map(isolate => isolate.id));
  return scan.candidates.map(candidate => {
    const existing = catalog.isolates.find(isolate => isolate.name === candidate.sample || isolate.id === candidate.sample);
    const id = suggestIsolateId(candidate.sample, usedIds);
    usedIds.add(id);
    return {
      target: existing ? {existingId: existing.id} : 'new',
      newIsolate: {name: candidate.sample, id, wildtype: null, derivedFrom: null},
      readSets: candidate.readSets.map(initialReadSetDecision),
    };
  });
}

function describeReadSet(readSet: DeliveryReadSet): string {
  const lane = readSet.lane === null ? 'merged lanes' : `lane ${String(readSet.lane)}`;
  return `run ${String(readSet.run)}, flowcell ${readSet.flowcell}, ${lane}`;
}

function chosenPairs(candidate: DeliveryCandidate, decision: CandidateDecision): ReadPair[] {
  return candidate.readSets.flatMap((readSet, index) => {
    const choice = decision.readSets[index];
    const variant = typeof choice?.variant === 'number' ? readSet.variants[choice.variant] : undefined;
    return variant && choice ? [{r1: variant.r1, r2: variant.r2, trimmed: choice.trimmed}] : [];
  });
}

/**
 * Applies the decisions to `catalog`: new isolates are appended and chosen pairs are added to
 * existing ones. Throws `ImportDecisionError` for choices that are still open; schema and read-file
 * rules are left to catalog validation.
 */
export function applyImportDecisions(
  catalog: IsolateCatalog,
  scan: DeliveryScan,
  decisions: readonly CandidateDecision[],
): {catalog: IsolateCatalog; pairs: ReadPair[]; created: number; extended: number} {
  const problems: string[] = [];
  const isolates = structuredClone(catalog.isolates);
  const pairs: ReadPair[] = [];
  let created = 0;
  // Several samples can add to one isolate; it still counts once.
  const extendedIds = new Set<string>();
  scan.candidates.forEach((candidate, index) => {
    const decision = decisions[index];
    if (decision === undefined || decision.target === 'skip') {
      return;
    }
    // Numbered as in the review, so a problem is easy to find in a long delivery.
    const sample = `${String(index + 1)}) ${candidate.sample}`;
    candidate.readSets.forEach((readSet, readSetIndex) => {
      if (decision.readSets[readSetIndex]?.variant === 'undecided') {
        problems.push(`${sample}: choose a copy of ${describeReadSet(readSet)}, or leave it out`);
      }
    });
    const chosen = chosenPairs(candidate, decision);
    if (chosen.length === 0) {
      problems.push(`${sample}: include at least one read set, or skip the sample`);
      return;
    }
    pairs.push(...chosen);
    if (decision.target === 'new') {
      const {name, id, wildtype, derivedFrom} = decision.newIsolate;
      isolates.push({id, name: name.trim(), wildtype, derived_from: derivedFrom, read_pairs: chosen});
      created += 1;
      return;
    }
    const {existingId} = decision.target;
    const existing = isolates.find(isolate => isolate.id === existingId);
    if (!existing) {
      problems.push(`${sample}: isolate ${existingId} no longer exists`);
      return;
    }
    existing.read_pairs.push(...chosen);
    extendedIds.add(existingId);
  });
  if (problems.length > 0) {
    throw new ImportDecisionError(problems);
  }
  return {catalog: {...catalog, isolates}, pairs, created, extended: extendedIds.size};
}
