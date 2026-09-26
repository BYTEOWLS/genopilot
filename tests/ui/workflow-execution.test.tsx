import assert from 'node:assert/strict';
import {appendFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  WorkflowExecutionScreen,
  type WorkflowRun,
  type RunFollowUp,
  type WorkflowRunResult,
  type WorkflowResultHandoff,
} from '../../src/ui/new-run-screen/workflow-execution.js';
import {RUN_EVENT_SCHEMA_VERSION} from '../../src/workflows/run-events.js';
import {HomeSuspensionContext, type HomeSuspension} from '../../src/ui/home-navigation.js';

const ENTER = '\r';
const ESCAPE = '\x1b';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const PAGE_UP = '\x1b[5~';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

class TestOutput extends Writable {
  columns = 200;
  rows = 40;
  readonly isTTY = false;
  private output = '';

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString();
    callback();
  }

  readOutput(): string {
    return this.output;
  }

  clearOutput(): void {
    this.output = '';
  }
}

async function waitForOutput(
  output: TestOutput,
  predicate: (value: string) => boolean,
): Promise<string> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    const value = output.readOutput();
    if (predicate(value)) {
      return value;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for terminal output. Received:\n${output.readOutput()}`);
}

async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting until ${description}`);
}

// Selects the execution in the start options by its exact command, which unlike the dry run's
// has no --dry-run flag, and starts it.
async function startExecution(input: TestInput, output: TestOutput): Promise<void> {
  await waitForOutput(output, value => value.includes('/managed/snakemake --dry-run'));
  output.clearOutput();
  input.write(ARROW_DOWN);
  await waitForOutput(output, value => value.includes('/managed/snakemake') && !value.includes('--dry-run'));
  input.write(ENTER);
}

const stages = [
  {id: 'resolve-inputs', label: 'Resolve inputs', rules: ['resolve_reference', 'resolve_target']},
  {id: 'validate-inputs', label: 'Validate inputs', rules: ['validate_inputs']},
  {id: 'summarize-results', label: 'Summarize results'},
];

function eventLine(event: Record<string, unknown>): string {
  return `${JSON.stringify({schema_version: RUN_EVENT_SCHEMA_VERSION, ...event})}\n`;
}

