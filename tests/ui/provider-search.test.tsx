import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {fileKinds, GenomeProviderRegistry, type GenomeReference} from '../../src/accessions/provider.js';
import {stripVTControlCharacters} from 'node:util';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {veupathdbProvider} from '../../src/accessions/provider/veupathdb/index.js';
import {DownloadForm} from '../../src/ui/accessions-screen/download-form.js';
import {pressKey, rendered, waitFor} from '../wait.js';

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

for (const include of [false, true]) {
  test(`download review applies the provider default and preserves an explicit inclusion choice (${include})`, async context => {
    const full: GenomeReference = {source: 'veupathdb', id: 'FungiDB-70_Synthetic',
      parameters: {site: 'FungiDB', release: 70, organism_abbreviation: 'Synthetic'}};
    const option = veupathdbProvider.downloadOptions![0]!;
    const lookups: GenomeReference[] = [];
    const records: GenomeReference[] = [];
    const requests: GenomeReference[] = [];
    const registry = new GenomeProviderRegistry([{
      ...veupathdbProvider, fields: [], sites: undefined, search: undefined,
      lookupMetadata: async reference => { lookups.push(reference); return null; },
    }]);
    const input = new Input();
    const output = new Output();
    const app = render(<DownloadForm registry={registry} existing={full}
      settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
      outputRoot="/runs" inputActive onConfigure={() => {}} onCancel={() => {}}
      onRecord={async entry => { records.push(entry); }} onComplete={() => {}}
      download={async request => {
        requests.push(request.reference);
        return {reference: request.reference, facts: {}, metadata: null, annotation: 'not-requested', downloaded: true};
      }} />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
    context.after(() => app.unmount());
    const press = async (key: string) => { await pressKey(input, key); await rendered(app); };
    await rendered(app);
    await press('\t');
    await press('\r');
    await waitFor(() => lookups.length === 1, 'review metadata lookup');
    await rendered(app);
    assert.deepEqual(lookups[0], option.apply(full, false));
    assert.equal(requests.length, 0);
    if (include) {
      for (let index = 0; index <= veupathdbProvider.artifacts.length; index++) {
        await press('\t');
      }
      await press(' ');
      await press('\t');
      await press('\t');
    }
    await press('\r');
    await waitFor(() => requests.length === 1, 'explicit download confirmation');
    assert.deepEqual(requests[0], option.apply(full, include));
    assert.deepEqual(records.map(({source, id, parameters}) => ({source, id, parameters})), requests);
  });
}

test('required VEuPathDB setup stays visible on a short terminal and blocks remote actions', async context => {
  const configured: string[] = [];
  const registry = new GenomeProviderRegistry([{
    ...veupathdbProvider,
    resolveExact: async () => assert.fail('missing credentials must block lookup'),
    search: async () => assert.fail('missing credentials must block search'),
  }]);
  const input = new Input();
  const output = new Output();
  output.columns = 60;
  output.rows = 18;
  const app = render(<DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive onConfigure={source => configured.push(source)} onCancel={() => {}}
    onRecord={async () => assert.fail('no record before review')} onComplete={() => assert.fail('no download without credentials')} />,
  {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  const press = async (key: string) => {
    await pressKey(input, key);
    await rendered(app);
    const frame = stripVTControlCharacters(output.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
    assert.ok(frame.split('\n').length <= output.rows, frame);
  };
  await rendered(app);
  await press('\r');
  await press('\r');
  await press('\x1b[A'); // Review action.
  await press('\r');
  await press('\x1b[A'); // Search action.
  await press('\r');
  await press('\x1b[A'); // Configure provider.
  await press('\r');
  assert.deepEqual(configured, [veupathdbProvider.id]);
});

test('provider-declared sites precede search and share inline artifact selection', async context => {
  const searches: [string, string | undefined][] = [];
  let requested: readonly string[] | undefined;
  let completed = false;
  const reference: GenomeReference = {source: 'site-provider', id: 'south-17_example', parameters: {site: 'south', release: 17}};
  const registry = new GenomeProviderRegistry([{
    ...ncbiProvider, id: 'site-provider', cacheDirectory: 'site-provider-cache', fields: [],
    sites: [{id: 'north', label: 'north-marker'}, {id: 'south', label: 'south-marker'}],
    artifacts: fileKinds.map(kind => ({kind, label: `artifact-${kind}`})),
    validateReference: (id, parameters) => ({source: 'site-provider', id, parameters: parameters as Record<string, unknown>}),
    lookupMetadata: undefined,
    metadataSummary: () => 'metadata-marker',
    search: async (query, ctx) => { searches.push([query, ctx.site]); return [{reference, summary: 'result-marker'}]; },
  }]);
  const input = new Input();
  const output = new Output();
  const app = render(<DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive onConfigure={() => {}} onCancel={() => {}} onRecord={async () => {}}
    onComplete={() => { completed = true; }} download={async request => {
      requested = request.kinds;
      assert.deepEqual(request.reference, reference);
      return {reference, cds: '/cds.fna', cds_sha256: 'a'.repeat(64), facts: {}, metadata: null, annotation: 'not-requested', downloaded: true};
    }} />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  const press = async (key: string) => { await pressKey(input, key); await rendered(app); };
  await rendered(app);
  await press('\r');
  await press('\x1b[B');
  await press('\r'); // The second declared site.
  await press('organism-query');
  await press('\t'); // Site row.
  await press('\t'); // Search action.
  await press('\r');
  await waitFor(() => searches.length === 1, 'site-scoped search');
  assert.deepEqual(searches, [['organism-query', 'south']]);
  await waitFor(() => output.output.includes('result-marker'), 'selectable result');
  await press('\r');
  await waitFor(() => output.output.includes(reference.id), 'pinned reference review');
  output.columns = 60;
  output.rows = 18;
  output.emit('resize');
  for (let index = 0; index < 4; index++) {
    await press('\t');
    const frame = stripVTControlCharacters(output.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
    assert.ok(frame.split('\n').length <= output.rows, frame);
    assert.match(frame.split('\n').find(line => line.startsWith('› ')) ?? '', /\[x\]/);
    await press(' ');
  }
  await press('\t'); // CDS stays checked.
  await press('\t'); // Metadata-only action.
  await press('\t'); // Download action.
  assert.equal(requested, undefined);
  await press('\r');
  await waitFor(() => completed, 'CDS-only download');
  assert.deepEqual(requested, ['cds']);
});

test('optional search returns selectable pinned references, not downloads or guessed exact identifiers', async context => {
  const queries: string[] = [];
  const records: unknown[] = [];
  let downloads = 0;
  let completed = false;
  const reference = {source: 'synthetic', id: 'pinned-organism', parameters: {release: 17}};
  const registry = new GenomeProviderRegistry([{
    ...ncbiProvider, id: 'synthetic', cacheDirectory: 'synthetic-cache', fields: [],
    validateReference: (id, parameters) => ({source: 'synthetic', id, parameters: parameters as Record<string, unknown>}),
    resolveExact: async () => assert.fail('selected results already have pinned references'),
    lookupMetadata: undefined,
    search: async query => { queries.push(query); return [{reference, summary: 'synthetic-result-marker'}]; },
  }]);
  const input = new Input();
  const output = new Output();
  const app = render(<DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive onConfigure={() => {}} onCancel={() => {}}
    onRecord={async ref => { records.push(ref); }} onComplete={() => { completed = true; }}
    download={async request => {
      downloads++;
      assert.deepEqual(request.reference, reference);
      return {reference, fasta: '/synthetic.fna', fasta_sha256: 'a'.repeat(64), facts: {}, metadata: null, annotation: 'unavailable', downloaded: true};
    }} />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  const press = async (key: string) => { await pressKey(input, key); await rendered(app); };
  await rendered(app);
  await press('\r');
  await press('synthetic-query');
  await press('\t');
  await press('\r');
  await waitFor(() => output.output.includes('synthetic-result-marker'), 'search results');
  assert.deepEqual(queries, ['synthetic-query']);
  assert.equal(downloads, 0);
  assert.deepEqual(records, []);
  await press('\r');
  assert.equal(downloads, 0, 'even a provider without metadata lookup requires review');
  await waitFor(() => output.output.includes(reference.id) && output.output.includes('17'), 'pinned reference review');
  assert.deepEqual(records, []);
  await press('\r');
  await waitFor(() => completed, 'confirmed selected result download');
  assert.deepEqual(records, [{...reference, metadata: null, cached_copies: []}]);
  assert.equal(downloads, 1);
});
