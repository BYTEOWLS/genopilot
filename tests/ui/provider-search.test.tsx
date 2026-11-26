import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {GenomeProviderRegistry} from '../../src/accessions/provider.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
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