function renderExecution(
  eventsPath: string,
  executeRun: (
    run: WorkflowRun,
    onOutput: (output: {stream: 'stdout' | 'stderr'; text: string}) => void,
  ) => Promise<WorkflowRunResult>,
  rows?: number,
  resultHandoff?: WorkflowResultHandoff,
  onHomeSuspension?: (suspension: HomeSuspension | undefined) => void,
  onSucceeded?: () => RunFollowUp | undefined,
): {input: TestInput; output: TestOutput; instance: ReturnType<typeof render>} {
  const input = new TestInput();
  const output = new TestOutput();
  if (rows !== undefined) {
    output.rows = rows;
  }
  const preparedRun = (mode: 'dry-run' | 'execute') => ({
    mode,
    command: `/managed/snakemake${mode === 'dry-run' ? ' --dry-run' : ''}`,
    stdoutLogPath: `/run/logs/snakemake-${mode}.stdout.log`,
    stderrLogPath: `/run/logs/snakemake-${mode}.stderr.log`,
    ...(mode === 'execute' ? {eventsPath} : {}),
  });
  const instance = render(
    <HomeSuspensionContext.Provider value={(_id, suspension) => onHomeSuspension?.(suspension)}>
    <WorkflowExecutionScreen
      configurationPath="/run/config.yaml"
      prepareRun={preparedRun}
      executeRun={executeRun}
      onBack={() => {}}
      inputActive
      stages={stages}
      resultHandoff={resultHandoff}
      onSucceeded={onSucceeded}
    />
    </HomeSuspensionContext.Provider>,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  return {input, output, instance};
}

test('reports stage progress from structured events, never from console text', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const eventsPath = join(root, 'events.jsonl');
  let releaseRun = (): void => {};
  const finished = new Promise<void>(resolve => {
    releaseRun = resolve;
  });

  const {input, output, instance} = renderExecution(eventsPath, async run => {
    assert.equal(run.eventsPath, eventsPath);
    await finished;
    return {...run, exitCode: 0};
  });
  context.after(() => instance.unmount());

  await waitForOutput(output, value => value.includes('Choose how to start this run'));
  input.write(ARROW_DOWN);
  await waitForOutput(output, value => value.includes('(●) Run workflow'));
  output.clearOutput();
  input.write(ENTER);

  const startedFrame = await waitForOutput(output, value =>
    value.includes('Waiting for Snakemake to schedule jobs'),
  );
  assert.match(startedFrame, /· Resolve inputs\s+0\/0/);
  assert.match(startedFrame, /— Summarize results\s+not implemented/);

  await appendFile(
    eventsPath,
    eventLine({type: 'run-info', jobs: {resolve_reference: 1, resolve_target: 1}, total: 2}) +
      eventLine({type: 'job-started', job_id: 1, rule: 'resolve_reference'}),
  );
  const runningFrame = await waitForOutput(output, value => value.includes('● Resolve inputs'));
  assert.match(runningFrame, /● Resolve inputs\s+0\/2/);
  // validate-inputs was not scheduled, so its outputs are already present in the run directory.
  assert.match(runningFrame, /✔ Validate inputs\s+up to date/);

  await appendFile(
    eventsPath,
    eventLine({type: 'job-finished', job_id: 1}) +
      eventLine({type: 'progress', done: 1, total: 2}) +
      eventLine({type: 'job-started', job_id: 2, rule: 'resolve_target'}) +
      eventLine({type: 'job-finished', job_id: 2}) +
      eventLine({type: 'progress', done: 2, total: 2}),
  );
  releaseRun();

  const finalFrame = await waitForOutput(output, value => value.includes('Workflow run succeeded'));
  assert.match(finalFrame, /✔ Resolve inputs\s+2\/2/);
  assert.match(finalFrame, /2\/2 jobs/);
});

test('marks the failing stage and keeps the reported reason', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const eventsPath = join(root, 'events.jsonl');

  const {input, output, instance} = renderExecution(eventsPath, async run => {
    // Snakemake writes its last events before exiting, so they can arrive after the final
    // poll; the screen drains the file once more before settling on a result.
    await appendFile(
      eventsPath,
      eventLine({type: 'run-info', jobs: {validate_inputs: 1}, total: 1}) +
        eventLine({type: 'job-started', job_id: 0, rule: 'validate_inputs'}) +
        eventLine({
          type: 'job-failed',
          job_id: 0,
          rule: 'validate_inputs',
          logs: ['logs/validate-inputs.log'],
        }),
    );
    return {...run, exitCode: 1};
  });
  context.after(() => instance.unmount());

  await waitForOutput(output, value => value.includes('Choose how to start this run'));
  input.write(ARROW_DOWN);
  await waitForOutput(output, value => value.includes('(●) Run workflow'));
  input.write(ENTER);

  const frame = await waitForOutput(output, value => value.includes('Workflow run failed'));
  assert.match(frame, /✖ Validate inputs\s+0\/1/);
  assert.match(frame, /Rule validate_inputs failed\./);
  assert.match(frame, /Snakemake exited with code 1\./);
});

test('shows no stage progress for a dry run, which schedules nothing', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));

  const {input, output, instance} = renderExecution(join(root, 'events.jsonl'), async run => {
    assert.equal(run.eventsPath, undefined);
    return {...run, exitCode: 0};
  });
  context.after(() => instance.unmount());

  await waitForOutput(output, value => value.includes('Choose how to start this run'));
  input.write(ENTER);

  const frame = await waitForOutput(output, value => value.includes('Snakemake dry run succeeded'));
  assert.doesNotMatch(frame, /Stages/);
  assert.doesNotMatch(frame, /Summarize results/);
});

