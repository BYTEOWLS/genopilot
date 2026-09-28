import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {RunResultsScreen} from '../../src/ui/run-results-screen/screen.js';
import {
  cohortColumns,
  cohortDetailSections,
  comparisonRows,
  consensusFileSections,
  countRows,
  isolateColumns,
  isolateDetailSections,
  overviewSections,
  referenceConsensusHelpSections,
} from '../../src/ui/run-results-screen/reference-consensus-results.js';
import {validateReferenceConsensusConfiguration} from '../../src/workflows/reference-consensus/configuration.js';
import {
  cohortPathKeys,
  isolatePathKeys,
  type CohortCounts,
  type CohortResult,
  type IsolateResult,
  type ReferenceConsensusResult,
} from '../../src/workflows/reference-consensus/results.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import type {CompatibleReferenceConsensusResult} from '../../src/workflows/results.js';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends Writable {
  columns = 160;
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

const TAB = '\t';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ENTER = '\r';
const ESCAPE = '\x1b';
const HELP = '?';

async function settle(milliseconds = 60): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'reference-consensus',
  label: 'Cohort consensus',
  description: 'Description.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
};

const isolateIds = ['iso-a', 'iso-b', 'iso-c', 'iso-d', 'iso-e', 'iso-f', 'iso-g', 'iso-h'];

const configuration = validateReferenceConsensusConfiguration({
  schema_version: 1,
  workflow_id: 'reference-consensus',
  workflow_version: 1,
  inputs: {
    backbone: {source: 'ncbi', accession: 'GCF_000000001.1'},
    isolates_file: 'isolates.yaml',
    selected_isolates: isolateIds,
  },
  calling: {ploidy: 1, min_depth: 10, min_mapping_quality: 20, min_base_quality: 20, min_allele_fraction: 0.8},
  consensus: {include_backbone_vote: true, voting_method: 'strict-majority', min_callable_isolates: 0, unresolved_snp: 'n'},
  resources: {cpu_mode: 'automatic', effective_cpus: 3},
  run: {output_root: '/runs', id: 'run-a', name: 'Synthetic cohort', created_at: '2026-01-01T12:00:00.000Z'},
});

function path(relative: string, available = true) {
  return {path: relative, absolutePath: `/runs/run-a/${relative}`, available};
}

function counts(tie: number): CohortCounts {
  return {
    lociSelected: 40, lociChanged: 12, multiallelicLoci: 3, competingIndelLoci: 1, basesBackboneOnly: 7, basesIupac: 0,
    lociUnresolved: {tie, no_majority: 1, no_votes: 0, few_callable: 0},
    basesN: {tie, no_majority: 1, no_votes: 5, few_callable: 0, backbone_not_acgt: 3},
  };
}

function isolate(id: string, index: number): IsolateResult {
  return {
    id,
    name: `Isolate ${String(index + 1)}`,
    wildtype: index === 0,
    derivedFrom: index === 1 ? 'iso-a' : null,
    state: index === 1 ? 'incomplete' : 'completed',
    ...(index === 1 ? {} : {metrics: {meanDepth: 40 + index, coveredFraction: 0.99, callableFraction: 0.95, snps: 1000 + index, indels: 80, trimmed: 'untrimmed'}}),
    promotionCandidate: index !== 1,
    paths: Object.fromEntries(isolatePathKeys.map(key => [key, path(`results/isolates/${id}/${key}`)])) as IsolateResult['paths'],
    issues: [],
  };
}

function cohort(id: string, iteration: number, change: Partial<CohortResult> = {}): CohortResult {
  return {
    id,
    iteration,
    state: 'completed',
    voters: isolateIds.filter(value => iteration === 1 || value !== 'iso-b'),
    settings: {...configuration.consensus, ...(iteration === 1 ? {} : {voting_method: 'plurality' as const})},
    excluded: iteration === 1 ? [] : [{id: 'iso-b', processing: 'incomplete'}],
    finishedAt: `2026-01-0${String(iteration)}T10:00:00.000Z`,
    ...(iteration === 1 ? {} : {reason: 'iso-b failed.', decidedAt: `2026-01-0${String(iteration)}T09:00:00.000Z`, initialAggregated: true}),
    counts: counts(iteration === 1 ? 3 : 1),
    paths: Object.fromEntries(cohortPathKeys
      .filter(key => iteration > 1 || key !== 'decision')
      .map(key => [key, path(`results/cohort/${id}/${key}`)])),
    issues: [],
    ...change,
  };
}

