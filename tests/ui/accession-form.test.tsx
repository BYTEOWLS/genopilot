import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {defaultTheme} from '@inkjs/ui';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import {accessionSources} from '../../src/accessions/registry.js';
import {GenomeProviderRegistry, type FileKind, type GenomeDownloadProgress} from '../../src/accessions/provider.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';
import {veupathdbProvider} from '../../src/accessions/provider/veupathdb/index.js';
import {AccessionForm} from '../../src/ui/accessions-screen/accession-form.js';
import {pressKey, rendered, waitFor as waitUntil} from '../wait.js';

class Input extends PassThrough {
  isTTY = true;
  setRawMode() {return this;}
  ref() {return this;}
  unref() {return this;}
}

class Output extends Writable {
  columns = 80;
  rows = 24;
  output = '';
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
    this.output += chunk.toString();
    callback();
  }
  frame(): string {
    return stripVTControlCharacters(this.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
  }
}

async function waitFor(condition: () => boolean, output: Output): Promise<void> {
  await waitUntil(condition, 'the expected frame', () => output.frame());
}

test('provider download options toggle the reference without submitting and remain usable after resizing', async context => {
  const input = new Input();
  const output = new Output();
  const registry = new GenomeProviderRegistry([veupathdbProvider]);
  const option = veupathdbProvider.downloadOptions![0]!;
  let editing: AccessionEntry = {...option.apply({source: 'veupathdb', id: 'FungiDB-70_Synthetic',
    parameters: {site: 'FungiDB', release: 70, organism_abbreviation: 'Synthetic'}}, false), metadata: null, cached_copies: []};
  let changes = 0;
  let submissions = 0;
  let cancelled = false;
  const view = () => <AccessionForm editing={editing} registry={registry} downloadRoot="/runs" inputActive
    downloadArtifacts={['fasta', 'gff3']} onArtifactsChange={() => {}}
    onReferenceChange={reference => { changes++; editing = {...editing, ...reference}; app.rerender(view()); }}
    onSubmit={async () => { submissions++; }} onCancel={() => { cancelled = true; }} />;
  const app = render(view(), {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await rendered(app);
  for (let index = 0; index <= veupathdbProvider.artifacts.length; index++) {
    await pressKey(input, '\t');
    await rendered(app);
  }
  output.rows = 18;
  output.columns = 70;
  output.emit('resize');
  await rendered(app);
  assert.ok(output.frame().split('\n').length <= output.rows, output.frame());
  await pressKey(input, '\r');
  await rendered(app);
  assert.equal(submissions, 0);
  await pressKey(input, ' ');
  await waitUntil(() => changes === 1, 'provider option callback');
  assert.equal(option.checked(editing), true);
  await pressKey(input, '\x1b[D');
  await waitUntil(() => changes === 2, 'provider option toggled off');
  assert.equal(option.checked(editing), false);
  await pressKey(input, '\x1b');
  await waitUntil(() => cancelled, 'cancel review');
  assert.equal(submissions, 0);
});

for (const reviewing of [false, true]) {
  test(`provider-independent metadata renders shared facts before custom attributes in ${reviewing ? 'review' : 'editor'}`, async context => {
    const input = new Input();
    const output = new Output();
    output.rows = 60;
    const opaque = {provider_fact: 'raw-marker'};
    const registry = new GenomeProviderRegistry([{
      ...ncbiProvider, id: 'synthetic', cacheDirectory: 'synthetic-cache',
      mapMetadata(value) {
        assert.deepEqual(value, opaque);
        return {assembly: {organism: 'shared-organism-marker', assembly_name: 'shared-assembly-marker'},
          statistics: {total_sequence_length: 12345},
          provider_attributes: [{id: 'specific', label: 'Custom', value: 'custom-value-marker'}]};
      },
    }]);
    const app = render(<AccessionForm registry={registry}
      editing={{source: 'synthetic', id: 'genome-id', parameters: {}, metadata: opaque, cached_copies: []}}
      downloadRoot={reviewing ? '/runs' : undefined} inputActive onSubmit={async () => assert.fail('read-only facts must not submit')}
      onCancel={() => {}} />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
    context.after(() => app.unmount());
    await rendered(app);
    const frame = output.frame();
    assert.ok(frame.includes('shared-organism-marker'), frame);
    assert.ok(frame.includes('shared-assembly-marker'), frame);
    assert.ok(frame.includes('12,345 bp'), frame);
    assert.ok(frame.indexOf('custom-value-marker') > frame.indexOf('12,345 bp'), frame);
    assert.ok(!frame.includes('raw-marker'), 'raw provider objects must not leak into the renderer');
  });
}

test('accession details page within the terminal while fields, save, and failures stay visible', async context => {
  const input = new Input();
  const output = new Output();
  const editing: AccessionEntry = {
    source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, name: 'draft-marker', description: 'long note '.repeat(40).trim(),
    metadata: {organism: 'organism-marker', retrieved_at: '2026-01-01T12:00:00.000Z', source: 'datasets-v2-rest'},
    cached_copies: Array.from({length: 8}, (_, index) => ({
      path: `/synthetic/${'long-directory/'.repeat(6)}cache-${index}-marker/GCA_000000001.1`,
      verified_at: '2026-01-01T12:00:00.000Z', fasta_sha256: 'a'.repeat(64),
    })),
  };
  const submitted: AccessionEntry[] = [];
  let cancelled = false;
  const app = render(<AccessionForm
    registry={accessionSources}
    editing={editing} inputActive
    onSubmit={async entry => {submitted.push(entry); throw new Error(`failure-marker ${'long failure '.repeat(80)}`);}}
    onCancel={() => {cancelled = true;}}
  />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const selected = () => output.frame().split('\n').find(line => line.startsWith('› ')) ?? '';
  const fits = () => output.frame().split('\n').length <= output.rows;
  const press = async (key: string) => {
    await pressKey(input, key);
    await rendered(app);
  };

  await waitFor(() => selected().includes(editing.name!) && output.frame().includes('organism-marker') && fits(), output);
  assert.ok(output.frame().includes('organism-marker'));
  assert.ok(!output.frame().includes('cache-7-marker'));
  for (let page = 0; page < 30 && !output.frame().includes('cache-7-marker'); page++) {
    await press('\x1b[6~');
    assert.ok(selected().includes(editing.name!));
    assert.ok(fits(), output.frame());
  }
  assert.ok(output.frame().includes('cache-7-marker'), 'All cached copies can be reached by paging.');

  output.rows = 18;
  output.columns = 60;
  output.emit('resize');
  await waitFor(() => selected().includes(editing.name!) && fits(), output);
  for (let page = 0; page < 30 && !output.frame().includes('organism-marker'); page++) {
    await press('\x1b[5~');
  }
  assert.ok(output.frame().includes('organism-marker'));
  assert.ok(fits(), output.frame());

  await press('\t');
  await press('-changed');
  await press('\r');
  assert.equal(submitted.length, 0, 'Enter in a text field does not save.');
  output.rows = 24;
  output.columns = 80;
  output.emit('resize');
  await press('\t');
  await press('\r');
  await waitFor(() => output.frame().includes('failure-marker') && fits(), output);
  assert.equal(submitted[0]?.description, `${editing.description}-changed`);
  assert.ok(selected().startsWith('› ['));
  await press('\x1b');
  assert.equal(cancelled, true);
});

for (const variant of ['info', 'warning'] as const) {
  test(`editor status uses an ${variant} alert`, async context => {
    const input = new Input();
    const output = new Output();
    const config = defaultTheme.components.Alert!.config as (props: {variant: string}) => {icon: string};
    const app = render(<AccessionForm registry={accessionSources} inputActive
      editing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, metadata: null, cached_copies: []}}
      onSubmit={async () => {}} onCancel={() => {}} onDownload={() => {}} onRefreshMetadata={async () => {}}
      message={{text: 'status-marker', variant}}
    />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
    context.after(() => app.unmount());
    await rendered(app);
    assert.ok(output.frame().includes(config({variant}).icon), output.frame());
    assert.ok(output.frame().includes('status-marker'));
    assert.ok(output.frame().split('\n').length <= output.rows, output.frame());
  });
}

test('review checkboxes follow focus and keep actions visible in a short terminal', async context => {
  const input = new Input();
  const output = new Output();
  output.columns = 60;
  output.rows = 18;
  let downloads = 0;
  const changes: string[][] = [];
  function Review() {
    const [kinds, setKinds] = React.useState<readonly FileKind[]>(['fasta', 'gff3']);
    return <AccessionForm registry={accessionSources} inputActive downloadRoot="/runs"
      editing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, metadata: null, cached_copies: []}}
      downloadArtifacts={kinds} onArtifactsChange={next => { changes.push([...next]); setKinds(next); }}
      onSaveMetadata={async () => {}} onSubmit={async () => { downloads++; throw new Error('retry-marker'); }} onCancel={() => {}} />;
  }
  const app = render(<Review />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false, patchConsole: false});
  context.after(() => app.unmount());
  const fits = () => output.frame().split('\n').length <= output.rows;
  const press = async (key: string) => { await pressKey(input, key); await rendered(app); assert.ok(fits(), output.frame()); };
  await rendered(app);
  assert.ok(fits(), output.frame());
  // Scroll details while an action owns focus, then return to the first checkbox.
  await press('\x1b[6~');
  await press('\t');
  assert.match(output.frame().split('\n').find(line => line.startsWith('› ')) ?? '', /\[x\]/);
  await press('\x1b[C');
  assert.deepEqual(changes.at(-1), ['gff3']);
  await press('\r');
  assert.equal(downloads, 0);
  await press('\t');
  output.columns = 70;
  output.rows = 20;
  output.emit('resize');
  await rendered(app);
  assert.ok(fits(), output.frame());
  assert.match(output.frame().split('\n').find(line => line.startsWith('› ')) ?? '', /\[x\]/);
  await press('\x1b[D');
  assert.deepEqual(changes.at(-1), []);
  await press('\x1b[A');
  output.columns = 60;
  output.rows = 18;
  output.emit('resize');
  await rendered(app);
  assert.ok(fits(), output.frame());
  await press('\x1b[A'); // Wrap from the first artifact to the download action.
  await press('\r');
  await waitFor(() => output.frame().includes('retry-marker') && fits(), output);
  assert.equal(downloads, 1);
});

