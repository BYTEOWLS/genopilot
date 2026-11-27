import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import React from 'react';
import {render} from 'ink';
import {defaultTheme} from '@inkjs/ui';
import {GenomeProviderRegistry, type GenomeProvider, type GenomeReference} from '../../src/accessions/provider.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {DownloadForm} from '../../src/ui/accessions-screen/download-form.js';
import {ToolingScreen} from '../../src/ui/tooling-screen/screen.js';
import type {ProviderSettings} from '../../src/tooling/provider-settings.js';
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
function mount(context: TestContext, element: React.ReactElement) {
  const input = new Input();
  const output = new Output();
  const app = render(element, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  return {input, output, app, press: async (key: string) => { await pressKey(input, key); await rendered(app); }};
}
const third: GenomeProvider = {
  ...ncbiProvider, id: 'third', label: 'third-provider-marker', cacheDirectory: 'third-cache',
  fields: [{id: 'token', label: 'third-field-marker', kind: 'secret', required: true}],
  validateReference: (id, parameters) => ({source: 'third', id, parameters: parameters as Record<string, unknown>}),
  resolveExact: async id => ({source: 'third', id, parameters: {release: 12}}),
};
const reviewMetadata = {organism: 'reviewed-organism-marker', source: 'datasets-v2-rest', retrieved_at: '2026-01-01T00:00:00Z'};
const registry = new GenomeProviderRegistry([{...ncbiProvider, lookupMetadata: async () => reviewMetadata}, {...third, id: 'second', label: 'second', cacheDirectory: 'second-cache'}, third]);

test('an injected third provider appears in tooling and renders its declared masked setup field', async context => {
  let reads = 0;
  const saves: unknown[] = [];
  const settings: ProviderSettings = {
    read: async () => { reads++; return {}; },
    save: async (provider, field, value) => { saves.push([provider.id, field, value]); },
    clear: async () => {},
  };
  const screen = mount(context, <ToolingScreen metadata={{label: 'test', version: '0'}} status={{state: 'checking'}}
    onCheck={() => assert.fail('provider setup must not check the runtime')} onBack={() => {}} inputActive registry={registry} settings={settings} />);
  await rendered(screen.app);
  await screen.press('\t');
  await waitFor(() => reads === 3, 'registry provider statuses');
  await screen.press('\x1b[B');
  await screen.press('\x1b[B');
  await screen.press('\r');
  await waitFor(() => reads === 4, 'third provider settings');
  assert.ok(screen.output.output.includes(third.fields[0]!.label));
  await screen.press('secret-marker');
  assert.ok(!screen.output.output.includes('secret-marker'));
  await screen.press('\r');
  assert.equal(saves.length, 0);
  await screen.press('\t');
  await screen.press('\r');
  await waitFor(() => saves.length === 1, 'secret save');
  assert.deepEqual(saves, [['third', 'token', 'secret-marker']]);
});

test('the catalog selector uses the same registry; missing required credentials block only remote work', async context => {
  let reads = 0;
  let records = 0;
  let remote = 0;
  const configured: string[] = [];
  const settings: ProviderSettings = {read: async () => { reads++; return {}; }, save: async () => {}, clear: async () => {}};
  const screen = mount(context, <DownloadForm registry={registry} settings={settings} outputRoot="/runs" inputActive
    onRecord={async () => { records++; }} onComplete={() => {}} onCancel={() => {}}
    download={async () => { remote++; throw new Error('unexpected'); }} onConfigure={source => configured.push(source)} />);
  await rendered(screen.app);
  await screen.press('\x1b[B');
  await screen.press('\x1b[B');
  await screen.press('\r');
  await waitFor(() => reads >= 2, 'selected provider settings');
  const alertConfig = defaultTheme.components.Alert!.config as (props: {variant: string}) => {icon: string};
  assert.ok(screen.output.output.includes(alertConfig({variant: 'warning'}).icon));
  await screen.press('synthetic-id');
  // ID, configure, then download.
  await screen.press('\x1b[A');
  await screen.press('\r');
  assert.equal(records, 0);
  assert.equal(remote, 0);
  await screen.press('\x1b[A');
  await screen.press('\r');
  assert.deepEqual(configured, ['third']);
});

test('optional credentials do not block a download; failure retains its canonical record for retry', async context => {
  const records: unknown[] = [];
  const requests: unknown[] = [];
  let completed = 0;
  let reads = 0;
  const settings: ProviderSettings = {read: async () => { reads++; return {}; }, save: async () => {}, clear: async () => {}};
  const reference = {source: 'ncbi', id: 'GCA_000000001.1', parameters: {}};
  const screen = mount(context, <DownloadForm registry={registry} settings={settings} outputRoot="/default/runs" inputActive
    existing={reference} onRecord={async ref => { records.push(ref); }} onComplete={() => { completed++; }} onCancel={() => {}} onConfigure={() => assert.fail('optional credentials do not add a setup action')}
    download={async request => {
      requests.push(request);
      if (requests.length === 1) { throw new Error('injected-download-failure'); }
      return {reference, fasta: '/cache/genomic.fna', fasta_sha256: 'a'.repeat(64), facts: {}, metadata: null, annotation: 'unavailable', downloaded: true};
    }} />);
  await waitFor(() => reads === 1, 'optional settings');
  await effectsSettled();
  const alertConfig = defaultTheme.components.Alert!.config as (props: {variant: string}) => {icon: string};
  assert.ok(!screen.output.output.includes(alertConfig({variant: 'warning'}).icon));
  await screen.press('\t');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(reviewMetadata.organism), 'metadata review');
  assert.equal(requests.length, 0);
  assert.equal(records.length, 0);
  await screen.press('\r');
  await waitFor(() => requests.length === 1, 'first confirmed attempt');
  await waitFor(() => screen.output.output.includes('injected-download-failure'), 'download failure');
  assert.equal(records.length, 1);
  assert.equal(completed, 0);
  await screen.press('\x1b');
  await screen.press('\r');
  await screen.press('\r');
  await waitFor(() => completed === 1, 'successful confirmed retry');
  assert.deepEqual(requests[0], {reference, root: '/default/runs', kinds: ['fasta', 'gff3'], mode: 'refresh'});
  assert.deepEqual(requests[1], {reference, root: '/default/runs', kinds: ['fasta', 'gff3'], mode: 'refresh'});
});

