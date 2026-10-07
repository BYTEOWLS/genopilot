import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  formatTerminalTitle,
  TerminalTitleProvider,
  terminalTitleStatusIcons,
  useTerminalTitle,
  type TerminalTitleContribution,
} from '../../src/ui/terminal-title.js';
import {NewRunScreen} from '../../src/ui/new-run-screen/screen.js';
import {
  WorkflowExecutionScreen,
  type WorkflowRunResult,
} from '../../src/ui/new-run-screen/workflow-execution.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';

const baseTitle = 'Base title';

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
  columns = 120;
  rows = 40;
  readonly isTTY = false;
  output = '';
  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString();
    callback();
  }
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

function renderWithTitle(
  context: TestContext,
  element: React.JSX.Element,
): {input: TestInput; output: TestOutput; titles: string[]; rerender: (next: React.JSX.Element) => void} {
  const input = new TestInput();
  const output = new TestOutput();
  const titles: string[] = [];
  const wrap = (child: React.JSX.Element): React.JSX.Element => (
    <TerminalTitleProvider baseTitle={baseTitle} onTitleChange={title => void titles.push(title)}>
      {child}
    </TerminalTitleProvider>
  );
  const instance = render(wrap(element), {
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  context.after(() => instance.unmount());
  return {input, output, titles, rerender: next => instance.rerender(wrap(next))};
}

const lastTitle = (titles: readonly string[]): string | undefined => titles[titles.length - 1];

test('places the most specific label first and shows the innermost status icon', () => {
  const contributions: TerminalTitleContribution[] = [
    {label: 'Outer'},
    {status: 'running'},
    {label: '  '},
    {label: 'Inner'},
  ];
  const title = formatTerminalTitle(baseTitle, contributions);
  assert.ok(title.startsWith(`${terminalTitleStatusIcons.running} `));
  assert.ok(title.indexOf('Inner') < title.indexOf('Outer'));
  assert.ok(title.indexOf('Outer') < title.indexOf(baseTitle));
  assert.equal(formatTerminalTitle(baseTitle, []), baseTitle);
});

function Contributor({
  label,
  status,
  children,
}: TerminalTitleContribution & {children?: React.ReactNode}): React.JSX.Element {
  useTerminalTitle({label, status});
  return <>{children}</>;
}

test('orders contributions by nesting and removes them on unmount', async context => {
  const view = renderWithTitle(
    context,
    <Contributor label="Outer">
      <Contributor label="Inner" />
    </Contributor>,
  );
  const nested = formatTerminalTitle(baseTitle, [{label: 'Outer'}, {label: 'Inner'}]);
  await waitUntil(() => lastTitle(view.titles) === nested, 'the nested title is published');

  view.rerender(
    <Contributor label="Outer">
      <Contributor label="Changed" status="running" />
    </Contributor>,
  );
  const changed = formatTerminalTitle(baseTitle, [
    {label: 'Outer'},
    {label: 'Changed', status: 'running'},
  ]);
  await waitUntil(() => lastTitle(view.titles) === changed, 'the changed title is published');
  // A contribution that changes is replaced in one step, never shown partially removed.
  assert.ok(!view.titles.includes(formatTerminalTitle(baseTitle, [{label: 'Outer'}])));

  view.rerender(<Contributor label="Outer" />);
  await waitUntil(
    () => lastTitle(view.titles) === formatTerminalTitle(baseTitle, [{label: 'Outer'}]),
    'the inner contribution is removed',
  );
});

function discoveredWorkflow(id: string, label: string): DiscoveredWorkflow {
  return {
    directoryUrl: new URL(`file:///workflows/${id}/`),
    manifest: {
      schema_version: 1,
      workflow_version: 1,
      id,
      label,
      description: `Description of ${id}.`,
      entry_snakefile: 'Snakefile',
      'parameter-definitions': 'manifest.parameters.yaml',
      stages: [{id: 'prepare', label: 'Prepare'}],
      artifacts: [],
    },
    parameterDefinitions: [],
  };
}

test('adds the selected workflow label to the title until the selection is left', async context => {
  const view = renderWithTitle(
    context,
    <NewRunScreen
      onBack={() => {}}
      onSelectedWorkflowIdChange={() => {}}
      discoverWorkflows={async () => [discoveredWorkflow('placeholder-workflow', 'Workflow label')]}
      currentDirectory="/research"
      genopilot={{version: '1.2.3'}}
    />,
  );
  await waitUntil(() => view.output.output.includes('Description of placeholder-workflow.'), 'workflows are listed');
  assert.equal(lastTitle(view.titles), baseTitle);

  view.input.write('\r');
  const selected = formatTerminalTitle(baseTitle, [{label: 'Workflow label'}]);
  await waitUntil(() => lastTitle(view.titles) === selected, 'the workflow label is shown');

  view.input.write('\x1b');
  await waitUntil(() => lastTitle(view.titles) === baseTitle, 'the workflow label is removed');
});

function renderExecution(
  context: TestContext,
  exitCode: number | null,
): {view: ReturnType<typeof renderWithTitle>; releaseRun: () => void} {
  let releaseRun = (): void => {};
  const released = new Promise<void>(resolve => {
    releaseRun = resolve;
  });
  const view = renderWithTitle(
    context,
    <WorkflowExecutionScreen
      configurationPath="/run/config.yaml"
      prepareRun={mode => ({
        mode,
        command: `/managed/snakemake ${mode}`,
        stdoutLogPath: `/run/${mode}.stdout.log`,
        stderrLogPath: `/run/${mode}.stderr.log`,
      })}
      executeRun={async (run): Promise<WorkflowRunResult> => {
        await released;
        return {...run, exitCode};
      }}
      onBack={() => {}}
      inputActive
    />,
  );
  return {view, releaseRun};
}

for (const [exitCode, outcome] of [
  [0, 'succeeded'],
  [1, 'failed'],
] as const) {
  test(`marks the title while Snakemake runs and keeps the ${outcome} outcome`, async context => {
    const {view, releaseRun} = renderExecution(context, exitCode);
    await waitUntil(() => view.output.output.includes('/managed/snakemake'), 'start options are shown');
    assert.equal(lastTitle(view.titles), baseTitle);

    view.input.write('\r');
    const running = formatTerminalTitle(baseTitle, [{status: 'running'}]);
    await waitUntil(() => lastTitle(view.titles) === running, 'the running mark is shown');

    releaseRun();
    const finished = formatTerminalTitle(baseTitle, [{status: outcome}]);
    await waitUntil(() => lastTitle(view.titles) === finished, `the ${outcome} mark is shown`);

    // Leaving the finished dry run for the start options clears the outcome.
    view.input.write('\x1b');
    await waitUntil(() => lastTitle(view.titles) === baseTitle, 'the outcome mark is cleared');
  });
}
