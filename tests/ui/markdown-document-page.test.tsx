import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import type {Document, DocumentsLoader} from '../../src/docs/documents.js';
import {parseMarkdown} from '../../src/docs/markdown.js';
import {MarkdownDocumentPage} from '../../src/ui/components/markdown-document-page.js';
import {BrowserViewProvider} from '../../src/browser/provider.js';
import {browserAssets} from '../browser/assets.js';
import {rm, writeFile} from 'node:fs/promises';
import {DocumentationScreen} from '../../src/ui/documentation-screen/screen.js';
import type {DiscoveredWorkflow} from '../../src/workflows/discovery.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';

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

const settle = (milliseconds = 60): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

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
  /** Sends keys one by one and returns everything drawn meanwhile. */
  const press = async (...keys: string[]): Promise<string> => {
    output.output = '';
    for (const key of keys) {
      input.write(key);
      await settle();
    }
    return output.output;
  };
  return {input, output, press, unmount: () => instance.unmount()};
}

test('shows several documents as tabs, each keeping its own scroll position', async () => {
  const load: DocumentsLoader = async () => [longDocument('first'), longDocument('second')];
  const page = mount(<MarkdownDocumentPage title="Docs" load={load} onClose={() => {}} inputActive />);
  try {
    await settle();
    let frame = await page.press(...Array.from({length: 10}, () => PAGE_DOWN));
    assert.match(frame, /End of first\./);
    frame = await page.press(TAB);
    assert.match(frame, /Line 0 of second\./, 'the second tab starts at its top');
    frame = await page.press(TAB);
    assert.match(frame, /End of first\./, 'the first tab kept its scroll position');
  } finally {
    page.unmount();
  }
});

test('shows a missing document as unavailable and closes with Esc', async () => {
  let closed = false;
  const load: DocumentsLoader = async () => [{id: 'README', title: 'README.md'}];
  const page = mount(<MarkdownDocumentPage title="Docs" load={load} onClose={() => { closed = true; }} inputActive />);
  try {
    await settle();
    assert.match(page.output.output, /No documentation is available/);
    await page.press(ESCAPE);
    await settle(100);
    assert.equal(closed, true);
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
    await settle();
    assert.match(page.output.output, /Permission denied sentinel/);
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
    await settle();
    const index = screen.output.output;
    assert.match(index, /App sentinel/);
    assert.match(index, /Label alpha/);
    assert.match(index, /Label beta/);

    let frame = await screen.press(ENTER);
    assert.match(frame, /General body sentinel/);
    await screen.press(ESCAPE);
    frame = await screen.press(ARROW_DOWN, ARROW_DOWN, ENTER);
    assert.match(frame, /Readme of beta\./);
    assert.deepEqual(opened, ['beta']);

    await screen.press(ESCAPE);
    assert.equal(backedOut, false, 'Esc on a document returns to the index');
    await screen.press(ESCAPE);
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('shared document page opens a browser, synchronizes selection, and shuts down with the app', async t => {
  const opened: string[] = [];
  const assetsDirectory = await browserAssets(t);
  const page = mount(<BrowserViewProvider assetsDirectory={assetsDirectory} application={{name: 'Test', version: 'test'}} open={async url => { opened.push(url); }}>
    <MarkdownDocumentPage title="Docs" load={async () => [document('one', 'First sentinel.'), document('two', 'Second sentinel.')]} onClose={() => {}} inputActive />
  </BrowserViewProvider>);
  try {
    await settle();
    await page.press('v');
    assert.equal(opened.length, 1);
    const url = opened[0]!;
    const controller = new AbortController();
    const response = await fetch(`${url}events`, {signal: controller.signal});
    const reader = response.body!.getReader();
    const first = await reader.read();
    const state = JSON.parse(new TextDecoder().decode(first.value).split('data: ')[1]!.trim());
    assert.equal(state.view.content.openId, 'one');
    await page.press(TAB);
    const switched = await reader.read();
    const switchedState = JSON.parse(new TextDecoder().decode(switched.value).split('data: ')[1]!.trim());
    assert.equal(switchedState.view.content.openId, 'two');
    const request = await fetch(`${url}select-item`, {method: 'POST', headers: {Origin: new URL(url).origin, 'Content-Type': 'application/json'}, body: JSON.stringify({viewId: state.view.id, itemId: 'one'})});
    assert.equal(request.status, 202);
    await settle();
    assert.match(page.output.output, /First sentinel/);
    await page.press('v');
    assert.equal(opened.length, 1, 'a connected browser is reused');
    controller.abort();
    page.unmount();
    await settle();
    await assert.rejects(fetch(`${url}events`));
  } finally {
    page.unmount();
  }
});

test('repeated browser requests reuse a pending launch and allow retry afterwards', async t => {
  const opened: string[] = [];
  let finishOpening: (() => void) | undefined;
  const assetsDirectory = await browserAssets(t);
  const page = mount(<BrowserViewProvider assetsDirectory={assetsDirectory} application={{name: 'Test', version: 'test'}} open={url => {
    opened.push(url);
    return new Promise(resolve => { finishOpening = resolve; });
  }}>
    <MarkdownDocumentPage title="Docs" load={async () => [document('one', 'Body.')]} onClose={() => {}} inputActive />
  </BrowserViewProvider>);
  try {
    await settle();
    await page.press('v', 'v');
    assert.equal(opened.length, 1);
    finishOpening!();
    await settle();
    await page.press('v');
    assert.equal(opened.length, 2, 'an unconnected browser can be reopened after the launch completes');
  } finally {
    finishOpening?.();
    page.unmount();
  }
});

test('missing assets fail visibly without opening a browser, and can be retried after repair', async t => {
  const assetsDirectory = await browserAssets(t);
  const missingAsset = new URL('page.css', assetsDirectory);
  await rm(missingAsset);
  const opened: string[] = [];
  const page = mount(<BrowserViewProvider assetsDirectory={assetsDirectory} application={{name: 'Test', version: 'test'}} open={async url => { opened.push(url); }}>
    <MarkdownDocumentPage title="Docs" load={async () => [document('one', 'Body.')]} onClose={() => {}} inputActive />
  </BrowserViewProvider>);
  try {
    await settle();
    await page.press('v');
    assert.equal(opened.length, 0);
    assert.ok(page.output.output.includes('page.css'));
    await writeFile(missingAsset, '/* repaired */');
    await page.press('v');
    assert.equal(opened.length, 1);
  } finally {
    page.unmount();
  }
});

test('browser shortcut is inactive when document input is suspended', async () => {
  const opened: string[] = [];
  const page = mount(<BrowserViewProvider application={{name: 'Test', version: 'test'}} open={async url => { opened.push(url); }}>
    <MarkdownDocumentPage title="Docs" load={async () => [document('one', 'Body.')]} onClose={() => {}} inputActive={false} />
  </BrowserViewProvider>);
  try {
    await settle();
    await page.press('v');
    assert.deepEqual(opened, []);
  } finally {
    page.unmount();
  }
});
