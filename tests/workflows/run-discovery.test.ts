import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import {
  deleteWorkflowRun,
  discoverWorkflowRuns,
} from '../../src/workflows/run-discovery.js';
import type {LoadedWorkflowResult} from '../../src/workflows/results.js';

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'annotation-transfer',
  label: 'Current packaged label',
  description: 'Transfer annotations.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
};

async function addRun(
  root: string,
  directoryId: string,
  configuration?: Record<string, unknown>,
): Promise<string> {
  const directory = join(root, 'annotation-transfer', directoryId);
  await mkdir(directory, {recursive: true});
  if (configuration) {
    await writeFile(join(directory, 'config.yaml'), JSON.stringify(configuration), 'utf8');
  }
  return directory;
}

function incompatible(kind: 'missing-summary' | 'invalid-summary' | 'missing-configuration'): LoadedWorkflowResult {
  return {kind: 'incompatible', error: {kind, message: kind}};
}

test('discovers run metadata and result states newest first', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-run-discovery-'));
  await addRun(tempDir, 'older-directory', {
    workflow_id: 'annotation-transfer',
    workflow_version: 1,
    genopilot: {version: '1.2.3', igv: '3.8.9', build: {commit: '0123456789abcdef0123456789abcdef01234567', committed_at: '2026-01-01T00:00:00.000Z', modified: false, released: true}},
    run: {
      id: 'older-run',
      name: 'Older name',
      description: 'Saved description',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  });
  await addRun(tempDir, 'newer-directory', {
    workflow_id: 'annotation-transfer',
    workflow_version: 2,
    run: {id: 'newer-run', created_at: '2026-02-01T00:00:00.000Z'},
  });
  await addRun(tempDir, 'broken-directory');
  await writeFile(join(tempDir, 'annotation-transfer', 'not-a-run.txt'), 'ignored', 'utf8');

  const runs = await discoverWorkflowRuns(tempDir, manifest, async directory => {
    if (directory.endsWith('older-directory')) {
      return incompatible('missing-summary');
    }
    if (directory.endsWith('newer-directory')) {
      return incompatible('invalid-summary');
    }
    return incompatible('missing-configuration');
  });

  assert.deepEqual(runs.map(run => run.metadata.id), [
    'newer-run',
    'older-run',
    'broken-directory',
  ]);
  assert.equal(runs[0]?.metadata.workflowVersion, 2);
  assert.equal(runs[0]?.status, 'corrupt');
  assert.equal(runs[1]?.metadata.name, 'Older name');
  assert.equal(runs[1]?.metadata.description, 'Saved description');
  assert.equal(runs[1]?.metadata.genopilot?.version, '1.2.3');
  assert.equal(runs[0]?.metadata.genopilot, undefined);
  assert.equal(runs[1]?.status, 'incomplete');
  assert.equal(runs[2]?.status, 'corrupt');
});

test('deletes only a direct child of the selected workflow run directory', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-run-deletion-'));
  const selectedRun = await addRun(tempDir, 'selected-run');
  const outsideRun = join(tempDir, 'outside-run');
  await mkdir(outsideRun);

  await assert.rejects(
    deleteWorkflowRun(tempDir, manifest.id, outsideRun),
    /outside the selected workflow run directory/,
  );
  await access(outsideRun);

  await deleteWorkflowRun(tempDir, manifest.id, selectedRun);
  await assert.rejects(access(selectedRun), error =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT');
  await access(outsideRun);
});

test('refuses deletion through a workflow-directory symlink', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-run-deletion-outside-'));
  const externalRoot = await mkdtemp(join(tmpdir(), 'genopilot-run-deletion-external-'));
  const externalWorkflow = join(externalRoot, manifest.id);
  const externalRun = join(externalWorkflow, 'outside-run');
  await mkdir(externalRun, {recursive: true});
  await symlink(externalWorkflow, join(tempDir, manifest.id), 'dir');

  await assert.rejects(
    deleteWorkflowRun(tempDir, manifest.id, join(tempDir, manifest.id, 'outside-run')),
    /outside the selected workflow run directory/,
  );
  await access(externalRun);
});

test('returns an empty list when a workflow has no run directory', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-run-discovery-'));
  assert.deepEqual(await discoverWorkflowRuns(tempDir, manifest), []);
});
