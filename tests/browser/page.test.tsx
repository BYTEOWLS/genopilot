import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider, localStorageColorSchemeManager} from '@mantine/core';
import {JSDOM} from 'jsdom';
import {BrowserApp} from '../../src/browser/page/app.js';
import {parseMarkdown} from '../../src/docs/markdown.js';
import type {BrowserState} from '../../src/browser/contract.js';

// DOM tests exercise outcomes and stable document IDs, not presentation labels.
test('browser page follows CLI selections, requests navigation, survives disconnect, and switches themes', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url: 'http://127.0.0.1:1234/token/', pretendToBeVisual: true});
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown): void => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  };
  let mediaDark = false;
  const mediaListeners = new Set<(event: {matches: boolean}) => void>();
  Object.defineProperty(dom.window, 'matchMedia', {value: () => ({matches: mediaDark, addEventListener: (_name: string, listener: (event: {matches: boolean}) => void) => mediaListeners.add(listener), removeEventListener: (_name: string, listener: (event: {matches: boolean}) => void) => mediaListeners.delete(listener)})});
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    install(key, (dom.window as unknown as Record<string, unknown>)[key]);
  }
  install('IS_REACT_ACT_ENVIRONMENT', true);
  let events: FakeEvents;
  class FakeEvents {
    onmessage?: (event: {data: string}) => void;
    onerror?: () => void;
    closed = false;
    constructor() { events = this; }
    close() { this.closed = true; }
  }
  install('EventSource', FakeEvents);
  const requests: unknown[] = [];
  install('fetch', async (_url: string, options: {body: string}) => {
    requests.push(JSON.parse(options.body));
    return {ok: true};
  });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  await act(async () => root.render(<MantineProvider defaultColorScheme="auto" colorSchemeManager={localStorageColorSchemeManager({key: 'genopilot-theme'})}><BrowserApp /></MantineProvider>));
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'light');
  const state: BrowserState = {navigationAvailable: true, view: {id: 'view-1', title: 'Test', provenance: {application: {name: 'Test', version: 'test'}, sources: []}, content: {kind: 'document', openId: 'one', documents: [
    {id: 'one', title: 'One', blocks: parseMarkdown('# First\n\n[Jump](#first-section)\n\n[Other](two.md#second-section)\n\n## first-section\n\n## second-section'), links: {'#first-section': {documentId: 'one', anchor: 'first-section'}, 'two.md#second-section': {documentId: 'two', anchor: 'second-section'}}},
    {id: 'two', title: 'Two', blocks: parseMarkdown('# Second\n\n## second-section'), links: {}},
  ]}}};
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  assert.ok(container.querySelector('#first-section'));
  assert.equal(dom.window.document.title, `${state.view!.provenance.application.name} · ${state.view!.content.documents[0]!.title}`);
  await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'n'})));
  assert.deepEqual(requests, [{viewId: 'view-1', itemId: 'two'}]);
  assert.ok(container.querySelector('#first-section'), 'browser waits for authoritative CLI selection');
  state.view!.content.openId = 'two';
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  assert.ok(container.querySelector('#second-section'));
  assert.equal(dom.window.document.title, `${state.view!.provenance.application.name} · ${state.view!.content.documents[1]!.title}`);
  await act(async () => events!.onerror?.());
  await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'p'})));
  assert.ok(container.querySelector('#first-section'), 'disconnected page remains readable');
  assert.equal(requests.length, 1);
  const scrolled: string[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  state.navigationAvailable = false;
  state.view!.content.openId = 'one';
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  const jump = container.querySelector('article a[href="#first-section"]')!;
  for (let click = 0; click < 2; click += 1) {
    await act(async () => jump.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true})));
  }
  assert.deepEqual(scrolled, ['first-section', 'first-section'], 'each repeated link requests a fresh scroll');
  // A cross-document link must wait for the target document, even if the old document has
  // an identically named heading. Afterwards, unrelated CLI updates must not replay it.
  state.navigationAvailable = true;
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  const other = container.querySelector('article a[href="#second-section"]')!;
  await act(async () => other.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true})));
  assert.equal(scrolled.length, 2);
  state.view!.content.openId = 'two';
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  assert.deepEqual(scrolled, ['first-section', 'first-section', 'second-section']);
  state.view!.content.openId = 'one';
  await act(async () => events!.onmessage?.({data: JSON.stringify(state)}));
  assert.equal(scrolled.length, 3);
  await act(async () => {
    mediaDark = true;
    mediaListeners.forEach(listener => listener({matches: true}));
  });
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'dark');
  const theme = container.querySelector<HTMLButtonElement>('button[data-control="theme"]')!;
  assert.equal(theme.dataset.themeMode, 'auto');
  assert.equal(theme.parentElement?.lastElementChild, theme, 'theme control is last in the header');
  assert.equal(theme.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  assert.ok(theme.getAttribute('aria-label'));
  theme.focus();
  assert.equal(dom.window.document.activeElement, theme);
  const cycleTheme = async (): Promise<void> => {
    await act(async () => theme.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true})));
  };
  await cycleTheme();
  assert.equal(theme.dataset.themeMode, 'light');
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'light');
  assert.equal(dom.window.localStorage.getItem('genopilot-theme'), 'light');
  await act(async () => {
    mediaListeners.forEach(listener => listener({matches: true}));
  });
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'light');
  await cycleTheme();
  assert.equal(theme.dataset.themeMode, 'dark');
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'dark');
  await cycleTheme();
  assert.equal(theme.dataset.themeMode, 'auto');
  assert.equal(dom.window.localStorage.getItem('genopilot-theme'), 'auto');
  await act(async () => {
    mediaDark = false;
    mediaListeners.forEach(listener => listener({matches: false}));
  });
  assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'light');
  assert.equal(container.querySelector('header a[href^="source"]'), null, 'no document download control');
  assert.equal(container.querySelector('header [role="menu"]'), null);
  // The side panel can collapse without losing the active document.
  const sidebarButton = container.querySelector('button[aria-controls="contents"]')!;
  await act(async () => sidebarButton.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true})));
  assert.equal(container.querySelector('#contents'), null);
  assert.ok(container.querySelector('#first-section'));
  // Storage failure does not prevent selecting a theme.
  Object.defineProperty(dom.window, 'localStorage', {get: () => { throw new Error('disabled'); }});
  const warn = console.warn;
  console.warn = () => {};
  try {
    await cycleTheme();
    await cycleTheme();
    assert.equal(dom.window.document.documentElement.dataset.mantineColorScheme, 'dark');
  } finally {
    console.warn = warn;
  }
  await act(async () => root.unmount());
  assert.equal(events!.closed, true);
});
