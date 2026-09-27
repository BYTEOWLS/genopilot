import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {completedIsolates} from '../../../src/workflows/reference-consensus/isolate-results.js';

test('reports the isolates whose promotion candidate exists', async context => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'consensus-isolate-results-'));
  context.after(() => rm(runDirectory, {recursive: true, force: true}));
  await mkdir(join(runDirectory, 'results', 'isolates', 'iso-a'), {recursive: true});
  await writeFile(join(runDirectory, 'results', 'isolates', 'iso-a', 'promotion-candidate.json'), '{}');
  // A partly processed isolate has results but no candidate yet.
  await mkdir(join(runDirectory, 'results', 'isolates', 'iso-b'), {recursive: true});
  await writeFile(join(runDirectory, 'results', 'isolates', 'iso-b', 'alignment.bam'), '');

  assert.deepEqual([...await completedIsolates(runDirectory, ['iso-a', 'iso-b', 'iso-c'])], ['iso-a']);
});
