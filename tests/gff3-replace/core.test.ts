import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {compileReplacement, decodeValue, encodeValue, ReplaceOptionsError, type ReplaceOptions} from '../../src/gff3-replace/core.js';
import {runPass, type PassResult} from '../../src/gff3-replace/pass.js';

const header = '##gff-version 3\n';

function feature(type: string, attributes: string, seqid = 'chr1', start = 1): string {
  return `${seqid}\tsynthetic\t${type}\t${String(start)}\t${String(start + 99)}\t.\t+\t.\t${attributes}`;
}

function options(search: string, replacement: string, extra: Partial<ReplaceOptions> = {}): ReplaceOptions {
  return {search, replacement, regularExpression: false, attributes: ['ids', 'Name', 'locus_tag'], ...extra};
}

/** Runs one pass over `text` and returns the summary with the rewritten text and ID mapping. */
async function rewrite(text: string, replaceOptions: ReplaceOptions): Promise<PassResult & {text: string; mapping: string}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gff3-replace-'));
  try {
    const source = join(tempDir, 'source.gff3');
    await writeFile(source, text);
    const output = {gff3: join(tempDir, 'out.gff3'), idMapping: join(tempDir, 'id-mapping.tsv')};
    const result = await runPass({source, options: replaceOptions, output});
    const mapping = result.written ? await readFile(output.idMapping, 'utf8') : '';
    return {...result, text: await readFile(output.gff3, 'utf8'), mapping};
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
}

test('identifier schemes: a renamed prefix, a capture group, extra-copy suffixes, and type prefixes', async () => {
  const prefix = await rewrite(header + [
    feature('gene', 'ID=AN0001;Name=AN0001'),
    feature('mRNA', 'ID=AN0001.t1;Parent=AN0001'),
    feature('gene', 'ID=AN0001_1;Name=AN0001;extra_copy_number=1'),
  ].join('\n') + '\n', options('AN', 'ANID_'));
  assert.deepEqual(prefix.problems, []);
  assert.match(prefix.text, /ID=ANID_0001;Name=ANID_0001;Alias=AN0001\n/);
  assert.match(prefix.text, /ID=ANID_0001\.t1;Parent=ANID_0001\n/);
  assert.match(prefix.text, /ID=ANID_0001_1;Name=ANID_0001;extra_copy_number=1;Alias=AN0001_1\n/);

  const capture = await rewrite(header + [
    feature('gene', 'ID=gene-ABC1;locus_tag=ABC1'),
    feature('mRNA', 'ID=rna-XM_1;Parent=gene-ABC1'),
  ].join('\n') + '\n', options('^gene-(.*)$', 'ANIA_$1', {regularExpression: true}));
  assert.deepEqual(capture.problems, []);
  assert.match(capture.text, /ID=ANIA_ABC1;locus_tag=ABC1;Alias=gene-ABC1\n/);
  assert.match(capture.text, /ID=rna-XM_1;Parent=ANIA_ABC1\n/);
  assert.equal(capture.statistics.ids.unmatched, 1);

  const typed = await rewrite(header + [
    feature('gene', 'ID=gene:AN1'),
    feature('mRNA', 'ID=transcript:AN1.1;Parent=gene:AN1'),
  ].join('\n') + '\n', options('^(gene|transcript):', '', {regularExpression: true}));
  assert.deepEqual(typed.problems, []);
  assert.match(typed.text, /ID=AN1;Alias=gene:AN1\n/);
  assert.match(typed.text, /ID=AN1\.1;Parent=AN1\n/);
});

test('a literal replacement inserts $ sequences as typed; a regular expression expands them', async () => {
  const literal = await rewrite(header + feature('gene', 'ID=AN1') + '\n', options('AN', '$1$&'));
  // `&` is reserved in column 9, so it is percent-encoded.
  assert.match(literal.text, /ID=\$1\$%261;Alias=AN1\n/);
  const regex = await rewrite(header + feature('gene', 'ID=AN1') + '\n', options('(AN)(1)', '$2$1', {regularExpression: true}));
  assert.match(regex.text, /ID=1AN;Alias=AN1\n/);
});

