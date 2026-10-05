import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {AnnotationTransferConfiguration} from '../../../src/workflows/annotation-transfer/configuration.js';
import {transferGuideHeading, transferReferenceView, transferTargetView} from '../../../src/workflows/annotation-transfer/views.js';

const fixtures = join(import.meta.dirname, '../../fixtures/annotation-transfer');

const configuration = {
  schema_version: 1,
  workflow_id: 'annotation-transfer',
  workflow_version: 1,
  inputs: {
    reference: {source: 'ncbi', accession: 'GCA_000000001.1'},
    target: {source: 'local', fasta: '/data/target.fasta'},
  },
  lifton: {profile: 'same-species'},
  resources: {cpu_mode: 'automatic', effective_cpus: 1},
  run: {id: 'run-1', name: 'Fixture run', created_at: '2026-10-05T10:00:00.000Z'},
} as unknown as AnnotationTransferConfiguration;

const recorded = {
  'resolved/reference.fasta': 'imported',
  'resolved/reference.gff3': 'imported',
  'resolved/target.fasta': 'imported',
  'results/annotation/lifton.raw.gff3': 'generated',
};

/** A finished run with the resolved fixtures, a transferred GFF3, both candidate files, and its artifact index. */
async function fixtureRun(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-transfer-views-'));
  await mkdir(join(tempDir, 'resolved'));
  await mkdir(join(tempDir, 'results/annotation/lifton_output/miniprot'), {recursive: true});
  await mkdir(join(tempDir, 'results/annotation/lifton_output/liftoff'));
  await copyFile(join(fixtures, 'reference.fasta'), join(tempDir, 'resolved/reference.fasta'));
  await copyFile(join(fixtures, 'reference.gff3'), join(tempDir, 'resolved/reference.gff3'));
  await copyFile(join(fixtures, 'target.fasta'), join(tempDir, 'resolved/target.fasta'));
  await copyFile(join(fixtures, 'reference.gff3'), join(tempDir, 'results/annotation/lifton.raw.gff3'));
  await copyFile(join(fixtures, 'reference.gff3'), join(tempDir, 'results/annotation/lifton_output/miniprot/miniprot.gff3'));
  await copyFile(join(fixtures, 'reference.gff3'), join(tempDir, 'results/annotation/lifton_output/liftoff/liftoff.gff3'));
  const artifacts = await Promise.all(Object.entries(recorded).map(async ([path, origin]) => ({
    id: path, path, origin, checksum: {algorithm: 'sha256', value: createHash('sha256').update(await readFile(join(tempDir, path))).digest('hex')},
  })));
  artifacts.push({id: 'lifton-diagnostics', path: 'results/annotation/lifton_output', origin: 'generated', checksum: {algorithm: 'sha256', value: 'a'.repeat(64)}});
  await writeFile(join(tempDir, 'artifacts.yaml'), JSON.stringify({schema_version: 1, artifacts}));
  return tempDir;
}

function context(runDirectory: string) {
  return {runDirectory, configuration, application: {name: 'GenoPilot', version: '0.0.0'}, workflow: {id: 'annotation-transfer', version: 1, label: 'Transfer genome annotation'}};
}

test('the target view lists the verified transfer before the unverified candidate models', async () => {
  const tempDir = await fixtureRun();
  try {
    const view = await transferTargetView(context(tempDir));
    assert.equal(view.content.reference.fasta, join(tempDir, 'resolved/target.fasta'));
    assert.ok(view.content.reference.snapshot);
    assert.equal(view.content.reference.name, 'Target');
    assert.deepEqual(view.content.tracks.map(track => track.id), ['transferred', 'liftoff', 'miniprot']);
    assert.ok(view.content.tracks[0]!.snapshot, 'the transferred GFF3 is checksum-verified');
    assert.ok(view.content.tracks.slice(1).every(track => !track.snapshot && !track.problem));
    assert.deepEqual(view.content.tracks.map(track => track.shown), [true, false, false], 'the intermediate annotations start hidden');
    assert.deepEqual(view.provenance.sources.map(source => !!source.sha256), [true, true, false, false]);
    assert.notEqual(view.id, (await transferReferenceView(context(tempDir))).id);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('a missing candidate file stays listed with its problem', async () => {
  const tempDir = await fixtureRun();
  try {
    await rm(join(tempDir, 'results/annotation/lifton_output/miniprot'), {recursive: true});
    const view = await transferTargetView(context(tempDir));
    const miniprot = view.content.tracks.find(track => track.id === 'miniprot');
    assert.match(miniprot?.problem ?? '', /miniprot\.gff3/);
    assert.equal(view.content.tracks.find(track => track.id === 'liftoff')?.problem, undefined);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('the reference view shows the verified source annotation under the accession', async () => {
  const tempDir = await fixtureRun();
  try {
    const guide = {id: 'results', title: 'Results', links: {}, blocks: [
      {kind: 'heading', level: 2, content: [{kind: 'text', text: 'Overview'}]},
      {kind: 'heading', level: 2, content: [{kind: 'text', text: transferGuideHeading}]},
      {kind: 'paragraph', content: [{kind: 'text', text: 'How to read the views.'}]},
      {kind: 'heading', level: 2, content: [{kind: 'text', text: 'Reference genome view'}]},
    ]} as unknown as Parameters<typeof transferReferenceView>[0]['guide'];
    const view = await transferReferenceView({...context(tempDir), guide});
    assert.equal(view.content.reference.name, 'GCA_000000001.1');
    assert.ok(['Transfer genome annotation', 'Fixture run', 'GCA_000000001.1'].every(part => view.title.includes(part)), 'the headline names the workflow, the run, and the genome');
    assert.deepEqual(view.content.tracks.map(track => [track.id, !!track.snapshot]), [['reference-annotation', true]]);
    assert.equal(view.guide?.title, transferGuideHeading);
    assert.deepEqual(view.guide?.blocks?.filter(block => block.kind === 'heading').length, 2, 'the guide keeps its own sections and drops the page before it');
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('a checksum mismatch of a verified file refuses the view', async () => {
  const tempDir = await fixtureRun();
  try {
    await appendFile(join(tempDir, 'results/annotation/lifton.raw.gff3'), '# changed\n');
    await assert.rejects(transferTargetView(context(tempDir)), /no longer matches its recorded checksum/);
    await appendFile(join(tempDir, 'resolved/reference.gff3'), '# changed\n');
    await assert.rejects(transferReferenceView(context(tempDir)), /no longer matches its recorded checksum/);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('a run without an artifact index or without a recorded file refuses the view', async () => {
  const tempDir = await fixtureRun();
  try {
    await writeFile(join(tempDir, 'artifacts.yaml'), JSON.stringify({schema_version: 1, artifacts: []}));
    await assert.rejects(transferTargetView(context(tempDir)), /records no checksum for resolved\/target\.fasta/);
    await rm(join(tempDir, 'artifacts.yaml'));
    await assert.rejects(transferReferenceView(context(tempDir)), /no readable artifact index/);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});
