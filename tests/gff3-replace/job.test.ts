import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {stringify} from 'yaml';
import type {ReplaceOptions} from '../../src/gff3-replace/core.js';
import {defaultOutputParent, findRunDirectory, listDerivedRewrites, runGff3Sources} from '../../src/gff3-replace/derived.js';
import {previewRewrite, writeRewrite, type ReplaceWorker, type StartWorker} from '../../src/gff3-replace/job.js';
import {waitFor} from '../wait.js';

const gff3 = '##gff-version 3\nchr1\tsynthetic\tgene\t1\t100\t.\t+\t.\tID=AN1;Name=AN1\nchr1\tsynthetic\tmRNA\t1\t100\t.\t+\t.\tID=AN1.1;Parent=AN1\n';
const replaceAn: ReplaceOptions = {search: 'AN', replacement: 'X', regularExpression: false, attributes: ['ids', 'Name']};
const application = async () => ({name: 'genopilot-test', version: '0.0.0'});
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function tempDirectory(context: {after: (fn: () => Promise<void>) => void}): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gff3-replace-job-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  return tempDir;
}

/** A synthetic finished run with one GFF3 result recorded in its artifact index. */
async function syntheticRun(tempDir: string, text = gff3): Promise<{run: string; source: string}> {
  const run = join(tempDir, 'runs', 'workflow', 'run-1');
  await mkdir(join(run, 'results'), {recursive: true});
  await writeFile(join(run, 'config.yaml'), stringify({workflow_id: 'workflow', run: {id: 'run-1'}}));
  const source = join(run, 'results', 'annotation.gff3');
  await writeFile(source, text);
  await writeFile(join(run, 'artifacts.yaml'), stringify({schema_version: 1, artifacts: [
    {path: 'results/annotation.gff3', origin: 'generated', checksum: {algorithm: 'sha256', value: sha256(text)}},
  ]}));
  return {run, source};
}

test('a rewrite writes a new folder with the GFF3, ID mapping, and record; the source stays unchanged', async context => {
  const tempDir = await tempDirectory(context);
  const source = join(tempDir, 'source.gff3');
  await writeFile(source, gff3);
  const preview = await previewRewrite({source, options: replaceAn});
  const now = () => new Date('2026-11-11T12:00:00.123Z');
  const first = await writeRewrite({source, options: replaceAn, expectedSourceSha256: preview.sourceSha256, outputParent: tempDir},
    undefined, {now, application});
  const second = await writeRewrite({source, options: replaceAn, expectedSourceSha256: preview.sourceSha256, outputParent: tempDir},
    undefined, {now, application});
  assert.equal(first.state, 'written');
  assert.equal(second.state, 'written');
  if (first.state !== 'written' || second.state !== 'written') {
    return;
  }
  assert.equal(first.folder, join(tempDir, 'gff3-replace-20261111T120000.123Z'));
  assert.equal(second.folder, `${first.folder}-2`);
  assert.deepEqual((await readdir(first.folder)).sort(), ['id-mapping.tsv', 'replace.yaml', 'source.gff3']);
  assert.equal(await readFile(source, 'utf8'), gff3);
  assert.match(await readFile(join(first.folder, 'source.gff3'), 'utf8'), /ID=X1;Name=X1;Alias=AN1/);
  assert.deepEqual(first.record.statistics.ids, {changed: 2, matched_unchanged: 0, unmatched: 0});
  assert.equal(first.record.statistics.replacements, preview.statistics.replacements);
  assert.equal(first.record.source.sha256, sha256(gff3));
  assert.equal(first.record.files.gff3.sha256, sha256(await readFile(join(first.folder, 'source.gff3'), 'utf8')));
});

test('a refused rewrite leaves no folder behind', async context => {
  const tempDir = await tempDirectory(context);
  const source = join(tempDir, 'source.gff3');
  await writeFile(source, gff3);
  const outputParent = join(tempDir, 'out');
  const outcome = await writeRewrite({source, options: {...replaceAn, replacement: ' '}, expectedSourceSha256: sha256(gff3), outputParent},
    undefined, {application});
  assert.equal(outcome.state, 'refused');
  assert.deepEqual(await readdir(outputParent), []);
});