test('rejects empty searches, invalid patterns, and patterns that match the empty string inside values', () => {
  assert.throws(() => compileReplacement({search: '', replacement: 'x', regularExpression: false}), ReplaceOptionsError);
  assert.throws(() => compileReplacement({search: '(', replacement: 'x', regularExpression: true}), ReplaceOptionsError);
  assert.throws(() => compileReplacement({search: 'x*', replacement: 'y', regularExpression: true}), ReplaceOptionsError);
  for (const anchored of ['^', '$', '\\b']) {
    assert.doesNotThrow(() => compileReplacement({search: anchored, replacement: 'y', regularExpression: true}));
  }
});

test('a zero-width prefix counts once per value', async () => {
  const result = await rewrite(header + feature('gene', 'ID=g1;Name=a,b') + '\n', options('^', 'P_', {regularExpression: true}));
  assert.match(result.text, /ID=P_g1;Name=P_a,P_b;Alias=g1/);
  assert.equal(result.statistics.replacements, 3);
});

test('the scope decides which attributes are searched; Alias keeps its history unless chosen', async () => {
  const text = header + feature('gene', 'ID=AN1;Alias=AN0;product=AN1 protein;Dbxref=DB:AN1') + '\n';
  const defaults = await rewrite(text, options('AN', 'X'));
  assert.match(defaults.text, /ID=X1;Alias=AN0,AN1;product=AN1 protein;Dbxref=DB:AN1\n/);
  const single = await rewrite(text, options('AN', 'X', {attributes: ['product']}));
  assert.match(single.text, /ID=AN1;Alias=AN0;product=X1 protein;Dbxref=DB:AN1\n/);
  const all = await rewrite(text, options('AN', 'X', {attributes: 'all'}));
  // Earlier aliases are searched under All; the former ID appended afterwards is not.
  assert.match(all.text, /ID=X1;Alias=X0,AN1;product=X1 protein;Dbxref=DB:X1\n/);
  assert.deepEqual(all.statistics.changedValues, {Alias: 1, Dbxref: 1, ID: 1, product: 1});
});

test('aliases: added to renamed genes and pseudogenes only, never repeated', async () => {
  const result = await rewrite(header + [
    feature('gene', 'ID=AN1'),
    feature('pseudogene', 'ID=AN2;Alias='),
    feature('mRNA', 'ID=AN1.1;Parent=AN1'),
    feature('gene', 'ID=other'),
  ].join('\n') + '\n', options('AN', 'X'));
  assert.match(result.text, /ID=X1;Alias=AN1\n/);
  assert.match(result.text, /ID=X2;Alias=AN2\n/);
  assert.match(result.text, /ID=X1\.1;Parent=X1\n/);
  assert.match(result.text, /\tID=other\n/);
  assert.equal(result.statistics.aliasesAdded, 2);

  const second = await rewrite(header + feature('gene', 'ID=X1;Alias=AN1,X1') + '\n', options('X', 'Y'));
  assert.match(second.text, /ID=Y1;Alias=AN1,X1\n/);
  assert.equal(second.statistics.aliasesAdded, 0);
});

test('escaping: values match decoded, changed values are re-encoded, unchanged ones keep their bytes', async () => {
  assert.equal(decodeValue('a%2Cb%3Bc%25'), 'a,b;c%');
  assert.equal(encodeValue('a,b;c=d&e%\t'), 'a%2Cb%3Bc%3Dd%26e%25%09');
  const result = await rewrite(header + feature('gene', 'ID=AN%2C1;Name=keep%2cme;Note=AN%3B') + '\n',
    options('AN', 'a,b', {attributes: ['ids', 'Note']}));
  assert.match(result.text, /ID=a%2Cb%2C1;Name=keep%2cme;Note=a%2Cb%3B;Alias=AN%2C1\n/);
});

test('untouched: columns 1–8, comments, directives, the FASTA section, CRLF, and a missing final newline', async () => {
  const text = '##gff-version 3\r\n# AN comment\r\n' +
    'AN_chr\tAN\tgene\t1\t9\t.\t+\t.\tID=AN1\r\n###\r\n##FASTA\r\n>AN_chr ID=AN1\r\nACGT';
  const result = await rewrite(text, options('AN', 'X', {attributes: 'all'}));
  assert.equal(result.text, text.replace('ID=AN1\r\n###', 'ID=X1;Alias=AN1\r\n###'));
  const unchanged = await rewrite(text, options('nothing', 'X'));
  assert.equal(unchanged.text, text);
});

