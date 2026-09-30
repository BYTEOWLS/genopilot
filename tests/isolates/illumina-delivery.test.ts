import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {gzipSync} from 'node:zlib';
import type {IsolateCatalog} from '../../src/isolates/catalog.js';
import {
  parseIlluminaFileName,
  parseIlluminaReadHeader,
  scanIlluminaDelivery,
  type DeliveryScan,
} from '../../src/isolates/illumina-delivery.js';

type Reads = {
  instrument?: string;
  run?: number;
  flowcell?: string;
  lane?: number;
  count?: number;
  /** Read index of the first record, so a filtered copy can start later than its raw source. */
  first?: number;
  length?: number;
  /** Shortens every third read, as adapter or quality trimming would. */
  trimmed?: boolean;
};

/** Synthetic Illumina FASTQ records; no real sequencing data is involved. */
function fastq(mate: 1 | 2, reads: Reads = {}): Buffer {
  const {instrument = 'A00001', run = 7, flowcell = 'HFLOWAAXX', lane = 1, count = 5, first = 0, length = 151} = reads;
  const records = Array.from({length: count}, (_, offset) => {
    const index = first + offset;
    const size = reads.trimmed && index % 3 === 0 ? length - 20 : length;
    return `@${instrument}:${String(run)}:${flowcell}:${String(lane)}:1101:${String(1000 + index)}:2000 ` +
      `${String(mate)}:N:0:ACGTACGT\n${'A'.repeat(size)}\n+\n${'F'.repeat(size)}\n`;
  });
  return gzipSync(records.join(''));
}

async function delivery(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'genopilot-delivery-'));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

async function put(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, content);
}

/** Writes both mates named `<prefix>_R1_001.fastq.gz` and `<prefix>_R2_001.fastq.gz`. */
async function pair(directory: string, prefix: string, reads: Reads = {}): Promise<void> {
  await put(join(directory, `${prefix}_R1_001.fastq.gz`), fastq(1, reads));
  await put(join(directory, `${prefix}_R2_001.fastq.gz`), fastq(2, reads));
}

const emptyCatalog: IsolateCatalog = {schema_version: 1, isolates: []};

function reasons(scan: DeliveryScan, root: string): Record<string, string> {
  return Object.fromEntries(scan.skippedFiles.map(file => [file.path.slice(root.length + 1), file.reason]));
}

test('parses Illumina file names from the right, with and without a lane', () => {
  assert.deepEqual(parseIlluminaFileName('ORD-12_strain_x_S3_L002_R1_001.fastq.gz'), {
    sample: 'ORD-12_strain_x',
    sampleNumber: 3,
    lane: 2,
    read: 'R1',
    chunk: 1,
  });
  assert.deepEqual(parseIlluminaFileName('strain-x_S3_I2_004.fastq.gz'), {
    sample: 'strain-x',
    sampleNumber: 3,
    lane: null,
    read: 'I2',
    chunk: 4,
  });
  for (const name of ['strain-x_R1.fastq.gz', 'strain-x_S3_L002_R1_001.fq.gz', 'strain-x_S3_L2_R1_001.fastq.gz', 'strain-x_S3_L002_R3_001.fastq.gz']) {
    assert.equal(parseIlluminaFileName(name), undefined, name);
  }
});

test('parses Illumina read headers and rejects other formats', () => {
  assert.deepEqual(parseIlluminaReadHeader('@A00001:7:HFLOWAAXX:2:1101:1000:2000 1:N:0:ACGT+TTGA'), {
    readName: 'A00001:7:HFLOWAAXX:2:1101:1000:2000',
    instrument: 'A00001',
    run: 7,
    flowcell: 'HFLOWAAXX',
    lane: 2,
  });
  for (const header of ['@SRR000001.1 length=150', '@A00001:7:HFLOWAAXX:x:1101:1000:2000', 'A00001:7:F:1:1:1:1']) {
    assert.equal(parseIlluminaReadHeader(header), undefined, header);
  }
});

test('groups raw and processed copies with identical names as variants of one read set', async context => {
  const tempDir = await delivery(context);
  await pair(join(tempDir, 'Sample-A_L001_ds.raw'), 'strain-a_S1_L001');
  // The processed copy dropped the first read and shortened others.
  await pair(join(tempDir, 'Sample-A_L001_ds.processed'), 'strain-a_S1_L001', {first: 1, trimmed: true});

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.deepEqual(scan.skippedFiles, []);
  assert.equal(scan.candidates.length, 1);
  const [candidate] = scan.candidates;
  assert.equal(candidate?.sample, 'strain-a');
  assert.equal(candidate?.readSets.length, 1);
  const variants = candidate?.readSets[0]?.variants ?? [];
  assert.deepEqual(variants.map(variant => variant.r1.slice(tempDir.length + 1)), [
    'Sample-A_L001_ds.processed/strain-a_S1_L001_R1_001.fastq.gz',
    'Sample-A_L001_ds.raw/strain-a_S1_L001_R1_001.fastq.gz',
  ]);
  assert.deepEqual(variants.map(variant => variant.readLength), [{min: 131, max: 151}, {min: 151, max: 151}]);
  assert.deepEqual(variants.map(variant => variant.suggestedTrimmed), [true, false]);
  assert.ok(variants.every(variant => variant.r1Bytes > 0 && variant.r2Bytes > 0));
});

