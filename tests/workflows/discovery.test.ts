import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test, {type TestContext} from 'node:test';
import {
  discoverPackagedWorkflows,
  WorkflowDiscoveryError,
} from '../../src/workflows/discovery.js';

function manifestSource(id: string, label: string): string {
  return `schema_version: 1
workflow_version: 1
id: ${id}
label: ${label}
description: Description for ${label}.
entry_snakefile: Snakefile
parameter-definitions: manifest.parameters.yaml
stages:
  - id: prepare
    label: Prepare
artifacts: []
`;
}

async function temporaryWorkflowDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-discovery-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

async function addManifest(
  root: string,
  directoryName: string,
  source: string,
): Promise<void> {
  const directory = join(root, directoryName);
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'manifest.yaml'), source);
  await writeFile(
    join(directory, 'manifest.parameters.yaml'),
    'schema_version: 1\nparameters: []\n',
  );
}

function directoryUrl(path: string): URL {
  return pathToFileURL(`${path}/`);
}

test('discovers packaged workflows independently of the current directory', async context => {
  const unrelatedDirectory = await temporaryWorkflowDirectory(context);
  const originalDirectory = process.cwd();
  process.chdir(unrelatedDirectory);
  try {
    const workflows = await discoverPackagedWorkflows();
    assert.deepEqual(
      workflows.map(workflow => workflow.manifest.id),
      ['annotation-transfer'],
    );
    assert.match(workflows[0]?.directoryUrl.pathname ?? '', /workflows\/annotation-transfer\/$/);
    assert.equal(
      workflows[0]?.parameterDefinitions.find(definition => definition.id === 'reference-fasta')
        ?.required,
      true,
    );
  } finally {
    process.chdir(originalDirectory);
  }
});

test('discovers manifests in deterministic directory order and ignores other directories', async context => {
  const root = await temporaryWorkflowDirectory(context);
  await addManifest(root, 'z-workflow', manifestSource('z-workflow', 'Z workflow'));
  await addManifest(root, 'a-workflow', manifestSource('a-workflow', 'A workflow'));
  await mkdir(join(root, 'shared'));

  const workflows = await discoverPackagedWorkflows(directoryUrl(root));

  assert.deepEqual(
    workflows.map(workflow => workflow.manifest.id),
    ['a-workflow', 'z-workflow'],
  );
});

test('rejects duplicate workflow IDs', async context => {
  const root = await temporaryWorkflowDirectory(context);
  await addManifest(root, 'first', manifestSource('same-workflow', 'First'));
  await addManifest(root, 'second', manifestSource('same-workflow', 'Second'));

  await assert.rejects(
    discoverPackagedWorkflows(directoryUrl(root)),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowDiscoveryError);
      assert.match(error.message, /Duplicate workflow ID 'same-workflow'/);
      assert.match(error.message, /first\/manifest\.yaml/);
      assert.match(error.message, /second\/manifest\.yaml/);
      return true;
    },
  );
});

test('rejects invalid external parameter definitions', async context => {
  const root = await temporaryWorkflowDirectory(context);
  await addManifest(root, 'invalid', manifestSource('invalid', 'Invalid'));
  await writeFile(join(root, 'invalid', 'manifest.parameters.yaml'), 'schema_version: [1\n');

  await assert.rejects(
    discoverPackagedWorkflows(directoryUrl(root)),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowDiscoveryError);
      assert.match(error.message, /invalid\/manifest\.parameters\.yaml/);
      return true;
    },
  );
});

test('accepts a manifest whose Snakefile is still a placeholder', async context => {
  const root = await temporaryWorkflowDirectory(context);
  await addManifest(root, 'placeholder', manifestSource('placeholder', 'Placeholder'));
  await writeFile(join(root, 'placeholder', 'Snakefile'), '# Not executable yet.\n');

  const workflows = await discoverPackagedWorkflows(directoryUrl(root));

  assert.equal(workflows[0]?.manifest.id, 'placeholder');
});
