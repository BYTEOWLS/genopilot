import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import type {Isolate} from '../../src/isolates/catalog.js';
import {
  IsolateCatalogChangedError,
  IsolateCatalogLoadError,
  loadIsolateCatalog,
  updateIsolateCatalog,
} from '../../src/isolates/store.js';

async function catalogPath(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-isolates-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return join(directory, 'isolates', 'isolates.yaml');
}

function isolate(id: string, overrides: Partial<Isolate> = {}): Isolate {
  return {
    id,
    name: `Isolate ${id}`,
    wildtype: false,
    derived_from: null,
    read_pairs: [{r1: `/data/${id}_R1.fq`, r2: `/data/${id}_R2.fq`, trimmed: false}],
    ...overrides,
  };
}

test('loads a missing catalog as empty without creating it', async context => {
  const path = await catalogPath(context);
  const loaded = await loadIsolateCatalog(path);

  assert.deepEqual(loaded.catalog.isolates, []);
  assert.equal(loaded.revision, undefined);
  await assert.rejects(stat(path), {code: 'ENOENT'});
});

test('saves privately and reloads the same catalog', async context => {
  const path = await catalogPath(context);
  const saved = await updateIsolateCatalog(path, undefined, catalog => ({
    ...catalog,
    isolates: [isolate('isolate-a', {name: 'no', description: 'yes'})],
  }));
  const reloaded = await loadIsolateCatalog(path);

  assert.deepEqual(reloaded, saved);
  // YAML 1.1 readers would turn unquoted `no`/`yes` into booleans.
  assert.match(await readFile(path, 'utf8'), /name: "no"/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, '..'))).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(join(path, '..')), ['isolates.yaml']);
});

test('refuses an update based on a stale revision', async context => {
  const path = await catalogPath(context);
  const first = await updateIsolateCatalog(path, undefined, catalog => ({
    ...catalog,
    isolates: [isolate('a')],
  }));
  await updateIsolateCatalog(path, first.revision, catalog => ({
    ...catalog,
    isolates: [...catalog.isolates, isolate('b')],
  }));

  await assert.rejects(
    updateIsolateCatalog(path, first.revision, catalog => ({...catalog, isolates: []})),
    IsolateCatalogChangedError,
  );
  const current = await loadIsolateCatalog(path);
  assert.deepEqual(current.catalog.isolates.map(entry => entry.id), ['a', 'b']);
});

test('lets only one of two concurrent writers from the same revision succeed', async context => {
  const path = await catalogPath(context);
  const results = await Promise.allSettled([
    updateIsolateCatalog(path, undefined, catalog => ({...catalog, isolates: [isolate('a')]})),
    updateIsolateCatalog(path, undefined, catalog => ({...catalog, isolates: [isolate('b')]})),
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const current = await loadIsolateCatalog(path);
  assert.equal(current.catalog.isolates.length, 1);
  await assert.rejects(stat(`${path}.lock`), {code: 'ENOENT'});
});

test('leaves the file untouched when a mutation is invalid or throws', async context => {
  const path = await catalogPath(context);
  const saved = await updateIsolateCatalog(path, undefined, catalog => ({
    ...catalog,
    isolates: [isolate('a')],
  }));
  const before = await readFile(path, 'utf8');

  await assert.rejects(
    updateIsolateCatalog(path, saved.revision, catalog => ({
      ...catalog,
      isolates: [...catalog.isolates, isolate('b', {derived_from: 'b'})],
    })),
    /derived_from/,
  );
  await assert.rejects(
    updateIsolateCatalog(path, saved.revision, () => {
      throw new Error('mutation failed');
    }),
    /mutation failed/,
  );

  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(await readdir(join(path, '..')), ['isolates.yaml']);
});

test('reports a corrupt catalog with its path and never overwrites it', async context => {
  const path = await catalogPath(context);
  await updateIsolateCatalog(path, undefined, catalog => catalog);
  await writeFile(path, 'schema_version: 1\nisolates: [unclosed\n');

  await assert.rejects(loadIsolateCatalog(path), (error: unknown) => {
    assert.ok(error instanceof IsolateCatalogLoadError);
    assert.equal(error.catalogPath, path);
    assert.ok(error.message.includes(path));
    return true;
  });
  await assert.rejects(
    updateIsolateCatalog(path, undefined, catalog => catalog),
    IsolateCatalogLoadError,
  );
  assert.equal(await readFile(path, 'utf8'), 'schema_version: 1\nisolates: [unclosed\n');
});

test('reports schema violations in an existing catalog', async context => {
  const path = await catalogPath(context);
  await updateIsolateCatalog(path, undefined, catalog => catalog);
  await writeFile(path, 'schema_version: 1\nisolates:\n  - id: a\n');

  await assert.rejects(loadIsolateCatalog(path), /\$\.isolates\[0\]\.name/);
});

test('recovers a lock left by a stopped process', async context => {
  const path = await catalogPath(context);
  await updateIsolateCatalog(path, undefined, catalog => catalog);
  const {revision} = await loadIsolateCatalog(path);
  // PIDs are bounded well below this value on Linux and macOS, so no process owns it.
  await writeFile(`${path}.lock`, '99999999\n');

  await updateIsolateCatalog(path, revision, catalog => ({...catalog, isolates: [isolate('a')]}));
  await assert.rejects(stat(`${path}.lock`), {code: 'ENOENT'});
});

test('refuses to write while another live process holds the lock', async context => {
  const path = await catalogPath(context);
  await updateIsolateCatalog(path, undefined, catalog => catalog);
  const {revision} = await loadIsolateCatalog(path);
  await writeFile(`${path}.lock`, `${String(process.pid)}\n`);

  await assert.rejects(
    updateIsolateCatalog(path, revision, catalog => ({...catalog, isolates: [isolate('a')]})),
    /another Genopilot window/i,
  );
  assert.equal(await readFile(`${path}.lock`, 'utf8'), `${String(process.pid)}\n`);
});
