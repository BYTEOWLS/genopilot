import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import test from 'node:test';
import {parse} from 'yaml';
import {
  ANNOTATION_TRANSFER_WORKFLOW_ID,
  ANNOTATION_TRANSFER_WORKFLOW_VERSION,
} from '../../../src/workflows/annotation-transfer/configuration.js';
import {parseWorkflowManifest} from '../../../src/workflows/manifest.js';
import {parseParameterDefinitions} from '../../../src/workflows/parameter-definitions.js';

const workflowDirectory = new URL(
  '../../../workflows/annotation-transfer/',
  import.meta.url,
);

async function readResource(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, workflowDirectory), 'utf8');
}

test('ships a valid annotation-transfer manifest with the planned workflow identity', async () => {
  const manifest = parseWorkflowManifest(await readResource('manifest.yaml'));

  assert.equal(manifest.id, ANNOTATION_TRANSFER_WORKFLOW_ID);
  assert.equal(manifest.workflow_version, ANNOTATION_TRANSFER_WORKFLOW_VERSION);
  assert.equal(manifest.entry_snakefile, 'Snakefile');
  assert.equal(manifest['parameter-definitions'], 'manifest.parameters.yaml');
  assert.match(manifest.label, /annotation/i);
  assert.deepEqual(
    manifest.stages.map(stage => stage.id),
    [
      'resolve-inputs',
      'validate-inputs',
      'transfer-annotation',
      'validate-annotation',
      'summarize-results',
      'record-provenance',
    ],
  );
  // Every implemented Snakemake rule is grouped by exactly one stage, so run progress can
  // report each scheduled job under a researcher-facing name.
  assert.deepEqual(
    manifest.stages.flatMap(stage => stage.rules ?? []),
    [
      'resolve_reference',
      'resolve_target',
      'validate_inputs',
      'transfer_annotation',
      'validate_annotation',
      'summarize_annotation_transfer',
      'record_annotation_transfer_provenance',
    ],
  );
  assert.deepEqual(manifest.stages.at(-1)?.rules, [
    'record_annotation_transfer_provenance',
  ]);
});

type PinnedEnvironment = {conda: Map<string, string>; pip: Map<string, string>};

/**
 * Reads a rule environment and requires every dependency to be pinned exactly, so version
 * bumps stay deliberate while the concrete versions can change without editing this test.
 */
async function readPinnedEnvironment(name: string): Promise<PinnedEnvironment> {
  const environment = parse(
    await readFile(
      new URL(`../../../workflows/shared/envs/${name}/environment.yaml`, import.meta.url),
      'utf8',
    ),
  ) as {dependencies: Array<string | {pip: string[]}>};
  const pinned: PinnedEnvironment = {conda: new Map(), pip: new Map()};

  for (const dependency of environment.dependencies) {
    if (typeof dependency === 'string') {
      if (dependency === 'pip') {
        continue;
      }
      const match = /^([A-Za-z0-9_.-]+)=(\d[\w.]*)$/.exec(dependency);
      assert.ok(match, `conda dependency ${dependency} in ${name} must be pinned with =`);
      pinned.conda.set(match[1]!, match[2]!);
    } else {
      for (const requirement of dependency.pip) {
        const match = /^([A-Za-z0-9_.-]+)==(\d[\w.]*)$/.exec(requirement);
        assert.ok(match, `pip dependency ${requirement} in ${name} must be pinned with ==`);
        pinned.pip.set(match[1]!, match[2]!);
      }
    }
  }
  return pinned;
}

test('pins an installable LiftOn environment including native parasail support', async () => {
  const environment = await readPinnedEnvironment('lifton');

  for (const name of ['python', 'minimap2', 'miniprot']) {
    assert.ok(environment.conda.has(name), `lifton environment must pin ${name}`);
  }
  // parasail must come from conda so pip never attempts a native source build.
  assert.ok(environment.conda.has('parasail-python'));
  assert.ok(environment.pip.has('lifton'));
});

test('pins Python for dependency-free rule scripts in the NCBI environment', async () => {
  const environment = await readPinnedEnvironment('ncbi-datasets-cli');

  assert.ok(environment.conda.has('python'));
  assert.ok(environment.conda.has('ncbi-datasets-cli'));
});

test('references existing packaged workflow files', async () => {
  const manifest = parseWorkflowManifest(await readResource('manifest.yaml'));

  for (const relativePath of [manifest.entry_snakefile, manifest['parameter-definitions']]) {
    const metadata = await stat(new URL(relativePath, workflowDirectory));
    assert.ok(metadata.isFile(), `${relativePath} must be a file`);
  }
});

test('declares the principal annotation-transfer result artifacts', async () => {
  const manifest = parseWorkflowManifest(await readResource('manifest.yaml'));
  const artifactsById = new Map(manifest.artifacts.map(artifact => [artifact.id, artifact]));

  assert.equal(
    artifactsById.get('raw-gff3')?.path,
    'results/annotation/lifton.raw.gff3',
  );
  assert.equal(artifactsById.get('lifton-diagnostics')?.path, 'results/annotation/lifton_output');
  assert.equal(artifactsById.get('annotation-validation')?.path, 'results/validation.json');
  assert.equal(artifactsById.get('feature-transfer')?.path, 'results/feature-transfer.tsv');
  assert.equal(artifactsById.get('transfer-metrics')?.path, 'results/metrics.json');
  assert.equal(artifactsById.get('completion-summary')?.path, 'results/summary.json');
  assert.equal(artifactsById.get('artifact-index')?.path, 'artifacts.yaml');
  assert.equal(artifactsById.get('run-provenance')?.path, 'provenance/run.json');
});

test('ships complete parameter definitions with explicit required fields', async () => {
  const manifest = parseWorkflowManifest(await readResource('manifest.yaml'));
  const definitions = parseParameterDefinitions(
    await readResource(manifest['parameter-definitions']),
  );
  const byId = new Map(definitions.map(definition => [definition.id, definition]));

  assert.equal(byId.get('reference-fasta')?.required, true);
  assert.deepEqual(byId.get('reference-fasta')?.visible_when, {
    parameter: 'reference-source',
    equals: 'local',
  });
  assert.deepEqual(byId.get('reference-accession')?.visible_when, {
    parameter: 'reference-source',
    equals: 'ncbi',
  });
  assert.deepEqual(byId.get('target-fasta')?.visible_when, {
    parameter: 'target-source',
    equals: 'local',
  });
  assert.deepEqual(byId.get('target-accession')?.visible_when, {
    parameter: 'target-source',
    equals: 'ncbi',
  });
  assert.deepEqual(byId.get('manual-cpu-limit')?.visible_when, {
    parameter: 'cpu-allocation',
    equals: 'manual',
  });
  assert.equal(byId.get('run-name')?.required, false);
  assert.equal(byId.get('run-description')?.required, false);
  assert.equal(byId.get('lifton-profile')?.hidden, true);
  assert.equal(byId.get('lifton-profile')?.default, 'same-species');
});
