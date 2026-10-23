import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import type {AccessionEntry} from '../../src/accessions/catalog.js';
import {AccessionForm} from '../../src/ui/accessions-screen/accession-form.js';

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

const pause = () => new Promise(resolve => setTimeout(resolve, 35));

async function waitFor(condition: () => boolean, output: Output): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(output.frame());
}

test('accession details page within the terminal while fields, save, and failures stay visible', async context => {
  const input = new Input();
  const output = new Output();
  const editing: AccessionEntry = {
    accession: 'GCA_000000001.1', name: 'draft-marker', description: 'long note '.repeat(40).trim(),
    ncbi: {organism: 'organism-marker', retrieved_at: '2026-01-01T12:00:00.000Z', source: 'datasets-v2-rest'},
    cached_copies: Array.from({length: 8}, (_, index) => ({
      path: `/synthetic/${'long-directory/'.repeat(6)}cache-${index}-marker/GCA_000000001.1`,
      verified_at: '2026-01-01T12:00:00.000Z', fasta_sha256: 'a'.repeat(64),
    })),
  };
  const submitted: AccessionEntry[] = [];
  let cancelled = false;
  const app = render(<AccessionForm
    catalog={{schema_version: 1, output_roots: [], accessions: [editing]}}
    editing={editing} inputActive
    fetchMetadata={async () => {throw new Error('unexpected lookup');}}
    onSubmit={async entry => {submitted.push(entry); throw new Error(`failure-marker ${'long failure '.repeat(80)}`);}}
    onCancel={() => {cancelled = true;}}
  />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const selected = () => output.frame().split('\n').find(line => line.startsWith('› ')) ?? '';
  const fits = () => output.frame().split('\n').length <= output.rows;
  const press = async (key: string) => {input.write(key); await pause();};

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
