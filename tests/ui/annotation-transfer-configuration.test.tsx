import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  AnnotationTransferConfigurationScreen,
  previousRunLabel,
  type AccessionCacheRegistration,
} from '../../src/ui/new-run-screen/annotation-transfer-configuration.js';
import WorkflowConfigurationScreen from '../../src/ui/new-run-screen/workflow-configuration.js';
import type {
  NcbiCacheEntryFinder,
  PreviousRunsLoader,
} from '../../src/ui/new-run-screen/annotation-transfer-configuration.js';
import type {AnnotationTransferConfiguration} from '../../src/workflows/annotation-transfer/configuration.js';
import type {PreparedAnnotationTransferRun} from '../../src/workflows/annotation-transfer/run-configuration.js';
import type {executeSnakemakeRun} from '../../src/workflows/execution.js';
import {
  parseParameterDefinitions,
  type WorkflowParameterDefinition,
} from '../../src/workflows/parameter-definitions.js';

const packagedParameterDefinitions = parseParameterDefinitions(
  readFileSync(
    new URL('../../workflows/annotation-transfer/manifest.parameters.yaml', import.meta.url),
    'utf8',
  ),
);

// Named key sequences instead of raw escape bytes, so a test reads as "press ENTER" rather than
// requiring the reader to recognize ANSI codes.
const ENTER = '\r';
const ESCAPE = '\x1b';
const SPACE = ' ';
const TAB = '\t';
const ARROW_DOWN = '\x1b[B';
const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

// Field and option labels are presentation text that the manifest may change at any time, so
// tests address fields by stable parameter ID and look up whatever label the manifest shows now.
const definitionsById = new Map(packagedParameterDefinitions.map(definition => [definition.id, definition]));

function fieldLabel(id: string): string {
  const definition = definitionsById.get(id);
  assert.ok(definition, `Unknown packaged parameter ${id}`);
  return definition.label;
}

function optionLabel(id: string, value: string): string {
  const option = definitionsById.get(id)?.options?.find(candidate => candidate.value === value);
  assert.ok(option, `Unknown option ${value} of packaged parameter ${id}`);
  return option.label;
}

// Parameters the packaged form shows before any input, with every choice at its default.
function initiallyVisibleParameters(): WorkflowParameterDefinition[] {
  const defaults = new Map(packagedParameterDefinitions.map(definition => [definition.id, definition.default ?? '']));
  return packagedParameterDefinitions.filter(definition => {
    if (definition.hidden) {
      return false;
    }
    if (!definition.visible_when) {
      return true;
    }
    const {parameter, equals} = definition.visible_when;
    const value = defaults.get(parameter) ?? '';
    return Array.isArray(equals) ? equals.includes(value) : value === equals;
  });
}

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
  rows = 30;
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

function registerCleanup(context: TestContext, instance: ReturnType<typeof render>): void {
  context.after(() => instance.unmount());
}

