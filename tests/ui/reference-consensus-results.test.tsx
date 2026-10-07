import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {RunResultsScreen, type CohortRerun} from '../../src/ui/run-results-screen/screen.js';
import {initialCohortDraft} from '../../src/ui/run-results-screen/cohort-review.js';
import {CohortDecisionError, type CohortDecisionDraft} from '../../src/workflows/reference-consensus/cohort-decision.js';
import type {CohortSites} from '../../src/workflows/reference-consensus/sites.js';
import type {SnakemakeRun} from '../../src/workflows/execution.js';
import {
  comparisonRows,
  countRows,
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
const SHIFT_TAB = '\x1b[Z';
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
  genopilot: {version: '1.2.3'},
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

function renderScreen(options: {
  rows?: number;
  columns?: number;
  onBack?: () => void;
  loaded?: CompatibleReferenceConsensusResult;
  cohortRerun?: CohortRerun;
  readSites?: (options: {consensusSitesPath: string; supportSitesPath: string; signal?: AbortSignal}) => Promise<CohortSites>;
} = {}) {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? output.rows;
  output.columns = options.columns ?? output.columns;
  const instance = render(
    <RunResultsScreen
      runDirectory="/runs/run-a"
      manifest={manifest}
      loaded={options.loaded ?? loaded()}
      onBack={options.onBack}
      pathExists={() => true}
      formatDateTime={value => `formatted:${value}`}
      cohortRerun={options.cohortRerun}
      readSites={options.readSites ?? (async () => ({voters: [], sites: []}))}
      loadHelp={async () => [{id: 'results', title: 'Results', blocks: []}]}
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

test('opens on the overview with the backbone and the active cohort, and keeps run details on their own tab', async () => {
  const screen = renderScreen();
  try {
    await settle();
    const frame = screen.output.readOutput();
    for (const expected of ['GCF_000000001.1', 'c'.repeat(64), 'iso-a, iso-c', '/runs/run-a/results/cohort/iteration-2/consensus-fasta']) {
      assert.ok(frame.includes(expected), `missing ${expected}`);
    }
    assert.doesNotMatch(frame, /formatted:2026-01-02T10:00:00\.000Z/, 'run metadata is not on the overview');
    // Run details are the tab before the citation, the last one.
    const details = await screen.press(SHIFT_TAB, SHIFT_TAB);
    assert.match(details, /formatted:2026-01-02T10:00:00\.000Z/);
    assert.doesNotMatch(details, /GCF_000000001\.1/);
  } finally {
    screen.unmount();
  }
});

test('suggests no annotation transfer before a consensus FASTA exists', async () => {
  const result = consensusResult();
  result.cohorts[1] = cohort('iteration-2', 2, {paths: {...result.cohorts[1]!.paths, 'consensus-fasta': path('results/cohort/iteration-2/consensus-fasta', false)}});
  const screen = renderScreen({loaded: loaded(result)});
  try {
    await settle();
    assert.doesNotMatch(screen.output.readOutput(), /\/runs\/run-a\/results\/cohort\/iteration-2\/consensus-fasta/);
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

test('shows the run files on their tab and returns to the overview', async () => {
  const screen = renderScreen();
  try {
    await settle();
    let frame = await screen.press(TAB, TAB, TAB, TAB);
    assert.match(frame, /isolates\.yaml/);
    assert.match(frame, /provenance\/backbone\.fasta\.json/);
    frame = await screen.press(TAB, TAB, TAB);
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

test('compares counts as both values and their change', () => {
  const rows = comparisonRows(counts(3), counts(1));
  const ids = countRows(counts(1)).map(row => row.id);
  const tie = rows[ids.indexOf('counts.loci_unresolved.tie')]!;
  assert.deepEqual(tie.slice(0, 3), ['3', '1', '-2']);
  const selected = rows[ids.indexOf('counts.loci_selected')]!;
  assert.deepEqual(selected.slice(0, 3), ['40', '40', '0']);
});

const SPACE = ' ';
const ARROW_RIGHT = '\x1b[C';

function site(start: number, change: Partial<CohortSites['sites'][number]> = {}): CohortSites['sites'][number] {
  return {
    chrom: 'chr1', start, end: start, status: 'unresolved', reason: 'tie', allele: '.', backboneAllele: 'G', backboneVotes: 1,
    alleles: ['G', 'C'], votes: [2, 2], callableIsolates: 3, totalVotes: 4, flags: ['snp'], calls: '0\t1\t1',
    ...change,
  };
}

const reviewedSites: CohortSites = {
  voters: ['iso-a', 'iso-c', 'iso-d'],
  sites: [
    site(1111),
    site(2222, {reason: 'no_majority', alleles: ['GAT', 'G', 'GATT'], votes: [1, 1, 1], flags: ['indel', 'competing_indel'], calls: '0\t1\tuncallable'}),
    site(3333, {status: 'selected', reason: '.', allele: 'A', flags: ['indel', 'competing_indel']}),
  ],
};

test('lists the reviewable loci of the selected cohort, filters them, and shows every voter', async () => {
  const requested: string[] = [];
  const screen = renderScreen({
    readSites: async ({consensusSitesPath}) => {
      requested.push(consensusSitesPath);
      return reviewedSites;
    },
  });
  /**
   * Presses keys, then waits until the selected line matches. The output is collected over all
   * keys, since Ink draws nothing for a key that leaves the frame unchanged.
   */
  const select = async (pattern: RegExp, ...keys: string[]): Promise<string> => {
    screen.output.clearOutput();
    for (const key of keys) {
      screen.input.write(key);
      await settle();
    }
    await waitFor(() => pattern.test(selectedLine(screen.output.readOutput()) ?? ''), `the selection matches ${String(pattern)}`);
    return screen.output.readOutput();
  };
  try {
    await settle();
    let frame = await select(/chr1:1,111/, TAB, TAB, TAB);
    // The active iteration is read, once.
    assert.deepEqual(requested, ['/runs/run-a/results/cohort/iteration-2/consensus-sites']);
    assert.doesNotMatch(frame, /chr1:2,222/);

    await select(/chr1:2,222/, 'f');
    frame = await select(/chr1:3,333/, 'f', ARROW_DOWN, ARROW_DOWN);
    // Every unresolved locus: the tie and the one without a majority.
    await select(/chr1:2,222/, 'f', ARROW_DOWN);

    await screen.press(ENTER);
    // The detail names every voter with its snapshot metadata and its vote or state.
    await waitFor(() => /uncallable/.test(screen.output.readOutput()), 'the locus detail is shown');
    frame = screen.output.readOutput();
    assert.match(frame, /Isolate 3/);
    assert.match(frame, /GATT/);
    await select(/chr1:2,222/, ESCAPE);
    assert.equal(requested.length, 1);
  } finally {
    screen.unmount();
  }
});

test('reads the sites of the cohort selected on the Iterations tab, and none without tables', async () => {
  const requested: string[] = [];
  const screen = renderScreen({
    readSites: async ({consensusSitesPath}) => {
      requested.push(consensusSitesPath);
      return reviewedSites;
    },
  });
  try {
    await settle();
    await screen.press(TAB, TAB, ARROW_UP, TAB);
    await waitFor(() => requested.length === 1, 'the sites are read');
    assert.deepEqual(requested, ['/runs/run-a/results/cohort/initial/consensus-sites']);
  } finally {
    screen.unmount();
  }

  const withoutTables = consensusResult();
  withoutTables.cohorts = withoutTables.cohorts.map(value => ({...value, paths: {}}));
  const requestedAgain: string[] = [];
  const second = renderScreen({
    loaded: loaded(withoutTables),
    readSites: async ({consensusSitesPath}) => {
      requestedAgain.push(consensusSitesPath);
      return reviewedSites;
    },
  });
  try {
    await settle();
    await second.press(TAB, TAB, TAB);
    await settle();
    assert.deepEqual(requestedAgain, []);
  } finally {
    second.unmount();
  }
});

type Recorded = {
  drafts: CohortDecisionDraft[];
  prepared: {iteration: number; mode: string; cores: number}[];
  executed: string[];
  reloads: number;
};

function rerun(recorded: Recorded, change: Partial<CohortRerun> = {}): CohortRerun {
  return {
    snakefilePath: '/package/workflows/reference-consensus/Snakefile',
    saveDecision: async (_directory, draft) => {
      recorded.drafts.push(draft);
      return 4;
    },
    prepareRun: ({iteration, mode, cores}) => {
      recorded.prepared.push({iteration, mode, cores});
      return {
        mode,
        command: `/managed/snakemake ${mode === 'dry-run' ? '--dry-run ' : ''}provenance/cohort/iteration-${String(iteration)}.json`,
        executable: '/managed/snakemake',
        arguments: [],
        runDirectory: '/runs/run-a',
        stdoutLogPath: `/runs/run-a/logs/cohort/iteration-${String(iteration)}/${mode}.stdout.log`,
        stderrLogPath: `/runs/run-a/logs/cohort/iteration-${String(iteration)}/${mode}.stderr.log`,
      } satisfies SnakemakeRun;
    },
    executeRun: async run => {
      recorded.executed.push(run.mode);
      return {...run, exitCode: 0};
    },
    checkDryRun: async () => ({allowed: true}),
    loadResult: async () => {
      recorded.reloads += 1;
      const result = consensusResult();
      result.cohorts.push(cohort('iteration-4', 4));
      result.activeCohortId = 'iteration-4';
      return loaded(result);
    },
    ...change,
  };
}

function recorder(): Recorded {
  return {drafts: [], prepared: [], executed: [], reloads: 0};
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await settle(10);
  }
  assert.fail(`Timed out waiting until ${description}`);
}

/** Moves from the first isolate row to a later form row: isolates, then the settings, the reason, and save. */
function down(times: number): string[] {
  return Array.from({length: times}, () => ARROW_DOWN);
}

test('saves a reasoned exclusion with changed settings, then dry-runs and executes only the iteration', async () => {
  const recorded = recorder();
  const screen = renderScreen({cohortRerun: rerun(recorded)});
  try {
    await settle();
    await screen.press('r');
    // The draft starts from the active iteration: iso-b (incomplete) is excluded.
    await screen.press(SPACE); // iso-a stops voting
    await screen.press(ARROW_DOWN, SPACE); // iso-b cannot vote: its processing is incomplete
    await screen.press(...down(isolateIds.length - 1)); // backbone vote
    await screen.press(SPACE, ARROW_DOWN, ARROW_RIGHT, ARROW_DOWN); // no backbone vote, plurality → strict majority
    await screen.press('\x7f', '2', ARROW_DOWN, SPACE, ARROW_DOWN); // minimum 2, IUPAC
    await screen.press(...'Coverage review.'.split(''), ARROW_DOWN, ENTER);
    await waitFor(() => recorded.drafts.length === 1, 'the decision is saved');

    const draft = recorded.drafts[0]!;
    assert.deepEqual(draft.voting_isolates, isolateIds.filter(id => id !== 'iso-a' && id !== 'iso-b'));
    assert.deepEqual(draft.excluded_from_voting, ['iso-a', 'iso-b']);
    assert.deepEqual(draft.consensus, {include_backbone_vote: false, voting_method: 'strict-majority', min_callable_isolates: 2, unresolved_snp: 'iupac'});
    assert.equal(draft.reason, 'Coverage review.');

    // The rerun of the saved iteration uses the run's CPUs and starts with its dry run.
    await waitFor(() => recorded.prepared.length >= 2, 'the rerun is prepared');
    assert.deepEqual(recorded.prepared.slice(0, 2).map(entry => entry.iteration), [4, 4]);
    assert.equal(recorded.prepared[0]?.cores, 3);
    let frame = await screen.press(ENTER);
    await waitFor(() => recorded.executed.length === 1, 'the dry run ran');
    frame = await screen.press(ESCAPE);
    assert.match(frame, /\/managed\/snakemake provenance\/cohort\/iteration-4\.json/);
    await screen.press(ENTER);
    await waitFor(() => recorded.executed.length === 2, 'the execution ran');
    assert.deepEqual(recorded.executed, ['dry-run', 'execute']);

    // Back on the results, reloaded, with the new iteration selected.
    await settle();
    frame = await screen.press(ESCAPE);
    await waitFor(() => recorded.reloads === 1, 'the result is reloaded');
    frame = await screen.press(ARROW_UP, ARROW_DOWN);
    assert.match(selectedLine(frame) ?? '', /^.*4.*active/);
  } finally {
    screen.unmount();
  }
});

test('shows the problems of a refused decision and stays in the form', async () => {
  const recorded = recorder();
  const screen = renderScreen({
    cohortRerun: rerun(recorded, {
      saveDecision: async () => {
        throw new CohortDecisionError([
          {path: '$.reason', message: 'must explain the decision'},
          {path: '$', message: 'changes nothing: iteration 2 has the same voting isolates and settings'},
        ]);
      },
    }),
  });
  try {
    await settle();
    await screen.press('r');
    await screen.press(...down(isolateIds.length + 5), ENTER);
    await waitFor(() => /must explain the decision/.test(screen.output.readOutput()), 'the problems are shown');
    assert.match(screen.output.readOutput(), /changes nothing/);
    assert.equal(recorded.prepared.length, 0);
  } finally {
    screen.unmount();
  }
});

test('starts a decision without an aggregated cohort from every completed isolate, so a failed one is excluded', () => {
  const result = consensusResult();
  result.cohorts = [cohort('initial', 1, {state: 'not-aggregated', voters: undefined, settings: undefined, counts: undefined})];
  delete result.activeCohortId;
  const draft = initialCohortDraft(result, configuration);
  assert.deepEqual(draft.voting, isolateIds.filter(id => id !== 'iso-b'));
  assert.deepEqual(draft.settings, configuration.consensus);
});

test('keeps the execution unavailable when the dry run would recompute an isolate', async () => {
  const recorded = recorder();
  const screen = renderScreen({
    cohortRerun: rerun(recorded, {
      checkDryRun: async () => ({allowed: false, reason: 'Snakemake would also run call_all_sites (1).'}),
    }),
  });
  try {
    await settle();
    await screen.press('r');
    await screen.press(...down(isolateIds.length + 5), ENTER);
    await waitFor(() => recorded.prepared.length >= 2, 'the rerun is prepared');
    let frame = await screen.press(ENTER);
    await waitFor(() => recorded.executed.length === 1, 'the dry run ran');
    await settle();
    frame = screen.output.readOutput();
    assert.match(frame, /call_all_sites \(1\)/);
    await screen.press(ESCAPE, ARROW_DOWN, ENTER);
    await waitFor(() => recorded.executed.length === 2, 'another attempt started');
    assert.deepEqual(recorded.executed, ['dry-run', 'dry-run']);
  } finally {
    screen.unmount();
  }
});

test('continues a pending iteration from the Iterations tab', async () => {
  const recorded = recorder();
  const screen = renderScreen({cohortRerun: rerun(recorded)});
  try {
    await settle();
    // The completed active iteration cannot be continued.
    await screen.press(TAB, TAB, 'c');
    assert.equal(recorded.prepared.length, 0);
    await screen.press(ARROW_DOWN, 'c');
    await waitFor(() => recorded.prepared.length >= 2, 'the rerun is prepared');
    assert.deepEqual(recorded.prepared.map(entry => entry.iteration).slice(0, 2), [3, 3]);
    assert.equal(recorded.drafts.length, 0);
  } finally {
    screen.unmount();
  }
});

test('cancels a running iteration when its screen goes away', async () => {
  const recorded = recorder();
  let signal: AbortSignal | undefined;
  const screen = renderScreen({
    cohortRerun: rerun(recorded, {
      executeRun: async (run, _onOutput, abort) => {
        signal = abort;
        await new Promise<void>(resolve => abort.addEventListener('abort', () => resolve(), {once: true}));
        throw new Error('Snakemake dry run cancelled.');
      },
    }),
  });
  await settle();
  await screen.press(TAB, TAB, ARROW_DOWN, 'c');
  await waitFor(() => recorded.prepared.length >= 2, 'the rerun is prepared');
  await screen.press(ENTER);
  await waitFor(() => signal !== undefined, 'the dry run started');
  screen.unmount();
  assert.equal(signal?.aborted, true);
});

test('offers no review or continue action without a rerun capability', async () => {
  const screen = renderScreen();
  try {
    await settle();
    const before = screen.output.readOutput();
    const frame = await screen.press('r');
    assert.match(frame + before, /GCF_000000001\.1/);
    assert.doesNotMatch(frame, /\[x\]/);
  } finally {
    screen.unmount();
  }
});

test('keeps the selected isolate of the review form in view in a short terminal and after a resize', async () => {
  const recorded = recorder();
  const screen = renderScreen({rows: 30, columns: 120, cohortRerun: rerun(recorded)});
  try {
    await settle();
    await screen.press('r');
    let frame = await screen.press(...down(isolateIds.length - 1));
    assert.match(selectedLine(frame) ?? '', /iso-h/);
    assert.doesNotMatch(frame, /iso-a/);

    screen.output.columns = 60;
    screen.output.rows = 40;
    screen.output.clearOutput();
    screen.output.emit('resize');
    await settle();
    frame = screen.output.readOutput();
    assert.match(selectedLine(frame) ?? '', /iso-h/);
    assert.match(frame, /iso-a/);
  } finally {
    screen.unmount();
  }
});
