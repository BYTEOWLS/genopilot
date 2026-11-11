import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import type {Document, DocumentsLoader} from '../../src/docs/documents.js';
import {parseMarkdown} from '../../src/docs/markdown.js';
import {MarkdownDocumentPage} from '../../src/ui/components/markdown-document-page.js';
import {DocumentationScreen} from '../../src/ui/documentation-screen/screen.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import {waitFor, pressKey} from '../wait.js';

const ESCAPE = '\x1b';
const ENTER = '\r';
const TAB = '\t';
const ARROW_DOWN = '\x1b[B';
const PAGE_DOWN = '\x1b[6~';

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
  rows = 20;
  columns = 80;
  readonly isTTY = true;
  output = '';

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

function document(id: string, body: string): Document {
  return {id, title: `Title ${id}`, blocks: parseMarkdown(`# Title ${id}\n\n${body}`)};
}

/** A document long enough to scroll, with a marker on its last line. */
function longDocument(id: string): Document {
  return document(id, `${Array.from({length: 40}, (_, index) => `Line ${String(index)} of ${id}.`).join('\n\n')}\n\nEnd of ${id}.`);
}

function mount(element: React.JSX.Element) {
  const input = new TestInput();
  const output = new TestOutput();
  const instance = render(element, {
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  /** Sends keys one by one, forgetting what was drawn before. */
  const press = async (...keys: string[]): Promise<void> => {
    output.output = '';
    for (const key of keys) {
      await pressKey(input, key);
    }
  };
  /** Waits until the output drawn since the last keys matches. */
  const shows = (pattern: RegExp, message?: string) =>
    waitFor(() => pattern.test(output.output), message ?? `the output matches ${String(pattern)}`, () => output.output);
  return {input, output, press, shows, unmount: () => instance.unmount()};
}

test('shows several documents as tabs, each keeping its own scroll position', async () => {
  const load: DocumentsLoader = async () => [longDocument('first'), longDocument('second')];
  const page = mount(<MarkdownDocumentPage title="Docs" load={load} onClose={() => {}} inputActive />);
  try {
    await page.shows(/Line 0 of first\./);
    await page.press(...Array.from({length: 10}, () => PAGE_DOWN));
    await page.shows(/End of first\./);
    await page.press(TAB);
    await page.shows(/Line 0 of second\./, 'the second tab starts at its top');
    await page.press(TAB);
    await page.shows(/End of first\./, 'the first tab kept its scroll position');
  } finally {
    page.unmount();
  }
});

test('shows a missing document as unavailable and closes with Esc', async () => {
  let closed = false;
  const load: DocumentsLoader = async () => [{id: 'README', title: 'README.md'}];
  const page = mount(<MarkdownDocumentPage title="Docs" load={load} onClose={() => { closed = true; }} inputActive />);
  try {
    await page.shows(/No documentation is available/);
    await page.press(ESCAPE);
    await waitFor(() => closed, 'the page closes');
  } finally {
    page.unmount();
  }
});

test('reports documentation that cannot be read', async () => {
  const load: DocumentsLoader = async () => {
    throw new Error('Permission denied sentinel');
  };
  const page = mount(<MarkdownDocumentPage title="Docs" load={load} onClose={() => {}} inputActive />);
  try {
    await page.shows(/Permission denied sentinel/);
  } finally {
    page.unmount();
  }
});

function workflow(id: string): DiscoveredWorkflow {
  const manifest = {id, label: `Label ${id}`, description: `Description ${id}`} as WorkflowManifest;
  return {manifest, directoryUrl: new URL(`file:///packaged/${id}/`), parameterDefinitions: []};
}

test('lists the general topic and one topic per discovered workflow, and opens their documents', async () => {
  const opened: string[] = [];
  let backedOut = false;
  const screen = mount(
    <DocumentationScreen
      appLabel="App sentinel"
      discoverWorkflows={async () => [workflow('alpha'), workflow('beta')]}
      onBack={() => { backedOut = true; }}
      inputActive
      loadGeneral={async () => [document('help', 'General body sentinel.')]}
      loadWorkflow={async discovered => {
        opened.push(discovered.manifest.id);
        return [document('README', `Readme of ${discovered.manifest.id}.`), document('results', 'Results body.')];
      }}
    />,
  );
  try {
    await screen.shows(/Label beta/);
    const index = screen.output.output;
    assert.match(index, /App sentinel/);
    assert.match(index, /Label alpha/);

    await screen.press(ENTER);
    await screen.shows(/General body sentinel/);
    await screen.press(ESCAPE);
    await screen.shows(/Label beta/);
    await screen.press(ARROW_DOWN, ARROW_DOWN, ENTER);
    await screen.shows(/Readme of beta\./);
    assert.deepEqual(opened, ['beta']);

    await screen.press(ESCAPE);
    await screen.shows(/Label beta/);
    assert.equal(backedOut, false, 'Esc on a document returns to the index');
    await screen.press(ESCAPE);
    await waitFor(() => backedOut, 'Esc on the index goes back');
  } finally {
    screen.unmount();
  }
});