test('keeps lanes and sequencing runs of one sample as separate read sets', async context => {
  const tempDir = await delivery(context);
  await pair(join(tempDir, 'run-7'), 'strain-b_S2_L001', {run: 7, flowcell: 'HFLOWAAXX', lane: 1});
  await pair(join(tempDir, 'run-7'), 'strain-b_S2_L002', {run: 7, flowcell: 'HFLOWAAXX', lane: 2});
  // A top-up run lists the same sample at another sample-sheet position.
  await pair(join(tempDir, 'run-9'), 'strain-b_S5_L001', {run: 9, flowcell: 'HFLOWBBXX', lane: 1});

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.equal(scan.candidates.length, 1);
  assert.deepEqual(
    scan.candidates[0]?.readSets.map(readSet => [readSet.run, readSet.flowcell, readSet.lane, readSet.variants.length]),
    [[7, 'HFLOWAAXX', 1, 1], [7, 'HFLOWAAXX', 2, 1], [9, 'HFLOWBBXX', 1, 1]],
  );
});

test('takes the lane only from the file name, so merged lanes stay one read set', async context => {
  const tempDir = await delivery(context);
  // A lane-merged raw file starts in lane 1; its filtered copy happens to start in lane 2.
  await pair(join(tempDir, 'raw'), 'strain-c_S3', {lane: 1});
  await pair(join(tempDir, 'processed'), 'strain-c_S3', {lane: 2, trimmed: true});

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.deepEqual(scan.candidates.map(candidate => candidate.readSets.map(readSet => [readSet.lane, readSet.variants.length])), [[[null, 2]]]);
});

test('reports every FASTQ it does not propose, with its reason', async context => {
  const tempDir = await delivery(context);
  await pair(tempDir, 'good_S1_L001');
  await put(join(tempDir, 'lonely_S2_L001_R1_001.fastq.gz'), fastq(1));
  await put(join(tempDir, 'good_S1_L001_I1_001.fastq.gz'), fastq(1));
  await pair(tempDir, 'Undetermined_S0_L001');
  await pair(tempDir, 'split_S3_L001');
  await put(join(tempDir, 'split_S3_L001_R1_002.fastq.gz'), fastq(1));
  await put(join(tempDir, 'split_S3_L001_R2_002.fastq.gz'), fastq(2));
  await put(join(tempDir, 'reads_1.fq.gz'), fastq(1));
  await put(join(tempDir, 'swapped_S4_L001_R1_001.fastq.gz'), fastq(1));
  await put(join(tempDir, 'swapped_S4_L001_R2_001.fastq.gz'), fastq(2, {first: 3}));
  await put(join(tempDir, 'broken_S5_L001_R1_001.fastq.gz'), 'not a FASTQ file\n');
  await put(join(tempDir, 'broken_S5_L001_R2_001.fastq.gz'), fastq(2));
  await put(join(tempDir, 'public_S6_L001_R1_001.fastq.gz'), gzipSync('@SRR000001.1\nACGT\n+\nFFFF\n'));
  await put(join(tempDir, 'public_S6_L001_R2_001.fastq.gz'), gzipSync('@SRR000001.1\nACGT\n+\nFFFF\n'));
  await put(join(tempDir, 'notes.txt'), 'not reported: not a FASTQ file');

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.deepEqual(scan.candidates.map(candidate => candidate.sample), ['good']);
  assert.deepEqual(reasons(scan, tempDir), {
    'broken_S5_L001_R1_001.fastq.gz': 'invalid-fastq',
    'broken_S5_L001_R2_001.fastq.gz': 'invalid-fastq',
    'good_S1_L001_I1_001.fastq.gz': 'index-read',
    'lonely_S2_L001_R1_001.fastq.gz': 'missing-mate',
    'public_S6_L001_R1_001.fastq.gz': 'not-illumina-header',
    'public_S6_L001_R2_001.fastq.gz': 'not-illumina-header',
    'reads_1.fq.gz': 'not-illumina-name',
    'split_S3_L001_R1_001.fastq.gz': 'split-chunk',
    'split_S3_L001_R1_002.fastq.gz': 'split-chunk',
    'split_S3_L001_R2_001.fastq.gz': 'split-chunk',
    'split_S3_L001_R2_002.fastq.gz': 'split-chunk',
    'swapped_S4_L001_R1_001.fastq.gz': 'mate-mismatch',
    'swapped_S4_L001_R2_001.fastq.gz': 'mate-mismatch',
    'Undetermined_S0_L001_R1_001.fastq.gz': 'undetermined',
    'Undetermined_S0_L001_R2_001.fastq.gz': 'undetermined',
  });
});

