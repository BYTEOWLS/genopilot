import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  missingResultPaths,
  RunResultsScreen,
  runSupportPaths,
} from '../../src/ui/run-results-screen/screen.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import type {LoadedWorkflowResult} from '../../src/workflows/results.js';
import {
  annotationTransferHelpSections,
  annotationTransferSections,
} from '../../src/ui/run-results-screen/annotation-transfer-results.js';
import {runHelpSections} from '../../src/ui/run-results-screen/run-help.js';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends Writable {
  columns = 240;
  rows = 100;
  readonly isTTY = false;
  private output = '';
  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
  readOutput(): string { return this.output; }
  clearOutput(): void { this.output = ''; }
}

const ARROW_DOWN = '\x1b[B';
const PAGE_DOWN = '\x1b[6~';
const ESCAPE = '\x1b';
const HELP = '?';

async function settle(milliseconds = 80): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'annotation-transfer',
  label: 'Transfer genome annotation',
  description: 'Transfer an annotation.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
};

function path(name: string, available = true) {
  return {path: `results/${name}`, absolutePath: `/runs/result-42/results/${name}`, available};
}

function compatibleResult(): Extract<LoadedWorkflowResult, {kind: 'compatible'}> {
  return {
    kind: 'compatible',
    workflow: {id: 'annotation-transfer', version: 1},
    configuration: {
      schema_version: 1,
      workflow_id: 'annotation-transfer',
      workflow_version: 1,
      inputs: {
        reference: {source: 'local', fasta: '/data/reference.fa', gff3: '/data/reference.gff3'},
        target: {source: 'local', fasta: '/data/target.fa'},
      },
      annotation: {id_prefix: 'AN_'},
      lifton: {profile: 'same-species'},
      resources: {cpu_mode: 'automatic', effective_cpus: 7},
      run: {
        output_root: '/runs',
        id: 'result-42',
        name: 'Synthetic transfer',
        description: 'A deliberately distinctive result.',
        created_at: '2026-09-05T20:00:00.000Z',
      },
    },
    result: {
      generatedAt: '2026-09-05T20:12:00.000Z',
      run: {id: 'result-42', createdAt: '2026-09-05T20:00:00.000Z', effectiveCpus: 7},
      status: 'completed-with-warnings',
      statusExplanation: 'Completed with one validation warning.',
      transfer: {
        referenceFeatures: 137,
        referenceFeaturesByType: {gene: 137},
        mappedFeatures: 131,
        mappedFeaturesByType: {gene: 131},
        unmappedFeatures: 6,
        unmappedFeaturesByType: {gene: 6},
        mappingFraction: 131 / 137,
        targetFeatureCopies: 134,
        targetFeatureCopiesByType: {gene: 134},
        featuresWithExtraCopies: 2,
        featuresWithExtraCopiesByType: {gene: 2},
        extraCopies: 3,
        miniprotRescues: 11,
        transferMethodsByTargetCopy: {Liftoff: 123, miniprot: 11},
        changedPrimaryProteinCodingFeatures: 19,
        mutationClassificationsByTargetCopy: {frameshift: 4, nonsynonymous: 15},
        dnaIdentityByTranscriptModel: {unit: 'transcript_model', count: 20, minimum: 0.91, mean: 0.96, maximum: 1},
        proteinIdentityByTranscriptModel: {unit: 'transcript_model', count: 0, minimum: null, mean: null, maximum: null, unavailableReason: 'No protein values.'},
      },
      prefix: {applied: true, value: 'AN_', transformedDistinctIds: 200},
      validation: {status: 'passed', errors: 0, warnings: 1},
      definitions: {
        metrics: {mapped_features: 'Persisted definition sentinel for mapped features.'},
        detailColumns: {},
      },
      reports: {
        feature_transfer: path('feature-transfer.tsv'),
        aggregated_metrics: path('metrics.json'),
        completion_summary: path('summary.json'),
        validation: path('validation.json', false),
        final_gff3: path('annotation/final.gff3'),
      },
      evidence: {
        raw_gff3: {...path('annotation/lifton.raw.gff3'), recordedAvailable: true},
        lifton_diagnostics: {...path('annotation/lifton_output'), recordedAvailable: true},
        run_manifest: {...path('annotation/lifton_output/run_manifest.json'), recordedAvailable: true},
        completeness_by_feature_type: {...path('annotation/lifton_output/stats/completeness.txt'), recordedAvailable: true},
        mapped_features: {...path('annotation/lifton_output/stats/mapped.txt'), recordedAvailable: true},
        mapped_transcripts: {...path('annotation/lifton_output/stats/transcripts.txt'), recordedAvailable: true},
        unmapped_features: {...path('annotation/lifton_output/stats/unmapped.txt'), recordedAvailable: true},
        extra_copy_features: {...path('annotation/lifton_output/stats/copies.txt'), recordedAvailable: true},
        selected_feature_types: {...path('annotation/lifton_output/types.txt'), recordedAvailable: true},
      },
      metricsPath: path('metrics.json'),
    },
  };
}

