import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {WorkflowManifest} from '../../../src/workflows/manifest.js';
import {loadWorkflowResult} from '../../../src/workflows/results.js';

function manifest(overrides: Partial<WorkflowManifest> = {}): WorkflowManifest {
  return {
    schema_version: 1,
    workflow_version: 1,
    id: 'annotation-transfer',
    label: 'Transfer genome annotation',
    description: 'Description may change.',
    entry_snakefile: 'Snakefile',
    'parameter-definitions': 'manifest.parameters.yaml',
    stages: [],
    artifacts: [],
    ...overrides,
  };
}

const reports = {
  feature_transfer: 'results/feature-transfer.tsv',
  aggregated_metrics: 'results/metrics.json',
  completion_summary: 'results/summary.json',
  validation: 'results/validation.json',
  final_gff3: 'results/annotation/lifton.prefixed.gff3',
};

const evidencePaths = {
  raw_gff3: 'results/annotation/lifton.raw.gff3',
  lifton_diagnostics: 'results/annotation/lifton_output',
  run_manifest: 'results/annotation/lifton_output/run_manifest.json',
  completeness_by_feature_type: 'results/annotation/lifton_output/stats/completeness_by_feature_type.txt',
  mapped_features: 'results/annotation/lifton_output/stats/mapped_feature.txt',
  mapped_transcripts: 'results/annotation/lifton_output/stats/mapped_transcript.txt',
  unmapped_features: 'results/annotation/lifton_output/stats/unmapped_features.txt',
  extra_copy_features: 'results/annotation/lifton_output/stats/extra_copy_features.txt',
  selected_feature_types: 'results/annotation/lifton_output/intermediate_files/auto_feature_types.txt',
};

function validSummary(): Record<string, unknown> {
  const metrics = {
    schema_version: 1,
    generated_at: '2026-09-05T20:01:00.000Z',
    workflow: {id: 'annotation-transfer', version: 1},
    definitions: {mapped_features: 'Mapped reference features.'},
    detail_column_definitions: {target_id: 'Raw target ID.'},
    transfer: {
      reference_features: 3,
      reference_features_by_type: {gene: 3},
      mapped_features: 2,
      mapped_features_by_type: {gene: 2},
      unmapped_features: 1,
      unmapped_features_by_type: {gene: 1},
      mapping_fraction: 2 / 3,
      target_feature_copies: 3,
      target_feature_copies_by_type: {gene: 3},
      features_with_extra_copies: 1,
      features_with_extra_copies_by_type: {gene: 1},
      extra_copies: 1,
      miniprot_rescues: 1,
      transfer_methods_by_target_copy: {Liftoff: 2, miniprot: 1},
      changed_primary_protein_coding_features: 1,
      mutation_classifications_by_target_copy: {frameshift: 1},
      dna_identity_by_transcript_model: {unit: 'transcript_model', count: 2, minimum: 0.9, mean: 0.95, maximum: 1},
      protein_identity_by_transcript_model: {unit: 'transcript_model', count: 0, minimum: null, mean: null, maximum: null, unavailable_reason: 'No values.'},
      authoritative_sources: ['results/annotation/lifton_output/run_manifest.json'],
      detail_enrichment_source: 'results/annotation/lifton.raw.gff3',
    },
    prefix: {applied: true, value: 'AN_', transformed_distinct_ids: 8, explanation: 'Prefix rewrite.'},
    validation: {status: 'passed', errors: 0, warnings: 1, source: 'results/validation.json', explanation: 'GFF3 validation.'},
  };
  return {
    schema_version: 1,
    generated_at: '2026-09-05T20:01:00.000Z',
    workflow: {id: 'annotation-transfer', version: 1},
    run: {id: 'test-run', created_at: '2026-09-05T20:00:00.000Z', effective_cpus: 4},
    status: 'completed-with-warnings',
    status_explanation: 'Completed; review warnings.',
    metrics: {schema_version: 1, path: 'results/metrics.json', payload: metrics},
    generated_reports: structuredClone(reports),
    source_evidence: Object.fromEntries(Object.entries(evidencePaths).map(([key, path]) => [key, {path, available: true}])),
  };
}

