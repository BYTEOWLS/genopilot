import {readFile, lstat, mkdir, mkdtemp, rename, rm, writeFile} from 'node:fs/promises';
import {basename, join, relative, resolve} from 'node:path';
import {Worker} from 'node:worker_threads';
import {stringify} from 'yaml';
import {packagedPath, packagedUrl} from '../package-root.js';
import {attributeNames, ReplaceOptionsError, type ReplaceOptions, type ReplaceStatistics} from './core.js';
import type {PassRequest, PassResult} from './pass.js';

/** The part of a worker thread a job uses, so tests can inject one that never finishes. */
export type ReplaceWorker = {
  on(event: 'message', listener: (message: WorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
};

export type WorkerMessage =
  | {ok: true; result: PassResult}
  | {ok: false; message: string; invalidOptions: boolean};

export type StartWorker = (request: PassRequest) => ReplaceWorker;

/** The bundled worker next to the CLI, or its source when the application runs through `tsx`. */
function workerUrl(): URL {
  return import.meta.url.endsWith('.ts') ? new URL('./worker.ts', import.meta.url) : packagedUrl('dist/gff3-replace-worker.js');
}

export const startWorker: StartWorker = request => new Worker(workerUrl(), {workerData: request}) as unknown as ReplaceWorker;

/**
 * Runs one pass in a worker. Aborting terminates the worker and rejects with the abort reason once
 * it has stopped.
 */
export function runInWorker(request: PassRequest, signal: AbortSignal | undefined, start: StartWorker = startWorker): Promise<PassResult> {
  signal?.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const worker = start(request);
    let settled = false;
    const settle = (action: () => void): void => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', abort);
        action();
      }
    };
    const abort = (): void => {
      void worker.terminate().catch(() => 0).then(() => settle(() => reject(signal?.reason)));
    };
    signal?.addEventListener('abort', abort, {once: true});
    worker.on('message', message => settle(() => {
      if (message.ok) {
        resolvePromise(message.result);
      } else {
        reject(message.invalidOptions ? new ReplaceOptionsError(message.message) : new Error(message.message));
      }
      void worker.terminate();
    }));
    worker.on('error', error => settle(() => reject(error)));
    // A terminated worker exits before `terminate()` resolves, so a cancel ends here with its reason.
    worker.on('exit', code => settle(() => reject(signal?.aborted
      ? signal.reason
      : new Error(`The replacement stopped unexpectedly (exit code ${String(code)}).`))));
  });
}

export type PreviewRequest = {source: string; options: ReplaceOptions};

/** Previews a replacement: the statistics, samples, and problems a rewrite would have. */
export function previewRewrite(request: PreviewRequest, signal?: AbortSignal, start?: StartWorker): Promise<PassResult> {
  return runInWorker({source: resolve(request.source), options: request.options}, signal, start);
}

/** The prefix of every rewrite folder, followed by its UTC timestamp with milliseconds. */
export const rewriteFolderPrefix = 'gff3-replace-';
/** The record every rewrite folder holds. */
export const recordFileName = 'replace.yaml';
export const idMappingFileName = 'id-mapping.tsv';

/** `gff3-replace-20261111T231405.123Z`: the time with millisecond precision, without colons. */
export function rewriteFolderName(now: Date): string {
  return `${rewriteFolderPrefix}${now.toISOString().replaceAll('-', '').replaceAll(':', '')}`;
}

export type RewriteRecord = {
  schema_version: 1;
  created_at: string;
  application: {name: string; version: string};
  source: {path: string; run_path?: string; sha256: string};
  search: string;
  replacement: string;
  regular_expression: boolean;
  attributes: 'all' | string[];
  files: {gff3: {path: string; sha256: string}; id_mapping: {path: string; sha256: string}};
  statistics: {
    replacements: number;
    changed_values: Record<string, number>;
    ids: {changed: number; matched_unchanged: number; unmatched: number};
    aliases_added: number;
    dangling_in_source: number;
  };
};

export function recordStatistics(statistics: ReplaceStatistics): RewriteRecord['statistics'] {
  return {
    replacements: statistics.replacements,
    changed_values: statistics.changedValues,
    ids: {changed: statistics.ids.changed, matched_unchanged: statistics.ids.matchedUnchanged, unmatched: statistics.ids.unmatched},
    aliases_added: statistics.aliasesAdded,
    dangling_in_source: statistics.danglingInSource,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function applicationIdentity(): Promise<{name: string; version: string}> {
  const metadata = JSON.parse(await readFile(packagedPath('package.json'), 'utf8')) as {name: string; version: string};
  return {name: metadata.name, version: metadata.version};
}

export type WriteRequest = PreviewRequest & {
  /** The source checksum the preview saw. */
  expectedSourceSha256: string;
  /** The folder the rewrite folder is created in, such as a run's `derived/`. */
  outputParent: string;
  /** The run the source belongs to, so the record names the source relative to it. */
  runDirectory?: string;
};

export type WriteOutcome =
  | {state: 'written'; folder: string; record: RewriteRecord; result: PassResult}
  | {state: 'refused'; result: PassResult};

/**
 * Writes a rewrite into a new folder under `outputParent`. Everything is written into a temporary
 * folder that is renamed only when complete, so failure or cancellation leaves no partial folder.
 */
export async function writeRewrite(
  request: WriteRequest,
  signal?: AbortSignal,
  {start, now = () => new Date(), application = applicationIdentity}: {
    start?: StartWorker;
    now?: () => Date;
    application?: () => Promise<{name: string; version: string}>;
  } = {},
): Promise<WriteOutcome> {
  const source = resolve(request.source);
  const parent = resolve(request.outputParent);
  await mkdir(parent, {recursive: true});
  const tempDir = await mkdtemp(join(parent, `.${rewriteFolderPrefix}`));
  try {
    const identity = await application();
    const gff3Name = basename(source);
    const result = await runInWorker({
      source,
      options: request.options,
      expectedSourceSha256: request.expectedSourceSha256,
      output: {gff3: join(tempDir, gff3Name), idMapping: join(tempDir, idMappingFileName)},
    }, signal, start);
    if (!result.written) {
      await rm(tempDir, {recursive: true, force: true});
      return {state: 'refused', result};
    }
    const createdAt = now();
    const runPath = request.runDirectory ? relative(resolve(request.runDirectory), source) : undefined;
    const record: RewriteRecord = {
      schema_version: 1,
      created_at: createdAt.toISOString(),
      application: identity,
      source: {path: source, ...(runPath ? {run_path: runPath} : {}), sha256: result.sourceSha256},
      search: request.options.search,
      replacement: request.options.replacement,
      regular_expression: request.options.regularExpression,
      attributes: request.options.attributes === 'all' ? 'all' : attributeNames(request.options.attributes),
      files: {
        gff3: {path: gff3Name, sha256: result.written.gff3Sha256},
        id_mapping: {path: idMappingFileName, sha256: result.written.idMappingSha256},
      },
      statistics: recordStatistics(result.statistics),
    };
    await writeFile(join(tempDir, recordFileName), stringify(record), 'utf8');
    signal?.throwIfAborted();
    const base = join(parent, rewriteFolderName(createdAt));
    for (let counter = 1; ; counter += 1) {
      const folder = counter === 1 ? base : `${base}-${String(counter)}`;
      if (await exists(folder)) {
        continue;
      }
      try {
        await rename(tempDir, folder);
        return {state: 'written', folder, record, result};
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
          throw error;
        }
      }
    }
  } catch (error) {
    await rm(tempDir, {recursive: true, force: true});
    throw error;
  }
}