function renderScreen(
  loaded: LoadedWorkflowResult,
  options: {
    rows?: number;
    inputActive?: boolean;
    onBack?: () => void;
    pathExists?: (path: string) => boolean;
    formatDateTime?: (value: string) => string;
  } = {},
): {input: TestInput; output: TestOutput; frame: () => string; unmount: () => void} {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? output.rows;
  const instance = render(
    <RunResultsScreen
      runDirectory="/runs/result-42"
      manifest={manifest}
      loaded={loaded}
      inputActive={options.inputActive ?? false}
      onBack={options.onBack}
      pathExists={options.pathExists ?? (() => true)}
      formatDateTime={options.formatDateTime ?? (value => `formatted:${value}`)}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  return {input, output, frame: () => output.readOutput(), unmount: () => instance.unmount()};
}

test('presents compatible run metadata, scientific metrics, and direct result paths', () => {
  const screen = renderScreen(compatibleResult());
  try {
    const frame = screen.frame();
    for (const expected of [
      'result-42',
      'Synthetic transfer',
      'annotation-transfer@1',
      'formatted:2026-09-05T20:00:00.000Z',
      'formatted:2026-09-05T20:12:00.000Z',
      '137',
      '131',
      '95.6%',
      '91.0%',
      '96.0%',
      '100.0%',
      'No protein values.',
      '/runs/result-42',
      'results/feature-transfer.tsv',
      'results/annotation/lifton.raw.gff3',
      'provenance/run.json',
    ]) {
      assert.ok(frame.includes(expected), `missing ${expected}`);
    }
  } finally {
    screen.unmount();
  }
});

test('reports unavailable generated reports as missing result paths', () => {
  const loaded = compatibleResult();
  const supportPaths = runSupportPaths('/runs/result-42', () => true);
  assert.ok(supportPaths.every(supportPath => supportPath.available));
  assert.deepEqual(
    missingResultPaths(loaded.result, supportPaths),
    ['/runs/result-42/results/validation.json'],
  );
});

test('checks support and canonical metrics paths independently from generated reports', () => {
  const loaded = compatibleResult();
  loaded.result.reports.validation!.available = true;
  loaded.result.metricsPath.available = false;
  const supportPaths = runSupportPaths(
    '/runs/result-42',
    candidate => !candidate.endsWith('/provenance/run.json') && !candidate.endsWith('/logs'),
  );
  assert.deepEqual(
    supportPaths.filter(supportPath => !supportPath.available).map(supportPath => supportPath.path),
    ['provenance/run.json', 'logs'],
  );
  assert.deepEqual(
    missingResultPaths(loaded.result, supportPaths).sort(),
    [
      '/runs/result-42/logs',
      '/runs/result-42/provenance/run.json',
      '/runs/result-42/results/metrics.json',
    ],
  );
});

test('distinguishes current evidence availability from availability at summary time', () => {
  const loaded = compatibleResult();
  loaded.result.evidence.raw_gff3!.available = false;
  loaded.result.evidence.mapped_features!.recordedAvailable = false;
  const screen = renderScreen(loaded);
  try {
    const frame = screen.frame();
    assert.match(frame, /lifton\.raw\.gff3 \(missing\) \(available when summarized\)/);
    assert.match(frame, /mapped\.txt \(unavailable when summarized; available now\)/);
  } finally {
    screen.unmount();
  }
});

test('scrolls result content in a short terminal', async () => {
  const screen = renderScreen(compatibleResult(), {
    rows: 20,
    inputActive: true,
  });
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.output.clearOutput();
    screen.output.emit('resize');
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    assert.doesNotMatch(screen.frame(), /provenance\/run\.json/);

    let reachedSupportPaths = false;
    for (let index = 0; index < 40 && !reachedSupportPaths; index += 1) {
      screen.output.clearOutput();
      screen.input.write(PAGE_DOWN);
      await new Promise<void>(resolve => setTimeout(resolve, 20));
      reachedSupportPaths = /provenance\/run\.json/.test(screen.frame());
    }
    assert.ok(reachedSupportPaths);

    screen.input.write(ARROW_DOWN);
  } finally {
    screen.unmount();
  }
});