function validConfiguration(directory: string): Record<string, unknown> {
  return {
    schema_version: 1,
    workflow_id: 'annotation-transfer',
    workflow_version: 1,
    inputs: {
      reference: {source: 'local', fasta: '/data/reference.fasta', gff3: '/data/reference.gff3'},
      target: {source: 'local', fasta: '/data/target.fasta'},
    },
    annotation: {id_prefix: 'AN_'},
    lifton: {profile: 'same-species'},
    resources: {cpu_mode: 'automatic', effective_cpus: 4},
    run: {
      output_root: join(directory, '..'),
      id: 'test-run',
      name: 'Test run',
      created_at: '2026-09-05T20:00:00.000Z',
      description: 'Synthetic result-reader test.',
    },
  };
}

async function prepareRun(summary: unknown = validSummary()): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-results-'));
  await mkdir(join(directory, 'results'), {recursive: true});
  await writeFile(join(directory, 'config.yaml'), JSON.stringify(validConfiguration(directory)), 'utf8');
  await writeFile(join(directory, 'results/summary.json'), JSON.stringify(summary), 'utf8');
  return directory;
}

test('loads a valid annotation-transfer summary into a small presentation model', async () => {
  const directory = await prepareRun();
  await writeFile(join(directory, 'results/metrics.json'), '{}', 'utf8');

  const loaded = await loadWorkflowResult(directory, manifest());

  assert.equal(loaded.kind, 'compatible');
  if (loaded.kind === 'compatible') {
    assert.equal(loaded.configuration.run.name, 'Test run');
    assert.equal(loaded.result.status, 'completed-with-warnings');
    assert.equal(loaded.result.transfer.mappedFeatures, 2);
    assert.equal(loaded.result.transfer.mappingFraction, 2 / 3);
    assert.equal(loaded.result.metricsPath.available, true);
    assert.equal(loaded.result.reports.feature_transfer?.available, false);
    assert.deepEqual(loaded.result.definitions, {
      metrics: {mapped_features: 'Mapped reference features.'},
      detailColumns: {target_id: 'Raw target ID.'},
    });
  }
});

test('ignores a changed packaged workflow label when stable identity agrees', async () => {
  const directory = await prepareRun();
  const loaded = await loadWorkflowResult(directory, manifest({label: 'A revised label', description: 'Revised presentation.'}));
  assert.equal(loaded.kind, 'compatible');
});

test('rejects an incomplete saved configuration after resolving its workflow identity', async () => {
  const directory = await prepareRun();
  await writeFile(
    join(directory, 'config.yaml'),
    'workflow_id: annotation-transfer\nworkflow_version: 1\n',
    'utf8',
  );

  const loaded = await loadWorkflowResult(directory, manifest());

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.equal(loaded.error.kind, 'invalid-configuration');
  }
});

test('reports a summary workflow ID mismatch as an invalid summary', async () => {
  const summary = validSummary();
  (summary.workflow as Record<string, unknown>).id = 'other-workflow';
  const directory = await prepareRun(summary);
  const loaded = await loadWorkflowResult(directory, manifest());

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.equal(loaded.error.kind, 'invalid-summary');
    assert.ok(loaded.error.issues?.some(issue => issue.path === '$.workflow.id'));
  }
});

test('returns a structured error for an unsupported workflow version', async () => {
  const directory = await prepareRun();
  await writeFile(join(directory, 'config.yaml'), 'workflow_id: annotation-transfer\nworkflow_version: 2\n', 'utf8');
  const loaded = await loadWorkflowResult(directory, manifest({workflow_version: 2}));

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.equal(loaded.error.kind, 'unsupported-workflow');
  }
});

