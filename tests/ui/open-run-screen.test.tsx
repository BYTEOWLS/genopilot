import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {OpenRunScreen} from '../../src/ui/open-run-screen/screen.js';
import {HomeSuspensionContext, type HomeSuspension} from '../../src/ui/home-navigation.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';
import type {DiscoveredRun} from '../../src/workflows/run-discovery.js';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends Writable {
  columns = 120;
  rows = 50;
  readonly isTTY = false;
  private output = '';
  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
  readOutput(): string { return this.output; }
  clearOutput(): void { this.output = ''; }
}

const workflow: DiscoveredWorkflow = {
  directoryUrl: new URL('file:///workflows/annotation-transfer/'),
  parameterDefinitions: [],
  manifest: {
    schema_version: 1,
    workflow_version: 1,
    id: 'annotation-transfer',
    label: 'Current annotation label',
    description: 'Transfer annotations.',
    entry_snakefile: 'Snakefile',
    'parameter-definitions': 'manifest.parameters.yaml',
    stages: [],
    artifacts: [],
  },
};

const run: DiscoveredRun = {
  directory: '/research/project/runs/annotation-transfer/run-42',
  metadata: {
    id: 'run-42',
    name: 'Saved run name',
    description: 'Saved run description',
    workflowId: 'annotation-transfer',
    workflowVersion: 1,
    createdAt: '2026-09-05T20:00:00.000Z',
  },
  status: 'incomplete',
  missingLinkedPaths: 0,
  loaded: {
    kind: 'incompatible',
    error: {
      kind: 'missing-summary',
      message: 'Unable to read completion summary: file does not exist',
      path: '/research/project/runs/annotation-transfer/run-42/results/summary.json',
    },
  },
};

