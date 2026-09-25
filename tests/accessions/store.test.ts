import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {
  AccessionCatalogChangedError,
  AccessionCatalogLoadError,
  loadAccessionCatalog,
  updateAccessionCatalog,
} from '../../src/accessions/store.js';

// The locking, atomic replacement, and failure paths are shared with the isolate catalog and
// covered by its store tests; these only confirm the accession catalog is wired to them.

async function catalogPath(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-accessions-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return join(directory, 'accessions', 'accessions.yaml');
}

test('saves privately, reloads, and refuses stale revisions', async context => {
  const path = await catalogPath(context);
  const saved = await updateAccessionCatalog(path, undefined, catalog => ({
    ...catalog,
    accessions: [{accession: 'GCF_000149205.2', name: 'no', ncbi: null, cached_copies: []}],
  }));

  assert.deepEqual(await loadAccessionCatalog(path), saved);
  assert.match(await readFile(path, 'utf8'), /name: "no"/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(
    updateAccessionCatalog(path, undefined, catalog => catalog),
    AccessionCatalogChangedError,
  );
});

test('reports an invalid catalog with its path and never saves over it', async context => {
  const path = await catalogPath(context);
  await updateAccessionCatalog(path, undefined, catalog => catalog);
  await writeFile(path, 'schema_version: 1\naccessions: nope\n');

  await assert.rejects(loadAccessionCatalog(path), (error: unknown) => {
    assert.ok(error instanceof AccessionCatalogLoadError);
    assert.ok(error.message.includes(path));
    return true;
  });
  await assert.rejects(updateAccessionCatalog(path, undefined, catalog => catalog), AccessionCatalogLoadError);
  assert.equal(await readFile(path, 'utf8'), 'schema_version: 1\naccessions: nope\n');
});