test('scrolls back through retained output while the run keeps producing more', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let emit: ((text: string) => void) | undefined;
  let release = (): void => {};
  const finished = new Promise<void>(resolve => {
    release = resolve;
  });

  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async (run, onOutput) => {
      emit = text => onOutput({stream: 'stdout', text});
      await finished;
      return {...run, exitCode: 0};
    },
  );
  context.after(() => instance.unmount());

  await waitForOutput(output, value => value.includes('Choose how to start this run'));
  input.write(ENTER);
  await waitForOutput(output, value => value.includes('Running snakemake dry run'));
  assert.ok(emit);

  // More output than the window holds, so there is something to scroll back to.
  emit(`${Array.from({length: 40}, (_, index) => `log line ${String(index + 1)}`).join('\n')}\n`);
  const tailFrame = await waitForOutput(output, value => value.includes('log line 40'));
  assert.match(tailFrame, /earlier lines/);
  assert.doesNotMatch(tailFrame, /log line 1$/m);

  output.clearOutput();
  input.write(PAGE_UP);
  const scrolledFrame = await waitForOutput(output, value => value.includes('Snakemake log — line'));
  assert.match(scrolledFrame, /newer lines/);
  assert.match(scrolledFrame, /↑\/↓ — Scroll/);
  const scrolledRange = /line (\d+)–(\d+) of (\d+)/.exec(scrolledFrame);
  assert.ok(scrolledRange);

  // Output arriving while scrolled back must not drag the view forward.
  output.clearOutput();
  emit('log line 41\n');
  const heldFrame = await waitForOutput(output, value => value.includes('of 41'));
  const heldRange = /line (\d+)–(\d+) of 41/.exec(heldFrame);
  assert.equal(heldRange?.[1], scrolledRange[1]);
  assert.equal(heldRange?.[2], scrolledRange[2]);

  // One line down, then back to following the newest output.
  output.clearOutput();
  input.write(ARROW_DOWN);
  const steppedFrame = await waitForOutput(output, value =>
    value.includes(`line ${String(Number(scrolledRange[1]) + 1)}–`),
  );
  assert.match(steppedFrame, /of 41/);

  output.clearOutput();
  input.write('G');
  const followingFrame = await waitForOutput(output, value => value.includes('log line 41'));
  assert.doesNotMatch(followingFrame, /Snakemake log — line/);

  output.clearOutput();
  input.write(ARROW_UP);
  await waitForOutput(output, value => value.includes('Snakemake log — line'));

  release();
  await waitForOutput(output, value => value.includes('Snakemake dry run succeeded'));
});

test('reloads persisted results after execution instead of keeping transient metrics', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let loads = 0;
  const resultHandoff: WorkflowResultHandoff = {
    runDirectory: root,
    manifest: {
      schema_version: 1,
      workflow_version: 1,
      id: 'annotation-transfer',
      label: 'Transfer genome annotation',
      description: 'Transfer an annotation.',
      entry_snakefile: 'Snakefile',
      'parameter-definitions': 'manifest.parameters.yaml',
      stages: [],
      artifacts: [],
    },
    loadResult: async runDirectory => {
      loads += 1;
      assert.equal(runDirectory, root);
      return {
        kind: 'incompatible',
        error: {
          kind: 'missing-summary',
          message: 'Unable to read completion summary: file not found',
          path: join(root, 'results/summary.json'),
        },
      };
    },
  };
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async (run, onOutput) => {
      onOutput({stream: 'stdout', text: 'Finished all jobs.\n'});
      return {...run, exitCode: 0};
    },
    undefined,
    resultHandoff,
  );
  context.after(() => instance.unmount());

  await startExecution(input, output);
  await waitUntil(() => loads === 1, 'persisted results are loaded');

  // A finished execution stays on the run screen with its log until results are requested.
  await waitForOutput(output, value => value.includes('Finished all jobs.'));
  await new Promise<void>(resolve => setTimeout(resolve, 100));
  assert.doesNotMatch(output.readOutput(), /Unable to read completion summary/);

  output.clearOutput();
  input.write(ENTER);
  const frame = await waitForOutput(output, value => value.includes('Unable to read completion summary'));
  assert.match(frame, /snakemake-execute\.stdout\.log/);
  assert.equal(loads, 1);

  // Leaving the results returns to the finished run rather than the workflow.
  output.clearOutput();
  input.write(ESCAPE);
  await waitForOutput(output, value => value.includes('Finished all jobs.'));
});

