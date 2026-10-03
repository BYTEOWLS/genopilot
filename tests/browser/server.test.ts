import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, rm} from 'node:fs/promises';
import {browserAssets} from './assets.js';
import {get} from 'node:http';
import {startBrowserServer} from '../../src/browser/server.js';
import type {DocumentView} from '../../src/browser/contract.js';

function view(id = 'test'): DocumentView {
  return {id, title: 'Test', provenance: {application: {name: 'Test', version: 'test'}, sources: []}, content: {kind: 'document', openId: 'one', documents: [{id: 'one', title: 'One', links: {}}]}};
}

test('loopback server refuses unauthenticated, cross-origin, unknown, and stale requests', async t => {
  const assets = await browserAssets(t);
  const server = await startBrowserServer({assets});
  t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const selected: string[] = [];
  server.show(view(), id => selected.push(id));
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${server.url}select-item`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  assert.equal((await fetch(`${origin}/`)).status, 403);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(server.url, {headers: {Host: 'attacker.invalid'}}, response => {
      response.resume();
      resolve(response.statusCode);
    }).once('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(server.url, {headers: {Origin: 'https://attacker.invalid'}})).status, 403);
  assert.equal((await fetch(`${server.url}select-item`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  assert.equal((await post({viewId: 'test', itemId: 'one'}, {Origin: 'null'})).status, 403);
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(`${server.url}unknown`)).status, 404);
  const script = await fetch(`${server.url}page.js?path=/etc/passwd`);
  assert.equal(script.status, 200);
  assert.equal(await script.text(), '/* test */');
  assert.equal((await fetch(`${server.url}page.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal((await post({viewId: 'test', itemId: 'unknown'})).status, 400);
  assert.equal((await post({viewId: 'test', itemId: 'one'})).status, 202);
  assert.deepEqual(selected, ['one']);
  assert.equal((await fetch(`${server.url}source?view=test&id=one`)).status, 404);
  assert.equal((await fetch(`${server.url}source?view=test&id=/etc/passwd`)).status, 404);
  const malformed = await fetch(`${server.url}select-item`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: '{'});
  assert.equal(malformed.status, 400);
  assert.equal((await post({note: 'x'.repeat(5000)})).status, 413);
  server.show(view('replacement'), () => {});
  assert.equal((await post({viewId: 'test', itemId: 'one'})).status, 400);
  assert.equal((await fetch(`${server.url}source?view=test&id=one`)).status, 404);
  server.detach();
  assert.equal((await post({viewId: 'replacement', itemId: 'one'})).status, 409);
});

test('SSE publishes selection, replacement, detachment, and closes on shutdown', async t => {
  const connections: boolean[] = [];
  const server = await startBrowserServer({assets: await browserAssets(t), onConnection: value => connections.push(value)});
  t.after(() => server.close());
  server.show(view(), () => {});
  const response = await fetch(`${server.url}events`);
  const reader = response.body!.getReader();
  async function next() {
    const chunk = await reader.read();
    assert.ok(!chunk.done);
    return JSON.parse(new TextDecoder().decode(chunk.value).split('data: ')[1]!.trim());
  }
  assert.equal((await next()).view.id, 'test');
  assert.equal(server.connected, true);
  server.show(view('next'), () => {});
  assert.equal((await next()).view.id, 'next');
  server.detach();
  assert.equal((await next()).navigationAvailable, false);
  await server.close();
  assert.equal((await reader.read()).done, true);
  assert.equal(server.connected, false);
  assert.ok(connections.includes(true));
});

test('startup rejects missing or unreadable page assets before listening', async t => {
  for (const name of ['index.html', 'page.js', 'page.css']) {
    const assets = await browserAssets(t);
    await rm(new URL(name, assets));
    await assert.rejects(startBrowserServer({assets}), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(name));
      assert.ok(error.message.includes('pnpm build'));
      assert.ok(error.cause instanceof Error);
      return true;
    });
  }
  const assets = await browserAssets(t);
  await rm(new URL('page.js', assets));
  await mkdir(new URL('page.js', assets));
  await assert.rejects(startBrowserServer({assets}), /page\.js/);
});
