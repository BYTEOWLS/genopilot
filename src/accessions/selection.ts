import {accessionSources} from './registry.js';
import type {GenomeReference} from './provider.js';

/** Form values are strings; catalog selections snapshot the complete nonsecret reference. */
export function genomeSelection(reference: GenomeReference): string {
  return JSON.stringify(accessionSources.validateReference(reference));
}

/** Workflow forms accept only complete catalog reference snapshots, never typed IDs. */
export function selectedGenome(value: string): GenomeReference | undefined {
  try {
    if (value.trim().startsWith('{')) {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).some(key => !['source', 'id', 'parameters'].includes(key))) {
        return undefined;
      }
      return accessionSources.validateReference(parsed);
    }
    return undefined;
  } catch {
    return undefined;
  }
}
