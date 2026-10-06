import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnnotationTransferConfigurationError,
  parseAnnotationTransferConfiguration,
  validateAnnotationTransferConfiguration,
} from '../../../src/workflows/annotation-transfer/configuration.js';

const validConfiguration = {
  schema_version: 1,
  workflow_id: 'annotation-transfer',
  workflow_version: 1,
  inputs: {
    reference: {source: 'local', fasta: '/data/reference.fa', gff3: '/data/reference.gff3'},
    target: {source: 'local', fasta: '/data/target.fa'},
  },
  lifton: {
    profile: 'same-species',
  },
  review: {minimum_protein_identity: 99},
  resources: {
    cpu_mode: 'automatic',
    effective_cpus: 8,
  },
  run: {
    output_root: '/data/runs',
    id: '2026-09-05_083412123_Initial-annotation-transfer',
    name: 'Initial annotation transfer',
    created_at: '2026-09-05T08:34:12.123Z',
  },
};

function configuration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return structuredClone({...validConfiguration, ...overrides});
}

function validationIssues(value: unknown) {
  try {
    validateAnnotationTransferConfiguration(value);
    assert.fail('expected annotation-transfer configuration validation to fail');
  } catch (error) {
    assert.ok(error instanceof AnnotationTransferConfigurationError);
    return error.issues;
  }
}

test('parses the minimal automatic-CPU configuration from YAML', () => {
  const parsed = parseAnnotationTransferConfiguration(`
    schema_version: 1
    workflow_id: annotation-transfer
    workflow_version: 1
    inputs:
      reference:
        source: local
        fasta: /data/reference.fa
        gff3: /data/reference.gff3
      target:
        source: local
        fasta: /data/target.fa
    lifton:
      profile: same-species
    review:
      minimum_protein_identity: 99
    resources:
      cpu_mode: automatic
      effective_cpus: 8
    run:
      output_root: /data/runs
      id: 2026-09-05_083412123_annotation-transfer
      created_at: "2026-09-05T08:34:12.123Z"
  `);

  assert.equal(parsed.workflow_id, 'annotation-transfer');
  assert.deepEqual(parsed.resources, {cpu_mode: 'automatic', effective_cpus: 8});
  assert.equal(parsed.run.id, '2026-09-05_083412123_annotation-transfer');
  assert.equal(parsed.run.name, undefined);
  assert.equal(parsed.run.description, undefined);
});

test('accepts leave-one-free and manual CPU modes', () => {
  const leaveOneFree = configuration({
    resources: {cpu_mode: 'leave-one-free', effective_cpus: 7},
  });
  const manual = configuration({
    resources: {cpu_mode: 'manual', manual_limit: 8, effective_cpus: 8},
  });

  assert.equal(
    validateAnnotationTransferConfiguration(leaveOneFree).resources.cpu_mode,
    'leave-one-free',
  );
  assert.equal(validateAnnotationTransferConfiguration(manual).resources.manual_limit, 8);
});

test('requires a positive manual limit only in manual CPU mode', () => {
  for (const resources of [
    {cpu_mode: 'manual', effective_cpus: 1},
    {cpu_mode: 'manual', manual_limit: 0, effective_cpus: 1},
    {cpu_mode: 'manual', manual_limit: 1.5, effective_cpus: 1},
    {cpu_mode: 'automatic', manual_limit: 4, effective_cpus: 1},
  ]) {
    const issues = validationIssues(configuration({resources}));
    assert.ok(issues.some(issue => issue.path === '$.resources.manual_limit'));
  }
});

test('requires a positive effective CPU count', () => {
  for (const effectiveCpus of [undefined, 0, 1.5]) {
    const issues = validationIssues(
      configuration({resources: {cpu_mode: 'automatic', effective_cpus: effectiveCpus}}),
    );
    assert.ok(issues.some(issue => issue.path === '$.resources.effective_cpus'));
  }
});

test('rejects unsupported CPU modes', () => {
  const issues = validationIssues(
    configuration({resources: {cpu_mode: 'maximum', effective_cpus: 1}}),
  );

  assert.ok(issues.some(issue => issue.path === '$.resources.cpu_mode'));
});

test('requires the fixed same-species LiftOn profile', () => {
  const issues = validationIssues(configuration({lifton: {profile: 'advanced'}}));
  assert.ok(issues.some(issue => issue.path === '$.lifton.profile'));
});

test('requires a minimum protein identity from 0 to 100 percent', () => {
  for (const value of [0, 99, 100]) {
    assert.equal(validateAnnotationTransferConfiguration(configuration({review: {minimum_protein_identity: value}})).review.minimum_protein_identity, value);
  }
  for (const review of [{minimum_protein_identity: 101}, {minimum_protein_identity: -1}, {minimum_protein_identity: 98.5},
    {minimum_protein_identity: Number.NaN}, {}, undefined]) {
    const issues = validationIssues(configuration({review}));
    assert.ok(issues.some(issue => issue.path.startsWith('$.review')), JSON.stringify(review));
  }
});

