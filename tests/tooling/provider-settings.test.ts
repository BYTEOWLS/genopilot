import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {providerError, providerSettings} from '../../src/tooling/provider-settings.js';
import {ncbiProvider} from '../../src/accessions/provider/ncbi/index.js';

test('provider fields have private, replaceable storage, isolated by provider and field', async context => {
  const root = await mkdtemp(join(tmpdir(), 'provider-settings-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const settings = providerSettings(root);
  const other = {...ncbiProvider, id: 'other', fields: [{id: 'token', label: 'Token', kind: 'secret' as const, required: true}]};
  assert.deepEqual(await settings.read(ncbiProvider), {});
  await settings.save(ncbiProvider, 'api-key', '  first\n ');
  await settings.save(other, 'token', 'second');
  await settings.save(ncbiProvider, 'api-key', 'replacement');
  assert.deepEqual(await settings.read(ncbiProvider), {'api-key': 'replacement'});
  assert.deepEqual(await settings.read(other), {token: 'second'});
  assert.equal((await stat(join(root, 'ncbi'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'ncbi', 'api-key'))).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(join(root, 'ncbi', 'api-key'), 'utf8'), /first/);
  await assert.rejects(settings.save(other, 'token', '\n '));
  await assert.rejects(settings.save(other, '../escape', 'value'));
  await settings.clear(ncbiProvider, 'api-key');
  await settings.clear(ncbiProvider, 'api-key');
  assert.deepEqual(await settings.read(ncbiProvider), {});
  assert.deepEqual(await settings.read(other), {token: 'second'});
});

test('remote errors cannot reveal literal or URL-encoded secret values', () => {
  assert.equal(providerError(new Error('key a+b or a%2Bb'), {token: 'a+b'}), 'key [redacted] or [redacted]');
});
