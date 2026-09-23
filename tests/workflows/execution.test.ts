import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {resolveToolingPaths} from '../../src/tooling/paths.js';
import {
  executeSnakemakeRun,
  prepareSnakemakeRun,
  renderCommand,
} from '../../src/workflows/execution.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-execution-test-'));
  const paths = resolveToolingPaths({
    platform: 'linux',
    architecture: 'x64',
    environment: {XDG_DATA_HOME: root},
    homeDirectory: root,
  });
  return {root, paths};
}

test('builds exact managed Snakemake commands that differ only by mode', async context => {
  const {root, paths} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const startedAt = new Date('2026-09-06T08:50:14.123Z');
  const options = {
    runDirectory: join(root, 'run with spaces'),
    configurationPath: join(root, 'run with spaces', 'config.yaml'),
    snakefilePath: join(root, 'packaged workflow', 'Snakefile'),
    cores: 3,
    paths,
    startedAt,
  };
  const dryRun = prepareSnakemakeRun({...options, mode: 'dry-run'});
  const execution = prepareSnakemakeRun({...options, mode: 'execute'});

  assert.equal(dryRun.executable, paths.snakemakeExecutable);
  assert.deepEqual(dryRun.arguments.slice(-7), [
    '--cores',
    '3',
    '--use-conda',
    // Rule environments are shared by every run instead of being copied into each run's own
    // `.snakemake/`, which for a real workflow is hundreds of megabytes per run.
    '--conda-prefix',
    paths.condaEnvironmentsDirectory,
    '--printshellcmds',
    '--dry-run',
  ]);
  assert.ok(!execution.arguments.includes('--dry-run'));

  // Only a real execution records progress events; a dry run schedules nothing, so its preview
  // must not be mixed into the run's record of what actually happened.
  assert.equal(dryRun.eventsPath, undefined);
  assert.ok(!dryRun.arguments.includes('--logger'));
  assert.equal(execution.eventsPath, join(root, 'run with spaces', 'events.jsonl'));
  assert.deepEqual(execution.arguments.slice(-4), [
    '--logger',
    'genopilot-run-events',
    '--logger-genopilot-run-events-path',
    execution.eventsPath,
  ]);
  assert.ok(execution.arguments.includes('--conda-prefix'));
  assert.ok(!paths.condaEnvironmentsDirectory.startsWith(execution.runDirectory));
  assert.ok(dryRun.arguments.includes('--directory'));
  assert.ok(dryRun.arguments.includes('--configfile'));
  assert.match(dryRun.command, /'[^']*run with spaces'/);
  assert.equal(renderCommand('/tool', ["a'b"]), "/tool 'a'\"'\"'b'");

  // Each attempt keeps its own preserved logs: a dry run and an execution in the same run
  // directory, or a retry after a failure, must never overwrite an earlier attempt's output.
  assert.match(dryRun.stdoutLogPath, /logs\/snakemake-dry-run\.2026-09-06_085014123\.stdout\.log$/);
  assert.match(dryRun.stderrLogPath, /logs\/snakemake-dry-run\.2026-09-06_085014123\.stderr\.log$/);
  assert.match(execution.stdoutLogPath, /logs\/snakemake-execute\.2026-09-06_085014123\.stdout\.log$/);
  assert.notEqual(
    prepareSnakemakeRun({
      ...options,
      mode: 'execute',
      startedAt: new Date('2026-09-06T09:00:00.000Z'),
    }).stdoutLogPath,
    execution.stdoutLogPath,
  );
});

test('streams output, exports the API key only in the child environment, and retains complete logs', async context => {
  const {root, paths} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const runDirectory = join(root, 'run');
  const scriptPath = join(root, 'fake-snakemake.mjs');
  await writeFile(
    scriptPath,
    "process.stdout.write(`out:${process.env.NCBI_API_KEY ?? 'missing'}\\n`); process.stderr.write('warning\\n');",
  );
  await chmod(scriptPath, 0o700);
  const prepared = prepareSnakemakeRun({
    mode: 'execute',
    runDirectory,
    configurationPath: join(runDirectory, 'config.yaml'),
    snakefilePath: join(root, 'Snakefile'),
    cores: 2,
    paths,
  });
  prepared.executable = process.execPath;
  prepared.arguments = [scriptPath];
  prepared.command = renderCommand(prepared.executable, prepared.arguments);
  const output: string[] = [];

  const result = await executeSnakemakeRun(
    prepared,
    (event: {stream: string; text: string}) => output.push(`${event.stream}:${event.text}`),
    undefined,
    {paths, readApiKey: async () => 'private-key'},
  );

  assert.equal(result.exitCode, 0);
  assert.ok(output.some(line => line.includes('stdout:out:private-key')));
  assert.equal(await readFile(result.stdoutLogPath, 'utf8'), 'out:private-key\n');
  assert.equal(await readFile(result.stderrLogPath, 'utf8'), 'warning\n');
  assert.doesNotMatch(prepared.command, /private-key/);
});

test('returns a non-zero exit code and preserves failure output', async context => {
  const {root, paths} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const runDirectory = join(root, 'run');
  const prepared = prepareSnakemakeRun({
    mode: 'execute',
    runDirectory,
    configurationPath: join(runDirectory, 'config.yaml'),
    snakefilePath: join(root, 'Snakefile'),
    cores: 1,
    paths,
  });
  prepared.executable = process.execPath;
  prepared.arguments = ['--eval', "process.stderr.write('failed\\n'); process.exit(7)"];

  const result = await executeSnakemakeRun(prepared, undefined, undefined, {
    paths,
    readApiKey: async () => undefined,
  });
  assert.equal(result.exitCode, 7);
  assert.equal(await readFile(result.stderrLogPath, 'utf8'), 'failed\n');
});

test('reports a process start failure while retaining empty logs', async context => {
  const {root, paths} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const runDirectory = join(root, 'run');
  const prepared = prepareSnakemakeRun({
    mode: 'execute',
    runDirectory,
    configurationPath: join(runDirectory, 'config.yaml'),
    snakefilePath: join(root, 'Snakefile'),
    cores: 1,
    paths,
  });
  prepared.executable = join(root, 'missing-snakemake');

  await assert.rejects(
    executeSnakemakeRun(prepared, undefined, undefined, {
      paths,
      readApiKey: async () => undefined,
    }),
    /ENOENT/,
  );
  assert.equal(await readFile(prepared.stdoutLogPath, 'utf8'), '');
  assert.equal(await readFile(prepared.stderrLogPath, 'utf8'), '');
});

test('cancels the detached process and still closes its log files', async context => {
  const {root, paths} = await fixture();
  context.after(() => rm(root, {recursive: true, force: true}));
  const runDirectory = join(root, 'run');
  const prepared = prepareSnakemakeRun({
    mode: 'execute',
    runDirectory,
    configurationPath: join(runDirectory, 'config.yaml'),
    snakefilePath: join(root, 'Snakefile'),
    cores: 1,
    paths,
  });
  prepared.executable = process.execPath;
  prepared.arguments = ['--eval', "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"];
  const controller = new AbortController();

  await assert.rejects(
    executeSnakemakeRun(prepared, undefined, controller.signal, {
      paths,
      readApiKey: async () => {
        // Exercise cancellation before executeSnakemakeDryRun has registered its child listener.
        controller.abort();
        return undefined;
      },
    }),
    /Snakemake run cancelled\./,
  );
  assert.equal(await readFile(prepared.stdoutLogPath, 'utf8'), '');
});