test('shows process failure together with persisted-result availability', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let loads = 0;
  const resultHandoff: WorkflowResultHandoff = {
    runDirectory: root,
    manifest: {
      schema_version: 1,
      workflow_version: 1,
      id: 'annotation-transfer',
      label: 'Transfer genome annotation',
      description: 'Transfer an annotation.',
      entry_snakefile: 'Snakefile',
      'parameter-definitions': 'manifest.parameters.yaml',
      stages: [],
      artifacts: [],
    },
    loadResult: async () => {
      loads += 1;
      return {
        kind: 'incompatible',
        error: {kind: 'invalid-summary', message: 'Completion summary is corrupt.'},
      };
    },
  };
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => ({...run, exitCode: 2}),
    undefined,
    resultHandoff,
  );
  context.after(() => instance.unmount());

  await startExecution(input, output);
  await waitUntil(() => loads === 1, 'persisted results are loaded');
  await new Promise<void>(resolve => setTimeout(resolve, 100));
  assert.doesNotMatch(output.readOutput(), /Completion summary is corrupt/);

  // Results of a failed execution can still be opened from the run screen.
  output.clearOutput();
  input.write(ENTER);
  const frame = await waitForOutput(output, value => value.includes('Completion summary is corrupt'));
  assert.match(frame, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('sizes the log window to the terminal instead of a fixed height', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let emit: ((text: string) => void) | undefined;
  let release = (): void => {};
  const finished = new Promise<void>(resolve => {
    release = resolve;
  });

  // A short terminal falls back to the minimum window rather than overflowing the screen.
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async (run, onOutput) => {
      emit = text => onOutput({stream: 'stdout', text});
      await finished;
      return {...run, exitCode: 0};
    },
    15,
  );
  context.after(() => instance.unmount());

  await waitForOutput(output, value => value.includes('Choose how to start this run'));
  input.write(ENTER);
  await waitForOutput(output, value => value.includes('Running snakemake dry run'));
  assert.ok(emit);

  emit(`${Array.from({length: 40}, (_, index) => `log line ${String(index + 1)}`).join('\n')}\n`);
  const frame = await waitForOutput(output, value => value.includes('log line 40'));

  const shown = [...frame.matchAll(/log line (\d+)/g)].map(match => Number(match[1]));
  assert.equal(Math.min(...shown), 36);
  assert.match(frame, /↑ 35 earlier lines/);

  release();
  await waitForOutput(output, value => value.includes('Snakemake dry run succeeded'));
});

test('suspends the home shortcut while the workflow runs', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let releaseRun = (): void => {};
  const finished = new Promise<void>(resolve => {
    releaseRun = resolve;
  });
  const suspensions: (HomeSuspension | undefined)[] = [];
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => {
      await finished;
      return {...run, exitCode: 0};
    },
    undefined,
    undefined,
    suspension => suspensions.push(suspension),
  );
  context.after(() => instance.unmount());

  await startExecution(input, output);
  await waitUntil(() => suspensions.length === 1, 'the running workflow suspends the shortcut');
  assert.deepEqual(suspensions, ['busy']);

  releaseRun();
  await waitUntil(() => suspensions.length === 2, 'the finished workflow releases the shortcut');
  assert.deepEqual(suspensions, ['busy', undefined]);
});

// The follow-up tests observe the injected runner and follow-up callbacks and the notes they
// supply, never the screen's own wording.

/** Selects a start mode by its injected command and starts it. */
async function startMode(input: TestInput, output: TestOutput, mode: 'dry-run' | 'execute'): Promise<void> {
  await waitForOutput(output, value => value.includes('/managed/snakemake --dry-run'));
  if (mode === 'execute') {
    output.clearOutput();
    input.write(ARROW_DOWN);
    await waitForOutput(output, value => value.includes('/managed/snakemake') && !value.includes('--dry-run'));
  }
  input.write(ENTER);
}