test('rejects unsupported summary and metrics schema versions', async () => {
  for (const mutate of [
    (summary: Record<string, unknown>) => { summary.schema_version = 2; },
    (summary: Record<string, unknown>) => { (summary.metrics as Record<string, unknown>).schema_version = 2; },
    (summary: Record<string, unknown>) => {
      const metrics = summary.metrics as Record<string, unknown>;
      (metrics.payload as Record<string, unknown>).schema_version = 2;
    },
  ]) {
    const summary = validSummary();
    mutate(summary);
    const loaded = await loadWorkflowResult(await prepareRun(summary), manifest());
    assert.equal(loaded.kind, 'incompatible');
    if (loaded.kind === 'incompatible') {
      assert.equal(loaded.error.kind, 'invalid-summary');
    }
  }
});

test('rejects malformed or contradictory workflow-specific metrics', async () => {
  for (const mutate of [
    (transfer: Record<string, unknown>) => { transfer.mapped_features = -1; },
    (transfer: Record<string, unknown>) => { transfer.mapping_fraction = 0.5; },
    (transfer: Record<string, unknown>) => {
      (transfer.dna_identity_by_transcript_model as Record<string, unknown>).maximum = 1.1;
    },
  ]) {
    const summary = validSummary();
    const metrics = (summary.metrics as Record<string, unknown>).payload as Record<string, unknown>;
    mutate(metrics.transfer as Record<string, unknown>);
    const loaded = await loadWorkflowResult(await prepareRun(summary), manifest());
    assert.equal(loaded.kind, 'incompatible');
    if (loaded.kind === 'incompatible') {
      assert.equal(loaded.error.kind, 'invalid-summary');
    }
  }
});

test('rejects a completion status that contradicts persisted validation', async () => {
  const summary = validSummary();
  summary.status = 'completed';
  const loaded = await loadWorkflowResult(await prepareRun(summary), manifest());

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.ok(loaded.error.issues?.some(issue => issue.path === '$.status'));
  }
});

test('rejects a summary copied from a different run configuration', async () => {
  const summary = validSummary();
  (summary.run as Record<string, unknown>).id = 'another-run';
  const loaded = await loadWorkflowResult(await prepareRun(summary), manifest());

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.ok(loaded.error.issues?.some(issue => issue.path === '$.run.id'));
  }
});

test('reports a missing summary independently from workflow compatibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-results-'));
  await writeFile(join(directory, 'config.yaml'), JSON.stringify(validConfiguration(directory)), 'utf8');
  const loaded = await loadWorkflowResult(directory, manifest());

  assert.equal(loaded.kind, 'incompatible');
  if (loaded.kind === 'incompatible') {
    assert.equal(loaded.error.kind, 'missing-summary');
  }
});

test('rejects absolute and traversing persisted artifact paths', async () => {
  for (const unsafePath of ['/tmp/outside.tsv', '../outside.tsv']) {
    const summary = validSummary();
    (summary.generated_reports as Record<string, unknown>).feature_transfer = unsafePath;
    const loaded = await loadWorkflowResult(await prepareRun(summary), manifest());
    assert.equal(loaded.kind, 'incompatible');
    if (loaded.kind === 'incompatible') {
      assert.ok(loaded.error.issues?.some(issue => issue.path === '$.generated_reports.feature_transfer'));
    }
  }
});

test('keeps valid metrics available while reporting each missing artifact separately', async () => {
  const directory = await prepareRun();
  await mkdir(join(directory, 'results/annotation'), {recursive: true});
  await writeFile(join(directory, 'results/annotation/lifton.raw.gff3'), '##gff-version 3\n', 'utf8');
  const loaded = await loadWorkflowResult(directory, manifest());

  assert.equal(loaded.kind, 'compatible');
  if (loaded.kind === 'compatible') {
    assert.equal(loaded.result.transfer.referenceFeatures, 3);
    assert.equal(loaded.result.evidence.raw_gff3?.available, true);
    assert.equal(loaded.result.evidence.run_manifest?.available, false);
    assert.equal(loaded.result.reports.validation?.available, false);
  }
});
