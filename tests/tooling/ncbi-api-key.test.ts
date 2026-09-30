import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  clearNcbiApiKey,
  isNcbiApiKeyConfigured,
  readNcbiApiKey,
  writeNcbiApiKey,
} from '../../src/tooling/ncbi-api-key.js';

async function temporaryKeyPath(context: import('node:test').TestContext): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ncbi-api-key-'));
  context.after(() => rm(tempDir, {recursive: true, force: true}));
  return join(tempDir, 'secrets', 'ncbi-api-key');
}

test('reports no key configured until one is saved', async context => {
  const path = await temporaryKeyPath(context);

  assert.equal(await readNcbiApiKey(path), undefined);
  assert.equal(await isNcbiApiKeyConfigured(path), false);
});

test('saves a trimmed key with private, owner-only permissions', async context => {
  const path = await temporaryKeyPath(context);

  await writeNcbiApiKey(path, '  abc123DEF456  ');

  assert.equal(await readNcbiApiKey(path), 'abc123DEF456');
  assert.equal(await isNcbiApiKeyConfigured(path), true);
  const fileStat = await stat(path);
  assert.equal(fileStat.mode & 0o777, 0o600);
  const directoryStat = await stat(join(path, '..'));
  assert.equal(directoryStat.mode & 0o777, 0o700);
});

test('replaces an existing key on a subsequent save', async context => {
  const path = await temporaryKeyPath(context);

  await writeNcbiApiKey(path, 'first-key');
  await writeNcbiApiKey(path, 'second-key');

  assert.equal(await readNcbiApiKey(path), 'second-key');
  const content = await readFile(path, 'utf8');
  assert.doesNotMatch(content, /first-key/);
});

test('re-asserts private permissions when overwriting a loosened file', async context => {
  const path = await temporaryKeyPath(context);
  await writeNcbiApiKey(path, 'first-key');
  await chmod(path, 0o644);

  await writeNcbiApiKey(path, 'second-key');

  const fileStat = await stat(path);
  assert.equal(fileStat.mode & 0o777, 0o600);
});

test('rejects an empty or whitespace-only key', async context => {
  const path = await temporaryKeyPath(context);

  await assert.rejects(writeNcbiApiKey(path, '   '), /must not be empty/);
  assert.equal(await isNcbiApiKeyConfigured(path), false);
});

test('clears a stored key and tolerates clearing when none exists', async context => {
  const path = await temporaryKeyPath(context);
  await writeNcbiApiKey(path, 'a-key');

  await clearNcbiApiKey(path);
  assert.equal(await isNcbiApiKeyConfigured(path), false);

  await clearNcbiApiKey(path);
});