test('runs the success follow-up only after a successful execution', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const modes: string[] = [];
  let followUps = 0;
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => {
      modes.push(run.mode);
      return {...run, exitCode: 0};
    },
    undefined,
    undefined,
    undefined,
    () => {
      followUps += 1;
      return {label: 'Test follow-up running', outcome: Promise.resolve('Test follow-up note')};
    },
  );
  context.after(() => instance.unmount());

  await startMode(input, output, 'dry-run');
  await waitUntil(() => modes.length === 1, 'the dry run finishes');
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  assert.equal(followUps, 0);

  // Leaving a finished dry run preselects the execution in the start options.
  output.clearOutput();
  input.write(ESCAPE);
  await waitForOutput(output, value => value.includes('/managed/snakemake'));
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  input.write(ENTER);
  await waitForOutput(output, value => value.includes('Test follow-up note'));
  assert.deepEqual(modes, ['dry-run', 'execute']);
  assert.equal(followUps, 1);
});

test('shows the finished run while its follow-up is still running', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let finishFollowUp = (_note: string): void => {};
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => ({...run, exitCode: 0}),
    undefined,
    undefined,
    undefined,
    () => ({
      label: 'Test follow-up running',
      outcome: new Promise<string>(resolve => {
        finishFollowUp = resolve;
      }),
    }),
  );
  context.after(() => instance.unmount());

  await startMode(input, output, 'execute');
  // The follow-up's label only appears on the finished screen, so the run is shown as finished.
  await waitForOutput(output, value => value.includes('Test follow-up running'));

  finishFollowUp('Test follow-up note');
  await waitForOutput(output, value => value.includes('Test follow-up note'));
});

test('shows a failed follow-up without changing the run', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => ({...run, exitCode: 0}),
    undefined,
    undefined,
    undefined,
    () => ({label: 'Test follow-up running', outcome: Promise.reject(new Error('test follow-up failure'))}),
  );
  context.after(() => instance.unmount());

  await startMode(input, output, 'execute');
  await waitForOutput(output, value => value.includes('test follow-up failure'));
});

test('skips the success follow-up when the execution fails', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  let executed = false;
  let followUps = 0;
  const {input, output, instance} = renderExecution(
    join(root, 'events.jsonl'),
    async run => {
      executed = true;
      return {...run, exitCode: 1};
    },
    undefined,
    undefined,
    undefined,
    () => {
      followUps += 1;
      return undefined;
    },
  );
  context.after(() => instance.unmount());

  await startMode(input, output, 'execute');
  await waitUntil(() => executed, 'the execution finishes');
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  assert.equal(followUps, 0);
});

const isolateStages = [
  {
    id: 'process',
    label: 'Process',
    rules: ['index', 'align_pair', 'call'],
    per_isolate: {read_pair_rules: ['align_pair'], isolate_rules: ['call']},
  },
];

