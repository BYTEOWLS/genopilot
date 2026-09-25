import assert from 'node:assert/strict';
import {chmod, link, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {gzipSync} from 'node:zlib';
import {checkReadFile, checkReadPairs, readFastqHead} from '../../src/isolates/reads.js';

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

function records(count: number, length = 50): string {
  // Pseudo-random bases and qualities compress about as poorly as real reads do.
  let state = 1;
  const next = (range: number): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % range;
  };
  return Array.from({length: count}, (_, index) => {
    const sequence = Array.from({length}, () => 'ACGT'[next(4)]).join('');
    const quality = Array.from({length}, () => String.fromCharCode(35 + next(40))).join('');
    return `@read-${String(index)}\n${sequence}\n+\n${quality}\n`;
  }).join('');
}

test('streams only the requested number of records', async context => {
  const directory = await workspace(context);
  const path = join(directory, 'reads.fastq.gz');
  await writeFile(path, gzipSync(records(5_000)));

  const head = await readFastqHead(path, {maxRecords: 3, maxBytes: 1024 * 1024});
  assert.deepEqual(head, {
    state: 'ok',
    records: [0, 1, 2].map(index => ({header: `@read-${String(index)}`, sequenceLength: 50})),
  });
});

test('stops at the byte limit and drops the record it cut', async context => {
  const directory = await workspace(context);
  const path = join(directory, 'large.fastq.gz');
  await writeFile(path, gzipSync(records(20_000)));

  const head = await readFastqHead(path, {maxRecords: 20_000, maxBytes: 4096});
  assert.equal(head.state, 'ok');
  assert.ok(head.state === 'ok' && head.records.length > 0 && head.records.length < 20_000);
});

test('returns every record of a short plain file', async context => {
  const directory = await workspace(context);
  const path = join(directory, 'short.fastq');
  await writeFile(path, records(2, 30));

  const head = await readFastqHead(path, {maxRecords: 1000, maxBytes: 1024 * 1024});
  assert.equal(head.state === 'ok' ? head.records.length : 0, 2);
});

test('accepts a final record without a trailing newline', async context => {
  const directory = await workspace(context);
  const plain = join(directory, 'unterminated.fastq');
  const compressed = join(directory, 'unterminated.fastq.gz');
  const text = records(2, 30).slice(0, -1);
  await writeFile(plain, text);
  await writeFile(compressed, gzipSync(text));

  for (const path of [plain, compressed]) {
    const head = await readFastqHead(path, {maxRecords: 1000, maxBytes: 1024 * 1024});
    assert.equal(head.state === 'ok' ? head.records.length : 0, 2, path);
  }
});

test('bounds memory when a small file decompresses to a huge amount of data', async context => {
  const directory = await workspace(context);
  const endlessLine = join(directory, 'endless-line.fastq.gz');
  const repetitive = join(directory, 'repetitive.fastq.gz');
  await writeFile(endlessLine, gzipSync(Buffer.alloc(8 * 1024 * 1024, 'A')));
  await writeFile(repetitive, gzipSync('@r\nACGT\n+\nIIII\n'.repeat(200_000)));

  assert.equal((await readFastqHead(endlessLine, {maxRecords: 1000, maxBytes: 1024 * 1024})).state, 'invalid');
  // Valid but extremely compressible records stop at the expansion limit, not at the record count.
  const head = await readFastqHead(repetitive, {maxRecords: 1_000_000, maxBytes: 64 * 1024});
  assert.equal(head.state, 'invalid');
});

test('rejects gzip damage near the byte limit rather than treating it as the limit', async context => {
  const directory = await workspace(context);
  const path = join(directory, 'damaged-late.fastq.gz');
  const compressed = gzipSync(records(20_000));
  // Corrupt the deflate stream just inside the limit, well after the first records.
  const limit = 64 * 1024;
  compressed.fill(0xff, limit - 2048, limit - 1024);
  await writeFile(path, compressed);

  assert.equal((await readFastqHead(path, {maxRecords: 20_000, maxBytes: limit})).state, 'invalid');
});

test('rejects damaged, truncated, and malformed FASTQ before the byte limit', async context => {
  const directory = await workspace(context);
  const complete = gzipSync(records(50));
  const cases: Record<string, string | Buffer> = {
    'truncated.fastq.gz': complete.subarray(0, complete.length - 10),
    'damaged.fastq.gz': Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]),
    'partial.fastq': '@read\nACGT\n+\n',
    'mismatched.fastq': '@read\nACGT\n+\nIII\n',
    'empty.fastq': '',
  };
  for (const [name, content] of Object.entries(cases)) {
    const path = join(directory, name);
    await writeFile(path, content);
    assert.equal((await readFastqHead(path, {maxRecords: 1000, maxBytes: 1024 * 1024})).state, 'invalid', name);
  }
  assert.equal((await readFastqHead(join(directory, 'absent.fastq'), {maxRecords: 1, maxBytes: 1024})).state, 'unreadable');
});
