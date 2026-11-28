import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {GenomeProviderRegistry, type ProviderContext} from '../../src/accessions/provider.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import {DownloadForm} from '../../src/ui/accessions-screen/download-form.js';
import {formatBytes} from '../../src/workflows/systems-check.js';
import {effectsSettled, pressKey, rendered, waitFor} from '../wait.js';

class Input extends PassThrough {
  isTTY = true;
  setRawMode() { return this; }
  ref() { return this; }
  unref() { return this; }
}
class Output extends Writable {
  columns = 100;
  rows = 30;
  output = '';
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) { this.output += chunk.toString(); callback(); }
}
const metadata = {organism: 'pre-download-organism-marker', source: 'datasets-v2-rest', retrieved_at: '2026-01-01T00:00:00Z'};
const reference = {source: 'ncbi', id: 'GCA_000000001.1', parameters: {}};
function mount(context: TestContext, lookup: (context: ProviderContext) => Promise<unknown>, options: {
  transfer?: (context: ProviderContext) => Promise<void>;
  save?: (entry: AccessionEntry) => Promise<void>;
} = {}) {
  let records = 0;
  const entries: AccessionEntry[] = [];
  let downloads = 0;
  let completed = false;
  let cancelled = false;
  const input = new Input();
  const output = new Output();
  const registry = new GenomeProviderRegistry([{...ncbiProvider, lookupMetadata: async (_reference, context) => lookup(context)}]);
  const app = render(<DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/synthetic/runs" existing={reference} inputActive onRecord={async entry => { await options.save?.(entry); records++; entries.push(entry); }}
    onComplete={() => { completed = true; }} onCancel={() => { cancelled = true; }} onConfigure={() => {}}
    download={async (_request, context) => {
      downloads++;
      await options.transfer?.(context);
      return {reference, fasta: '/synthetic.fna', fasta_sha256: 'a'.repeat(64), facts: {}, metadata, annotation: 'unavailable', downloaded: true};
    }} />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  return {input, output, app, entries,
    press: async (key: string) => { await pressKey(input, key); await rendered(app); },
    get records() { return records; }, get downloads() { return downloads; },
    get completed() { return completed; }, get cancelled() { return cancelled; },
  };
}

test('a metadata failure cannot download; retry shows metadata and waits for explicit confirmation', async context => {
  let lookups = 0;
  const screen = mount(context, async () => {
    lookups++;
    if (lookups === 1) { throw new Error('injected-metadata-failure'); }
    return metadata;
  });
  await effectsSettled();
  await screen.press('\r');
  assert.equal(lookups, 0, 'Enter in the identifier field does not activate an action');
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes('injected-metadata-failure'), 'lookup failure');
  assert.equal(screen.downloads, 0);
  assert.equal(screen.records, 0);
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(metadata.organism), 'metadata review');
  assert.equal(screen.downloads, 0);
  assert.equal(screen.records, 0);
  await screen.press('\x1b[6~');
  screen.output.rows = 18;
  screen.output.columns = 60;
  screen.output.emit('resize');
  await rendered(screen.app);
  assert.equal(screen.downloads, 0, 'reviewing and resizing never starts the download');
  await screen.press('\r');
  await waitFor(() => screen.completed, 'confirmed download');
  assert.equal(screen.downloads, 1);
  assert.equal(screen.records, 1);
  assert.equal(lookups, 2, 'confirmation uses the reviewed reference, without another lookup');
});

test('metadata-only save persists the reviewed entry without downloading files', async context => {
  const screen = mount(context, async () => metadata);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(metadata.organism), 'metadata review');
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.cancelled, 'return to the catalog after saving metadata');
  assert.deepEqual(screen.entries, [{...reference, metadata, cached_copies: []}]);
  assert.equal(screen.downloads, 0);
  assert.equal(screen.completed, false);
});

test('metadata-only save errors allow retry without fetching genome files', async context => {
  let saves = 0;
  const screen = mount(context, async () => metadata, {save: async () => {
    saves++;
    if (saves === 1) { throw new Error('injected-catalog-save-failure'); }
  }});
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(metadata.organism), 'metadata review');
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes('injected-catalog-save-failure'), 'save error');
  assert.equal(screen.cancelled, false);
  assert.equal(screen.records, 0);
  await screen.press('\r');
  await waitFor(() => screen.cancelled, 'successful retry');
  assert.equal(screen.downloads, 0);
  assert.equal(screen.records, 1);
});

test('download progress displays received bytes with and without a supplied total', async context => {
  let report: ProviderContext['onProgress'];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const screen = mount(context, async () => metadata, {transfer: async transfer => {
    report = transfer.onProgress;
    transfer.onProgress?.({phase: 'downloading', bytes: 1500000, total: 3000000});
    await gate;
  }});
  context.after(release);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(metadata.organism), 'metadata review');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(formatBytes(1500000)) && screen.output.output.includes(formatBytes(3000000)), 'received bytes and known total');
  assert.equal(screen.completed, false);
  screen.output.rows = 18;
  screen.output.columns = 60;
  screen.output.emit('resize');
  await rendered(screen.app);
  const frame = stripVTControlCharacters(screen.output.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
  assert.ok(frame.split('\n').length <= screen.output.rows, frame);
  screen.output.output = '';
  report!({phase: 'downloading', bytes: 1750000});
  await waitFor(() => screen.output.output.includes(formatBytes(1750000)), 'bytes without a fabricated total');
  assert.ok(!screen.output.output.includes(formatBytes(3000000)));
  release();
  await waitFor(() => screen.completed, 'download completion');
});

test('backing out of metadata review never saves a record or starts a download', async context => {
  const screen = mount(context, async () => metadata);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(metadata.organism), 'metadata review');
  await screen.press('\x1b');
  assert.equal(screen.cancelled, false, 'Escape from review returns to selection');
  await screen.press('\x1b');
  assert.equal(screen.cancelled, true);
  assert.equal(screen.downloads, 0);
  assert.equal(screen.records, 0);
});

test('Escape cancels an in-flight metadata lookup without reaching download', async context => {
  let signal: AbortSignal | undefined;
  let stopped = false;
  const screen = mount(context, async context => {
    signal = context.signal;
    return new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => {
      stopped = true;
      reject(context.signal.reason);
    }, {once: true}));
  });
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => !!signal, 'metadata request');
  await screen.press('\x1b');
  await waitFor(() => stopped, 'lookup cancellation');
  assert.equal(signal!.aborted, true);
  assert.equal(screen.downloads, 0);
  assert.equal(screen.records, 0);
});
