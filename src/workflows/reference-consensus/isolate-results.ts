import {access} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * The isolates whose processing is complete in a run directory. The workflow writes an isolate's
 * promotion candidate as its last per-isolate step, only after the isolate's FASTA passed its
 * checks, so the file's presence marks a finished isolate, also one finished in an earlier attempt.
 */
export async function completedIsolates(
  runDirectory: string,
  isolateIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const finished = await Promise.all(
    isolateIds.map(async id => {
      try {
        await access(join(runDirectory, 'results', 'isolates', id, 'promotion-candidate.json'));
        return id;
      } catch {
        return undefined;
      }
    }),
  );
  return new Set(finished.filter((id): id is string => id !== undefined));
}
