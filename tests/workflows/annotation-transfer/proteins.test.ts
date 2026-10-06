import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {filteredGenes, ProteinTableError, readReviewGenes} from '../../../src/workflows/annotation-transfer/proteins.js';

const header = [
  'reference_id', 'feature_type', 'reference_seqid', 'reference_start', 'reference_end', 'reference_strand', 'lifton_category', 'status', 'copy_number', 'target_id', 'target_seqid', 'target_start',
  'target_end', 'target_strand', 'transfer_method', 'minimum_dna_identity', 'minimum_protein_identity', 'mutations',
  'protein_category', 'lifton_status', 'unresolved_bases', 'review_reasons',
].join('\t');

const rows = [
  // Unchanged and not listed.
  'g-ok\tgene\trefchr\t5\t95\t-\tcoding\tmapped\t0\tg-ok\tchr1\t1\t100\t+\tLiftoff\t1.0\t1.0\t\tunchanged\tLiftoff\t0\t',
  // Below the threshold only.
  'g-low\tgene\trefchr\t5\t95\t-\tcoding\tmapped\t0\tg-low\tchr1\t200\t300\t+\tLiftoff\t0.99\t0.95\tnonsynonymous\tsubstitutions\tLiftoff\t0\tbelow_threshold',
  // Disrupted, but on an unresolved base.
  'g-n\tgene\trefchr\t5\t95\t-\tcoding\tmapped\t0\tg-n\tchr1\t400\t500\t-\tLiftoff\t0.9\t0.5\tframeshift\tdisrupted\tLiftoff\t1\tdisrupted,below_threshold,unresolved_bases',
  // Additional copy: never rated.
  'g-low\tgene\trefchr\t5\t95\t-\tcoding\textra-copy\t1\tg-low_1\tchr2\t1\t100\t+\tLiftoff\t0.9\t0.8\tnonsynonymous\t\t\t\t',
  // Disrupted without unresolved bases.
  'g-fs\tgene\trefchr\t5\t95\t-\tcoding\tmapped\t0\tg-fs\tchr2\t200\t300\t+\tLiftoff\t0.95\t0.9\tstop_codon_gain\tdisrupted\tLiftOn_chaining_algorithm\t0\tdisrupted,below_threshold',
  // Unmapped.
  'g-un\tgene\trefchr\t5\t95\t-\tcoding\tunmapped\t0\t\t\t\t\t\t\t\t\t\tunmapped\t\t\tunmapped_or_lost',
];

async function table(lines: string[]): Promise<{path: string; tempDir: string}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'genopilot-proteins-'));
  const path = join(tempDir, 'feature-transfer.tsv');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return {path, tempDir};
}

test('keeps only the genes with review reasons, with their facts', async () => {
  const {path, tempDir} = await table([header, ...rows]);
  try {
    const genes = await readReviewGenes({path});
    assert.deepEqual(genes.map(gene => gene.referenceId), ['g-low', 'g-n', 'g-fs', 'g-un']);
    const unmapped = genes[3]!;
    assert.equal(unmapped.target, undefined);
    assert.equal(unmapped.proteinIdentity, undefined);
    assert.equal(unmapped.unresolvedBases, undefined);
    assert.deepEqual(genes[2]!.target, {id: 'g-fs', seqid: 'chr2', start: 200, end: 300, strand: '+'});
    assert.deepEqual(genes[2]!.liftonStatus, ['LiftOn_chaining_algorithm']);
    assert.deepEqual(unmapped.reference, {seqid: 'refchr', start: 5, end: 95, strand: '-'}, 'an unmapped gene keeps its reference position');
    assert.deepEqual(genes[1]!.reasons, ['disrupted', 'below_threshold', 'unresolved_bases']);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('orders likely real changes first, then by identity, and filters by reason', async () => {
  const {path, tempDir} = await table([header, ...rows]);
  try {
    const genes = await readReviewGenes({path});
    assert.deepEqual(filteredGenes(genes, 'all').map(gene => gene.referenceId), ['g-un', 'g-fs', 'g-n', 'g-low']);
    assert.deepEqual(filteredGenes(genes, 'below_threshold').map(gene => gene.referenceId), ['g-fs', 'g-n', 'g-low']);
    assert.deepEqual(filteredGenes(genes, 'unresolved_bases').map(gene => gene.referenceId), ['g-n']);
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('refuses a table without the rating, with an unknown reason, or with a bad value', async () => {
  for (const lines of [
    [header.split('\t').slice(0, 18).join('\t'), 'g\tgene\trefchr\t5\t95\t-\tcoding\tmapped\t0\tg\tchr1\t1\t2\t+\tLiftoff\t1\t1\t'],
    [header, rows[1]!.replace('\trefchr\t5\t', '\trefchr\tfive\t')],
    [header, rows[1]!.replace('below_threshold', 'suspicious')],
    [header, rows[1]!.replace('substitutions', 'odd')],
    [header, rows[1]!.replace('\t0.95\t', '\t95\t')],
    [header, rows[1]!.replace('\t200\t', '\tx\t')],
    [],
  ]) {
    const {path, tempDir} = await table(lines);
    try {
      await assert.rejects(readReviewGenes({path}), ProteinTableError);
    } finally {
      await rm(tempDir, {recursive: true, force: true});
    }
  }
});