test('returns from the result screen with Escape', async () => {
  let backedOut = false;
  const screen = renderScreen(compatibleResult(), {
    inputActive: true,
    onBack: () => { backedOut = true; },
  });
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.input.write(ESCAPE);
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('renders an unqualified completed status', () => {
  const loaded = compatibleResult();
  loaded.result.status = 'completed';
  loaded.result.statusExplanation = 'Transfer completed without validation findings.';
  loaded.result.validation = {status: 'passed', errors: 0, warnings: 0};
  const screen = renderScreen(loaded);
  try {
    assert.match(screen.frame(), /Transfer completed without validation findings\./);
  } finally {
    screen.unmount();
  }
});

test('renders validation failure as a retained scientific result', () => {
  const loaded = compatibleResult();
  loaded.result.status = 'validation-failed';
  loaded.result.statusExplanation = 'Structural validation failed; evidence was retained.';
  loaded.result.validation = {status: 'failed', errors: 3, warnings: 0};
  const screen = renderScreen(loaded);
  try {
    assert.match(screen.frame(), /Structural validation failed; evidence was retained\./);
    assert.match(screen.frame(), /failed[\s\S]*\b3\b/);
  } finally {
    screen.unmount();
  }
});

test('keeps run support paths visible when persisted results are incompatible', () => {
  const screen = renderScreen({
    kind: 'incompatible',
    error: {
      kind: 'invalid-summary',
      message: 'Unsupported summary schema 9.',
      path: '/runs/result-42/results/summary.json',
    },
  });
  try {
    const frame = screen.frame();
    assert.match(frame, /Unsupported summary schema 9/);
    assert.match(frame, /\/runs\/result-42\/results\/summary\.json/);
    assert.match(frame, /artifacts\.yaml/);
    assert.match(frame, /provenance\/run\.json/);
    assert.doesNotMatch(frame, /137/);
  } finally {
    screen.unmount();
  }
});

test('explains every workflow result item and flags LiftOn values it does not know', () => {
  const loaded = compatibleResult();
  loaded.result.transfer.mutationClassificationsByTargetCopy = {frameshift: 4, invented_class: 1};
  loaded.result.transfer.transferMethodsByTargetCopy = {
    Liftoff: 3,
    'LiftOn_chaining_algorithm,Liftoff': 1,
    'Liftoff,invented_status': 1,
  };
  const itemIds = annotationTransferSections(loaded.result).flatMap(section => section.items.map(item => item.id));
  const entries = annotationTransferHelpSections(loaded.result).flatMap(section => section.entries);

  assert.deepEqual(entries.map(entry => entry.id), itemIds);
  assert.equal(new Set(itemIds).size, itemIds.length);
  for (const entry of entries) {
    assert.ok(entry.explanation, `missing explanation for ${entry.id}`);
  }
  assert.equal(
    entries.find(entry => entry.id === 'mapped_features')?.definition,
    'Persisted definition sentinel for mapped features.',
  );
  const mutationValues = entries.find(entry => entry.id === 'mutation_classifications_by_target_copy')?.values ?? [];
  assert.ok(mutationValues.some(value => value.value === 'frameshift' && value.explanation));
  assert.ok(mutationValues.some(value => value.value === 'identical' && value.explanation));
  assert.deepEqual(mutationValues.filter(value => !value.explanation).map(value => value.value), ['invented_class']);
  const methodValues = entries.find(entry => entry.id === 'transfer_methods_by_target_copy')?.values ?? [];
  assert.ok(methodValues.some(value => value.value === 'LiftOn_chaining_algorithm,Liftoff' && value.explanation));
  assert.deepEqual(methodValues.filter(value => !value.explanation).map(value => value.value), ['Liftoff,invented_status']);
});

test('explains every run-level result item', () => {
  const ids = [
    'run.id', 'run.name', 'run.description', 'run.workflow', 'run.created', 'run.summary_generated', 'run.effective_cpus',
  ];
  const fileIds = ['run.stdout', 'run.stderr', ...runSupportPaths('/runs/result-42', () => true).map(item => item.id)];
  const sections = runHelpSections({
    metadataItems: ids.map(id => ({id, label: id})),
    fileItems: fileIds.map(id => ({id, label: id})),
    hasStatus: true,
    workflowSections: [],
  });
  const entries = sections.flatMap(section => section.entries);
  assert.deepEqual(entries.map(entry => entry.id).sort(), [...ids, ...fileIds, 'run.status'].sort());
  for (const entry of entries) {
    assert.ok(entry.explanation, `missing explanation for ${entry.id}`);
  }
});

test('opens the help page and returns to the preserved result scroll position', async () => {
  let backedOut = false;
  const screen = renderScreen(compatibleResult(), {
    rows: 20,
    inputActive: true,
    onBack: () => { backedOut = true; },
  });
  try {
    await settle();
    screen.output.emit('resize');
    await settle();
    screen.input.write(PAGE_DOWN);
    await settle();
    screen.output.clearOutput();
    screen.input.write(ARROW_DOWN);
    await settle();
    const scrolledResults = screen.frame();
    assert.doesNotMatch(scrolledResults, /Persisted definition sentinel/);

    screen.output.clearOutput();
    screen.input.write(HELP);
    await settle();
    let helpFrame = screen.frame();
    for (let index = 0; index < 40 && !/Persisted definition sentinel/.test(helpFrame); index += 1) {
      screen.output.clearOutput();
      screen.input.write(PAGE_DOWN);
      await settle();
      helpFrame = screen.frame();
    }
    assert.match(helpFrame, /Persisted definition sentinel for mapped features\./);

    screen.output.clearOutput();
    screen.input.write(ESCAPE);
    await settle(150);
    assert.equal(backedOut, false);
    assert.doesNotMatch(screen.frame(), /Persisted definition sentinel/);
    const visibleText = (frame: string) => frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    assert.equal(visibleText(screen.frame()), visibleText(scrolledResults));

    screen.input.write(ESCAPE);
    await settle(150);
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('renders help without a persisted definition or for incompatible results', async () => {
  const loaded = compatibleResult();
  loaded.result.definitions = {metrics: {}, detailColumns: {}};
  loaded.result.transfer.transferMethodsByTargetCopy = {Liftoff: 1, 'unexpected-method': 1};
  for (const candidate of [loaded, {
    kind: 'incompatible',
    error: {kind: 'missing-summary', message: 'No summary.'},
  } as LoadedWorkflowResult]) {
    const screen = renderScreen(candidate, {inputActive: true});
    try {
      await settle();
      screen.output.clearOutput();
      screen.input.write(HELP);
      await settle();
      const frame = screen.frame();
      assert.doesNotMatch(frame, /Persisted definition sentinel/);
      assert.doesNotMatch(frame, /\b137\b/);
      if (candidate.kind === 'compatible') {
        let helpFrame = frame;
        for (let index = 0; index < 40 && !/unexpected-method/.test(helpFrame); index += 1) {
          screen.output.clearOutput();
          screen.input.write(PAGE_DOWN);
          await settle();
          helpFrame = screen.frame();
        }
        assert.match(helpFrame, /unexpected-method/);
      }
    } finally {
      screen.unmount();
    }
  }
});