async function waitForOutput(output: TestOutput, expected: string): Promise<string> {
  const timeout = Date.now() + 1000;
  while (Date.now() < timeout) {
    const frame = output.readOutput();
    if (frame.includes(expected)) {
      return frame;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${expected}. Received:\n${output.readOutput()}`);
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 30));
}

function namedRuns(count: number): DiscoveredRun[] {
  return Array.from({length: count}, (_, index): DiscoveredRun => ({
    ...run,
    directory: `/research/project/runs/annotation-transfer/run-${String(index + 1)}`,
    metadata: {...run.metadata, id: `run-${String(index + 1)}`, name: `Visible run ${String(index + 1)}`},
  }));
}

function renderScreen(context: TestContext, options: {
  onBack?: () => void;
  deleteRun?: (runDirectory: string) => Promise<void>;
  runs?: DiscoveredRun[];
  rows?: number;
  onHomeSuspension?: (suspension: HomeSuspension | undefined) => void;
} = {}) {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? output.rows;
  let discoveredCollection: string | undefined;
  const instance = render(
    <HomeSuspensionContext.Provider value={(_id, suspension) => options.onHomeSuspension?.(suspension)}>
    <OpenRunScreen
      currentDirectory="/research/project"
      onBack={options.onBack ?? (() => undefined)}
      discoverWorkflows={async () => [workflow]}
      discoverRuns={async collectionRoot => {
        discoveredCollection = collectionRoot;
        return options.runs ?? [run];
      }}
      deleteRun={options.deleteRun}
      formatDateTime={value => `formatted:${value}`}
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
  context.after(() => instance.unmount());
  return {input, output, discoveredCollection: () => discoveredCollection};
}

test('uses the default run collection and opens persisted results without execution', async context => {
  const screen = renderScreen(context);
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  const runFrame = await waitForOutput(screen.output, 'Saved run description');
  assert.equal(screen.discoveredCollection(), '/research/project/runs');
  assert.match(runFrame, /Saved run name/);
  assert.match(runFrame, /formatted:2026-09-05T20:00:00\.000Z/);
  assert.doesNotMatch(runFrame, /run-42/);

  screen.output.clearOutput();
  screen.input.write('\r');
  const resultFrame = await waitForOutput(screen.output, 'Unable to read completion summary');
  assert.match(resultFrame, /run-42/);
  assert.match(resultFrame, /Saved run name/);
  assert.match(resultFrame, /Saved run description/);

  screen.output.clearOutput();
  screen.input.write('\x1b');
  await waitForOutput(screen.output, 'Saved run description');
});

test('deletes a selected run only after explicit confirmation', async context => {
  const deletedDirectories: string[] = [];
  const screen = renderScreen(context, {
    deleteRun: async runDirectory => { deletedDirectories.push(runDirectory); },
  });
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Saved run description');

  screen.input.write('d');
  await settle();
  screen.output.clearOutput();
  screen.input.write('\r');
  await settle();
  assert.deepEqual(deletedDirectories, []);
  assert.doesNotMatch(screen.output.readOutput(), /run-42/);

  screen.input.write('n');
  await settle();
  screen.input.write('\r');
  await waitForOutput(screen.output, 'run-42');
  assert.deepEqual(deletedDirectories, []);

  screen.output.clearOutput();
  screen.input.write('\x1b');
  await waitForOutput(screen.output, 'Saved run description');
  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await settle();
  assert.deepEqual(deletedDirectories, [run.directory]);

  screen.output.clearOutput();
  screen.input.write('\r');
  await settle();
  assert.doesNotMatch(screen.output.readOutput(), /run-42/);
});

test('deletes the selected run and keeps the others', async context => {
  const runs = namedRuns(3);
  const deletedDirectories: string[] = [];
  const screen = renderScreen(context, {
    runs,
    deleteRun: async runDirectory => { deletedDirectories.push(runDirectory); },
  });
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Visible run 3');

  screen.input.write('\x1b[B');
  await settle();
  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await settle();
  assert.deepEqual(deletedDirectories, [runs[1]?.directory]);

  screen.output.clearOutput();
  screen.input.write('\x1b[B');
  const frame = await waitForOutput(screen.output, 'Visible run 3');
  assert.match(frame, /Visible run 1/);
  assert.doesNotMatch(frame, /Visible run 2/);
});

test('keeps a run after a failed deletion and allows a retry', async context => {
  const attempts: string[] = [];
  const screen = renderScreen(context, {
    deleteRun: async runDirectory => {
      attempts.push(runDirectory);
      if (attempts.length === 1) {
        throw new Error('disk is read-only');
      }
    },
  });
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Saved run description');

  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await waitForOutput(screen.output, 'disk is read-only');
  assert.deepEqual(attempts, [run.directory]);

  screen.input.write('y');
  await settle();
  assert.deepEqual(attempts, [run.directory]);

  screen.input.write('\x1b');
  await settle();
  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await settle();
  assert.deepEqual(attempts, [run.directory, run.directory]);
});

test('ignores navigation and repeated confirmation while a deletion is running', async context => {
  let finishDeletion: () => void = () => undefined;
  const attempts: string[] = [];
  let backedOut = false;
  const screen = renderScreen(context, {
    onBack: () => { backedOut = true; },
    deleteRun: runDirectory => {
      attempts.push(runDirectory);
      return new Promise<void>(resolve => { finishDeletion = resolve; });
    },
  });
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Saved run description');

  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await settle();
  screen.output.clearOutput();
  screen.input.write('y');
  screen.input.write('\r');
  screen.input.write('\x1b');
  await settle();
  assert.deepEqual(attempts, [run.directory]);
  assert.doesNotMatch(screen.output.readOutput(), /run-42/);

  screen.input.write('\x1b');
  await settle();
  assert.equal(backedOut, false);
  finishDeletion();
  await settle();
  assert.deepEqual(attempts, [run.directory]);
});

test('keeps the selected run visible in a short terminal', async context => {
  const runs = namedRuns(8);
  const screen = renderScreen(context, {runs, rows: 16});
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Visible run 1');

  for (let index = 0; index < 5; index += 1) {
    screen.input.write('\x1b[B');
  }
  await waitForOutput(screen.output, 'Visible run 6');
  screen.output.clearOutput();
  screen.input.write('\x1b[B');
  const frame = await waitForOutput(screen.output, 'Visible run 7');
  assert.doesNotMatch(frame, /Visible run 1/);

  screen.output.clearOutput();
  screen.input.write('\r');
  await waitForOutput(screen.output, 'run-7');
});

test('returns from workflow selection with Escape', async context => {
  let backedOut = false;
  const screen = renderScreen(context, {onBack: () => { backedOut = true; }});
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\x1b');
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  assert.equal(backedOut, true);
});

test('suspends the home shortcut only while a deletion is running', async context => {
  let finishDeletion: () => void = () => undefined;
  const suspensions: (HomeSuspension | undefined)[] = [];
  const screen = renderScreen(context, {
    onHomeSuspension: suspension => suspensions.push(suspension),
    deleteRun: () => new Promise<void>(resolve => { finishDeletion = resolve; }),
  });
  await waitForOutput(screen.output, 'Current annotation label');
  screen.input.write('\r');
  await waitForOutput(screen.output, 'Saved run description');
  assert.deepEqual(suspensions, []);

  screen.input.write('d');
  await settle();
  screen.input.write('y');
  await settle();
  assert.deepEqual(suspensions, ['busy']);

  finishDeletion();
  await settle();
  assert.deepEqual(suspensions, ['busy', undefined]);
});
