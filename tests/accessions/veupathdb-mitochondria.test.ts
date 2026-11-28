import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {resolveGenomeCache} from '../../src/accessions/cache.js';
import {GenomeProviderRegistry, type ProviderContext} from '../../src/accessions/provider.js';
import {veupathdbProvider} from '../../src/accessions/provider/veupathdb/index.js';
import {filterMitochondria} from '../../src/accessions/provider/veupathdb/mitochondria.js';

const fasta = '>chr1\nACGT\n>mito_synthetic\nATGC\n>unknown_short\nAA\n';
const gff = '##gff-version 3\n##sequence-region chr1 1 4\n##sequence-region mito_synthetic 1 4\nchr1\tsynthetic\tgene\t1\t4\t.\t+\t.\tID=nuclear\nmito_synthetic\tsynthetic\tgene\t1\t4\t.\t+\t.\tID=mitogene\n';
const full = {source: 'veupathdb', id: 'FungiDB-70_Synthetic', parameters: {site: 'FungiDB', release: 70, organism_abbreviation: 'Synthetic'}};
const option = veupathdbProvider.downloadOptions![0]!;
const registry = new GenomeProviderRegistry([veupathdbProvider]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

async function temporary(t: {after: (fn: () => Promise<void>) => void}) {
  const root = await mkdtemp(join(tmpdir(), 'genopilot-mitochondria-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('provider filtering choice is explicit, canonical, reversible, and isolated from whole-genome identity', async () => {
  assert.equal(option.defaultValue, false);
  const nuclear = option.apply(full, false);
  assert.notEqual(nuclear.id, full.id);
  assert.deepEqual(registry.validateReference(nuclear), nuclear);
  assert.deepEqual(option.apply(nuclear, true), full);
  assert.equal(option.checked(nuclear), false);
  assert.deepEqual(await veupathdbProvider.resolveExact(nuclear.id, {signal: signal(), secrets: {}, site: 'FungiDB'}), nuclear);
  assert.throws(() => veupathdbProvider.validateReference(full.id, nuclear.parameters));
  assert.throws(() => veupathdbProvider.validateReference(nuclear.id, {...full.parameters, exclude_mitochondrial: false}));
});

test('nuclear cache derives a matching genomic pair, retains raw evidence, and reuses offline without changing full cache', async t => {
  const root = await temporary(t);
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/a/service')) {
      return Response.json({projectId: 'FungiDB', buildNumber: '71'});
    }
    if (url.includes('/reports/standard')) {
      return Response.json({records: [], meta: {totalCount: 0, responseCount: 0}});
    }
    return new Response(url.endsWith('.gff') ? gff : fasta);
  };
  const context: ProviderContext = {signal: signal(), secrets: {'api-key': 'synthetic'}, fetchImpl};
  const request = {reference: full, root, kinds: ['fasta', 'gff3'] as const, mode: 'refresh' as const};
  const original = await resolveGenomeCache(request, context, registry);
  const nuclear = await resolveGenomeCache({...request, reference: option.apply(full, false)}, context, registry);
  assert.equal(await readFile(nuclear.fasta!, 'utf8'), '>chr1\nACGT\n>unknown_short\nAA\n');
  assert.equal(await readFile(nuclear.gff3!, 'utf8'), gff.split('\n').filter(line => !line.includes('mito_synthetic')).join('\n'));
  assert.equal(await readFile(original.fasta!, 'utf8'), fasta);
  assert.equal(await readFile(original.gff3!, 'utf8'), gff);
  const directory = join(root, veupathdbProvider.cacheDirectory, nuclear.reference.id);
  assert.equal(await readFile(join(directory, 'original/genomic.fna'), 'utf8'), fasta);
  assert.equal(await readFile(join(directory, 'original/genomic.gff'), 'utf8'), gff);
  const summary = veupathdbProvider.downloadSummary!(nuclear.facts);
  assert.ok(summary?.includes('mito_synthetic'));
  assert.ok(summary?.includes('4'));
  assert.equal(veupathdbProvider.downloadSummary!({}), undefined);
  const facts = nuclear.facts.mitochondrial_filter as {excluded_sequences: unknown; removed_features: number; originals: Record<string, {sha256: string}>};
  assert.deepEqual(facts.excluded_sequences, [{id: 'mito_synthetic', bases: 4}]);
  assert.equal(facts.removed_features, 1);
  assert.equal(facts.originals.fasta!.sha256, hash(fasta));
  assert.equal(facts.originals.gff3!.sha256, hash(gff));
  const offline = await resolveGenomeCache({...request, reference: nuclear.reference, mode: 'reuse'}, {
    signal: signal(), secrets: {}, fetchImpl: async () => assert.fail('offline reuse must not fetch'),
  }, registry);
  assert.equal(offline.fasta_sha256, nuclear.fasta_sha256);
  assert.deepEqual(offline.facts, nuclear.facts);
  const originalFacts = (nuclear.facts.artifacts as Record<string, unknown>).fasta;
  const partial = await resolveGenomeCache({...request, reference: nuclear.reference, kinds: ['gff3']}, context, registry);
  assert.equal(await readFile(join(directory, 'original/genomic.fna'), 'utf8'), fasta);
  assert.deepEqual((partial.facts.artifacts as Record<string, unknown>).fasta, originalFacts);
  assert.equal(partial.originals?.fasta, hash(fasta));
  const afterPartial = await resolveGenomeCache({...request, reference: nuclear.reference, mode: 'reuse'}, {
    signal: signal(), secrets: {}, fetchImpl: async () => assert.fail('partial refresh must remain reusable offline'),
  }, registry);
  assert.equal(afterPartial.fasta_sha256, nuclear.fasta_sha256);
  await writeFile(join(directory, 'original/genomic.fna'), '>tampered\nAT\n');
  await assert.rejects(resolveGenomeCache({...request, reference: nuclear.reference, mode: 'reuse', copy: {
    path: directory, fasta_sha256: nuclear.fasta_sha256, gff3_sha256: nuclear.gff3_sha256,
  }}, {signal: signal(), secrets: {}}, registry), /snapshotted genome copy/);
});