test('inline download progress and cancellation remain visible after resizing', async context => {
  const input = new Input();
  const output = new Output();
  let started = false;
  let cancelled = false;
  function Editor() {
    const [progress, setProgress] = React.useState<GenomeDownloadProgress>();
    return <AccessionForm registry={accessionSources} inputActive progress={progress}
      editing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, metadata: null, cached_copies: []}}
      onSubmit={async () => {}} onCancel={() => {}}
      onRefreshMetadata={async () => {}}
      onDownload={async signal => {
        started = true;
        setProgress({phase: 'downloading', bytes: 1024, total: 4096});
        try {
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
            cancelled = true;
            reject(signal.reason);
          }, {once: true}));
        } finally {
          setProgress(undefined);
        }
      }} />;
  }
  const app = render(<Editor />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await rendered(app);
  await pressKey(input, '\t');
  await pressKey(input, '\t');
  await pressKey(input, '\r');
  await waitFor(() => started, output);
  output.rows = 18;
  output.columns = 60;
  output.emit('resize');
  await rendered(app);
  assert.ok(output.frame().split('\n').length <= output.rows, output.frame());
  await pressKey(input, '\x1b');
  await waitFor(() => cancelled, output);
});

test('metadata refresh is a selectable editor action and does not intercept typing', async context => {
  const input = new Input();
  const output = new Output();
  let refreshed = 0;
  const saved: AccessionEntry[] = [];
  const app = render(<AccessionForm registry={accessionSources}
    editing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, metadata: null, cached_copies: []}}
    inputActive onDownload={() => {}} onRefreshMetadata={async () => { refreshed += 1; }}
    onSubmit={async entry => { saved.push(entry); }} onCancel={() => {}}
  />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  await rendered(app);
  const press = async (key: string) => {
    await pressKey(input, key);
    await rendered(app);
  };
  await press('m');
  await press('\r');
  assert.equal(refreshed, 0);
  await press('\t');
  await press('\t');
  await press('\t');
  output.rows = 18;
  output.columns = 60;
  output.emit('resize');
  await rendered(app);
  assert.ok(output.frame().split('\n').length <= output.rows, output.frame());
  assert.ok(output.frame().split('\n').some(line => line.startsWith('› [ ')));
  await press('\r');
  assert.equal(refreshed, 1);
  assert.equal(saved.length, 0);
  await press('\t');
  await press('\r');
  await waitFor(() => saved.length === 1, output);
  assert.equal(saved[0]?.name, 'm');
});