test('provider artifacts can be unchecked independently before an explicitly confirmed download', async context => {
  const requests: unknown[] = [];
  let completed = false;
  const reference = {source: 'ncbi', id: 'GCA_000000001.1', parameters: {}};
  const screen = mount(context, <DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive existing={reference} onRecord={async () => {}} onCancel={() => {}} onConfigure={() => {}}
    onComplete={() => { completed = true; }} download={async request => {
      requests.push(request);
      return {reference, gff3: '/annotation.gff', gff3_sha256: 'a'.repeat(64), facts: {}, metadata: null, annotation: 'available', downloaded: true};
    }} />);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(reviewMetadata.organism), 'review');
  await screen.press('\t');
  await screen.press('\r'); // Enter on a checkbox does not submit or open another page.
  await screen.press(' '); // Uncheck FASTA inline; GFF3 remains selected.
  await screen.press('\r');
  assert.equal(requests.length, 0, 'choosing artifacts is not download confirmation');
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => completed, 'selected-artifact download');
  assert.deepEqual(requests, [{reference, kinds: ['gff3'], root: '/runs', mode: 'refresh'}]);
});

test('an injected provider owns the artifact list; an empty selection cannot download but can save metadata', async context => {
  let downloaded = false;
  let saved = false;
  let returned = false;
  const reference: GenomeReference = {source: 'third', id: 'synthetic-id', parameters: {release: 12}};
  const singleArtifact = new GenomeProviderRegistry([{
    ...third, fields: [], artifacts: [{kind: 'gff3', label: 'provider-declared-annotation-marker'}], lookupMetadata: undefined,
  }]);
  const screen = mount(context, <DownloadForm registry={singleArtifact} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive existing={reference} onRecord={async () => { saved = true; }} onCancel={() => { returned = true; }} onConfigure={() => {}}
    onComplete={() => {}} download={async () => { downloaded = true; throw new Error('must not download'); }} />);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(singleArtifact.get('third').artifacts[0]!.label), 'inline declared artifact');
  await screen.press('\t');
  await screen.press(' ');
  await screen.press('\x1b[A');
  await screen.press('\r');
  assert.equal(downloaded, false);
  assert.equal(saved, false);
  // Metadata-only saving is still available with every artifact unchecked.
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => returned, 'metadata-only save');
  assert.equal(saved, true);
  assert.equal(downloaded, false);
});

test('leaving inline artifact edits cancels review without saving or downloading', async context => {
  let kinds: readonly string[] | undefined;
  let saved = false;
  const reference = {source: 'ncbi', id: 'GCA_000000001.1', parameters: {}};
  const screen = mount(context, <DownloadForm registry={registry} settings={{read: async () => ({}), save: async () => {}, clear: async () => {}}}
    outputRoot="/runs" inputActive existing={reference} onRecord={async () => { saved = true; }} onCancel={() => {}} onConfigure={() => {}} onComplete={() => {}}
    download={async request => {
      kinds = request.kinds;
      return {reference, fasta: '/fasta.fna', fasta_sha256: 'a'.repeat(64), facts: {}, metadata: null, annotation: 'unavailable', downloaded: true};
    }} />);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(reviewMetadata.organism), 'review');
  await screen.press('\t');
  await screen.press(' ');
  screen.output.rows = 20;
  screen.output.columns = 70;
  screen.output.emit('resize');
  await rendered(screen.app);
  await screen.press('\x1b');
  assert.equal(kinds, undefined);
  assert.equal(saved, false);
  // A new review resets all provider artifacts to checked.
  await screen.press('\r');
  await screen.press('\r');
  await waitFor(() => !!kinds, 'confirmed download after a fresh review');
  assert.deepEqual(kinds, ['fasta', 'gff3']);
});

test('leaving an active download aborts it without reporting completion', async context => {
  let signal: AbortSignal | undefined;
  let completed = false;
  const settings: ProviderSettings = {read: async () => ({}), save: async () => {}, clear: async () => {}};
  const screen = mount(context, <DownloadForm registry={registry} settings={settings} outputRoot="/runs" inputActive
    existing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}}}
    onRecord={async () => {}} onComplete={() => { completed = true; }} onCancel={() => {}} onConfigure={() => {}}
    download={async (_request, context) => {
      signal = context.signal;
      await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), {once: true}));
      throw new Error('unreachable');
    }} />);
  await effectsSettled();
  await screen.press('\x1b[A');
  await screen.press('\r');
  await waitFor(() => screen.output.output.includes(reviewMetadata.organism), 'metadata review');
  assert.equal(signal, undefined);
  await screen.press('\r');
  await waitFor(() => !!signal, 'confirmed download start');
  screen.app.unmount();
  assert.equal(signal!.aborted, true);
  assert.equal(completed, false);
});