test('IDs shared by discontinuous features, multi-valued parents, and features without an ID', async () => {
  const result = await rewrite(header + [
    feature('gene', 'ID=AN1'),
    feature('mRNA', 'ID=AN1.1;Parent=AN1'),
    feature('mRNA', 'ID=AN1.2;Parent=AN1'),
    feature('exon', 'Parent=AN1.1,AN1.2'),
    feature('CDS', 'ID=cds-AN1;Parent=AN1.1', 'chr1', 10),
    feature('CDS', 'ID=cds-AN1;Parent=AN1.1', 'chr1', 300),
  ].join('\n') + '\n', options('AN', 'X'));
  assert.deepEqual(result.problems, []);
  assert.match(result.text, /\tParent=X1\.1,X1\.2\n/);
  assert.equal(result.statistics.ids.changed, 4);
  assert.equal(result.mapping.split('\n').filter(line => line.startsWith('cds-AN1')).join('\n'), 'cds-AN1\tcds-X1\tCDS\tchr1\t10');
  assert.equal(result.mapping.split('\n')[0], 'old_id\tnew_id\ttype\tseqid\tstart');
});

test('nothing is written for empty values, invalid IDs, or collisions; references follow their IDs', async () => {
  const empty = await rewrite(header + feature('gene', 'ID=g1;Name=AN') + '\n', options('AN', ''));
  assert.equal(empty.written, undefined);
  assert.match(empty.problems.join('\n'), /becomes empty/);

  const invalid = await rewrite(header + feature('gene', 'ID=AN1') + '\n', options('AN', 'a b'));
  assert.match(invalid.problems.join('\n'), /whitespace/);

  const collision = await rewrite(header + [feature('gene', 'ID=AN1'), feature('gene', 'ID=X1')].join('\n') + '\n', options('AN', 'X'));
  assert.match(collision.problems.join('\n'), /both become "X1"/);

  const references = await rewrite(header + [feature('gene', 'ID=AN1'), feature('mRNA', 'ID=m1;Parent=AN1;Derives_from=AN1')].join('\n') + '\n',
    options('AN', 'X'));
  assert.deepEqual(references.problems, []);
  assert.match(references.text, /ID=m1;Parent=X1;Derives_from=X1\n/);
});

test('references already unresolved in the source are counted, not rejected', async () => {
  const result = await rewrite(header + [feature('gene', 'ID=AN1'), feature('mRNA', 'ID=m1;Parent=missing')].join('\n') + '\n',
    options('AN', 'X'));
  assert.deepEqual(result.problems, []);
  assert.equal(result.statistics.danglingInSource, 1);
  assert.ok(result.written);
});

test('a source that changed since the preview is refused', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'gff3-replace-'));
  try {
    const source = join(tempDir, 'source.gff3');
    await writeFile(source, header + feature('gene', 'ID=AN1') + '\n');
    const result = await runPass({source, options: options('AN', 'X'), expectedSourceSha256: '0'.repeat(64),
      output: {gff3: join(tempDir, 'out.gff3'), idMapping: join(tempDir, 'map.tsv')}});
    assert.equal(result.written, undefined);
    assert.match(result.problems[0] ?? '', /changed since the preview/);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('the preview reports the same statistics as the rewrite', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'gff3-replace-'));
  try {
    const source = join(tempDir, 'source.gff3');
    await writeFile(source, header + [feature('gene', 'ID=AN1;Name=AN1'), feature('mRNA', 'ID=AN1.1;Parent=AN1')].join('\n') + '\n');
    const preview = await runPass({source, options: options('AN', 'X')});
    const written = await runPass({source, options: options('AN', 'X'), expectedSourceSha256: preview.sourceSha256,
      output: {gff3: join(tempDir, 'out.gff3'), idMapping: join(tempDir, 'map.tsv')}});
    assert.ok(written.written);
    assert.deepEqual(written.statistics, preview.statistics);
    assert.deepEqual(written.samples, preview.samples);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('attribute names are matched without surrounding spaces and written back unchanged', async () => {
  const result = await rewrite(header + feature('gene', 'ID=AN1; Name=AN1; Alias=old') + '\n', options('AN', 'X'));
  assert.match(result.text, /\tID=X1; Name=X1; Alias=old,AN1\n/);
});

test('a feature line without nine columns is reported', async () => {
  const result = await rewrite(header + 'chr1\tbroken\n', options('AN', 'X'));
  assert.match(result.problems.join('\n'), /expected 9 tab-separated columns/);
});
