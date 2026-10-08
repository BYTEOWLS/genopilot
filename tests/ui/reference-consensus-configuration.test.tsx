import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {packagedPath} from '../../src/package-root.js';
import type {Isolate, IsolateCatalog} from '../../src/isolates/catalog.js';
import {ReferenceConsensusConfigurationScreen} from '../../src/ui/new-run-screen/reference-consensus-configuration.js';
import type {executeSnakemakeRun} from '../../src/workflows/execution.js';
import {parseWorkflowManifest} from '../../src/workflows/manifest.js';
import {parseParameterDefinitions} from '../../src/workflows/parameter-definitions.js';
import type {
  PreparedReferenceConsensusRun,
  RunInspection,
} from '../../src/workflows/reference-consensus/run-configuration.js';

const packagedParameterDefinitions = parseParameterDefinitions(
  readFileSync(new URL('../../workflows/reference-consensus/manifest.parameters.yaml', import.meta.url), 'utf8'),
);

const packagedStages = parseWorkflowManifest(
  readFileSync(new URL('../../workflows/reference-consensus/manifest.yaml', import.meta.url), 'utf8'),
).stages;

const ENTER = '\r';
const ESCAPE = '\x1b';
const SPACE = ' ';
const TAB = '\t';
const ARROW_DOWN = '\x1b[B';
const ARROW_RIGHT = '\x1b[C';
const PAGE_DOWN = '\x1b[6~';

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

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }

  lastFrame(): string {
    return this.output.split(/\x1b\[[GH]/).at(-1) ?? '';
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

async function waitForFrame(output: TestOutput, predicate: (frame: string) => boolean): Promise<string> {
  const timeoutAt = Date.now() + 2000;
  while (Date.now() < timeoutAt) {
    const frame = output.lastFrame();
    if (predicate(frame)) {
      return frame;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for a terminal frame. Last frame:\n${output.lastFrame()}`);
}

async function press(input: TestInput, key: string): Promise<void> {
  input.write(key);
  await waitUntil(() => input.readableLength === 0, 'the key is handled');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldLine(frame: string, id: string): string | undefined {
  const pattern = new RegExp(`^[›\\s]*${escapeRegExp(fieldLabel(id))}(\\*?:|\\s{2,})`);
  return frame.split('\n').find(line => pattern.test(line));
}

function selectedLine(frame: string): string | undefined {
  return frame.split('\n').find(line => line.startsWith('›'));
}

async function focusField(input: TestInput, output: TestOutput, id: string): Promise<void> {
  for (let attempt = 0; attempt <= packagedParameterDefinitions.length; attempt += 1) {
    const frame = output.lastFrame();
    const line = selectedLine(frame);
    if (line !== undefined && fieldLine(line, id) !== undefined) {
      return;
    }
    await press(input, TAB);
    await waitForFrame(output, next => selectedLine(next) !== line);
  }
  assert.fail(`Could not select parameter ${id}.`);
}

async function chooseOption(input: TestInput, output: TestOutput, id: string, value: string): Promise<void> {
  await focusField(input, output, id);
  const optionCount = definitionsById.get(id)?.options?.length ?? 0;
  const isMarked = (frame: string): boolean => frame.includes(`(●) ${optionLabel(id, value)}`);
  for (let attempt = 0; attempt < optionCount && !isMarked(output.lastFrame()); attempt += 1) {
    const before = output.lastFrame();
    await press(input, SPACE);
    await waitForFrame(output, frame => frame !== before);
  }
  assert.ok(isMarked(output.lastFrame()), `Could not choose ${value} for parameter ${id}.`);
}

async function typeInto(input: TestInput, output: TestOutput, id: string, value: string): Promise<void> {
  await focusField(input, output, id);
  input.write(value);
  await waitForFrame(output, frame => fieldLine(frame, id)?.includes(value) ?? false);
}

async function startReview(input: TestInput, output: TestOutput): Promise<void> {
  const onButton = (frame: string): boolean => /^› \[/.test(selectedLine(frame) ?? '');
  for (let attempt = 0; attempt <= packagedParameterDefinitions.length && !onButton(output.lastFrame()); attempt += 1) {
    const before = selectedLine(output.lastFrame());
    await press(input, TAB);
    await waitForFrame(output, next => selectedLine(next) !== before);
  }
  assert.ok(onButton(output.lastFrame()), 'Could not select the continue button.');
  await press(input, ENTER);
}

function isolate(id: string, name: string, trimmed = false): Isolate {
  return {
    id,
    name,
    wildtype: null,
    derived_from: null,
    read_pairs: [{r1: `/reads/${id}_R1.fastq.gz`, r2: `/reads/${id}_R2.fastq.gz`, trimmed}],
  };
}

const catalog: IsolateCatalog = {
  schema_version: 1,
  isolates: [isolate('wild-type', 'Wild type'), isolate('mutant-one', 'Mutant one', true)],
};

function renderScreen(
  context: TestContext,
  options: {
    catalog?: IsolateCatalog;
    inspectRun?: (prepared: PreparedReferenceConsensusRun) => Promise<RunInspection>;
    saveRun?: (prepared: PreparedReferenceConsensusRun) => Promise<string>;
    executeSnakemakeRun?: typeof executeSnakemakeRun;
    backboneCached?: boolean;
    rows?: number;
  } = {},
) {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? 30;
  let snapshotLoads = 0;
  const reviewed: PreparedReferenceConsensusRun[] = [];
  const instance = render(
    <ReferenceConsensusConfigurationScreen
      currentDirectory="/research"
      onBack={() => {}}
      inputActive
      genopilot={{version: '1.2.3', igv: '3.8.9'}}
      availableCpus={4}
      snakefilePath={packagedPath('workflows/reference-consensus/Snakefile')}
      parameterDefinitions={packagedParameterDefinitions}
      stages={packagedStages}
      loadIsolateCatalogSnapshot={async () => {
        snapshotLoads += 1;
        return options.catalog ?? catalog;
      }}
      loadIsolates={async () => (options.catalog ?? catalog).isolates}
      inspectRun={async prepared => {
        reviewed.push(prepared);
        return options.inspectRun ? options.inspectRun(prepared) : {sameFiles: []};
      }}
      saveRun={options.saveRun ?? (async () => '/research/runs/config.yaml')}
      checkBackboneCache={async () => options.backboneCached ?? false}
      checkNcbiApiKey={async () => true}
      discoverPreviousRuns={async () => []}
      executeSnakemakeRun={options.executeSnakemakeRun}
      registerAccessionCaches={async () => 'Recorded.'}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  context.after(() => instance.unmount());
  return {input, output, reviewed, snapshotLoads: () => snapshotLoads};
}

async function chooseIsolates(input: TestInput, output: TestOutput, ids: readonly string[]): Promise<void> {
  await focusField(input, output, 'isolates');
  await press(input, ENTER);
  for (const id of ids) {
    await waitForFrame(output, frame => frame.includes(`(${id})`));
    // Move the highlight onto the isolate's row, found by its stable ID.
    for (let attempt = 0; attempt < catalog.isolates.length; attempt += 1) {
      const before = selectedLine(output.lastFrame());
      if (before?.includes(`(${id})`)) {
        break;
      }
      await press(input, ARROW_DOWN);
      await waitForFrame(output, frame => selectedLine(frame) !== before);
    }
    await press(input, SPACE);
    await waitForFrame(output, frame => frame.split('\n').some(line => line.includes(`(${id})`) && line.includes('[✔]')));
  }
  await press(input, ENTER);
  await waitForFrame(output, frame => fieldLine(frame, 'isolates')?.includes(`${String(ids.length)} selected`) ?? false);
}

test('requires at least one isolate before preparing the run', async context => {
  const {input, output, snapshotLoads} = renderScreen(context);
  await waitForFrame(output, frame => selectedLine(frame) !== undefined);
  await typeInto(input, output, 'backbone-accession', 'GCF_000149205.2');
  await startReview(input, output);
  await waitForFrame(output, frame => frame.includes(`${fieldLabel('isolates')}: is required`));
  assert.equal(snapshotLoads(), 0);
});

test('configures a run from cataloged isolates, reviews it, and starts a dry run or an execution', async context => {
  const executedModes: string[] = [];
  let saved: PreparedReferenceConsensusRun | undefined;
  const {input, output, reviewed} = renderScreen(context, {
    rows: 80,
    inspectRun: async () => ({sameFiles: [{first: '/reads/one.fq', second: '/reads/linked.fq'}]}),
    saveRun: async prepared => {
      saved = prepared;
      return `${prepared.outputDirectory}/config.yaml`;
    },
    executeSnakemakeRun: async (run, onOutput) => {
      executedModes.push(run.mode);
      onOutput?.({stream: 'stdout', text: 'Job stats\n'});
      return {...run, exitCode: 0};
    },
  });
  await waitForFrame(output, frame => selectedLine(frame) !== undefined);

  // The default voting method is visible before anything is chosen.
  assert.ok(output.lastFrame().includes(`(●) ${optionLabel('voting-method', 'strict-majority')}`));
  await typeInto(input, output, 'backbone-accession', 'GCF_000149205.2');
  await chooseIsolates(input, output, ['mutant-one', 'wild-type']);
  await chooseOption(input, output, 'include-backbone-vote', 'no');
  await chooseOption(input, output, 'voting-method', 'plurality');
  await typeInto(input, output, 'min-depth', '5');
  await startReview(input, output);

  await waitUntil(() => reviewed.length === 1, 'the run is prepared');
  const prepared = reviewed[0]!;
  const {configuration, snapshot} = prepared;
  assert.deepEqual(configuration.inputs.selected_isolates, ['mutant-one', 'wild-type']);
  // The consensus settings left alone keep the manifest's defaults.
  assert.deepEqual(configuration.consensus, {
    include_backbone_vote: false, voting_method: 'plurality', min_callable_isolates: 0, unresolved_snp: 'n',
  });
  assert.equal(configuration.calling.min_depth, 105);
  assert.equal(configuration.calling.ploidy, 1);
  assert.deepEqual(snapshot.isolates.map(entry => entry.id), ['mutant-one', 'wild-type']);

  const frame = await waitForFrame(output, next => next.includes(configuration.run.id));
  // Warnings, every isolate and its read files, and the run directory; the command waits for the start page.
  assert.ok(frame.includes('/reads/linked.fq'));
  assert.ok(frame.includes('mutant-one_R1.fastq.gz'));
  assert.ok(frame.includes(prepared.outputDirectory));
  assert.ok(!frame.includes('--dry-run'));

  await press(input, ENTER);
  await waitUntil(() => saved !== undefined, 'the run is saved');
  // The start page shows the exact dry-run command.
  const onStartPage = (next: string): boolean =>
    next.includes('--dry-run') && next.includes('workflows/reference-consensus/Snakefile');
  await waitForFrame(output, onStartPage);
  await press(input, ENTER);
  await waitUntil(() => executedModes.length === 1, 'the dry run starts');
  assert.deepEqual(executedModes, ['dry-run']);
  // After the dry run, the workflow itself can be executed, and its isolates are followed.
  await waitForFrame(output, next => next.includes('Job stats'));
  // Back on the start page, the execution is preselected once a dry run has passed.
  await press(input, ESCAPE);
  await waitForFrame(output, next => next.includes('workflows/reference-consensus/Snakefile') && !next.includes('--dry-run'));
  await press(input, ENTER);
  await waitUntil(() => executedModes.length === 2, 'the execution starts');
  assert.deepEqual(executedModes, ['dry-run', 'execute']);
  await waitForFrame(output, next => next.includes(snapshot.isolates[0]!.name) && next.includes(snapshot.isolates[1]!.name));
});

test('asks how to handle a cached backbone and saves the decision', async context => {
  let saved: PreparedReferenceConsensusRun | undefined;
  const {input, output, reviewed} = renderScreen(context, {
    rows: 80,
    backboneCached: true,
    saveRun: async prepared => {
      saved = prepared;
      return `${prepared.outputDirectory}/config.yaml`;
    },
  });
  await waitForFrame(output, frame => selectedLine(frame) !== undefined);
  await typeInto(input, output, 'backbone-accession', 'GCF_000149205.2');
  await chooseIsolates(input, output, ['wild-type']);
  await startReview(input, output);

  await waitUntil(() => reviewed.length === 1, 'the run is prepared');
  // The cache decision replaces the form and names the cached accession.
  const cacheFrame = await waitForFrame(
    output,
    frame => frame.includes('GCF_000149205.2') && fieldLine(frame, 'isolates') === undefined,
  );
  // As on a choice field of the form, → on the cache entry chooses its next option.
  await press(input, ARROW_RIGHT);
  await waitForFrame(output, frame => frame !== cacheFrame);
  await startReview(input, output);
  await waitForFrame(output, frame => frame.includes(reviewed[0]!.configuration.run.id));
  await press(input, ENTER);
  await waitUntil(() => saved !== undefined, 'the run is saved');
  const backbone = saved?.configuration.inputs.backbone;
  assert.equal(backbone?.source === 'ncbi' ? backbone.ncbi_cache_mode : undefined, 'refresh');
});

test('scrolls a review taller than the terminal', async context => {
  const many: IsolateCatalog = {
    schema_version: 1,
    isolates: Array.from({length: 12}, (_, index) => isolate(`isolate-${String(index + 1)}`, `Isolate ${String(index + 1)}`)),
  };
  const {input, output, reviewed} = renderScreen(context, {catalog: many, rows: 30});
  await waitForFrame(output, frame => selectedLine(frame) !== undefined);
  await typeInto(input, output, 'backbone-accession', 'GCF_000149205.2');
  await focusField(input, output, 'isolates');
  await press(input, ENTER);
  await waitForFrame(output, frame => frame.includes('(isolate-1)'));
  for (let index = 0; index < 12; index += 1) {
    await press(input, SPACE);
    await press(input, ARROW_DOWN);
  }
  await press(input, ENTER);
  await waitForFrame(output, frame => fieldLine(frame, 'isolates')?.includes('12 selected') ?? false);
  await startReview(input, output);
  await waitUntil(() => reviewed.length === 1, 'the run is prepared');
  const {outputDirectory} = reviewed[0]!;

  const first = await waitForFrame(output, frame => frame.includes('↓'));
  assert.ok(!first.includes(outputDirectory));
  assert.ok(first.split('\n').length <= 30);
  for (let page = 0; page < 10 && !output.lastFrame().includes(outputDirectory); page += 1) {
    await press(input, PAGE_DOWN);
  }
  const last = await waitForFrame(output, frame => frame.includes(outputDirectory));
  assert.ok(last.includes('↑'));
  assert.ok(last.split('\n').length <= 30);
});
