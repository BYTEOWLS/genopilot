import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ParameterDefinitionsValidationError,
  parseParameterDefinitions,
  validateParameterDefinitions,
} from '../../src/workflows/parameter-definitions.js';

const valid = {
  schema_version: 1,
  parameters: [
    {
      id: 'reference-fasta',
      label: 'Reference FASTA',
      section: 'Inputs',
      kind: 'file',
      required: true,
      default: null,
    },
    {
      id: 'run-name',
      label: 'Run name',
      section: 'Run details',
      kind: 'text',
      required: false,
      hidden: true,
      default: null,
    },
  ],
};

function issues(value: unknown) {
  try {
    validateParameterDefinitions(value);
    assert.fail('expected parameter definitions to fail validation');
  } catch (error) {
    assert.ok(error instanceof ParameterDefinitionsValidationError);
    return error.issues;
  }
}

test('parses required metadata and defaults omitted hidden to false', () => {
  const definitions = parseParameterDefinitions(`
    schema_version: 1
    parameters:
      - id: reference-fasta
        label: Reference FASTA
        section: Inputs
        kind: file
        required: true
        default: null
      - id: lifton-profile
        label: LiftOn profile
        section: Workflow options
        kind: fixed
        required: true
        hidden: true
        default: same-species
  `);

  assert.equal(definitions[0]?.required, true);
  assert.equal(definitions[0]?.hidden, false);
  assert.equal(definitions[1]?.hidden, true);
  assert.equal(definitions[1]?.default, 'same-species');
});

test('requires explicit required and default values and validates hidden when present', () => {
  const missingRequired = structuredClone(valid);
  delete (missingRequired.parameters[0] as Partial<(typeof valid.parameters)[number]>).required;
  const missingDefault = structuredClone(valid);
  delete (missingDefault.parameters[0] as Partial<(typeof valid.parameters)[number]>).default;
  const invalidHidden = structuredClone(valid);
  (invalidHidden.parameters[0] as Record<string, unknown>).hidden = 'yes';

  assert.ok(issues(missingRequired).some(issue => issue.path === '$.parameters[0].required'));
  assert.ok(issues(missingDefault).some(issue => issue.path === '$.parameters[0].default'));
  assert.ok(issues(invalidHidden).some(issue => issue.path === '$.parameters[0].hidden'));
});

test('rejects duplicate IDs and unknown fields', () => {
  const value = structuredClone(valid) as {schema_version: number; parameters: Record<string, unknown>[]};
  value.parameters.push({...value.parameters[0]!, unexpected: true});
  const validationIssues = issues(value);

  assert.ok(validationIssues.some(issue => issue.message.includes('duplicate parameter ID')));
  assert.ok(validationIssues.some(issue => issue.path.endsWith('.unexpected')));
});

test('accepts a visible_when matching any of several values and rejects an empty list', () => {
  const definitions = parseParameterDefinitions(`
    schema_version: 1
    parameters:
      - id: source
        label: Source
        section: Inputs
        kind: choice
        required: true
        default: a
        options:
          - value: a
            label: A
          - value: b
            label: B
          - value: c
            label: C
      - id: path
        label: Path
        section: Inputs
        kind: file
        required: true
        default: null
        visible_when:
          parameter: source
          equals: [a, b]
  `);

  assert.deepEqual(
    definitions.find(definition => definition.id === 'path')?.visible_when,
    {parameter: 'source', equals: ['a', 'b']},
  );

  const emptyList = structuredClone(valid) as {parameters: Record<string, unknown>[]};
  (emptyList.parameters[0] as Record<string, unknown>).visible_when = {
    parameter: 'run-name',
    equals: [],
  };
  assert.ok(
    issues(emptyList).some(issue => issue.path === '$.parameters[0].visible_when.equals'),
  );
});

test('accepts browse_only_when only on a file field and validates its cross-reference', () => {
  const withBrowseOnly = structuredClone(valid) as {parameters: Record<string, unknown>[]};
  (withBrowseOnly.parameters[0] as Record<string, unknown>).browse_only_when = {
    parameter: 'run-name',
    equals: 'chosen',
  };
  const definitions = validateParameterDefinitions(withBrowseOnly);
  assert.deepEqual(definitions[0]?.browse_only_when, {parameter: 'run-name', equals: 'chosen'});

  const onNonFile = structuredClone(valid) as {parameters: Record<string, unknown>[]};
  (onNonFile.parameters[1] as Record<string, unknown>).browse_only_when = {
    parameter: 'reference-fasta',
    equals: 'x',
  };
  assert.ok(
    issues(onNonFile).some(
      issue =>
        issue.path === '$.parameters[1].browse_only_when' &&
        issue.message.includes('only allowed for a file field'),
    ),
  );

  const unknownReference = structuredClone(valid) as {parameters: Record<string, unknown>[]};
  (unknownReference.parameters[0] as Record<string, unknown>).browse_only_when = {
    parameter: 'does-not-exist',
    equals: 'x',
  };
  assert.ok(
    issues(unknownReference).some(issue =>
      issue.path.endsWith('.browse_only_when.parameter'),
    ),
  );
});