test('requires the expected schema and workflow identity', () => {
  const issues = validationIssues(
    configuration({schema_version: 2, workflow_id: 'other', workflow_version: 99}),
  );

  assert.deepEqual(
    issues.map(issue => issue.path),
    ['$.schema_version', '$.workflow_id', '$.workflow_version'],
  );
});

test('requires absolute input and output paths', () => {
  const value = configuration({
    inputs: {
      reference: {source: 'local', fasta: 'inputs/reference.fa', gff3: '/data/reference.gff3'},
      target: {source: 'local', fasta: '/data/target.fa'},
    },
    run: {
      output_root: 'runs',
      id: 'run',
    },
  });
  const issues = validationIssues(value);

  assert.ok(issues.some(issue => issue.path === '$.inputs.reference.fasta'));
  assert.ok(issues.some(issue => issue.path === '$.run.output_root'));
});

test('rejects unsafe path characters', () => {
  for (const path of ['/data/reference.fa ', '/data/\0reference.fa', '/data/\nreference.fa']) {
    const value = configuration();
    const inputs = value.inputs as {reference: Record<string, unknown>};
    inputs.reference.fasta = path;
    const issues = validationIssues(value);

    assert.ok(issues.some(issue => issue.path === '$.inputs.reference.fasta'));
  }
});

test('accepts a versioned NCBI accession as the reference or target source', () => {
  const referenceFromNcbi = configuration({
    inputs: {
      reference: {source: 'ncbi', accession: 'GCF_000149205.2'},
      target: {source: 'local', fasta: '/data/target.fa'},
    },
  });
  const targetFromNcbi = configuration({
    inputs: {
      reference: {source: 'local', fasta: '/data/reference.fa', gff3: '/data/reference.gff3'},
      target: {source: 'ncbi', accession: 'GCA_000149205.2'},
    },
  });

  const parsedReference = validateAnnotationTransferConfiguration(referenceFromNcbi);
  assert.deepEqual(parsedReference.inputs.reference, {
    source: 'ncbi',
    accession: 'GCF_000149205.2',
  });
  assert.deepEqual(parsedReference.inputs.target, {source: 'local', fasta: '/data/target.fa'});

  const parsedTarget = validateAnnotationTransferConfiguration(targetFromNcbi);
  assert.deepEqual(parsedTarget.inputs.target, {source: 'ncbi', accession: 'GCA_000149205.2'});
});

test('accepts only explicit reuse or refresh NCBI cache decisions', () => {
  for (const ncbi_cache_mode of ['reuse', 'refresh'] as const) {
    const parsed = validateAnnotationTransferConfiguration(
      configuration({
        inputs: {
          reference: {source: 'ncbi', accession: 'GCF_000149205.2', ncbi_cache_mode},
          target: {source: 'local', fasta: '/data/target.fa'},
        },
      }),
    );
    assert.equal(
      parsed.inputs.reference.source === 'ncbi'
        ? parsed.inputs.reference.ncbi_cache_mode
        : undefined,
      ncbi_cache_mode,
    );
  }

  const issues = validationIssues(
    configuration({
      inputs: {
        reference: {
          source: 'ncbi',
          accession: 'GCF_000149205.2',
          ncbi_cache_mode: 'automatic',
        },
        target: {source: 'local', fasta: '/data/target.fa'},
      },
    }),
  );
  assert.ok(issues.some(issue => issue.path === '$.inputs.reference.ncbi_cache_mode'));
});

test('rejects a bare or malformed NCBI accession', () => {
  for (const accession of ['GCF_000149205', 'GCX_000149205.2', 'GCF_1.2', '']) {
    const issues = validationIssues(
      configuration({
        inputs: {
          reference: {source: 'ncbi', accession},
          target: {source: 'local', fasta: '/data/target.fa'},
        },
      }),
    );
    assert.ok(issues.some(issue => issue.path === '$.inputs.reference.accession'));
  }
});

test('rejects an unrecognized input source and mismatched fields for the chosen source', () => {
  const invalidSource = validationIssues(
    configuration({
      inputs: {
        reference: {source: 'sftp', fasta: '/data/reference.fa'},
        target: {source: 'local', fasta: '/data/target.fa'},
      },
    }),
  );
  assert.ok(invalidSource.some(issue => issue.path === '$.inputs.reference.source'));

  const ncbiWithLocalFields = validationIssues(
    configuration({
      inputs: {
        reference: {
          source: 'ncbi',
          accession: 'GCF_000149205.2',
          fasta: '/data/reference.fa',
        },
        target: {source: 'local', fasta: '/data/target.fa'},
      },
    }),
  );
  assert.ok(ncbiWithLocalFields.some(issue => issue.path === '$.inputs.reference.fasta'));

  const localMissingGff3 = validationIssues(
    configuration({
      inputs: {
        reference: {source: 'local', fasta: '/data/reference.fa'},
        target: {source: 'local', fasta: '/data/target.fa'},
      },
    }),
  );
  assert.ok(localMissingGff3.some(issue => issue.path === '$.inputs.reference.gff3'));
});