test('explicit GFF organelle metadata filters opaque sequence IDs, but unknown sequences are retained', async t => {
  const root = await temporary(t);
  await writeFile(join(root, 'genomic.fna'), '>opaque\nAT\n>unknown\nGC\n');
  await writeFile(join(root, 'genomic.gff'), '##gff-version 3\nopaque\tsynthetic\tregion\t1\t2\t.\t+\t.\tID=opaque;genome=mitochondrion\n');
  const facts = await filterMitochondria(root, {fasta: 'genomic.fna', gff3: 'genomic.gff'}, signal());
  assert.deepEqual(facts.excluded_sequences, [{id: 'opaque', bases: 2}]);
  assert.equal(await readFile(join(root, 'genomic.fna'), 'utf8'), '>unknown\nGC\n');
});

test('provider single-artifact downloads classify against the same genomic pair and publish only selected files', async t => {
  const sourceFasta = '>nuclear\nAC\n>opaque_a mitochondrion\nAT\n>opaque_b\nGC\n';
  const sourceGff = '##gff-version 3\nnuclear\tsynthetic\tgene\t1\t2\t.\t+\t.\tID=n\nopaque_a\tsynthetic\tgene\t1\t2\t.\t+\t.\tID=a\nopaque_b\tsynthetic\tregion\t1\t2\t.\t+\t.\tID=b;genome=mitochondrion\n';
  for (const kind of ['fasta', 'gff3'] as const) {
    const root = await temporary(t);
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async input => {
      const url = String(input);
      if (url.endsWith('/a/service')) {
        return Response.json({projectId: 'FungiDB', buildNumber: '71'});
      }
      if (url.includes('/reports/standard')) {
        return Response.json({records: [], meta: {totalCount: 0, responseCount: 0}});
      }
      calls.push(url);
      return new Response(url.endsWith('.gff') ? sourceGff : sourceFasta);
    };
    const genome = await resolveGenomeCache({reference: option.apply(full, false), kinds: [kind], root, mode: 'refresh'},
      {signal: signal(), secrets: {'api-key': 'synthetic'}, fetchImpl}, registry);
    assert.equal(calls.length, 2, 'both classification inputs are fetched');
    const output = await readFile(genome[kind]!, 'utf8');
    assert.ok(!output.includes('opaque_a') && !output.includes('opaque_b'));
    assert.ok(output.includes('nuclear'));
    const other = kind === 'fasta' ? 'gff3' : 'fasta';
    assert.equal(genome[other], undefined);
    const filename = kind === 'fasta' ? 'genomic.gff' : 'genomic.fna';
    const directory = join(root, veupathdbProvider.cacheDirectory, genome.reference.id);
    await assert.rejects(readFile(join(directory, filename)), {code: 'ENOENT'});
    await assert.rejects(readFile(join(directory, 'original', filename)), {code: 'ENOENT'});
    const facts = genome.facts.mitochondrial_filter as {excluded_sequences: {id: string}[]; classification_inputs: unknown};
    assert.deepEqual(facts.excluded_sequences.map(sequence => sequence.id).sort(), ['opaque_a', 'opaque_b']);
    assert.deepEqual(facts.classification_inputs, {fasta: hash(sourceFasta), gff3: hash(sourceGff)});
  }
});

test('single-artifact filtering supports genomic FASTA and annotation independently', async t => {
  for (const kind of ['fasta', 'gff3'] as const) {
    const root = await temporary(t);
    const filename = kind === 'fasta' ? 'genomic.fna' : 'genomic.gff';
    await writeFile(join(root, filename), kind === 'fasta' ? fasta : gff);
    const facts = await filterMitochondria(root, {[kind]: filename}, signal());
    assert.equal((await readFile(join(root, filename), 'utf8')).includes('mito_synthetic'), false);
    assert.equal(facts.excluded_sequences.length, 1);
  }
});

test('filtering refuses an empty resulting genome, embedded GFF FASTA, and cancellation', async t => {
  const root = await temporary(t);
  await writeFile(join(root, 'genomic.fna'), '>mito_synthetic\nAT\n');
  await assert.rejects(filterMitochondria(root, {fasta: 'genomic.fna'}, signal()), /no genome sequences/);
  await writeFile(join(root, 'genomic.gff'), '##gff-version 3\n##FASTA\n>chr1\nAT\n');
  await assert.rejects(filterMitochondria(root, {gff3: 'genomic.gff'}, signal()), /embedded/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(filterMitochondria(root, {gff3: 'genomic.gff'}, abort.signal), {name: 'AbortError'});
});