for (const activation of ['button', 'shortcut'] as const) {
  test(`accession editor downloads by ${activation} without intercepting typed text`, async context => {
    const input = new Input();
    const output = new Output();
    let downloads = 0;
    const saved: AccessionEntry[] = [];
    const app = render(<AccessionForm registry={accessionSources}
      editing={{source: 'ncbi', id: 'GCA_000000001.1', parameters: {}, metadata: null, cached_copies: []}}
      inputActive onDownload={() => { downloads += 1; }}
      onSubmit={async entry => { saved.push(entry); throw new Error('save-marker'); }} onCancel={() => {}}
    />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
    context.after(() => app.unmount());
    await rendered(app);
    const press = async (key: string) => {
      await pressKey(input, key);
      await rendered(app);
    };
    await press('g');
    await press('\r');
    assert.equal(downloads, 0, 'typing and Enter in fields never start a download');
    await press('\t');
    await press('\t');
    output.rows = 18;
    output.columns = 60;
    output.emit('resize');
    await rendered(app);
    assert.ok(output.frame().split('\n').length <= output.rows, output.frame());
    assert.ok(output.frame().split('\n').some(line => line.startsWith('› [ ')), 'download action remains visible');
    await press(activation === 'button' ? '\r' : 'g');
    assert.equal(downloads, 1);
    assert.equal(saved.length, 0, 'download does not implicitly save labels');
    await press('\t');
    await press('\r');
    await waitFor(() => saved.length === 1, output);
    assert.equal(saved[0]?.name, 'g', 'the download shortcut remains ordinary text in a field');
  });
}
