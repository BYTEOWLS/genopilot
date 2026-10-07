import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseReferenceConsensusConfiguration,
  ReferenceConsensusConfigurationError,
  validateReferenceConsensusConfiguration,
} from '../../../src/workflows/reference-consensus/configuration.js';
import {parseIsolateSnapshot} from '../../../src/workflows/reference-consensus/snapshot.js';

const validConfiguration = {
  schema_version: 1,
  workflow_id: 'reference-consensus',
  workflow_version: 1,
  genopilot: {version: '1.2.3'},
  inputs: {
    backbone: {source: 'ncbi', accession: 'GCF_000149205.2', ncbi_cache_mode: 'reuse'},
    isolates_file: 'isolates.yaml',
    selected_isolates: ['isolate-a', 'isolate-b'],
  },
  calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8},
  consensus: {
    include_backbone_vote: true,
    voting_method: 'strict-majority',
    min_callable_isolates: 0,
    unresolved_snp: 'n',
  },
  resources: {cpu_mode: 'automatic', effective_cpus: 8},
  run: {output_root: '/analysis/runs', id: '2026-01-01_120000000_example', created_at: '2026-01-01T12:00:00.000Z'},
};

type Configuration = typeof validConfiguration;

function withChange(change: (configuration: Record<string, any>) => void): Configuration {
  const configuration = structuredClone(validConfiguration) as Record<string, any>;
  change(configuration);
  return configuration as Configuration;
}

function issuePaths(value: unknown): string[] {
  try {
    validateReferenceConsensusConfiguration(value);
  } catch (error) {
    assert.ok(error instanceof ReferenceConsensusConfigurationError);
    return error.issues.map(issue => issue.path);
  }
  assert.fail('expected the configuration to be refused');
}

test('parses a saved configuration directly from YAML', () => {
  const parsed = parseReferenceConsensusConfiguration(`
schema_version: 1
workflow_id: reference-consensus
workflow_version: 1
genopilot:
  version: 1.2.3
inputs:
  backbone:
    source: local
    fasta: /data/backbone.fa
  isolates_file: isolates.yaml
  selected_isolates: [isolate-a]
calling:
  ploidy: 1
  min_depth: 5
  min_mapping_quality: 0
  min_base_quality: 13
  min_allele_fraction: 0.9
consensus:
  include_backbone_vote: false
  voting_method: plurality
  min_callable_isolates: 1
  unresolved_snp: iupac
resources:
  cpu_mode: manual
  manual_limit: 2
  effective_cpus: 2
run:
  output_root: /analysis/runs
  id: example
  created_at: "2026-01-01T12:00:00.000Z"
`);
  assert.deepEqual(parsed.inputs.backbone, {source: 'local', fasta: '/data/backbone.fa'});
  assert.equal(parsed.consensus.include_backbone_vote, false);
  assert.equal(parsed.consensus.voting_method, 'plurality');
  assert.equal(parsed.consensus.min_callable_isolates, 1);
  assert.equal(parsed.consensus.unresolved_snp, 'iupac');
  assert.equal(parsed.calling.min_mapping_quality, 0);
});

test('accepts the documented example with an NCBI backbone', () => {
  assert.deepEqual(validateReferenceConsensusConfiguration(structuredClone(validConfiguration)), validConfiguration);
});

test('requires at least one unique isolate ID and no count field', () => {
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.selected_isolates = [];
  })), ['$.inputs.selected_isolates']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.selected_isolates = ['isolate-a', 'isolate-a'];
  })), ['$.inputs.selected_isolates[1]']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.isolate_count = 2;
  })), ['$.inputs.isolate_count']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.isolates_file = '/elsewhere/isolates.yaml';
  })), ['$.inputs.isolates_file']);
});

test('supports only haploid calling with bounded thresholds', () => {
  assert.deepEqual(issuePaths(withChange(value => {
    value.calling.ploidy = 2;
  })), ['$.calling.ploidy']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.calling.min_depth = 0;
  })), ['$.calling.min_depth']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.calling.min_base_quality = 1.5;
  })), ['$.calling.min_base_quality']);
  for (const fraction of [0.5, 1.01, Number.NaN]) {
    assert.deepEqual(issuePaths(withChange(value => {
      value.calling.min_allele_fraction = fraction;
    })), ['$.calling.min_allele_fraction']);
  }
  assert.doesNotThrow(() => validateReferenceConsensusConfiguration(withChange(value => {
    value.calling.min_allele_fraction = 1;
  })));
});

test('requires an explicit voting method and backbone-vote decision', () => {
  assert.deepEqual(issuePaths(withChange(value => {
    value.consensus.voting_method = 'majority';
  })), ['$.consensus.voting_method']);
  assert.deepEqual(issuePaths(withChange(value => {
    delete value.consensus.include_backbone_vote;
  })), ['$.consensus.include_backbone_vote']);
});

test('bounds the minimum of callable isolates by the selected isolates', () => {
  for (const minimum of [-1, 1.5, '1', undefined]) {
    assert.deepEqual(issuePaths(withChange(value => {
      value.consensus.min_callable_isolates = minimum;
    })), ['$.consensus.min_callable_isolates']);
  }
  assert.deepEqual(issuePaths(withChange(value => {
    value.consensus.min_callable_isolates = 3;
  })), ['$.consensus.min_callable_isolates']);
  assert.doesNotThrow(() => validateReferenceConsensusConfiguration(withChange(value => {
    value.consensus.min_callable_isolates = 2;
  })));
});

test('requires an explicit representation of unresolved SNPs', () => {
  for (const representation of ['IUPAC', 'backbone', undefined]) {
    assert.deepEqual(issuePaths(withChange(value => {
      value.consensus.unresolved_snp = representation;
    })), ['$.consensus.unresolved_snp']);
  }
  assert.doesNotThrow(() => validateReferenceConsensusConfiguration(withChange(value => {
    value.consensus.unresolved_snp = 'iupac';
  })));
});

test('refuses an unversioned accession and a backbone mixing both sources', () => {
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.backbone.accession = 'GCF_000149205';
  })), ['$.inputs.backbone.accession']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.backbone = {source: 'local', fasta: '/data/backbone.fa', accession: 'GCF_000149205.2'};
  })), ['$.inputs.backbone.accession']);
  assert.deepEqual(issuePaths(withChange(value => {
    value.inputs.backbone = {source: 'local', fasta: 'relative/backbone.fa'};
  })), ['$.inputs.backbone.fasta']);
});

test('parses a snapshot holding exactly the selection, in order', () => {
  const source = `
schema_version: 1
captured_at: "2026-01-01T12:00:00.000Z"
isolates:
  - id: isolate-a
    name: Isolate A
    wildtype: null
    derived_from: null
    read_pairs:
      - {r1: /data/a_R1.fastq.gz, r2: /data/a_R2.fastq.gz, trimmed: false}
      - {r1: /data/a2_R1.fastq.gz, r2: /data/a2_R2.fastq.gz, trimmed: true}
`;
  const snapshot = parseIsolateSnapshot(source, ['isolate-a']);
  assert.equal(snapshot.isolates[0]?.read_pairs[1]?.trimmed, true);
  assert.throws(() => parseIsolateSnapshot(source, ['isolate-b']), ReferenceConsensusConfigurationError);
  assert.throws(
    () => parseIsolateSnapshot(source.replace('trimmed: true', 'trimmed: yes please'), ['isolate-a']),
    ReferenceConsensusConfigurationError,
  );
});