function renderIsolateExecution(
  eventsPath: string,
  isolates: readonly {id: string; label: string; readPairs: number}[],
  executeRun: (run: WorkflowRun) => Promise<WorkflowRunResult>,
  rows = 40,
): {input: TestInput; output: TestOutput; instance: ReturnType<typeof render>} {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = rows;
  const instance = render(
    <WorkflowExecutionScreen
      configurationPath="/run/config.yaml"
      prepareRun={mode => ({
        mode,
        command: `/managed/snakemake${mode === 'dry-run' ? ' --dry-run' : ''}`,
        stdoutLogPath: '/run/logs/stdout.log',
        stderrLogPath: '/run/logs/stderr.log',
        ...(mode === 'execute' ? {eventsPath} : {}),
      })}
      executeRun={executeRun}
      onBack={() => {}}
      inputActive
      stages={isolateStages}
      isolates={isolates}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  return {input, output, instance};
}

test('follows every isolate through its own jobs and marks only the failing one', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const eventsPath = join(root, 'events.jsonl');
  let releaseRun = (): void => {};
  const finished = new Promise<void>(resolve => {
    releaseRun = resolve;
  });
  const isolates = [
    {id: 'iso-a', label: 'First isolate', readPairs: 2},
    {id: 'iso-b', label: 'Second isolate', readPairs: 1},
  ];
  const {input, output, instance} = renderIsolateExecution(eventsPath, isolates, async run => {
    await finished;
    return {...run, exitCode: 1};
  });
  context.after(() => instance.unmount());

  await startExecution(input, output);
  // Two read pairs and one isolate rule, and one read pair and one isolate rule.
  const pendingFrame = await waitForOutput(output, value => value.includes('First isolate'));
  assert.match(pendingFrame, /· First isolate[^\n]*0\/3/);
  assert.match(pendingFrame, /· Second isolate[^\n]*0\/2/);

  await appendFile(
    eventsPath,
    eventLine({type: 'run-info', jobs: {index: 1, align_pair: 3, call: 2}, total: 6}) +
      eventLine({type: 'job-started', job_id: 1, rule: 'index', wildcards: {}}) +
      eventLine({type: 'job-started', job_id: 2, rule: 'align_pair', wildcards: {isolate: 'iso-a', pair: '1'}}) +
      eventLine({type: 'job-started', job_id: 3, rule: 'align_pair', wildcards: {isolate: 'iso-b', pair: '1'}}) +
      eventLine({type: 'job-finished', job_id: 3}) +
      eventLine({type: 'job-started', job_id: 4, rule: 'call', wildcards: {isolate: 'iso-b'}}),
  );
  output.clearOutput();
  const runningFrame = await waitForOutput(output, value => /● Second isolate[^\n]*1\/2/.test(value));
  assert.match(runningFrame, /● First isolate[^\n]*0\/3 running align pair/);

  await appendFile(
    eventsPath,
    eventLine({type: 'job-failed', job_id: 4, rule: 'call', logs: []}) +
      eventLine({type: 'job-finished', job_id: 2}),
  );
  releaseRun();
  const finalFrame = await waitForOutput(output, value => value.includes('Workflow run failed'));
  assert.match(finalFrame, /✖ Second isolate[^\n]*1\/2 failed/);
  assert.match(finalFrame, /● First isolate[^\n]*1\/3/);
});

test('keeps failing and running isolates visible when the terminal is short', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const eventsPath = join(root, 'events.jsonl');
  const isolates = Array.from({length: 8}, (_, index) => ({
    id: `iso-${String(index + 1)}`,
    label: `Isolate number ${String(index + 1)}`,
    readPairs: 1,
  }));
  const {input, output, instance} = renderIsolateExecution(eventsPath, isolates, async run => {
    await appendFile(
      eventsPath,
      eventLine({type: 'job-started', job_id: 7, rule: 'align_pair', wildcards: {isolate: 'iso-8', pair: '1'}}) +
        eventLine({type: 'job-failed', job_id: 7, rule: 'align_pair', logs: []}),
    );
    return {...run, exitCode: 1};
  }, 16);
  context.after(() => instance.unmount());

  await startExecution(input, output);
  const allOutput = await waitForOutput(output, value => value.includes('Workflow run failed'));
  // Only the final frame counts; earlier frames rightly listed other isolates.
  const frame = allOutput.slice(allOutput.lastIndexOf('Isolates '));
  // A quarter of 16 rows fits four isolates: the failed one first, then the others in order.
  assert.match(frame, /✖ Isolate number 8/);
  assert.match(frame, /· Isolate number 3/);
  assert.ok(!frame.includes('Isolate number 4'));
  assert.match(frame, /… 4 more isolates/);
});

test('completes every isolate once the run succeeds, including reused steps', async context => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-screen-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const eventsPath = join(root, 'events.jsonl');
  const {input, output, instance} = renderIsolateExecution(
    eventsPath,
    [{id: 'iso-a', label: 'Resumed isolate', readPairs: 1}],
    async run => ({...run, exitCode: 0}),
  );
  context.after(() => instance.unmount());

  await startExecution(input, output);
  const frame = await waitForOutput(output, value => value.includes('Workflow run succeeded'));
  assert.match(frame, /✔ Resumed isolate[^\n]*0\/2 done, 2 steps reused/);
});