function consensusResult(): ReferenceConsensusResult {
  return {
    backbone: {
      source: 'ncbi',
      accession: 'GCF_000000001.1',
      sha256: 'c'.repeat(64),
      origin: 'imported',
      downloaded: false,
      paths: {fasta: path('resolved/backbone.fasta'), provenance: path('provenance/backbone.fasta.json')},
      issues: [],
    },
    isolates: isolateIds.map(isolate),
    cohorts: [cohort('initial', 1), cohort('iteration-2', 2), cohort('iteration-3', 3, {state: 'pending', counts: undefined, finishedAt: undefined})],
    activeCohortId: 'iteration-2',
    baselineCohortId: 'initial',
    status: {variant: 'success', explanation: 'The cohort consensus of iteration 2 is available.'},
    generatedAt: '2026-01-02T10:00:00.000Z',
    effectiveCpus: 3,
    runFiles: {
      configuration: path('config.yaml'),
      snapshot: path('isolates.yaml'),
      inputValidation: path('results/input-validation.json'),
    },
    linkedPaths: [],
  };
}

function loaded(result = consensusResult()): CompatibleReferenceConsensusResult {
  return {
    kind: 'compatible',
    workflow: {id: 'reference-consensus', version: 1},
    configuration,
    snapshot: {schema_version: 1, captured_at: '2026-01-01T12:00:00.000Z', isolates: []},
    result,
    shell: {
      runStatus: 'completed',
      status: result.status,
      generatedAt: result.generatedAt!,
      effectiveCpus: 3,
      linkedPaths: [],
    },
  };
}