test('does not follow directory symlinks or file links that leave the folder', async context => {
  const tempDir = await delivery(context);
  const outside = await delivery(context);
  await pair(join(tempDir, 'data'), 'strain-d_S1_L001');
  await pair(outside, 'foreign_S1_L001');
  await symlink(tempDir, join(tempDir, 'data', 'loop'));
  await symlink(join(outside, 'foreign_S1_L001_R1_001.fastq.gz'), join(tempDir, 'foreign_S1_L001_R1_001.fastq.gz'));
  // The link sorts before the file it points to, but the file itself is kept.
  await symlink(join(tempDir, 'data', 'strain-d_S1_L001_R1_001.fastq.gz'), join(tempDir, 'data', 'a-link_S1_L001_R1_001.fastq.gz'));
  await symlink(join(tempDir, 'data', 'absent.fastq.gz'), join(tempDir, 'data', 'broken_S2_L001_R1_001.fastq.gz'));

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.deepEqual(scan.candidates.map(candidate => candidate.sample), ['strain-d']);
  assert.equal(scan.candidates[0]?.readSets[0]?.variants[0]?.r1, join(tempDir, 'data', 'strain-d_S1_L001_R1_001.fastq.gz'));
  assert.deepEqual(scan.skippedDirectories, [{path: join(tempDir, 'data', 'loop'), reason: 'symlink'}]);
  assert.deepEqual(reasons(scan, tempDir), {
    'data/a-link_S1_L001_R1_001.fastq.gz': 'same-file',
    'data/broken_S2_L001_R1_001.fastq.gz': 'unreadable',
    'foreign_S1_L001_R1_001.fastq.gz': 'outside-folder',
  });
});

test('marks read files the catalog already references, also through links', async context => {
  const tempDir = await delivery(context);
  const elsewhere = await delivery(context);
  await pair(tempDir, 'known_S1_L001');
  await pair(tempDir, 'linked_S2_L001');
  await pair(tempDir, 'new_S3_L001');
  await symlink(join(tempDir, 'linked_S2_L001_R1_001.fastq.gz'), join(elsewhere, 'linked_R1.fastq.gz'));
  const catalog: IsolateCatalog = {
    schema_version: 1,
    isolates: [
      {
        id: 'known',
        name: 'Known',
        wildtype: null,
        derived_from: null,
        read_pairs: [{r1: join(tempDir, 'known_S1_L001_R1_001.fastq.gz'), r2: join(tempDir, 'known_S1_L001_R2_001.fastq.gz'), trimmed: false}],
      },
      {
        id: 'linked',
        name: 'Linked',
        wildtype: null,
        derived_from: null,
        read_pairs: [{r1: join(elsewhere, 'linked_R1.fastq.gz'), r2: join(elsewhere, 'missing_R2.fastq.gz'), trimmed: false}],
      },
    ],
  };

  const scan = await scanIlluminaDelivery(tempDir, catalog);

  assert.deepEqual(scan.candidates.map(candidate => candidate.sample), ['new']);
  assert.deepEqual(
    scan.alreadyImported.map(file => [file.path.slice(tempDir.length + 1), file.isolateId]).sort(),
    [
      ['known_S1_L001_R1_001.fastq.gz', 'known'],
      ['known_S1_L001_R2_001.fastq.gz', 'known'],
      ['linked_S2_L001_R1_001.fastq.gz', 'linked'],
      ['linked_S2_L001_R2_001.fastq.gz', 'linked'],
    ],
  );
});

test('names the mate that could not be read', async context => {
  const tempDir = await delivery(context);
  await put(join(tempDir, 'strain-f_S1_L001_R1_001.fastq.gz'), fastq(1));
  await put(join(tempDir, 'strain-f_S1_L001_R2_001.fastq.gz'), Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]));

  const scan = await scanIlluminaDelivery(tempDir, emptyCatalog);

  assert.deepEqual(scan.skippedFiles.map(file => [file.reason, file.detail?.slice(0, 3)]), [
    ['invalid-fastq', 'R2:'],
    ['invalid-fastq', 'R2:'],
  ]);
});

test('reports an unreadable subfolder and keeps scanning', {skip: process.getuid?.() === 0}, async context => {
  const tempDir = await delivery(context);
  await pair(join(tempDir, 'open'), 'strain-g_S1_L001');
  await pair(join(tempDir, 'locked'), 'strain-h_S1_L001');
  await chmod(join(tempDir, 'locked'), 0o000);
  let scan: DeliveryScan;
  try {
    scan = await scanIlluminaDelivery(tempDir, emptyCatalog);
  } finally {
    // Restore access before the workspace cleanup removes the folder.
    await chmod(join(tempDir, 'locked'), 0o700);
  }

  assert.deepEqual(scan.candidates.map(candidate => candidate.sample), ['strain-g']);
  assert.deepEqual(scan.skippedDirectories, [{path: join(tempDir, 'locked'), reason: 'unreadable'}]);
});

test('stops scanning when cancelled', async context => {
  const tempDir = await delivery(context);
  await pair(tempDir, 'strain-e_S1_L001');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(scanIlluminaDelivery(tempDir, emptyCatalog, controller.signal), {name: 'AbortError'});
});

test('fails when the chosen folder cannot be read', async context => {
  const tempDir = await delivery(context);
  await assert.rejects(scanIlluminaDelivery(join(tempDir, 'missing'), emptyCatalog), {code: 'ENOENT'});
});
