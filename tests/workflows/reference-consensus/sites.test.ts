import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {gzipSync} from 'node:zlib';
import {
  matchesSiteFilter,
  readCohortSites,
  siteCalls,
  siteFilters,
} from '../../../src/workflows/reference-consensus/sites.js';

const consensusHeader = '#chrom\tstart\tend\tconsensus_start\tconsensus_end\tkind\tstatus\treason\tallele\twritten\tbackbone_allele\talleles\tallele_votes\tcallable_isolates\ttotal_votes\tflags';
const supportHeader = '#chrom\tstart\tend\tbackbone_allele\tbackbone_votes\talleles\tallele_votes\tcallable_isolates\ttotal_votes\tflags\tisolate:isolate-a\tisolate:isolate-b\tisolate:isolate-c';

const consensusRows = [
  'chr1\t5\t5\t5\t5\tlocus\tselected\t.\tT\tT\tA\tA,T\t1,3\t3\t4\tsnp',
  'chr1\t8\t12\t8\t12\tregion\tunresolved\tno_votes\t.\t.\t.\t.\t.\t0\t0\t.',
  'chr1\t20\t20\t20\t20\tlocus\tunresolved\ttie\t.\tN\tG\tG,C\t2,2\t3\t4\tsnp',
  'chr1\t30\t32\t30\t32\tlocus\tunresolved\tno_majority\t.\tNNN\tGAT\tGAT,G,GATT\t1,1,1\t3\t3\tindel,multiallelic,competing_indel',
  'chr2\t3\t3\t3\t3\tlocus\tselected\t.\tA\tA\tA\tA,AT,ATT\t3,1,0\t3\t4\tindel,multiallelic,competing_indel',
  'chr2\t9\t9\t9\t9\tlocus\tunresolved\tfew_callable\t.\tN\tC\tC\t1\t0\t1\tsnp',
];
const supportRows = [
  'chr1\t5\t5\tA\t1\tA,T\t1,3\t3\t4\tsnp\t1\t1\t1',
  'chr1\t20\t20\tG\t1\tG,C\t2,2\t3\t4\tsnp\t0\t1\t1',
  'chr1\t30\t32\tGAT\t0\tGAT,G,GATT\t1,1,1\t3\t3\tindel,multiallelic,competing_indel\t0\t1\t2',
  'chr2\t3\t3\tA\t1\tA,AT,ATT\t3,1,0\t3\t4\tindel,multiallelic,competing_indel\t0\t0\t1',
  'chr2\t9\t9\tC\t1\tC\t1\t0\t1\tsnp\tuncallable\tambiguous\tunsupported',
];

/** bgzip writes concatenated gzip members; the reader must follow all of them. */
function bgzipLike(lines: string[]): Buffer {
  const text = `${lines.join('\n')}\n`;
  const middle = Math.floor(text.length / 2);
  return Buffer.concat([gzipSync(text.slice(0, middle)), gzipSync(text.slice(middle))]);
}

async function tables(context: TestContext, consensus: string[], support: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'cohort-sites-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const consensusSitesPath = join(root, 'consensus-sites.tsv.gz');
  const supportSitesPath = join(root, 'support-sites.tsv.gz');
  await writeFile(consensusSitesPath, bgzipLike(consensus));
  await writeFile(supportSitesPath, bgzipLike(support));
  return {consensusSitesPath, supportSitesPath};
}

test('keeps unresolved and competing-indel loci with every voter\'s support', async context => {
  const paths = await tables(
    context,
    [consensusHeader, ...consensusRows],
    ['## isolates: isolate-a,isolate-b,isolate-c', supportHeader, ...supportRows],
  );
  const {voters, sites} = await readCohortSites(paths);

  assert.deepEqual(voters, ['isolate-a', 'isolate-b', 'isolate-c']);
  // The selected SNP and the unresolved region are not kept; the selected competing indel is.
  assert.deepEqual(sites.map(site => `${site.chrom}:${String(site.start)}`), ['chr1:20', 'chr1:30', 'chr2:3', 'chr2:9']);
  const tie = sites[0]!;
  assert.equal(tie.reason, 'tie');
  assert.equal(tie.backboneVotes, 1);
  assert.deepEqual(tie.alleles, ['G', 'C']);
  assert.deepEqual(tie.votes, [2, 2]);
  assert.deepEqual(siteCalls(tie, voters), [
    {voter: 'isolate-a', call: '0'},
    {voter: 'isolate-b', call: '1'},
    {voter: 'isolate-c', call: '1'},
  ]);
  assert.deepEqual(siteCalls(sites[3]!, voters).map(entry => entry.call), ['uncallable', 'ambiguous', 'unsupported']);

  const counts = Object.fromEntries(siteFilters.map(filter => [
    filter,
    sites.filter(site => matchesSiteFilter(site, filter)).length,
  ]));
  assert.deepEqual(counts, {tie: 1, no_majority: 1, competing_indel: 2, unresolved: 3});
});

test('rejects tables that do not belong together', async context => {
  const shifted = await tables(
    context,
    [consensusHeader, ...consensusRows],
    [supportHeader, ...supportRows.slice(1)],
  );
  await assert.rejects(readCohortSites(shifted), /has no matching row/);

  const longer = await tables(
    context,
    [consensusHeader, ...consensusRows.slice(0, 2)],
    [supportHeader, ...supportRows],
  );
  await assert.rejects(readCohortSites(longer), /has more loci/);

  const wrongHeader = await tables(context, ['#chrom\tstart', ...consensusRows], [supportHeader, ...supportRows]);
  await assert.rejects(readCohortSites(wrongHeader), /does not start with the columns/);
});

test('stops when cancelled', async context => {
  const many = Array.from({length: 20000}, (_, index) =>
    `chr1\t${String(index + 1)}\t${String(index + 1)}\t0\t0\tlocus\tunresolved\ttie\t.\tN\tA\tA,C\t1,1\t2\t2\tsnp`);
  const support = Array.from({length: 20000}, (_, index) =>
    `chr1\t${String(index + 1)}\t${String(index + 1)}\tA\t0\tA,C\t1,1\t2\t2\tsnp\t0\t1`);
  const paths = await tables(context, [consensusHeader, ...many], [supportHeader.split('\t').slice(0, 12).join('\t'), ...support]);
  const controller = new AbortController();
  controller.abort(new Error('left the tab'));
  await assert.rejects(readCohortSites({...paths, signal: controller.signal}), /left the tab|cancelled/);
});
