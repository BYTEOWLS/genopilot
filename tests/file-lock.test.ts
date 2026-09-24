import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {acquireFileLock} from '../src/file-lock.js';

async function lockPath(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-lock-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return join(directory, 'test.lock');
}

test('records the owner PID and removes the lock on release', async context => {
  const path = await lockPath(context);
  const lock = await acquireFileLock(path, 'busy');

  assert.equal(lock.recovered, false);
  assert.equal(await readFile(path, 'utf8'), `${String(process.pid)}\n`);
  await lock.release();
  await assert.rejects(stat(path), {code: 'ENOENT'});
});

test('refuses a lock held by a running process', async context => {
  const path = await lockPath(context);
  const lock = await acquireFileLock(path, 'busy');
  context.after(() => lock.release());

  await assert.rejects(acquireFileLock(path, 'Already locked.'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Already locked\./);
    // A crashed owner's PID can be reused, so the researcher must be able to find the lock.
    assert.ok(error.message.includes(path));
    return true;
  });
});

test('recovers a lock whose owner has stopped', async context => {
  const path = await lockPath(context);
  await writeFile(path, '99999999\n');

  const lock = await acquireFileLock(path, 'busy');
  assert.equal(lock.recovered, true);
  await lock.release();
});

test('waits out a recent malformed lock but recovers an old one', async context => {
  const path = await lockPath(context);
  await writeFile(path, '');
  await assert.rejects(acquireFileLock(path, 'busy'), /busy/);

  const old = new Date(Date.now() - 60_000);
  await utimes(path, old, old);
  const lock = await acquireFileLock(path, 'busy');
  assert.equal(lock.recovered, true);
  await lock.release();
});