test('requires an ISO 8601 UTC created_at timestamp', () => {
  for (const created_at of [
    undefined,
    '',
    '2026-09-05',
    '2026-09-05T08:34:12Z',
    '2026-09-05 08:34:12.123Z',
    'not-a-date',
  ]) {
    const run: Record<string, unknown> = {output_root: '/data/runs', id: 'run'};
    if (created_at !== undefined) {
      run.created_at = created_at;
    }
    const issues = validationIssues(configuration({run}));
    assert.ok(issues.some(issue => issue.path === '$.run.created_at'));
  }

  const parsed = validateAnnotationTransferConfiguration(
    configuration({
      run: {output_root: '/data/runs', id: 'run', created_at: '2026-09-05T08:34:12.123Z'},
    }),
  );
  assert.equal(parsed.run.created_at, '2026-09-05T08:34:12.123Z');
});

test('requires a run ID that is a safe single path segment', () => {
  for (const id of [
    undefined,
    ' run',
    'run ',
    '.hidden',
    '../run',
    'run/name',
    'run name',
    'run\0name',
    'r'.repeat(129),
  ]) {
    const run: Record<string, unknown> = {output_root: '/data/runs'};
    if (id !== undefined) {
      run.id = id;
    }
    const issues = validationIssues(configuration({run}));
    assert.ok(issues.some(issue => issue.path === '$.run.id'));
  }

  const parsed = validateAnnotationTransferConfiguration(
    configuration({
      run: {
        output_root: '/data/runs',
        id: '2026-09-05_083412123_re-run.2',
        created_at: '2026-09-05T08:34:12.123Z',
      },
    }),
  );
  assert.equal(parsed.run.id, '2026-09-05_083412123_re-run.2');
});

test('accepts an optional run name and rejects an unusable one', () => {
  const parsed = validateAnnotationTransferConfiguration(
    configuration({
      run: {
        output_root: '/data/runs',
        id: 'run',
        // A researcher-facing label is stored exactly as typed, including characters that
        // would be unsafe in the run ID's directory name.
        name: 'Baseline transfer: 2026/09',
        created_at: '2026-09-05T08:34:12.123Z',
      },
    }),
  );
  assert.equal(parsed.run.name, 'Baseline transfer: 2026/09');

  for (const name of ['', ' Run', 'Run ', 'Run\nname', 'Run\0name']) {
    const issues = validationIssues(
      configuration({run: {output_root: '/data/runs', id: 'run', name}}),
    );
    assert.ok(issues.some(issue => issue.path === '$.run.name'));
  }
});

test('accepts an optional non-empty run description', () => {
  const parsed = validateAnnotationTransferConfiguration(
    configuration({
      run: {
        output_root: '/data/runs',
        id: 'run',
        created_at: '2026-09-05T08:34:12.123Z',
        description: 'Baseline transfer to the initial T2T assembly.',
      },
    }),
  );
  assert.match(parsed.run.description ?? '', /Baseline transfer/);

  const issues = validationIssues(
    configuration({
      run: {
        output_root: '/data/runs',
        id: 'run',
        created_at: '2026-09-05T08:34:12.123Z',
        description: ' ',
      },
    }),
  );
  assert.ok(issues.some(issue => issue.path === '$.run.description'));
});

test('rejects missing required sections and nested fields', () => {
  for (const field of ['inputs', 'lifton', 'resources', 'run']) {
    const value = configuration();
    delete value[field];
    const issues = validationIssues(value);
    assert.ok(issues.some(issue => issue.path === `$.${field}`));
  }

  const value = configuration();
  const inputs = value.inputs as {reference: Record<string, unknown>};
  delete inputs.reference.gff3;
  const run = value.run as Record<string, unknown>;
  delete run.id;
  const issues = validationIssues(value);

  assert.ok(issues.some(issue => issue.path === '$.inputs.reference.gff3'));
  assert.ok(issues.some(issue => issue.path === '$.run.id'));
});

test('rejects unknown fields at every configuration level', () => {
  const value = configuration({unexpected: true});
  const inputs = value.inputs as {reference: Record<string, unknown>; extra?: unknown};
  inputs.extra = true;
  inputs.reference.notes = 'draft';
  const lifton = value.lifton as Record<string, unknown>;
  lifton.coverage = 0.9;
  const resources = value.resources as Record<string, unknown>;
  resources.threads = 8;
  const run = value.run as Record<string, unknown>;
  run.overwrite = true;
  const issues = validationIssues(value);
  const paths = issues.map(issue => issue.path);

  assert.ok(paths.includes('$.unexpected'));
  assert.ok(paths.includes('$.inputs.extra'));
  assert.ok(paths.includes('$.inputs.reference.notes'));
  assert.ok(paths.includes('$.lifton.coverage'));
  assert.ok(paths.includes('$.resources.threads'));
  assert.ok(paths.includes('$.run.overwrite'));
});

test('reports malformed YAML as a structured configuration error', () => {
  assert.throws(
    () => parseAnnotationTransferConfiguration('schema_version: [1'),
    (error: unknown) => {
      assert.ok(error instanceof AnnotationTransferConfigurationError);
      assert.equal(error.issues[0]?.path, '$');
      assert.match(error.issues[0]?.message ?? '', /not valid YAML/);
      return true;
    },
  );
});
