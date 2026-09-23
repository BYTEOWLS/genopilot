import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {render} from 'ink';
import {WelcomeScreen, type CliMetadata} from '../../src/ui/welcome-screen.js';
import type {ToolingStatus} from '../../src/tooling/check.js';
import {
  ToolingInstallationError,
  type InstallationProgress,
  type InstallationResult,
} from '../../src/tooling/installer.js';
import {resolveToolingPaths} from '../../src/tooling/paths.js';
import {
  welcomeCommands,
  type CommandDefinition,
  type WelcomeCommandId,
} from '../../src/ui/welcome-screen/commands/definitions.js';
import type {RunDiscovery} from '../../src/ui/open-run-screen/screen.js';
import type {WorkflowDiscovery} from '../../src/ui/workflow-selector.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';
import type {WorkflowParameterDefinition} from '../../src/workflows/parameter-definitions.js';
import type {UpdateAvailability} from '../../src/self-update.js';

const metadata: CliMetadata = {
  packageName: '@byteowls/genopilot',
  label: 'Genopilot',
  commandName: 'genopilot',
  description: 'Run selected genomic workflows.',
  author: 'Test Author',
  version: '0.8.0',
};

function discoveredWorkflow(
  id: string,
  label: string,
  description: string,
  parameterDefinitions: WorkflowParameterDefinition[] = [],
): DiscoveredWorkflow {
  return {
    directoryUrl: new URL(`file:///workflows/${id}/`),
    manifest: {
      schema_version: 1,
      workflow_version: 1,
      id,
      label,
      description,
      entry_snakefile: 'Snakefile',
      'parameter-definitions': 'manifest.parameters.yaml',
      stages: [{id: 'prepare', label: 'Prepare'}],
      artifacts: [],
    },
    parameterDefinitions,
  };
}

const detectedStatus: ToolingStatus = {
  state: 'ready',
  node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
  pixi: {
    state: 'available',
    detected: {command: 'pixi', version: 'pixi 0.79.0'},
  },
  conda: {
    state: 'available',
    detected: {command: 'conda', version: 'conda 25.11.1'},
  },
  snakemake: {
    state: 'available',
    detected: {command: 'snakemake', version: '9.26.1'},
  },
};

function commandsFor(...ids: WelcomeCommandId[]): readonly CommandDefinition<WelcomeCommandId>[] {
  return ids.map(id => {
    const command = welcomeCommands.find(candidate => candidate.id === id);
    assert.ok(command, `Unknown command ID: ${id}`);
    return command;
  });
}

const newRunOnlyCommands = commandsFor('new-run');
const openRunOnlyCommands = commandsFor('open-run');
const ncbiAccessOnlyCommands = commandsFor('ncbi-access');
const toolingOnlyCommands = commandsFor('check-tooling');

/** Simulates the TTY input stream that Ink expects during interactive tests. */
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

/** Captures Ink output while exposing configurable terminal dimensions. */
class TestOutput extends Writable {
  columns: number;
  rows: number;
  readonly isTTY = false;
  private output = '';

