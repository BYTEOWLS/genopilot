import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import type {ReplaceOptions} from '../../src/gff3-replace/core.js';
import type {WriteOutcome, WriteRequest} from '../../src/gff3-replace/job.js';
import type {PassResult} from '../../src/gff3-replace/pass.js';
import {Gff3ReplaceScreen} from '../../src/ui/gff3-replace-screen/screen.js';
import {pressKey, rendered, waitFor} from '../wait.js';

class Input extends PassThrough {
  isTTY = true;
  setRawMode() {return this;}
  ref() {return this;}
  unref() {return this;}
}

class Output extends Writable {
  columns = 100;
  rows = 60;
  output = '';
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
    this.output += chunk.toString();
    callback();
  }
  frame(): string {
    return stripVTControlCharacters(this.output.split(/\x1b\[[GH]/).at(-1) ?? '').trimEnd();
  }
}

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const ESCAPE = '\x1b';

function result(problems: string[] = []): PassResult {
  return {
    statistics: {replacements: 2, changedValues: {ID: 1, Name: 1}, ids: {changed: 1, matchedUnchanged: 0, unmatched: 0}, aliasesAdded: 1, danglingInSource: 0},
    samples: {ID: [{before: 'AN1', after: 'X1'}]},
    problems,
    moreProblems: 0,
    sourceSha256: 'a'.repeat(64),
  };
}

function setup(context: {after: (fn: () => void) => void}, overrides: {
  preview?: (request: {source: string; options: ReplaceOptions}, signal: AbortSignal) => Promise<PassResult>;
} = {}) {
  const input = new Input();
  const output = new Output();
  const previews: {source: string; options: ReplaceOptions}[] = [];
  const writes: WriteRequest[] = [];
  let back = 0;
  const app = render(<Gff3ReplaceScreen
    currentDirectory="/synthetic"
    source="/synthetic/run/results/annotation.gff3"
    sourceFixed
    inputActive
    onBack={() => {back += 1;}}
    findRun={async () => '/synthetic/run'}
    pathExists={() => true}
    preview={overrides.preview ?? (async request => {previews.push(request); return result();})}
    write={async request => {
      writes.push(request);
      return {state: 'written', folder: '/synthetic/run/derived/gff3-replace-x', result: result(), record: {
        files: {gff3: {path: 'annotation.gff3', sha256: 'b'.repeat(64)}, id_mapping: {path: 'id-mapping.tsv', sha256: 'c'.repeat(64)}},
      }} as unknown as WriteOutcome;
    }}
  />, {stdin: input, stdout: output, stderr: output, interactive: true, exitOnCtrlC: false});
  context.after(() => app.unmount());
  const press = async (key: string) => {
    await pressKey(input, key);
    await rendered(app);
  };
  return {app, output, press, previews, writes, back: () => back};
}

test('previews, then writes a run\'s rewrite into its derived folder, then returns', async context => {
  const screen = setup(context);
  await rendered(screen.app);
  for (const character of 'AN') {
    await screen.press(character);
  }
  await screen.press(DOWN);
  await screen.press('X');
  // Up from the first field wraps to the button.
  await screen.press(UP);
  await screen.press(UP);
  await screen.press('\r');
  await waitFor(() => screen.previews.length === 1, 'the preview runs', () => screen.output.frame());
  assert.deepEqual(screen.previews[0], {
    source: '/synthetic/run/results/annotation.gff3',
    options: {search: 'AN', replacement: 'X', regularExpression: false, attributes: ['ids', 'Name', 'locus_tag']},
  });
  await rendered(screen.app);
  await screen.press('\r');
  await waitFor(() => screen.writes.length === 1, 'the rewrite is written', () => screen.output.frame());
  assert.equal(screen.writes[0]?.outputParent, '/synthetic/run/derived');
  assert.equal(screen.writes[0]?.runDirectory, '/synthetic/run');
  assert.equal(screen.writes[0]?.expectedSourceSha256, 'a'.repeat(64));
  await waitFor(() => screen.output.frame().includes('/synthetic/run/derived/gff3-replace-x'), 'the result view shows the folder');
  await screen.press(ESCAPE);
  assert.equal(screen.back(), 1);
});

test('a change after the preview needs a new preview before writing', async context => {
  const screen = setup(context);
  await rendered(screen.app);
  await screen.press('A');
  await screen.press(UP);
  await screen.press('\r');
  await waitFor(() => screen.previews.length === 1, 'the first preview runs');
  await rendered(screen.app);
  // From the button, down wraps to Search, then Replacement and the regular-expression switch.
  await screen.press(DOWN);
  await screen.press(DOWN);
  await screen.press(DOWN);
  await screen.press(' ');
  await screen.press(UP);
  await screen.press(UP);
  await screen.press(UP);
  await screen.press('\r');
  await waitFor(() => screen.previews.length === 2, 'a second preview runs');
  assert.equal(screen.previews[1]?.options.regularExpression, true);
  assert.equal(screen.writes.length, 0);
});

test('an empty search is rejected without a preview', async context => {
  const screen = setup(context);
  await rendered(screen.app);
  await screen.press(UP);
  await screen.press('\r');
  await rendered(screen.app);
  assert.equal(screen.previews.length, 0);
});

test('Esc cancels a running preview instead of leaving', async context => {
  let aborted = false;
  let started = false;
  const screen = setup(context, {preview: (_request, signal) => new Promise((_resolve, reject) => {
    started = true;
    signal.addEventListener('abort', () => {
      aborted = true;
      reject(signal.reason);
    });
  })});
  await rendered(screen.app);
  await screen.press('A');
  await screen.press(UP);
  await screen.press('\r');
  await waitFor(() => started, 'the preview starts');
  await screen.press(ESCAPE);
  await waitFor(() => aborted, 'the preview is cancelled');
  assert.equal(screen.back(), 0);
  await screen.press(ESCAPE);
  assert.equal(screen.back(), 1);
});
