import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowManifest,
  validateWorkflowManifest,
  WorkflowManifestValidationError,
} from '../../src/workflows/manifest.js';

const validManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'annotation-transfer',
  label: 'Transfer genome annotation',
  description: 'Transfer and validate an annotation on a target assembly.',
  entry_snakefile: 'workflow/Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [
    {id: 'validate-inputs', label: 'Validate inputs'},
    {id: 'run-lifton', label: 'Run LiftOn', description: 'Transfer the annotation.'},
    {id: 'review', label: 'Review transfer'},
  ],
  artifacts: [
    {
      id: 'raw-gff3',
      label: 'Raw LiftOn GFF3',
      path: 'results/annotation/lifton.raw.gff3',
      type: 'gff3',
      produced_by: 'run-lifton',
    },
  ],
};

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return structuredClone({...validManifest, ...overrides});
}

function validationIssues(value: unknown) {
  try {
    validateWorkflowManifest(value);
    assert.fail('expected workflow manifest validation to fail');
  } catch (error) {
    assert.ok(error instanceof WorkflowManifestValidationError);
    return error.issues;
  }
}

test('parses a valid versioned workflow manifest from YAML', () => {
  const parsed = parseWorkflowManifest(`
    schema_version: 1
    workflow_version: 1
    id: annotation-transfer
    label: Transfer genome annotation
    description: Transfer and validate an annotation.
    entry_snakefile: workflow/Snakefile
    parameter-definitions: manifest.parameters.yaml
    stages:
      - id: validate-inputs
        label: Validate inputs
      - id: run-lifton
        label: Run LiftOn
    artifacts:
      - id: raw-gff3
        label: Raw LiftOn GFF3
        path: results/annotation/lifton.raw.gff3
        type: gff3
        produced_by: run-lifton
  `);

  assert.equal(parsed.id, 'annotation-transfer');
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.workflow_version, 1);
  assert.deepEqual(
    parsed.stages.map(stage => stage.id),
    ['validate-inputs', 'run-lifton'],
  );
});

test('rejects unsupported schema versions and invalid workflow versions', () => {
  const issues = validationIssues(manifest({schema_version: 2, workflow_version: 0}));

  assert.deepEqual(
    issues.map(issue => issue.path),
    ['$.schema_version', '$.workflow_version'],
  );
});

test('rejects empty fields, malformed identifiers, and an empty stage list', () => {
  const issues = validationIssues(
    manifest({id: 'Annotation Transfer', label: ' ', description: '', stages: []}),
  );
  const paths = issues.map(issue => issue.path);

  assert.ok(paths.includes('$.id'));
  assert.ok(paths.includes('$.label'));
  assert.ok(paths.includes('$.description'));
  assert.ok(paths.includes('$.stages'));
});

test('rejects unsafe or non-normalized paths', () => {
  for (const invalidPath of [
    '/workflow/Snakefile',
    '../workflow/Snakefile',
    'workflow/../Snakefile',
    'workflow\\Snakefile',
    'workflow//Snakefile',
    'C:\\workflow\\Snakefile',
    ' workflow/Snakefile',
    'workflow/Snakefile ',
    'workflow/\0Snakefile',
    'workflow/\nSnakefile',
  ]) {
    const issues = validationIssues(manifest({entry_snakefile: invalidPath}));
    assert.ok(
      issues.some(issue => issue.path === '$.entry_snakefile'),
      `expected path rejection for ${JSON.stringify(invalidPath)}`,
    );
  }
});

test('applies contained-path validation to configuration and artifact paths', () => {
  const invalidConfiguration = validationIssues(
    manifest({'parameter-definitions': '../manifest.parameters.yaml'}),
  );
  const invalidArtifactValue = manifest();
  const artifacts = invalidArtifactValue.artifacts as Array<Record<string, unknown>>;
  artifacts[0] = {...artifacts[0], path: 'results/\0annotation.gff3'};
  const invalidArtifact = validationIssues(invalidArtifactValue);

  assert.ok(invalidConfiguration.some(issue => issue.path === '$.parameter-definitions'));
  assert.ok(invalidArtifact.some(issue => issue.path === '$.artifacts[0].path'));
});

test('rejects unknown root and nested fields', () => {
  const value = manifest({unexpected: true});
  const stages = value.stages as Array<Record<string, unknown>>;
  stages[0] = {...stages[0], snakefile_rule: 'validate'};
  const issues = validationIssues(value);

  assert.ok(issues.some(issue => issue.path === '$.unexpected'));
  assert.ok(issues.some(issue => issue.path === '$.stages[0].snakefile_rule'));
});

test('rejects duplicate stage and artifact identifiers and artifact paths', () => {
  const value = manifest();
  const stages = value.stages as Array<Record<string, unknown>>;
  stages.push({id: 'run-lifton', label: 'Duplicate stage'});
  const artifacts = value.artifacts as Array<Record<string, unknown>>;
  artifacts.push({...artifacts[0]});
  artifacts.push({
    ...artifacts[0],
    id: 'other-gff3',
  });
  const issues = validationIssues(value);
  const messages = issues.map(issue => issue.message);

  assert.ok(messages.some(message => message.includes('duplicate stage ID')));
  assert.ok(messages.some(message => message.includes('duplicate artifact ID')));
  assert.ok(messages.some(message => message.includes('duplicate artifact path')));
});

test('rejects artifacts that reference unknown stages', () => {
  const value = manifest();
  const artifacts = value.artifacts as Array<Record<string, unknown>>;
  artifacts[0] = {...artifacts[0], produced_by: 'missing-stage'};
  const issues = validationIssues(value);

  assert.ok(issues.some(issue => issue.path === '$.artifacts[0].produced_by'));
});

test('reports malformed YAML as a structured manifest validation error', () => {
  assert.throws(
    () => parseWorkflowManifest('schema_version: [1'),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowManifestValidationError);
      assert.equal(error.issues[0]?.path, '$');
      assert.match(error.issues[0]?.message ?? '', /not valid YAML/);
      return true;
    },
  );
});
