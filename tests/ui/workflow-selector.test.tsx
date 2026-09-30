import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  useWorkflowSelection,
  WorkflowSelector,
  type WorkflowDiscovery,
} from '../../src/ui/components/workflow-selector.js';
import type {Document} from '../../src/docs/documents.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends Writable {
  columns = 100;
  rows = 40;
  readonly isTTY = false;
  override _write(_chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
}

const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ENTER = '\r';
const ESCAPE = '\x1b';

function workflow(id: string): DiscoveredWorkflow {
  return {
    directoryUrl: new URL(`file:///workflows/${id}/`),
    parameterDefinitions: [],
    manifest: {
      schema_version: 1,
      workflow_version: 1,
      id,
      label: `Label for ${id}`,
      description: `Description for ${id}.`,
      entry_snakefile: 'Snakefile',
      'parameter-definitions': 'manifest.parameters.yaml',
      stages: [],
      artifacts: [],
    },
  };
}

const threeWorkflows: WorkflowDiscovery = async () => [workflow('first'), workflow('second'), workflow('third')];

function Harness({
  discoverWorkflows,
  preferredWorkflowId,
  onSelect,
  onBack,
  inputActive,
  loadDocuments,
}: {
  loadDocuments?: (workflow: DiscoveredWorkflow) => Promise<Document[]>;
  discoverWorkflows: WorkflowDiscovery;
  preferredWorkflowId?: string;
  onSelect: (workflow: DiscoveredWorkflow) => void;
  onBack: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const selection = useWorkflowSelection(discoverWorkflows, preferredWorkflowId);
  return (
    <WorkflowSelector
      title="Choose"
      selection={selection}
      selectHint="Continue"
      onSelect={onSelect}
      onBack={onBack}
      inputActive={inputActive}
      {...(loadDocuments ? {loadDocuments} : {})}
    />
  );
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 30));
}

function renderSelector(context: TestContext, options: {
  discoverWorkflows?: WorkflowDiscovery;
  preferredWorkflowId?: string;
  inputActive?: boolean;
  loadDocuments?: (workflow: DiscoveredWorkflow) => Promise<Document[]>;
} = {}) {
  const input = new TestInput();
  const selected: string[] = [];
  let backCount = 0;
  const instance = render(
    <Harness
      discoverWorkflows={options.discoverWorkflows ?? threeWorkflows}
      preferredWorkflowId={options.preferredWorkflowId}
      onSelect={value => selected.push(value.manifest.id)}
      onBack={() => { backCount += 1; }}
      inputActive={options.inputActive ?? true}
      {...(options.loadDocuments ? {loadDocuments: options.loadDocuments} : {})}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: new TestOutput() as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  const press = async (key: string): Promise<void> => {
    input.write(key);
    await settle();
  };
  return {press, selected, backCount: () => backCount};
}

test('selects the first discovered workflow by default', async context => {
  const selector = renderSelector(context);
  await settle();
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, ['first']);
});

test('moves the selection with wrap-around in both directions', async context => {
  const selector = renderSelector(context);
  await settle();
  await selector.press(ARROW_DOWN);
  await selector.press(ENTER);
  await selector.press(ARROW_UP);
  await selector.press(ARROW_UP);
  await selector.press(ENTER);
  await selector.press(ARROW_DOWN);
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, ['second', 'third', 'first']);
});

test('starts at a preferred workflow when discovery contains it', async context => {
  const selector = renderSelector(context, {preferredWorkflowId: 'third'});
  await settle();
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, ['third']);
});

test('falls back to the first workflow when the preferred one is not discovered', async context => {
  const selector = renderSelector(context, {preferredWorkflowId: 'removed'});
  await settle();
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, ['first']);
});

test('reports Escape as a back request', async context => {
  const selector = renderSelector(context);
  await settle();
  await selector.press(ESCAPE);
  assert.equal(selector.backCount(), 1);
  assert.deepEqual(selector.selected, []);
});

test('allows only going back while discovery is pending', async context => {
  const selector = renderSelector(context, {discoverWorkflows: () => new Promise(() => undefined)});
  await settle();
  await selector.press(ENTER);
  await selector.press(ESCAPE);
  assert.deepEqual(selector.selected, []);
  assert.equal(selector.backCount(), 1);
});

test('allows only going back after discovery fails', async context => {
  const selector = renderSelector(context, {
    discoverWorkflows: async () => { throw new Error('duplicate workflow ID'); },
  });
  await settle();
  await selector.press(ARROW_DOWN);
  await selector.press(ENTER);
  await selector.press(ESCAPE);
  assert.deepEqual(selector.selected, []);
  assert.equal(selector.backCount(), 1);
});

test('selects nothing when no workflows are discovered', async context => {
  const selector = renderSelector(context, {discoverWorkflows: async () => []});
  await settle();
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, []);
});

test('ignores input while inactive', async context => {
  const selector = renderSelector(context, {inputActive: false});
  await settle();
  await selector.press(ENTER);
  await selector.press(ESCAPE);
  assert.deepEqual(selector.selected, []);
  assert.equal(selector.backCount(), 0);
});

test('opens the highlighted workflow\'s documentation and returns to the list', async context => {
  const documented: string[] = [];
  const selector = renderSelector(context, {
    loadDocuments: async value => {
      documented.push(value.manifest.id);
      return [];
    },
  });
  await settle();
  await selector.press(ARROW_DOWN);
  await selector.press('?');
  assert.deepEqual(documented, ['second']);
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, [], 'the documentation owns the keys while open');
  await selector.press(ESCAPE);
  await new Promise<void>(resolve => setTimeout(resolve, 100));
  assert.equal(selector.backCount(), 0, 'Esc closes the documentation, not the selector');
  await selector.press(ENTER);
  assert.deepEqual(selector.selected, ['second']);
});
