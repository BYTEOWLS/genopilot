import assert from 'node:assert/strict';
import test from 'node:test';
import {fetchAssemblyMetadata, parseAssemblyReport} from '../../src/accessions/ncbi-metadata.js';

const accession = 'GCF_000149205.2';
const secret = 'secret-api-key-value';
const now = () => new Date('2026-01-01T12:00:00.000Z');

// Shaped like the NCBI Datasets v2 REST `dataset_report` response (snake_case keys).
const restReport = {
  accession,
  current_accession: accession,
  organism: {tax_id: 42, organism_name: 'Example organism', infraspecific_names: {strain: 'Example strain'}},
  assembly_info: {
    assembly_name: 'Example assembly',
    assembly_level: 'Chromosome',
    assembly_status: 'current',
    assembly_type: 'haploid',
    refseq_category: 'reference genome',
    submitter: 'Example submitter',
  },
};

type Call = {url: string; headers: Record<string, string>};

function fakeFetch(respond: () => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({url: String(url), headers: {...(init?.headers as Record<string, string>)}});
    return respond();
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

test('maps the REST report to the minimal metadata', async () => {
  const result = await fetchAssemblyMetadata(accession, {fetchImpl: fakeFetch(() => json({reports: [restReport]})), now});

  assert.deepEqual(result, {
    state: 'retrieved',
    metadata: {
      organism: 'Example organism',
      tax_id: 42,
      assembly_name: 'Example assembly',
      assembly_level: 'Chromosome',
      assembly_status: 'current',
      assembly_type: 'haploid',
      refseq_category: 'reference genome',
      strain: 'Example strain',
      submitter: 'Example submitter',
      retrieved_at: '2026-01-01T12:00:00.000Z',
      source: 'datasets-v2-rest',
    },
  });
});

test('reads the camelCase report the Datasets CLI caches with a download', () => {
  const metadata = parseAssemblyReport(
    {
      accession,
      organism: {taxId: 42, organismName: 'Example organism'},
      assemblyInfo: {
        assemblyName: 'Example assembly',
        assemblyStatus: 'current',
        assemblyType: 'haploid',
        submitter: 'Example submitter',
      },
    },
    accession,
    'cached-download-report',
    '2026-01-01T12:00:00.000Z',
  );

  assert.deepEqual(metadata, {
    organism: 'Example organism',
    tax_id: 42,
    assembly_name: 'Example assembly',
    assembly_status: 'current',
    assembly_type: 'haploid',
    submitter: 'Example submitter',
    retrieved_at: '2026-01-01T12:00:00.000Z',
    source: 'cached-download-report',
  });
});

test('omits facts NCBI does not report instead of guessing them', async () => {
  // Most assemblies have no RefSeq category, and many name no strain.
  const report = {
    ...restReport,
    organism: {tax_id: 42, organism_name: 'Example organism'},
    assembly_info: {assembly_name: 'Example assembly'},
  };
  const result = await fetchAssemblyMetadata(accession, {fetchImpl: fakeFetch(() => json({reports: [report]})), now});

  assert.equal(result.state, 'retrieved');
  for (const field of ['strain', 'refseq_category', 'assembly_type', 'submitter']) {
    assert.ok(result.state === 'retrieved' && !(field in result.metadata), field);
  }
});

test('sends the API key only as a header, and only when configured', async () => {
  const calls: Call[] = [];
  await fetchAssemblyMetadata(accession, {fetchImpl: fakeFetch(() => json({reports: [restReport]}), calls), now});
  await fetchAssemblyMetadata(accession, {
    apiKey: secret,
    fetchImpl: fakeFetch(() => json({reports: [restReport]}), calls),
    now,
  });

  assert.equal(calls[0]?.headers['api-key'], undefined);
  assert.equal(calls[1]?.headers['api-key'], secret);
  assert.ok(calls.every(call => !call.url.includes(secret)));
  assert.match(calls[0]?.url ?? '', /\/datasets\/v2\/genome\/accession\/GCF_000149205\.2\/dataset_report$/);
});

test('classifies failures without exposing the API key', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => Promise.reject(new TypeError(`fetch failed ${secret}`)), 'offline'],
    [() => json({}, 429), 'rate-limited'],
    [() => json({}, 500), 'http-error'],
    [() => new Response('not json', {status: 200}), 'invalid-response'],
    // NCBI answers an unknown accession with an empty object rather than an error status.
    [() => json({}), 'not-found'],
    [() => json({reports: [{...restReport, accession: 'GCF_000149205.3'}]}), 'not-found'],
    [() => json({reports: [{...restReport, organism: {}}]}), 'invalid-response'],
  ];
  for (const [respond, kind] of cases) {
    const result = await fetchAssemblyMetadata(accession, {apiKey: secret, fetchImpl: fakeFetch(respond), now});
    assert.equal(result.state, 'failed');
    assert.equal(result.state === 'failed' ? result.kind : undefined, kind);
    assert.ok(result.state === 'failed' && !result.message.includes(secret));
  }
});
