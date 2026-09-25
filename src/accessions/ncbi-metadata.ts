import type {NcbiAssemblyMetadata, NcbiMetadataSource} from './catalog.js';

/** The pinned NCBI Datasets REST API version that metadata is read from. */
export const ncbiDatasetsApiBaseUrl = 'https://api.ncbi.nlm.nih.gov/datasets/v2';

const defaultTimeoutMilliseconds = 15_000;

export type MetadataFetchErrorKind =
  | 'offline'
  | 'rate-limited'
  | 'not-found'
  | 'http-error'
  | 'invalid-response';

export type MetadataFetchResult =
  | {state: 'retrieved'; metadata: NcbiAssemblyMetadata}
  | {state: 'failed'; kind: MetadataFetchErrorKind; message: string};

export type AssemblyMetadataFetcher = (accession: string) => Promise<MetadataFetchResult>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field by its REST API name (snake_case) or by the camelCase name the Datasets CLI
 * writes into a download's `assembly_data_report.jsonl`; the two carry the same report.
 */
function field(record: unknown, snakeCaseName: string): unknown {
  if (!isRecord(record)) {
    return undefined;
  }
  if (snakeCaseName in record) {
    return record[snakeCaseName];
  }
  return record[snakeCaseName.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())];
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Maps one NCBI Assembly Data Report to the catalog's minimal metadata. Returns undefined when the
 * report names a different accession or lacks the organism. Absent optional facts stay absent.
 */
export function parseAssemblyReport(
  report: unknown,
  accession: string,
  source: NcbiMetadataSource,
  retrievedAt: string,
): NcbiAssemblyMetadata | undefined {
  if (field(report, 'accession') !== accession) {
    return undefined;
  }
  const organism = field(report, 'organism');
  const organismName = text(field(organism, 'organism_name'));
  if (organismName === undefined) {
    return undefined;
  }
  const taxId = field(organism, 'tax_id');
  const assemblyInfo = field(report, 'assembly_info');
  const optional = {
    assembly_name: text(field(assemblyInfo, 'assembly_name')),
    assembly_level: text(field(assemblyInfo, 'assembly_level')),
    assembly_status: text(field(assemblyInfo, 'assembly_status')),
    assembly_type: text(field(assemblyInfo, 'assembly_type')),
    refseq_category: text(field(assemblyInfo, 'refseq_category')),
    strain: text(field(field(organism, 'infraspecific_names'), 'strain')),
    submitter: text(field(assemblyInfo, 'submitter')),
  };
  return {
    organism: organismName,
    ...(Number.isSafeInteger(taxId) && (taxId as number) > 0 ? {tax_id: taxId as number} : {}),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    retrieved_at: retrievedAt,
    source,
  };
}

/**
 * Fetches lightweight assembly metadata from the NCBI Datasets API. The API key is optional; it
 * is sent only as a request header, never in the URL, and never appears in a returned message.
 */
export async function fetchAssemblyMetadata(
  accession: string,
  {
    apiKey,
    fetchImpl = fetch,
    now = () => new Date(),
    timeoutMilliseconds = defaultTimeoutMilliseconds,
  }: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMilliseconds?: number;
  } = {},
): Promise<MetadataFetchResult> {
  const url = `${ncbiDatasetsApiBaseUrl}/genome/accession/${encodeURIComponent(accession)}/dataset_report`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {accept: 'application/json', ...(apiKey ? {'api-key': apiKey} : {})},
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch {
    return {
      state: 'failed',
      kind: 'offline',
      message: 'NCBI could not be reached. Check the network connection and try again.',
    };
  }
  if (response.status === 429) {
    return {
      state: 'failed',
      kind: 'rate-limited',
      message: apiKey
        ? 'NCBI rate-limited the request. Wait a moment and try again.'
        : 'NCBI rate-limited the request. Wait a moment and try again, or add an NCBI API key.',
    };
  }
  if (!response.ok) {
    return {state: 'failed', kind: 'http-error', message: `NCBI answered with HTTP ${String(response.status)}.`};
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {state: 'failed', kind: 'invalid-response', message: 'NCBI returned a response that is not valid JSON.'};
  }
  if (!isRecord(body)) {
    return {state: 'failed', kind: 'invalid-response', message: 'NCBI returned an unexpected response.'};
  }
  // An unknown accession is answered with an empty report list rather than an error status.
  const reports = Array.isArray(body.reports) ? body.reports : [];
  if (reports.length === 0 || field(reports[0], 'accession') !== accession) {
    return {state: 'failed', kind: 'not-found', message: `NCBI has no assembly ${accession}.`};
  }
  const metadata = parseAssemblyReport(reports[0], accession, 'datasets-v2-rest', now().toISOString());
  if (!metadata) {
    return {
      state: 'failed',
      kind: 'invalid-response',
      message: `NCBI's report does not describe ${accession} with an organism name.`,
    };
  }
  return {state: 'retrieved', metadata};
}