// Ink erases the previous frame before each redraw (ending in cursor-left) or clears the whole
// terminal (ending in cursor-home), so the current frame is everything after the last of those.
function lastFrame(output: TestOutput): string {
  return output.readOutput().split(/\x1b\[[GH]/).at(-1) ?? '';
}

async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting until ${description}`);
}

async function waitForFrame(
  output: TestOutput,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const timeoutAt = Date.now() + 1000;
  while (Date.now() < timeoutAt) {
    const frame = lastFrame(output);
    if (predicate(frame)) {
      return frame;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for a terminal frame. Last frame:\n${lastFrame(output)}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The rendered line of a parameter, found by the label its ID currently has in the manifest: a
// form field ends its label with a colon, and the review aligns values in a column after it.
function lineFor(frame: string, label: string): string | undefined {
  const pattern = new RegExp(`^[›\\s]*${escapeRegExp(label)}(\\*?:|\\s{2,})`);
  return frame.split('\n').find(line => pattern.test(line));
}

function fieldLine(frame: string, id: string): string | undefined {
  return lineFor(frame, fieldLabel(id));
}

function selectedLine(frame: string): string | undefined {
  return frame.split('\n').find(line => line.startsWith('›'));
}

function isSelected(frame: string, label: string): boolean {
  const line = selectedLine(frame);
  return line !== undefined && lineFor(line, label) !== undefined;
}

async function waitForForm(output: TestOutput): Promise<string> {
  return waitForFrame(output, frame => selectedLine(frame) !== undefined);
}

function renderConfiguration(
  currentDirectory: string,
  options: {
    validatePreparedRun?: (prepared: PreparedAnnotationTransferRun) => Promise<void>;
    saveRun?: (prepared: PreparedAnnotationTransferRun) => Promise<string>;
    parameterDefinitions?: readonly WorkflowParameterDefinition[];
    onBack?: () => void;
    checkNcbiApiKey?: () => Promise<boolean>;
    discoverPreviousRuns?: PreviousRunsLoader;
    findCacheEntries?: NcbiCacheEntryFinder;
    executeSnakemakeRun?: typeof executeSnakemakeRun;
    registerAccessionCaches?: AccessionCacheRegistration;
    rows?: number;
  } = {},
): {input: TestInput; output: TestOutput; instance: ReturnType<typeof render>} {
  const input = new TestInput();
  const output = new TestOutput();
  if (options.rows !== undefined) {
    output.rows = options.rows;
  }
  const instance = render(
    <AnnotationTransferConfigurationScreen
      currentDirectory={currentDirectory}
      onBack={options.onBack ?? (() => {})}
      inputActive
      availableCpus={4}
      validatePreparedRun={options.validatePreparedRun}
      saveRun={options.saveRun}
      parameterDefinitions={options.parameterDefinitions ?? packagedParameterDefinitions}
      checkNcbiApiKey={options.checkNcbiApiKey}
      discoverPreviousRuns={options.discoverPreviousRuns ?? (async () => [])}
      findCacheEntries={options.findCacheEntries ?? (async () => [])}
      executeSnakemakeRun={options.executeSnakemakeRun}
      // Never the real catalog: a test run must not touch the researcher's accession catalog.
      registerAccessionCaches={options.registerAccessionCaches ?? (async () => 'Recorded.')}
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

// Tab visits every editable field in turn, whatever the manifest order, so pressing it until
// the field is selected reaches any visible field. Each press waits for its own frame: two
// synchronous writes can land in the same 'data' event and be parsed as a single keypress.
async function focusField(input: TestInput, output: TestOutput, id: string): Promise<void> {
  const label = fieldLabel(id);
  for (let attempt = 0; attempt <= packagedParameterDefinitions.length; attempt += 1) {
    const frame = lastFrame(output);
    if (isSelected(frame, label)) {
      return;
    }
    const before = selectedLine(frame);
    input.write(TAB);
    await waitForFrame(output, next => selectedLine(next) !== before);
  }
  assert.fail(`Could not select parameter ${id}.`);
}

// The form's continue button follows its last field; selected, its line starts with "› [".
async function startReview(input: TestInput, output: TestOutput): Promise<void> {
  const onButton = (frame: string): boolean => /^› \[/.test(selectedLine(frame) ?? '');
  for (let attempt = 0; attempt <= packagedParameterDefinitions.length && !onButton(lastFrame(output)); attempt += 1) {
    const before = selectedLine(lastFrame(output));
    input.write(TAB);
    await waitForFrame(output, next => selectedLine(next) !== before);
  }
  assert.ok(onButton(lastFrame(output)), 'Could not select the continue button.');
  input.write(ENTER);
}

async function typeInto(input: TestInput, output: TestOutput, id: string, value: string): Promise<void> {
  await focusField(input, output, id);
  input.write(value);
  await waitForFrame(output, frame => fieldLine(frame, id)?.includes(value) ?? false);
}

// The lines belonging to the selected field: its own header plus every option line directly
// beneath it. Two choice fields can share an option label, so an option's state has to be read
// from the selected field's own block, not the whole frame.
function selectedFieldBlock(frame: string): string {
  const lines = frame.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('›'));
  if (headerIndex === -1) {
    return '';
  }
  const block = [lines[headerIndex]];
  for (let index = headerIndex + 1; index < lines.length && /^\s+\(/.test(lines[index]); index += 1) {
    block.push(lines[index]);
  }
  return block.join('\n');
}

// Sets a choice parameter to an option value by pressing Space until that option is marked,
// so a test keeps working if the field's default or option order changes.
async function chooseOption(input: TestInput, output: TestOutput, id: string, value: string): Promise<void> {
  await focusField(input, output, id);
  const isMarked = (frame: string): boolean =>
    selectedFieldBlock(frame).includes(`(●) ${optionLabel(id, value)}`);
  const optionCount = definitionsById.get(id)?.options?.length ?? 0;
  for (let attempt = 0; attempt < optionCount && !isMarked(lastFrame(output)); attempt += 1) {
    const before = selectedFieldBlock(lastFrame(output));
    input.write(SPACE);
    await waitForFrame(output, frame => selectedFieldBlock(frame) !== before);
  }
  assert.ok(isMarked(lastFrame(output)), `Could not choose ${value} for parameter ${id}.`);
}

// The review is the only screen that shows the generated run ID.
async function waitForReview(
  output: TestOutput,
  reviewed: () => PreparedAnnotationTransferRun | undefined,
): Promise<{frame: string; prepared: PreparedAnnotationTransferRun}> {
  await waitUntil(() => reviewed() !== undefined, 'the prepared run is validated');
  const prepared = reviewed()!;
  const frame = await waitForFrame(output, value => value.includes(prepared.configuration.run.id));
  return {frame, prepared};
}

test('keeps pasted whitespace in a typable local-file-path field', async context => {
  const {input, output, instance} = renderConfiguration('/research');
  registerCleanup(context, instance);
  await waitForForm(output);

  await chooseOption(input, output, 'reference-source', 'local');
  await focusField(input, output, 'reference-fasta');
  // Unlike a text/integer field, a paste here is inserted as-is: no trimming, no control-
  // character stripping. That is @inkjs/ui's own behavior, not something this form adds back.
  input.write('  /data/reference.fa  ');
  await waitForFrame(output, frame => fieldLine(frame, 'reference-fasta')?.includes('  /data/reference.fa') ?? false);
});

test('edits all required fields and confirms effective options before saving', async context => {
  let reviewed: PreparedAnnotationTransferRun | undefined;
  let saved: PreparedAnnotationTransferRun | undefined;
  let apiKeyChecks = 0;
  const executedModes: string[] = [];
  const registrations: string[] = [];
  const {input, output, instance} = renderConfiguration('/research', {
    // Tall enough to show the whole review without scrolling.
    rows: 60,
    registerAccessionCaches: async outputRoot => {
      registrations.push(outputRoot);
      return 'Recorded.';
    },
    validatePreparedRun: async prepared => {
      reviewed = prepared;
    },
    saveRun: async prepared => {
      saved = prepared;
      return '/research/runs/Test run/config.yaml';
    },
    checkNcbiApiKey: async () => {
      apiKeyChecks += 1;
      return false;
    },
    executeSnakemakeRun: async (run, onOutput) => {
      executedModes.push(run.mode);
      onOutput?.({stream: 'stdout', text: 'Building DAG of jobs…\nNothing to be done.\n'});
      return {...run, exitCode: 0};
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  // Both sides of this run come from local files.
  await chooseOption(input, output, 'reference-source', 'local');
  await typeInto(input, output, 'reference-fasta', '/data/reference.fa');
  await typeInto(input, output, 'reference-gff3', '/data/reference.gff3');
  await chooseOption(input, output, 'target-source', 'local');
  await typeInto(input, output, 'target-fasta', '/data/target.fa');
  await chooseOption(input, output, 'cpu-allocation', 'leave-one-free');
  await typeInto(input, output, 'run-name', 'Test run');
  await typeInto(input, output, 'run-description', 'Baseline annotation');

  await startReview(input, output);
  const review = await waitForReview(output, () => reviewed);
  const {configuration} = review.prepared;
  assert.equal(configuration.workflow_id, 'annotation-transfer');
  assert.equal(configuration.resources.cpu_mode, 'leave-one-free');
  assert.equal(configuration.resources.effective_cpus, 3);
  assert.match(configuration.run.id, /^\d{4}-\d{2}-\d{2}_\d{9}_Test-run$/);
  assert.equal(configuration.run.name, 'Test run');
  assert.equal(configuration.run.description, 'Baseline annotation');
  assert.match(configuration.run.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(review.prepared.outputDirectory, /^\/research\/runs\/annotation-transfer\//);
  assert.ok(review.frame.includes(review.prepared.outputDirectory));
  assert.match(fieldLine(review.frame, 'run-name') ?? '', /Test run/);
  assert.equal(fieldLine(review.frame, 'lifton-profile'), undefined);
  // The NCBI API key only matters, and is only checked, when an input is downloaded from NCBI.
  assert.equal(apiKeyChecks, 0);

  input.write(ENTER);
  await waitUntil(() => saved !== undefined, 'the configuration is saved');
  assert.equal(saved?.configuration.run.id, configuration.run.id);
  // The rendered command wraps across terminal lines, so match it unwrapped.
  const unwrap = (frame: string): string => frame.replace(/\s+/g, ' ');
  const startFrame = await waitForFrame(output, frame => unwrap(frame).includes('--printshellcmds --dry-run'));
  assert.match(unwrap(startFrame), /--cores 3 --use-conda --conda-prefix \S+ --printshellcmds --dry-run/);
  assert.ok(unwrap(startFrame).includes(`--directory ${review.prepared.outputDirectory}`));

  // Executing does not require a dry run first: selecting it shows its own exact command.
  input.write(ARROW_DOWN);
  await waitForFrame(output, frame => frame.includes('--printshellcmds') && !frame.includes('--dry-run'));

  input.write(ENTER);
  await waitUntil(() => executedModes.length === 1, 'the workflow is executed');
  assert.deepEqual(executedModes, ['execute']);
  await waitForFrame(output, frame => frame.includes('Nothing to be done.'));
  // Local inputs leave nothing to record in the accession catalog.
  assert.deepEqual(registrations, []);
});

test('records the NCBI cache in the accession catalog after a successful NCBI-sourced run', async context => {
  let reviewed: PreparedAnnotationTransferRun | undefined;
  let saves = 0;
  const executedModes: string[] = [];
  const registrations: string[] = [];
  const {input, output, instance} = renderConfiguration('/research', {
    // Tall enough to show the whole review without scrolling.
    rows: 60,
    registerAccessionCaches: async outputRoot => {
      registrations.push(outputRoot);
      return 'Test registration note';
    },
    validatePreparedRun: async prepared => {
      reviewed = prepared;
    },
    saveRun: async () => {
      saves += 1;
      return '/research/runs/config.yaml';
    },
    checkNcbiApiKey: async () => false,
    executeSnakemakeRun: async run => {
      executedModes.push(run.mode);
      return {...run, exitCode: 0};
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  await chooseOption(input, output, 'reference-source', 'ncbi');
  await typeInto(input, output, 'reference-accession', 'GCF_000149205.2');
  await chooseOption(input, output, 'target-source', 'ncbi');
  await typeInto(input, output, 'target-accession', 'GCA_000011425.1');
  await startReview(input, output);
  await waitForReview(output, () => reviewed);
  input.write(ENTER);
  await waitUntil(() => saves === 1, 'the configuration is saved');
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  // The start options list the dry run first; the execution is the next option.
  input.write(ARROW_DOWN);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  input.write(ENTER);

  await waitUntil(() => registrations.length === 1, 'the cache is recorded');
  assert.deepEqual(executedModes, ['execute']);
  assert.deepEqual(registrations, ['/research/runs']);
  await waitForFrame(output, frame => frame.includes('Test registration note'));
});

test('shows a failed dry run with its live output, then offers execution again', async context => {
  const input = new TestInput();
  const output = new TestOutput();
  const attempts: string[] = [];
  let prepareCalls = 0;
  let saveCalls = 0;
  const preparedRun = (mode: 'dry-run' | 'execute', attempt: number) => ({
    mode,
    command: `/managed/snakemake${mode === 'dry-run' ? ' --dry-run' : ''}`,
    stdoutLogPath: `/run/logs/snakemake-${mode}.${String(attempt)}.stdout.log`,
    stderrLogPath: `/run/logs/snakemake-${mode}.${String(attempt)}.stderr.log`,
  });
  let attempt = 0;
  const instance = render(
    <WorkflowConfigurationScreen
      title="Test workflow"
      currentDirectory="/research"
      parameterDefinitions={[]}
      onBack={() => {}}
      inputActive
      prepareRun={async () => {
        prepareCalls += 1;
        return {
          payload: {id: 'run'},
          resolvedValues: {},
          effectiveOptions: [],
          outputDirectory: '/run/output',
        };
      }}
      saveRun={async () => {
        saveCalls += 1;
        return '/run/config.yaml';
      }}
      prepareSnakemakeRun={mode => preparedRun(mode, attempt)}
      executeSnakemakeRun={async (run, onOutput) => {
        attempts.push(run.stdoutLogPath);
        attempt += 1;
        onOutput({stream: 'stderr', text: 'Invalid workflow configuration\n'});
        return {...run, exitCode: 2};
      }}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  registerCleanup(context, instance);

  await waitForFrame(output, frame => frame.length > 0);
  input.write(ENTER);
  await waitUntil(() => prepareCalls === 1, 'the run is prepared');
  await waitForFrame(output, frame => frame.includes('/run/output'));
  input.write(ENTER);
  await waitUntil(() => saveCalls === 1, 'the configuration is saved');
  // The dry run is preselected and its exact command is shown before starting it.
  await waitForFrame(output, frame => frame.includes('/managed/snakemake --dry-run'));
  input.write(ENTER);
  await waitUntil(() => attempts.length === 1, 'the dry run is started');
  // The failed run keeps its captured stderr on screen.
  await waitForFrame(output, frame => frame.includes('Invalid workflow configuration'));

  // A finished dry run returns to the start options with the execution preselected, and the
  // next attempt is prepared again so it cannot reuse the previous attempt's log files.
  input.write(ESCAPE);
  await waitForFrame(output, frame => frame.includes('/managed/snakemake') && !frame.includes('--dry-run'));
  input.write(ENTER);
  await waitUntil(() => attempts.length === 2, 'the workflow is executed');
  assert.deepEqual(attempts, [
    '/run/logs/snakemake-dry-run.0.stdout.log',
    '/run/logs/snakemake-execute.1.stdout.log',
  ]);
});

test('switches the reference to an NCBI accession independently of the target', async context => {
  let reviewed: PreparedAnnotationTransferRun | undefined;
  let apiKeyChecks = 0;
  const {input, output, instance} = renderConfiguration('/research', {
    validatePreparedRun: async prepared => {
      reviewed = prepared;
    },
    checkNcbiApiKey: async () => {
      apiKeyChecks += 1;
      return false;
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  await chooseOption(input, output, 'reference-source', 'ncbi');
  assert.equal(fieldLine(lastFrame(output), 'reference-fasta'), undefined);
  assert.equal(fieldLine(lastFrame(output), 'reference-gff3'), undefined);

  await typeInto(input, output, 'reference-accession', 'GCF_000149205.2');
  await chooseOption(input, output, 'target-source', 'local');
  await typeInto(input, output, 'target-fasta', '/data/target.fa');

  await startReview(input, output);
  const {frame, prepared} = await waitForReview(output, () => reviewed);
  const {reference, target} = prepared.configuration.inputs;
  assert.equal(reference.source, 'ncbi');
  assert.equal(reference.source === 'ncbi' ? reference.accession : undefined, 'GCF_000149205.2');
  assert.equal(target.source, 'local');
  assert.equal(apiKeyChecks, 1);
  assert.match(fieldLine(frame, 'reference-accession') ?? '', /GCF_000149205\.2/);
  // Choices are reviewed by their option label, not the raw stored value.
  assert.ok(fieldLine(frame, 'reference-source')?.includes(optionLabel('reference-source', 'ncbi')));
  assert.ok(fieldLine(frame, 'target-source')?.includes(optionLabel('target-source', 'local')));
  assert.equal(fieldLine(frame, 'reference-fasta'), undefined);
  assert.equal(fieldLine(frame, 'reference-gff3'), undefined);
});

test('reflects the NCBI API key status in the review of an NCBI-sourced run', async context => {
  const reviewFrame = async (apiKeyConfigured: boolean): Promise<string> => {
    let reviewed: PreparedAnnotationTransferRun | undefined;
    const {input, output, instance} = renderConfiguration('/research', {
      validatePreparedRun: async prepared => {
        reviewed = prepared;
      },
      checkNcbiApiKey: async () => apiKeyConfigured,
    });
    registerCleanup(context, instance);
    await waitForForm(output);
    await chooseOption(input, output, 'reference-source', 'ncbi');
    await typeInto(input, output, 'reference-accession', 'GCF_000149205.2');
    await chooseOption(input, output, 'target-source', 'ncbi');
    await typeInto(input, output, 'target-accession', 'GCA_000011425.1');
    await startReview(input, output);
    const {frame, prepared} = await waitForReview(output, () => reviewed);
    // Each render generates its own timestamped run ID; only the key status should differ.
    return frame.replaceAll(prepared.configuration.run.id, '<run-id>');
  };

  const configured = (await reviewFrame(true)).split('\n');
  const missing = (await reviewFrame(false)).split('\n');
  assert.ok(configured.some(line => !missing.includes(line)));
  assert.ok(missing.some(line => !configured.includes(line)));
});

test('asks how to handle an existing NCBI cache entry and saves the decision', async context => {
  let reviewed: PreparedAnnotationTransferRun | undefined;
  let saved: PreparedAnnotationTransferRun | undefined;
  let cacheLookups = 0;
  const {input, output, instance} = renderConfiguration('/research', {
    validatePreparedRun: async prepared => {
      reviewed = prepared;
    },
    saveRun: async prepared => {
      saved = prepared;
      return '/research/runs/annotation-transfer/run/config.yaml';
    },
    findCacheEntries: async () => {
      cacheLookups += 1;
      return [{input: 'reference', accession: 'GCF_000149205.2'}];
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  await chooseOption(input, output, 'reference-source', 'ncbi');
  await typeInto(input, output, 'reference-accession', 'GCF_000149205.2');
  await chooseOption(input, output, 'target-source', 'local');
  await typeInto(input, output, 'target-fasta', '/data/target.fa');

  await startReview(input, output);
  await waitUntil(() => cacheLookups === 1, 'the NCBI cache is searched');
  // The cache decision replaces the form and names the cached accession.
  const cacheFrame = await waitForFrame(
    output,
    frame => frame.includes('GCF_000149205.2') && fieldLine(frame, 'reference-source') === undefined,
  );

  // As on a choice field of the form, ↓ on the cache entry chooses its next option.
  input.write(ARROW_DOWN);
  await waitForFrame(output, frame => frame !== cacheFrame);
  // Enter acts only on the continue button, which follows the cache choices.
  await startReview(input, output);
  await waitForReview(output, () => reviewed);
  input.write(ENTER);
  await waitUntil(() => saved !== undefined, 'the configuration is saved');
  const reference = saved?.configuration.inputs.reference;
  assert.equal(reference?.source === 'ncbi' ? reference.ncbi_cache_mode : undefined, 'refresh');
});

test('shows only manifest parameters that are not hidden', async context => {
  const {output, instance} = renderConfiguration('/research', {
    parameterDefinitions: [
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
        id: 'run-name',
        label: 'Run name (optional; suggested)',
        section: 'Run details',
        kind: 'text',
        required: false,
        hidden: false,
        default: null,
      },
      {
        id: 'hidden-option',
        label: 'Hidden option',
        section: 'Workflow options',
        kind: 'fixed',
        required: true,
        hidden: true,
        default: 'secret',
      },
      {
        id: 'visible-option',
        label: 'Visible option',
        section: 'Workflow options',
        kind: 'fixed',
        required: true,
        hidden: false,
        default: 'shown',
      },
    ],
  });
  registerCleanup(context, instance);

  const frame = await waitForFrame(output, value => value.includes('Visible option*: shown'));
  assert.match(frame, /Reference FASTA\*:/);
  assert.doesNotMatch(frame, /Run name \(optional; suggested\)\*:/);
  assert.doesNotMatch(frame, /Hidden option|secret/);
});

test('returns from the form with Escape, and types the letter "b" instead of going back', async context => {
  let backCalls = 0;
  const {input, output, instance} = renderConfiguration('/research', {
    onBack: () => {
      backCalls += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  await chooseOption(input, output, 'reference-source', 'ncbi');
  await focusField(input, output, 'reference-accession');
  input.write('b');
  await waitForFrame(output, frame => /:\s*b\s*$/.test(fieldLine(frame, 'reference-accession') ?? ''));
  assert.equal(backCalls, 0);

  input.write(ESCAPE);
  await waitUntil(() => backCalls > 0, 'the form returns');
  assert.equal(backCalls, 1);
});

test('shows actionable validation errors before confirmation', async context => {
  let validations = 0;
  const {input, output, instance} = renderConfiguration('/research', {
    validatePreparedRun: async () => {
      validations += 1;
    },
    // Tall enough that every form row stays on screen beside the error list.
    rows: 60,
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  const missingRequired = initiallyVisibleParameters().filter(
    definition => definition.required && definition.default === null,
  );
  assert.ok(missingRequired.length > 0);
  const occurrences = (frame: string, label: string): number => frame.split(label).length - 1;
  await startReview(input, output);
  // Each missing field is named in the error list in addition to its own form row.
  const frame = await waitForFrame(output, value =>
    missingRequired.every(definition => occurrences(value, definition.label) >= 2),
  );
  assert.doesNotMatch(frame, /\$\.run\.name/);
  assert.equal(validations, 0);
});

test('opens the file browser with Enter from a local path field and selects a file', async context => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'annotation-transfer-browser-'));
  context.after(() => rm(temporaryRoot, {recursive: true, force: true}));
  const root = join(temporaryRoot, 'runs');
  const fasta = join(root, 'reference.fa');
  const folder = join(root, 'folder');
  await mkdir(folder, {recursive: true});
  await mkdir(join(root, 'ncbi-accessions-cache'));
  await mkdir(join(temporaryRoot, 'ncbi-accessions-cache'));
  await writeFile(join(folder, 'nested.fa'), '>nested\nACGT\n');
  await writeFile(fasta, '>chr1\nACGT\n');
  let validations = 0;
  const {input, output, instance} = renderConfiguration(root, {
    validatePreparedRun: async () => {
      validations += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  // On a local path field, which can also be typed into, Enter opens the browser instead of
  // starting the review.
  await chooseOption(input, output, 'reference-source', 'local');
  await focusField(input, output, 'reference-fasta');

  input.write(ENTER);
  const rootFrame = await waitForFrame(output, value => value.includes('› folder/'));
  assert.doesNotMatch(rootFrame, /ncbi-accessions-cache/);
  assert.equal(validations, 0);

  // The cache directory is only hidden inside a run collection, not in its parent.
  input.write(ARROW_LEFT);
  await waitForFrame(output, value => value.includes('› ncbi-accessions-cache/'));
  input.write(ARROW_DOWN);
  await waitForFrame(output, value => value.includes('› runs/'));
  input.write(ARROW_RIGHT);
  await waitForFrame(output, value => value.includes('› folder/'));

  input.write(ARROW_RIGHT);
  await waitForFrame(output, value => value.includes('nested.fa'));

  input.write(ARROW_LEFT);
  await waitForFrame(output, value => value.includes('› folder/'));
  input.write(ARROW_DOWN);
  await waitForFrame(output, value => value.includes('› reference.fa'));
  input.write(ENTER);
  const formFrame = await waitForFrame(output, value => fieldLine(value, 'reference-fasta')?.includes(fasta) ?? false);
  // Browsing sets only the field it was opened from.
  assert.ok(!fieldLine(formFrame, 'reference-gff3')?.includes(root));
});

test('labels a previous run by its name and creation time, not its run ID', () => {
  const configuration = {
    schema_version: 1,
    workflow_id: 'annotation-transfer',
    workflow_version: 1,
    inputs: {
      reference: {source: 'local', fasta: '/data/reference.fa', gff3: '/data/reference.gff3'},
      target: {source: 'local', fasta: '/data/target.fa'},
    },
    annotation: {id_prefix: 'AN_CS'},
    lifton: {profile: 'same-species'},
    resources: {cpu_mode: 'automatic', effective_cpus: 8},
    run: {
      output_root: '/data/runs',
      id: '2026-09-05_083412123_Baseline-transfer',
      name: 'Baseline transfer',
      created_at: '2026-09-05T08:34:12.123Z',
      description: 'Initial T2T annotation',
    },
  } as const satisfies AnnotationTransferConfiguration;

  const named = previousRunLabel(configuration);
  assert.ok(named.includes('Baseline transfer'));
  assert.ok(named.includes('2026-09-05 08:34:12'));
  assert.ok(named.includes('Initial T2T annotation'));
  assert.ok(!named.includes(configuration.run.id));

  const unnamed = previousRunLabel({
    ...configuration,
    run: {
      output_root: '/data/runs',
      id: '2026-09-05_083412123_annotation-transfer',
      created_at: '2026-09-05T08:34:12.123Z',
    },
  });
  assert.ok(unnamed.includes('2026-09-05 08:34:12'));
  assert.ok(!unnamed.includes('annotation-transfer'));
});

test('steps through previous run history and prefills the form immediately', async context => {
  const previousRuns: readonly {label: string; values: Record<string, string>}[] = [
    {
      label: 'Run A',
      values: {
        'reference-source': 'ncbi',
        'reference-accession': 'GCF_000149205.2',
        'target-source': 'local',
        'target-fasta': '/data/target-a.fa',
        'annotation-id-prefix': 'AN_A',
        'cpu-allocation': 'automatic',
        'output-root': '/out/a',
        'run-name': 'run-a',
        'run-description': 'First transfer',
      },
    },
    {
      label: 'Run B',
      values: {
        'reference-source': 'local',
        'reference-fasta': '/data/reference-b.fa',
        'reference-gff3': '/data/reference-b.gff3',
        'target-source': 'local',
        'target-fasta': '/data/target-b.fa',
        'annotation-id-prefix': 'AN_B',
        'cpu-allocation': 'automatic',
        'output-root': '/out/b',
        'run-name': 'run-b',
        'run-description': 'Second transfer',
      },
    },
  ];
  let loaded = false;
  // Tall enough to show every field at once, so each prefilled value is on screen.
  const {input, output, instance} = renderConfiguration('/research', {
    rows: 60,
    discoverPreviousRuns: async () => {
      loaded = true;
      return previousRuns;
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);
  await waitUntil(() => loaded, 'previous runs are discovered');
  // Let the discovered runs reach the form before browsing them.
  await new Promise<void>(resolve => setTimeout(resolve, 100));

  input.write(PAGE_DOWN);
  const firstRunFrame = await waitForFrame(
    output,
    frame => fieldLine(frame, 'reference-accession')?.includes('GCF_000149205.2') ?? false,
  );
  assert.match(fieldLine(firstRunFrame, 'target-fasta') ?? '', /\/data\/target-a\.fa/);
  assert.match(fieldLine(firstRunFrame, 'annotation-id-prefix') ?? '', /AN_A/);

  input.write(PAGE_DOWN);
  const secondRunFrame = await waitForFrame(
    output,
    frame => fieldLine(frame, 'reference-fasta')?.includes('/data/reference-b.fa') ?? false,
  );
  assert.match(fieldLine(secondRunFrame, 'reference-gff3') ?? '', /\/data\/reference-b\.gff3/);
  assert.match(fieldLine(secondRunFrame, 'annotation-id-prefix') ?? '', /AN_B/);
  assert.equal(fieldLine(secondRunFrame, 'reference-accession'), undefined);

  input.write(PAGE_UP);
  await waitForFrame(output, frame => fieldLine(frame, 'reference-accession')?.includes('GCF_000149205.2') ?? false);

  // Stepping back past the first run restores the defaults instead of keeping prefilled values.
  input.write(PAGE_UP);
  await waitForFrame(output, frame => !frame.includes('AN_A') && !frame.includes('GCF_000149205.2'));
});

test('scrolls the field list to keep the selected field reachable in a short terminal', async context => {
  const rows = 15;
  const {input, output, instance} = renderConfiguration('/research', {rows});
  registerCleanup(context, instance);
  const initialFrame = await waitForForm(output);

  const editableLabels = initiallyVisibleParameters()
    .filter(definition => definition.kind !== 'fixed')
    .map(definition => definition.label);
  const frameHeight = (frame: string): number => frame.replace(/\n+$/, '').split('\n').length;
  assert.ok(editableLabels.some(label => lineFor(initialFrame, label) === undefined));
  assert.ok(frameHeight(initialFrame) <= rows);

  // Tab through every editable field and the continue button, then wrap around: each selected
  // row is on screen and the form never grows past the terminal height.
  const selectedLabel = (frame: string): string | undefined =>
    editableLabels.find(label => isSelected(frame, label)) ??
    (/^› \[/.test(selectedLine(frame) ?? '') ? 'continue button' : undefined);
  const visited = [selectedLabel(initialFrame)];
  for (let step = 0; step <= editableLabels.length; step += 1) {
    const before = selectedLine(lastFrame(output));
    input.write(TAB);
    const frame = await waitForFrame(output, next => selectedLine(next) !== before);
    assert.ok(frameHeight(frame) <= rows, `Frame exceeds ${String(rows)} rows:\n${frame}`);
    visited.push(selectedLabel(frame));
  }
  assert.deepEqual(new Set(visited), new Set([...editableLabels, 'continue button']));
  assert.equal(visited.at(-1), visited[0]);
});

test('ignores Enter in a field and reviews only from the continue button', async context => {
  let validations = 0;
  const {input, output, instance} = renderConfiguration('/research', {
    validatePreparedRun: async () => {
      validations += 1;
    },
  });
  registerCleanup(context, instance);
  await waitForForm(output);

  await focusField(input, output, 'run-name');
  const before = selectedLine(lastFrame(output));
  input.write(ENTER);
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  assert.equal(selectedLine(lastFrame(output)), before);
  assert.equal(validations, 0);
});