function renderScreen(options: {rows?: number; columns?: number; onBack?: () => void} = {}) {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? output.rows;
  output.columns = options.columns ?? output.columns;
  const instance = render(
    <RunResultsScreen
      runDirectory="/runs/run-a"
      manifest={manifest}
      loaded={loaded()}
      onBack={options.onBack}
      pathExists={() => true}
      formatDateTime={value => `formatted:${value}`}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  /** Sends keys one by one and returns what was drawn after the last one. */
  const press = async (...keys: string[]): Promise<string> => {
    for (const key of keys) {
      output.clearOutput();
      input.write(key);
      await settle();
    }
    return output.readOutput();
  };
  return {input, output, press, unmount: () => instance.unmount()};
}

/** The drawn line that carries the selection marker. */
function selectedLine(frame: string): string | undefined {
  return frame.split('\n').reverse().find(line => line.includes('›'));
}

test('opens on the overview with the backbone and the active cohort', async () => {
  const screen = renderScreen();
  try {
    await settle();
    const frame = screen.output.readOutput();
    for (const expected of ['GCF_000000001.1', 'c'.repeat(64), 'iso-a, iso-c', 'formatted:2026-01-02T10:00:00.000Z']) {
      assert.ok(frame.includes(expected), `missing ${expected}`);
    }
  } finally {
    screen.unmount();
  }
});

test('switches tabs and moves the isolate selection into its detail and back', async () => {
  let backedOut = false;
  const screen = renderScreen({onBack: () => { backedOut = true; }});
  try {
    await settle();
    let frame = await screen.press(TAB);
    assert.match(selectedLine(frame) ?? '', /iso-a/);
    assert.doesNotMatch(frame, /results\/isolates\/iso-a\/alignment/);

    frame = await screen.press(ARROW_DOWN);
    assert.match(selectedLine(frame) ?? '', /iso-b/);

    frame = await screen.press(ENTER);
    assert.match(frame, /results\/isolates\/iso-b\/alignment/);
    assert.match(frame, /results\/isolates\/iso-b\/logs/);

    frame = await screen.press(ESCAPE);
    assert.equal(backedOut, false);
    assert.match(selectedLine(frame) ?? '', /iso-b/);

    await screen.press(ESCAPE);
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('selects an iteration and compares it with the first completed cohort', async () => {
  const screen = renderScreen();
  try {
    await settle();
    let frame = await screen.press(TAB, TAB);
    // The active iteration is selected first; its tie count fell from 3 to 1.
    assert.match(selectedLine(frame) ?? '', /^\W*2\b/);
    assert.match(frame, /results\/cohort\/iteration-2\/consensus-fasta/);
    assert.match(frame, /-2\b/);

    frame = await screen.press(ARROW_UP);
    assert.match(frame, /results\/cohort\/initial\/consensus-fasta/);

    frame = await screen.press(ARROW_DOWN, ARROW_DOWN);
    assert.match(frame, /iteration-3\/decision/);
  } finally {
    screen.unmount();
  }
});

test('shows the run files on the last tab and returns to the overview', async () => {
  const screen = renderScreen();
  try {
    await settle();
    let frame = await screen.press(TAB, TAB, TAB);
    assert.match(frame, /isolates\.yaml/);
    assert.match(frame, /provenance\/backbone\.fasta\.json/);
    frame = await screen.press(TAB);
    assert.match(frame, /GCF_000000001\.1/);
  } finally {
    screen.unmount();
  }
});

test('keeps the selected isolate in view in a short terminal and after a resize', async () => {
  const screen = renderScreen({rows: 22, columns: 70});
  try {
    await settle();
    await screen.press(TAB);
    const frame = await screen.press(...Array.from({length: isolateIds.length - 1}, () => ARROW_DOWN));
    assert.match(selectedLine(frame) ?? '', /iso-h/);

    screen.output.columns = 50;
    screen.output.clearOutput();
    screen.output.emit('resize');
    await settle();
    assert.match(selectedLine(screen.output.readOutput()) ?? '', /iso-h/);
  } finally {
    screen.unmount();
  }
});

test('opens and closes the help page from any tab', async () => {
  const screen = renderScreen();
  try {
    await settle();
    await screen.press(TAB);
    let frame = await screen.press(HELP);
    assert.equal(selectedLine(frame), undefined);
    frame = await screen.press(ESCAPE);
    assert.match(selectedLine(frame) ?? '', /iso-a/);
  } finally {
    screen.unmount();
  }
});

test('explains every item the reference-consensus view can render', () => {
  const result = consensusResult();
  const rendered = new Set([
    ...overviewSections(result).flatMap(section => section.rows.map(row => row.id)),
    ...countRows(counts(0)).map(row => row.id),
    ...isolateColumns.map(column => column.id),
    ...result.isolates.flatMap(value => isolateDetailSections(value, result).flatMap(section => section.rows.map(row => row.id))),
    ...cohortColumns.map(column => column.id),
    ...result.cohorts.flatMap(value => cohortDetailSections(value, text => text).flatMap(section => section.rows.map(row => row.id))),
    ...consensusFileSections(result).flatMap(section => section.rows.map(row => row.id)),
  ]);
  const entries = referenceConsensusHelpSections(result).flatMap(section => section.entries);
  const explained = new Set(entries.filter(entry => entry.explanation || entry.values).map(entry => entry.id));
  for (const id of rendered) {
    assert.ok(explained.has(id), `no help for ${id}`);
  }
  for (const entry of entries) {
    assert.ok(entry.explanation ?? entry.values, `empty help entry ${entry.id}`);
  }
});

test('compares counts as both values and their change', () => {
  const rows = comparisonRows(counts(3), counts(1));
  const ids = countRows(counts(1)).map(row => row.id);
  const tie = rows[ids.indexOf('counts.loci_unresolved.tie')]!;
  assert.deepEqual(tie.slice(0, 3), ['3', '1', '-2']);
  const selected = rows[ids.indexOf('counts.loci_selected')]!;
  assert.deepEqual(selected.slice(0, 3), ['40', '40', '0']);
});
