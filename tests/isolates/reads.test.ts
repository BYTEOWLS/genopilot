import assert from 'node:assert/strict';
import {chmod, link, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {gzipSync} from 'node:zlib';
import {checkReadFile, checkReadPairs} from '../../src/isolates/reads.js';

const record = '@read-1/1\nACGTN\n+\nIIIII\n';

async function workspace(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-reads-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

test('accepts plain and gzip-compressed FASTQ', async context => {
  const directory = await workspace(context);
  const plain = join(directory, 'reads.fastq');
  const compressed = join(directory, 'reads.fastq.gz');
  await writeFile(plain, record);
  await writeFile(compressed, gzipSync(record));

  assert.deepEqual(await checkReadFile(plain), {state: 'ok'});
  assert.deepEqual(await checkReadFile(compressed), {state: 'ok'});
});

test('inspects only the start of a large gzip file', async context => {
  const directory = await workspace(context);
  const path = join(directory, 'large.fastq.gz');
  // Random-looking sequence keeps the compressed size well above the inspected prefix.
  const records = Array.from({length: 20_000}, (_, index) => {
    const sequence = Array.from({length: 50}, (_unused, position) => 'ACGT'[(index * 7 + position * 13 + index * position) % 4]).join('');
    return `@read-${String(index)}\n${sequence}\n+\n${'I'.repeat(50)}\n`;
  }).join('');
  await writeFile(path, gzipSync(records));

  assert.deepEqual(await checkReadFile(path), {state: 'ok'});
});

test('rejects files that do not start with a complete FASTQ record', async context => {
  const directory = await workspace(context);
  const cases: Record<string, string | Buffer> = {
    'fasta.fa': '>chr1\nACGT\n',
    'truncated.fq': '@read\nACGT\n+\n',
    'mismatched.fq': '@read\nACGT\n+\nIII\n',
    'empty.fq': '',
    'damaged.fq.gz': Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]),
  };
  for (const [name, content] of Object.entries(cases)) {
    const path = join(directory, name);
    await writeFile(path, content);
    assert.equal((await checkReadFile(path)).state, 'invalid', name);
  }
});

test('distinguishes missing files, directories, and relative paths', async context => {
  const directory = await workspace(context);
  await mkdir(join(directory, 'folder'));

  assert.equal((await checkReadFile(join(directory, 'absent.fq'))).state, 'missing');
  assert.equal((await checkReadFile(join(directory, 'folder'))).state, 'not-a-file');
  assert.equal((await checkReadFile('relative.fq')).state, 'invalid');
});

test('reports unreadable files', {skip: process.getuid?.() === 0}, async context => {
  const directory = await workspace(context);
  const path = join(directory, 'locked.fq');
  await writeFile(path, record);
  await chmod(path, 0o000);

  assert.equal((await checkReadFile(path)).state, 'unreadable');
});

test('detects files reached twice through links, within and across pairs', async context => {
  const directory = await workspace(context);
  const r1 = join(directory, 'R1.fq');
  const r2 = join(directory, 'R2.fq');
  await writeFile(r1, record);
  await writeFile(r2, record);
  await symlink(r1, join(directory, 'symlink.fq'));
  await link(r1, join(directory, 'hardlink.fq'));
  await writeFile(join(directory, 'other.fq'), record);

  const pair = {r1, r2};
  assert.deepEqual((await checkReadPairs([pair])).sameFiles, []);
  assert.deepEqual(
    (await checkReadPairs([{r1, r2: join(directory, 'symlink.fq')}])).sameFiles,
    [{first: r1, second: join(directory, 'symlink.fq')}],
  );
  // Links are also caught across pairs, e.g. a second lane that points back at the first.
  assert.deepEqual(
    (await checkReadPairs([pair, {r1: join(directory, 'hardlink.fq'), r2: join(directory, 'other.fq')}])).sameFiles,
    [{first: r1, second: join(directory, 'hardlink.fq')}],
  );
  const missingMate = await checkReadPairs([{r1, r2: join(directory, 'absent.fq')}]);
  assert.equal(missingMate.pairs[0]?.r1.state, 'ok');
  assert.equal(missingMate.pairs[0]?.r2.state, 'missing');
});