test('a failing worker leaves no folder behind', async context => {
  const tempDir = await tempDirectory(context);
  const outputParent = join(tempDir, 'out');
  await assert.rejects(writeRewrite({source: join(tempDir, 'missing.gff3'), options: replaceAn, expectedSourceSha256: '', outputParent},
    undefined, {application}), /ENOENT/);
  assert.deepEqual(await readdir(outputParent), []);
});

test('cancelling terminates a worker that never finishes and leaves no folder behind', async context => {
  const tempDir = await tempDirectory(context);
  const source = join(tempDir, 'source.gff3');
  await writeFile(source, gff3);
  const outputParent = join(tempDir, 'out');
  let started = false;
  let terminated = false;
  const start: StartWorker = () => {
    started = true;
    const worker = new EventEmitter() as EventEmitter & ReplaceWorker;
    // Like a real worker, it exits before `terminate()` resolves.
    worker.terminate = async () => {
      terminated = true;
      worker.emit('exit', 1);
      return 1;
    };
    return worker;
  };
  const controller = new AbortController();
  const writing = writeRewrite({source, options: replaceAn, expectedSourceSha256: sha256(gff3), outputParent}, controller.signal,
    {start, application});
  await waitFor(() => started, 'the worker starts');
  controller.abort(new Error('cancelled-marker'));
  await assert.rejects(writing, /cancelled-marker/);
  assert.equal(terminated, true);
  assert.deepEqual(await readdir(outputParent), []);
});

test('rewrites of a run go to its derived folder, chain, and are marked outdated when their source changes', async context => {
  const tempDir = await tempDirectory(context);
  const {run, source} = await syntheticRun(tempDir);
  assert.equal(await findRunDirectory(source), run);
  assert.equal(await findRunDirectory(join(tempDir, 'elsewhere.gff3')), undefined);
  const outputParent = defaultOutputParent(source, run);
  assert.equal(outputParent, join(run, 'derived'));

  const first = await writeRewrite({source, options: replaceAn, expectedSourceSha256: sha256(gff3), outputParent, runDirectory: run},
    undefined, {now: () => new Date('2026-01-01T00:00:00.000Z'), application});
  assert.equal(first.state, 'written');
  if (first.state !== 'written') {
    return;
  }
  const derivedSource = join(first.folder, 'annotation.gff3');
  assert.equal(await findRunDirectory(derivedSource), run);
  const second = await writeRewrite({source: derivedSource, options: {...replaceAn, search: 'X', replacement: 'Y'},
    expectedSourceSha256: first.record.files.gff3.sha256, outputParent, runDirectory: run},
  undefined, {now: () => new Date('2026-01-01T00:00:01.000Z'), application});
  assert.equal(second.state, 'written');
  if (second.state !== 'written') {
    return;
  }
  assert.equal(second.record.source.run_path, 'derived/gff3-replace-20260101T000000.000Z/annotation.gff3');
  assert.match(await readFile(join(second.folder, 'annotation.gff3'), 'utf8'), /ID=Y1;Name=Y1;Alias=AN1,X1/);
  assert.equal(await readFile(source, 'utf8'), gff3);

  const current = await listDerivedRewrites(run);
  assert.deepEqual(current.map(rewrite => rewrite.state), ['current', 'current']);
  const manifest = {artifacts: [
    {id: 'annotation', label: 'Annotation', path: 'results/annotation.gff3', type: 'gff3', produced_by: 'stage'},
    {id: 'table', label: 'Table', path: 'results/table.tsv', type: 'tsv', produced_by: 'stage'},
  ]};
  assert.deepEqual(runGff3Sources(run, manifest, current).map(entry => entry.kind), ['artifact', 'derived', 'derived']);

  // An iteration that replaced the result records a new checksum; both rewrites are now outdated.
  await writeFile(join(run, 'artifacts.yaml'), stringify({schema_version: 1, artifacts: [
    {path: 'results/annotation.gff3', origin: 'generated', checksum: {algorithm: 'sha256', value: sha256('changed')}},
  ]}));
  const outdated = await listDerivedRewrites(run);
  assert.deepEqual(outdated.map(rewrite => rewrite.state), ['outdated', 'outdated']);
  assert.deepEqual(runGff3Sources(run, manifest, outdated).map(entry => entry.kind), ['artifact']);
});

test('a run without derived files lists none', async context => {
  const tempDir = await tempDirectory(context);
  const {run} = await syntheticRun(tempDir);
  assert.deepEqual(await listDerivedRewrites(run), []);
});