  constructor(columns: number, rows = 50) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

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

/** Creates a deterministic replacement for the real asynchronous tooling check. */
function resolvedTooling(status: ToolingStatus): () => Promise<ToolingStatus> {
  return () => Promise.resolve(status);
}

/** Renders the component against fake terminal streams for one test. */
function renderWelcome(
  status: ToolingStatus,
  options: {
    columns?: number;
    rows?: number;
    exitConfirmationMilliseconds?: number;
    toolingCheck?: () => Promise<ToolingStatus>;
    toolingInstaller?: (
      onProgress: (progress: InstallationProgress) => void,
      signal?: AbortSignal,
    ) => Promise<InstallationResult>;
    commands?: readonly CommandDefinition<WelcomeCommandId>[];
    workflowDiscovery?: WorkflowDiscovery;
    runDiscovery?: RunDiscovery;
    onWorkflowSelected?: (workflowId: string) => void;
    ncbiApiKeyPath?: string;
    checkNcbiApiKeyConfigured?: () => Promise<boolean>;
    saveNcbiApiKey?: (key: string) => Promise<void>;
    clearStoredNcbiApiKey?: () => Promise<void>;
    updateCheck?: () => Promise<UpdateAvailability>;
  } = {},
): {
  input: TestInput;
  instance: ReturnType<typeof render>;
  output: TestOutput;
} {
  const input = new TestInput();
  const output = new TestOutput(options.columns ?? 80, options.rows);
  const instance = render(
    <WelcomeScreen
      metadata={metadata}
      currentDirectory="/research/project"
      toolingCheck={options.toolingCheck ?? resolvedTooling(status)}
      toolingInstaller={options.toolingInstaller}
      exitConfirmationMilliseconds={options.exitConfirmationMilliseconds}
      commands={options.commands}
      workflowDiscovery={options.workflowDiscovery}
      runDiscovery={options.runDiscovery}
      onWorkflowSelected={options.onWorkflowSelected}
      ncbiApiKeyPath={options.ncbiApiKeyPath}
      checkNcbiApiKeyConfigured={options.checkNcbiApiKeyConfigured}
      saveNcbiApiKey={options.saveNcbiApiKey}
      clearStoredNcbiApiKey={options.clearStoredNcbiApiKey}
      updateCheck={options.updateCheck ?? (async () => ({state: 'current'}))}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );

  return {input, instance, output};
}

/** Waits until an injected dependency observes an expected interaction. */
async function waitFor(condition: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() > timeoutAt) {
      assert.fail('Timed out waiting for condition.');
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
}

/** Ensures each test unmounts React and releases Ink's event listeners. */
function registerCleanup(context: TestContext, instance: ReturnType<typeof render>): void {
  context.after(() => instance.unmount());
}

/** Waits for an asynchronous React render to write an expected terminal frame. */
async function waitForOutput(
  output: TestOutput,
  predicate: (value: string) => boolean,
): Promise<string> {
  const timeoutAt = Date.now() + 1000;

  while (Date.now() < timeoutAt) {
    const value = output.readOutput();
    if (predicate(value)) {
      return value;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }

  assert.fail(`Timed out waiting for terminal output. Received:\n${output.readOutput()}`);
}

test('renders identity, directory, and commands without the ready tooling list', async context => {
  const {instance, output} = renderWelcome(detectedStatus);
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  assert.match(frame, /Genopilot/);
  assert.match(frame, /v0\.8\.0/);
  assert.match(frame, /Run selected genomic workflows\./);
  assert.match(frame, /Author: Test Author/);
  assert.match(frame, /Current directory: \/research\/project/);
  assert.doesNotMatch(frame, /Required tooling/);
  assert.doesNotMatch(frame, /Node — Runtime|Pixi — Provisioning|Conda — Environments|Snakemake — Workflow/);
  assert.doesNotMatch(frame, /Set up tooling|Source:|SHA-256:|Destination:/);
});

test('shows a non-blocking update notice when a newer release is available', async context => {
  const {instance, output} = renderWelcome(detectedStatus, {
    updateCheck: async () => ({state: 'available', latestVersion: '0.9.0'}),
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('Update available:'));
  assert.match(frame, /⚠ Update available: v0\.9\.0 — run `genopilot update`/);
});

test('hides failed advisory update checks', async context => {
  const {instance, output} = renderWelcome(detectedStatus, {
    updateCheck: async () => {
      throw new Error('registry unavailable');
    },
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  assert.doesNotMatch(frame, /Update available|registry unavailable/);
});

test('discovers, presents, and chooses workflows by stable ID in the new-run flow', async context => {
  let discoveryCalls = 0;
  const selectedWorkflowIds: string[] = [];
  const workflowDiscovery = async (): Promise<DiscoveredWorkflow[]> => {
    discoveryCalls += 1;
    const renamed = discoveryCalls > 1 ? 'Renamed ' : '';
    return [
      discoveredWorkflow(
        'first-workflow',
        `${renamed}First workflow`,
        'Description for the first workflow.',
      ),
      discoveredWorkflow(
        'second-workflow',
        `${renamed}Second workflow`,
        'Description for the second workflow.',
      ),
    ];
  };
  const commandLabel = 'Injected new-run command';
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: newRunOnlyCommands.map(command => ({...command, label: commandLabel})),
    workflowDiscovery,
    onWorkflowSelected: workflowId => selectedWorkflowIds.push(workflowId),
  });
  registerCleanup(context, instance);
  const showsWorkflows = (value: string): boolean =>
    value.includes('Description for the first workflow.')
    && value.includes('Description for the second workflow.');
  await waitForOutput(output, value => value.includes(commandLabel));

  output.clearOutput();
  input.write('\r');
  await waitForOutput(output, showsWorkflows);
  assert.equal(discoveryCalls, 1);

  output.clearOutput();
  input.write('\x1b[B');
  await waitForOutput(output, value => value.length > 0);

  // Input is ignored while the terminal is too narrow, and resizing neither rediscovers nor
  // resets the highlighted workflow.
  output.clearOutput();
  output.columns = 35;
  output.emit('resize');
  await waitForOutput(output, value => value.length > 0 && !showsWorkflows(value));
  input.write('\x1b[A');
  output.clearOutput();
  output.columns = 80;
  output.emit('resize');
  await waitForOutput(output, showsWorkflows);
  assert.equal(discoveryCalls, 1);

  input.write('\r');
  await waitFor(() => selectedWorkflowIds.length === 1);
  assert.deepEqual(selectedWorkflowIds, ['second-workflow']);

  output.clearOutput();
  input.write('\x1b');
  await waitForOutput(output, showsWorkflows);
  output.clearOutput();
  input.write('\x1b');
  await waitForOutput(output, value => value.includes(commandLabel));

  // Reopening rediscovers and keeps the previously chosen workflow highlighted by ID.
  output.clearOutput();
  input.write('\r');
  await waitForOutput(output, value => value.includes('Renamed Second workflow'));
  input.write('\r');
  await waitFor(() => selectedWorkflowIds.length === 2);
  assert.deepEqual(selectedWorkflowIds, ['second-workflow', 'second-workflow']);
  assert.equal(discoveryCalls, 2);
});

test('opens annotation-transfer configuration by stable workflow ID', async context => {
  const workflowDiscovery = async (): Promise<DiscoveredWorkflow[]> => [
    discoveredWorkflow(
      'annotation-transfer',
      'Renamed annotation workflow',
      'Configure the annotation transfer.',
      [
        {
          id: 'reference-fasta',
          label: 'Reference FASTA',
          section: 'Inputs',
          kind: 'file',
          required: true,
          hidden: false,
          default: null,
        },
        {
          id: 'cpu-allocation',
          label: 'CPU allocation',
          section: 'Resources',
          kind: 'choice',
          required: true,
          hidden: false,
          default: 'automatic',
          options: [{value: 'automatic', label: 'Automatic (all available CPUs)'}],
        },
      ],
    ),
  ];
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: newRunOnlyCommands,
    workflowDiscovery,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('\r');
  await waitForOutput(output, value => value.includes('Select a workflow'));
  input.write('\r');
  // The form shows the discovered workflow's own parameters, not a packaged copy of them.
  const configurationFrame = await waitForOutput(output, value => value.includes('Reference FASTA'));
  assert.match(configurationFrame, /Inputs/);
  assert.match(configurationFrame, /\(●\) Automatic \(all available CPUs\)/);
  assert.doesNotMatch(configurationFrame, /LiftOn profile/);

  input.write('/partial/reference.fa');
  await waitForOutput(output, value => value.includes('/partial/reference.fa'));
  output.clearOutput();
  output.columns = 35;
  output.emit('resize');
  await waitForOutput(output, value => value.includes('This terminal is too narrow.'));
  input.write('x');
  output.clearOutput();
  output.columns = 80;
  output.emit('resize');
  const restoredFrame = await waitForOutput(output, value => value.includes('/partial/reference.fa'));
  assert.doesNotMatch(restoredFrame, /\/partial\/reference\.fax/);
});

test('returns from a workflow-discovery failure', async context => {
  const workflowDiscovery = async (): Promise<DiscoveredWorkflow[]> => {
    throw new Error('duplicate workflow ID');
  };
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: newRunOnlyCommands,
    workflowDiscovery,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  output.clearOutput();
  input.write('\r');
  const failedFrame = await waitForOutput(output, value =>
    value.includes('Workflow discovery failed.'),
  );
  assert.match(failedFrame, /duplicate workflow ID/);
  assert.match(failedFrame, /Esc — Back/);

  output.clearOutput();
  input.write('\x1b');
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));
});

test('opens the existing-run flow from the welcome command', async context => {
  let workflowDiscoveryCalls = 0;
  const runDiscoveries: {collectionRoot: string; workflowId: string}[] = [];
  const commandLabel = 'Injected open-run command';
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: openRunOnlyCommands.map(command => ({...command, label: commandLabel})),
    workflowDiscovery: async () => {
      workflowDiscoveryCalls += 1;
      return [discoveredWorkflow('saved-workflow', 'Saved workflow', 'Description for the saved workflow.')];
    },
    runDiscovery: async (collectionRoot, workflow) => {
      runDiscoveries.push({collectionRoot, workflowId: workflow.manifest.id});
      return [];
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes(commandLabel));

  input.write('\r');
  await waitFor(() => workflowDiscoveryCalls === 1);
  await waitForOutput(output, value => value.includes('Description for the saved workflow.'));
  input.write('\r');
  await waitFor(() => runDiscoveries.length === 1);
  assert.deepEqual(runDiscoveries, [{collectionRoot: '/research/project/runs', workflowId: 'saved-workflow'}]);

  // Escape leaves the runs, then the workflows; reopening the command discovers workflows again.
  output.clearOutput();
  input.write('\x1b');
  await waitForOutput(output, value => value.includes('Description for the saved workflow.'));
  output.clearOutput();
  input.write('\x1b');
  await waitForOutput(output, value => value.includes(commandLabel));
  input.write('\r');
  await waitFor(() => workflowDiscoveryCalls === 2);
});

test('opens and navigates away from the ncbi-access command', async context => {
  let saved: string | undefined;
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: ncbiAccessOnlyCommands,
    ncbiApiKeyPath: '/researcher/data/secrets/ncbi-api-key',
    checkNcbiApiKeyConfigured: async () => false,
    saveNcbiApiKey: async key => {
      saved = key;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('\r');

  const screenFrame = await waitForOutput(output, value => value.includes('API key: Not set'));
  assert.match(screenFrame, /Saved to:\s+\/researcher\/data\/secrets\/ncbi-api-key/);
  input.write('a-key');
  await waitForOutput(output, value => value.includes('New key: *****'));
  input.write('\r');
  await waitForOutput(output, value => value.includes('NCBI API key saved.'));
  assert.equal(saved, 'a-key');

  output.clearOutput();
  input.write('\x1b');
  const welcomeFrame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  assert.match(welcomeFrame, /Commands/);
});

test('opens the tooling screen and runs a fresh check there', async context => {
  let checks = 0;
  const toolingCheck = async (): Promise<ToolingStatus> => {
    checks += 1;
    return detectedStatus;
  };
  const {input, instance, output} = renderWelcome(detectedStatus, {
    toolingCheck,
    commands: toolingOnlyCommands,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  output.clearOutput();
  input.write('\r');

  const toolingFrame = await waitForOutput(output, value => value.includes('R/Enter — Check tooling'));
  assert.equal(checks, 1);
  assert.match(toolingFrame, /Required tooling/);
  assert.match(toolingFrame, /✓ Node — Runtime — v24\.19\.0 — Available/);
  assert.match(toolingFrame, /✓ Pixi — Provisioning — v0\.79\.0 — Available/);
  assert.match(toolingFrame, /✓ Conda — Environments — v25\.11\.1 — Available/);
  assert.match(toolingFrame, /✓ Snakemake — Workflow — v9\.26\.1 — Available/);
  assert.doesNotMatch(toolingFrame, /Commands/);

  input.write('\r');
  const checkedFrame = await waitForOutput(output, value =>
    value.includes('Tooling check complete. All required tools are available.'),
  );
  assert.equal(checks, 2);
  assert.match(checkedFrame, /✔ Tooling check complete/);

  output.clearOutput();
  input.write('\x1b');
  const welcomeFrame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  assert.match(welcomeFrame, /Commands/);
  assert.doesNotMatch(welcomeFrame, /Node — Runtime|Tooling check complete/);
});

test('runs a command by ID when its display label changes', async context => {
  let checks = 0;
  const toolingCheck = async (): Promise<ToolingStatus> => {
    checks += 1;
    return detectedStatus;
  };
  const renamedCommands = toolingOnlyCommands.map(command => ({
    ...command,
    label: 'Arbitrary presentation label',
  }));
  const {input, instance, output} = renderWelcome(detectedStatus, {
    toolingCheck,
    commands: renamedCommands,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('\r');
  await waitForOutput(output, value => value.includes('R/Enter — Check tooling'));
  input.write('\r');

  const checkedFrame = await waitForOutput(output, value =>
    value.includes('Tooling check complete. All required tools are available.'),
  );
  assert.equal(checks, 2);
  assert.doesNotMatch(checkedFrame, /Coming soon/);
});

test('clears a completed tooling-check message when returning to the command menu', async context => {
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: toolingOnlyCommands,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('\r');
  await waitForOutput(output, value => value.includes('R/Enter — Check tooling'));
  input.write('\r');
  await waitForOutput(output, value =>
    value.includes('Tooling check complete. All required tools are available.'),
  );

  output.clearOutput();
  input.write('\x1b');
  const commandFrame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  assert.doesNotMatch(
    commandFrame,
    /Tooling check complete\. All required tools are available\./,
  );
});

test('returns home with h from a nested screen in one press', async context => {
  let workflowDiscoveryCalls = 0;
  const runDiscoveries: string[] = [];
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: openRunOnlyCommands,
    workflowDiscovery: async () => {
      workflowDiscoveryCalls += 1;
      return [discoveredWorkflow('saved-workflow', 'Saved workflow', 'Description for the saved workflow.')];
    },
    runDiscovery: async (_collectionRoot, workflow) => {
      runDiscoveries.push(workflow.manifest.id);
      return [];
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('\r');
  await waitForOutput(output, value => value.includes('Description for the saved workflow.'));
  input.write('\r');
  await waitFor(() => runDiscoveries.length === 1);

  output.clearOutput();
  input.write('h');
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  // The command reopens from its start, so the nested state was left rather than hidden.
  input.write('\r');
  await waitFor(() => workflowDiscoveryCalls === 2);
});

test('leaves h to a focused text field and returns home from a choice field', async context => {
  const workflowDiscovery = async (): Promise<DiscoveredWorkflow[]> => [
    discoveredWorkflow('annotation-transfer', 'Annotation workflow', 'Configure it.', [
      {
        id: 'annotation-prefix',
        label: 'Annotation prefix',
        section: 'Inputs',
        kind: 'text',
        required: true,
        hidden: false,
        default: null,
      },
      {
        id: 'cpu-allocation',
        label: 'CPU allocation',
        section: 'Resources',
        kind: 'choice',
        required: true,
        hidden: false,
        default: 'automatic',
        options: [{value: 'automatic', label: 'Automatic'}],
      },
    ]),
  ];
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: newRunOnlyCommands,
    workflowDiscovery,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  input.write('\r');
  await waitForOutput(output, value => value.includes('Configure it.'));
  input.write('\r');
  await waitForOutput(output, value => value.includes('Annotation prefix'));

  input.write('x');
  await waitForOutput(output, value => value.includes('Annotation prefix*: x'));
  // Written separately so the field receives `h` as its own keypress, like a typed letter.
  input.write('h');
  await waitForOutput(output, value => value.includes('Annotation prefix*: xh'));

  input.write('\t');
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  output.clearOutput();
  input.write('h');
  await waitForOutput(output, value => value.includes('↑/↓ — Select · Enter — Open'));
});

test('types h into the NCBI key instead of returning home', async context => {
  let saved: string | undefined;
  const {input, instance, output} = renderWelcome(detectedStatus, {
    commands: ncbiAccessOnlyCommands,
    checkNcbiApiKeyConfigured: async () => false,
    saveNcbiApiKey: async key => {
      saved = key;
    },
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  input.write('\r');
  await waitForOutput(output, value => value.includes('API key: Not set'));

  input.write('h');
  await waitForOutput(output, value => value.includes('New key: *'));
  input.write('\r');
  await waitFor(() => saved !== undefined);
  assert.equal(saved, 'h');
});

test('offers setup choices instead of commands when tooling is missing', async context => {
  const {instance, output} = renderWelcome({
    state: 'setup-required',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {
      state: 'available',
      detected: {command: 'pixi', version: 'pixi 0.79.0'},
    },
    conda: {
      state: 'available',
      detected: {command: 'conda', version: 'conda 25.11.1'},
    },
    snakemake: {state: 'missing'},
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value =>
    value.includes('Install missing tooling now? [Y/n]'),
  );

  assert.match(frame, /Required tooling: Setup required/);
  assert.doesNotMatch(frame, /Tooling: Setup required/);
  assert.match(frame, /✓ Node — Runtime — v24\.19\.0 — Available/);
  assert.match(frame, /✓ Pixi — Provisioning — v0\.79\.0 — Available/);
  assert.match(frame, /✓ Conda — Environments — v25\.11\.1 — Available/);
  assert.match(frame, /○ Snakemake — Workflow — v9\.26\.1 — Not detected/);
  assert.doesNotMatch(frame, />=9\.26\.1|<10\.0\.0/);
  assert.match(frame, /Install missing tooling now\? \[Y\/n\]/);
  assert.match(frame, /Yes \(Y\) is the default\./);
  assert.doesNotMatch(frame, /Source:|SHA-256:|Destination:/);
  assert.doesNotMatch(frame, /Automatic installation is coming soon/);
  assert.doesNotMatch(frame, /↑\/↓ — Select · Enter — Open/);
});

test('starts installation only after affirmative consent and shows progress', async context => {
  const setupRequired: ToolingStatus = {
    state: 'setup-required',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'missing'},
    conda: {state: 'missing'},
    snakemake: {state: 'missing'},
  };
  let installationCalls = 0;
  let finishInstallation: ((result: InstallationResult) => void) | undefined;
  const toolingInstaller = (onProgress: (progress: InstallationProgress) => void) => {
    installationCalls += 1;
    onProgress({type: 'phase', phase: 'pixi', tools: ['pixi']});
    onProgress({type: 'log', text: 'Downloading Pixi…\nChecking archive…'});
    return new Promise<InstallationResult>(resolve => {
      finishInstallation = resolve;
    });
  };
  const {input, instance, output} = renderWelcome(setupRequired, {toolingInstaller});
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('Install missing tooling now?'));
  assert.equal(installationCalls, 0);

  input.write('y');
  const installingFrame = await waitForOutput(output, value => value.includes('Installing…'));
  assert.equal(installationCalls, 1);
  assert.match(installingFrame, /Pixi — Provisioning — v0\.79\.0 — Installing…/);
  assert.match(installingFrame, /Installation log/);
  assert.match(installingFrame, /Downloading Pixi…\n\s+Checking archive…/);
  assert.match(installingFrame, /─/);

  finishInstallation?.({
    logPath: '/logs/tooling-setup.log',
    paths: resolveToolingPaths(),
  });
  const completedFrame = await waitForOutput(
    output,
    value => value.includes('Setup log: /logs/tooling-setup.log'),
  );
  assert.match(completedFrame, /Setup log: \/logs\/tooling-setup\.log/);
});

test('returns to setup after an installation failure and shows the log', async context => {
  const setupRequired: ToolingStatus = {
    state: 'setup-required',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'missing'},
    conda: {state: 'missing'},
    snakemake: {state: 'missing'},
  };
  const toolingInstaller = async () => {
    throw new ToolingInstallationError('Checksum verification failed', '/logs/failed.log');
  };
  const {input, instance, output} = renderWelcome(setupRequired, {toolingInstaller});
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('Install missing tooling now?'));

  input.write('\r');
  const frame = await waitForOutput(output, value => value.includes('Setup failed:'));

  assert.match(frame, /Setup failed: Checksum verification failed/);
  assert.match(frame, /Log: \/logs\/failed\.log/);
  assert.match(frame, /Install missing tooling now\? \[Y\/n\]/);
});

test('shows tooling-check failures and allows a retry', async context => {
  let checks = 0;
  const toolingCheck = async (): Promise<ToolingStatus> => {
    checks += 1;
    if (checks === 1) {
      throw new Error('check failed\u001b[31m');
    }
    return detectedStatus;
  };
  const {input, instance, output} = renderWelcome(detectedStatus, {toolingCheck});
  registerCleanup(context, instance);
  const failedFrame = await waitForOutput(output, value => value.includes('Tooling check failed'));
  assert.match(failedFrame, /Tooling check failed: check failed\[31m/);
  assert.doesNotMatch(failedFrame, /check failed\u001b\[31m/);

  input.write('r');
  const readyFrame = await waitForOutput(output, value => value.includes('↑/↓ — Select'));
  assert.equal(checks, 2);
  assert.doesNotMatch(readyFrame, /Required tooling|Node — Runtime/);
});

test('cancels an active installation before exiting', async context => {
  const setupRequired: ToolingStatus = {
    state: 'setup-required',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'missing'},
    conda: {state: 'missing'},
    snakemake: {state: 'missing'},
  };
  let cancelled = false;
  const toolingInstaller = (
    onProgress: (progress: InstallationProgress) => void,
    signal?: AbortSignal,
  ) => {
    onProgress({type: 'phase', phase: 'pixi', tools: ['pixi']});
    return new Promise<InstallationResult>((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          cancelled = true;
          reject(new ToolingInstallationError('Tooling setup cancelled.', '/logs/cancelled.log'));
        },
        {once: true},
      );
    });
  };
  const {input, instance, output} = renderWelcome(setupRequired, {toolingInstaller});
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('Install missing tooling now?'));
  input.write('y');
  await waitForOutput(output, value => value.includes('Installing…'));

  input.write('\x03');
  await waitForOutput(output, value => value.includes('Press Ctrl+C again to exit.'));
  input.write('\x03');
  await instance.waitUntilExit();
  assert.equal(cancelled, true);
});

test('shows an in-progress indicator beside the tool being installed', async context => {
  const {instance, output} = renderWelcome({
    state: 'installing',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'installing'},
    conda: {state: 'missing'},
    snakemake: {state: 'missing'},
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('Installing…'));

  assert.match(frame, /Required tooling: Installing/);
  assert.match(frame, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Pixi — Provisioning — v0\.79\.0 — Installing…/);
  assert.match(frame, /Installation log/);
  assert.match(frame, /─/);
  assert.doesNotMatch(frame, /Source:|SHA-256:|Destination:/);
  assert.match(frame, /Do not close this terminal\./);
  assert.doesNotMatch(frame, /Install missing tooling now|↑\/↓ — Select · Enter — Open/);
});

test('activates runtime indicators only after Pixi installation and verification', async context => {
  const setupRequired: ToolingStatus = {
    state: 'setup-required',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'missing'},
    conda: {state: 'missing'},
    snakemake: {state: 'missing'},
  };
  let reportProgress: ((progress: InstallationProgress) => void) | undefined;
  const toolingInstaller = (onProgress: (progress: InstallationProgress) => void) => {
    reportProgress = onProgress;
    onProgress({type: 'phase', phase: 'pixi', tools: ['pixi']});
    return new Promise<InstallationResult>(() => undefined);
  };
  const {input, instance, output} = renderWelcome(setupRequired, {toolingInstaller});
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('Install missing tooling now?'));

  input.write('y');
  const pixiFrame = await waitForOutput(output, value =>
    value.includes('Pixi — Provisioning — v0.79.0 — Installing…'),
  );
  assert.match(pixiFrame, /Pixi — Provisioning — v0\.79\.0 — Installing…/);
  assert.doesNotMatch(pixiFrame, /Conda — Environments — v25\.11\.1 — Installing…/);

  output.clearOutput();
  reportProgress?.({type: 'phase', phase: 'verification', tools: ['pixi']});
  const verificationFrame = await waitForOutput(output, value => value.includes('Verifying…'));
  assert.match(verificationFrame, /Pixi — Provisioning — v0\.79\.0 — Verifying…/);
  assert.doesNotMatch(verificationFrame, /Conda — Environments — v25\.11\.1 — Installing…/);

  output.clearOutput();
  reportProgress?.({type: 'phase', phase: 'runtime', tools: ['conda', 'snakemake']});
  const runtimeFrame = await waitForOutput(output, value =>
    value.includes('Conda — Environments — v25.11.1 — Installing…'),
  );
  assert.match(runtimeFrame, /Pixi — Provisioning — v0\.79\.0 — Available/);
  assert.match(runtimeFrame, /Conda — Environments — v25\.11\.1 — Installing…/);
  assert.match(runtimeFrame, /Snakemake — Workflow — v9\.26\.1 — Installing…/);
});

test('hides Pixi download details while the runtime bundle is being installed', async context => {
  const {instance, output} = renderWelcome({
    state: 'installing',
    node: {state: 'available', detected: {command: 'node', version: 'v24.19.0'}},
    pixi: {state: 'available', detected: {command: 'pixi', version: '0.79.0'}},
    conda: {state: 'installing'},
    snakemake: {state: 'installing'},
  });
  registerCleanup(context, instance);

  const frame = await waitForOutput(output, value => value.includes('Conda — Environments'));

  assert.match(frame, /Conda — Environments — v25\.11\.1 — Installing…/);
  assert.match(frame, /Snakemake — Workflow — v9\.26\.1 — Installing…/);
  assert.doesNotMatch(frame, /Source:|SHA-256:|Destination:/);
});

test('shows incompatible versions and keeps commands hidden', async context => {
  const {instance, output} = renderWelcome({
    state: 'setup-required',
    node: {
      state: 'incompatible',
      detected: {command: 'node', version: 'v26.0.0'},
      supportedRange: '>=24.0.0 <26.0.0',
    },
    pixi: {
      state: 'available',
      detected: {command: 'pixi', version: 'pixi 0.79.0'},
    },
    conda: {
      state: 'available',
      detected: {command: 'conda', version: 'conda 25.11.1'},
    },
    snakemake: {
      state: 'available',
      detected: {command: 'snakemake', version: '9.26.1'},
    },
  });
  registerCleanup(context, instance);
  const frame = await waitForOutput(output, value => value.includes('Incompatible'));

  assert.match(frame, /Node — Runtime — v26\.0\.0 — Incompatible; target v24 LTS/);
  assert.doesNotMatch(frame, />=24\.0\.0|<26\.0\.0/);
  assert.doesNotMatch(frame, /↑\/↓ — Select · Enter — Open/);
});

test('rerenders when the terminal width changes', async context => {
  const {instance, output} = renderWelcome(detectedStatus);
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  output.clearOutput();
  output.columns = 35;
  output.emit('resize');
  await waitForOutput(output, value => value.includes('This terminal is too narrow.'));

  output.clearOutput();
  output.columns = 80;
  output.emit('resize');
  const restoredOutput = await waitForOutput(
    output,
    value =>
      value.lastIndexOf('↑/↓ — Select') > value.lastIndexOf('This terminal is too narrow.'),
  );

  assert.match(restoredOutput, /↑\/↓ — Select/);
});

test('exits only after two Ctrl+C presses within the confirmation period', async context => {
  const {input, instance, output} = renderWelcome(detectedStatus);
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  output.clearOutput();
  input.write('\x03');
  await waitForOutput(output, value => value.includes('Press Ctrl+C again to exit.'));

  input.write('\x03');
  await instance.waitUntilExit();
});

test('resets Ctrl+C confirmation after its timeout', async context => {
  const {input, instance, output} = renderWelcome(detectedStatus, {
    exitConfirmationMilliseconds: 20,
  });
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  output.clearOutput();
  input.write('\x03');
  await waitForOutput(output, value => value.includes('Press Ctrl+C again to exit.'));
  await waitForOutput(
    output,
    value =>
      value.lastIndexOf('Press Ctrl+C twice to exit.') >
      value.lastIndexOf('Press Ctrl+C again to exit.'),
  );

  output.clearOutput();
  input.write('\x03');
  await waitForOutput(output, value => value.includes('Press Ctrl+C again to exit.'));
  input.write('\x03');
  await instance.waitUntilExit();
});

test('does not exit in response to q, h, or Escape', async context => {
  const {input, instance, output} = renderWelcome(detectedStatus);
  registerCleanup(context, instance);
  await waitForOutput(output, value => value.includes('↑/↓ — Select'));

  input.write('q');
  input.write('h');
  input.write('\x1b');
  await new Promise<void>(resolve => setTimeout(resolve, 100));
  output.clearOutput();
  input.write('\x03');
  await waitForOutput(output, value => value.includes('Press Ctrl+C again to exit.'));

  input.write('\x03');
  await instance.waitUntilExit();
});
