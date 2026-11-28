import {createWriteStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable, Transform} from 'node:stream';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {pipeline} from 'node:stream/promises';
import {filterMitochondria} from './mitochondria.js';
import {emptyGenomeMetadata, type GenomeAttribute} from '../../metadata.js';
import {artifactFiles, fileKinds, type ArtifactPaths, type FileKind, type GenomeProvider, type GenomeReference, type GenomeResult, type ProviderContext} from '../../provider.js';

// Only component sites with authenticated discovery and raw-file evidence are exposed.
export const veupathdbSites = [
  {id: 'FungiDB', label: 'FungiDB', host: 'fungidb.org'},
  {id: 'ToxoDB', label: 'ToxoDB', host: 'toxodb.org'},
  {id: 'PlasmoDB', label: 'PlasmoDB', host: 'plasmodb.org'},
] as const;

type Parameters = {site: string; release: number; organism_abbreviation: string; exclude_mitochondrial?: true};
type Metadata = Parameters & {
  organism?: string; organism_id?: string; assembly?: string; strain?: string; species?: string;
  annotation_version?: string; tax_id?: number; number_of_contigs?: number;
  supercontig_count?: number; chromosome_count?: number; megabps?: number; retrieved_at?: string;
};
const textFields = ['organism', 'organism_id', 'assembly', 'strain', 'species', 'annotation_version', 'retrieved_at'] as const;
const numberFields = ['tax_id', 'number_of_contigs', 'supercontig_count', 'chromosome_count', 'megabps'] as const;
const fields = ['site', 'release', 'organism_abbreviation', ...textFields, ...numberFields];
const organismAttributes = [
  'primary_key', 'name_for_filenames', 'project_id', 'genome_version', 'strain', 'species',
  'ncbi_tax_id', 'annotation_version', 'contigCount', 'supercontigCount', 'chromosomeCount', 'megabps',
];

function reportedText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text && !/^(?:N\/A|null|not available|not provided|-)$/i.test(text) ? text : undefined;
}

function reportedNumber(value: unknown, integer = true): number | undefined {
  const number = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 && (!integer || Number.isSafeInteger(number)) ? number : undefined;
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function siteFor(id: string | undefined) {
  const site = veupathdbSites.find(site => site.id === id);
  if (!site) {
    throw new Error('Select a supported VEuPathDB site.');
  }
  return site;
}

function parameters(value: unknown): Parameters {
  if (!isRecord(value) || Object.keys(value).some(key => !['site', 'release', 'organism_abbreviation', 'exclude_mitochondrial'].includes(key))
    || (value.exclude_mitochondrial !== undefined && value.exclude_mitochondrial !== true)
    || typeof value.site !== 'string' || !Number.isSafeInteger(value.release) || Number(value.release) < 1
    || typeof value.organism_abbreviation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.organism_abbreviation)
    || value.organism_abbreviation.endsWith('__nuclear')) {
    throw new Error('Invalid VEuPathDB site, pinned release, or organism abbreviation.');
  }
  siteFor(value.site);
  return {site: value.site, release: value.release as number, organism_abbreviation: value.organism_abbreviation,
    ...(value.exclude_mitochondrial === true ? {exclude_mitochondrial: true as const} : {})};
}

function referenceFor(params: Parameters): GenomeReference {
  return {source: 'veupathdb', id: `${params.site}-${params.release}_${params.organism_abbreviation}${params.exclude_mitochondrial ? '__nuclear' : ''}`, parameters: {...params}};
}

function validateReference(id: string, value: unknown): GenomeReference {
  const reference = referenceFor(parameters(value));
  if (reference.id !== id) {
    throw new Error('VEuPathDB parameters do not match the canonical genome ID.');
  }
  return reference;
}

function metadata(value: unknown): Metadata | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).some(key => !fields.includes(key))) {
    throw new Error('Invalid VEuPathDB metadata.');
  }
  const params = parameters(Object.fromEntries(['site', 'release', 'organism_abbreviation'].map(key => [key, value[key]])));
  for (const key of textFields) {
    if (value[key] !== undefined && reportedText(value[key]) !== value[key]) {
      throw new Error('Invalid VEuPathDB metadata field.');
    }
  }
  for (const key of numberFields) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || reportedNumber(value[key], key !== 'megabps') === undefined
      || (key === 'tax_id' && Number(value[key]) < 1))) {
      throw new Error('Invalid VEuPathDB numeric metadata field.');
    }
  }
  if (value.retrieved_at !== undefined && (typeof value.retrieved_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.retrieved_at) || Number.isNaN(Date.parse(value.retrieved_at)))) {
    throw new Error('Invalid VEuPathDB retrieval timestamp.');
  }
  return {...value, ...params} as Metadata;
}

async function request(url: string, context: ProviderContext, method = 'GET'): Promise<Response> {
  context.signal.throwIfAborted();
  const key = context.secrets['api-key'];
  if (!key?.trim() || /[\r\n]/.test(key)) {
    throw new Error('Configure a VEuPathDB API key in Manage tooling.');
  }
  let response: Response;
  try {
    response = await (context.fetchImpl ?? fetch)(url, {
      method, signal: context.signal, redirect: 'error', headers: {Authorization: `Bearer ${key}`, Accept: method === 'HEAD' ? '*/*' : 'application/json, application/octet-stream'},
    });
  } catch {
    context.signal.throwIfAborted();
    throw new Error('VEuPathDB could not be reached or redirected the request. Check the connection and retry.');
  }
  context.signal.throwIfAborted();
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new Error('VEuPathDB rejected access. Check the configured API key and account access.');
  }
  return response;
}

async function json(url: string, context: ProviderContext): Promise<unknown> {
  const response = await request(url, context);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`VEuPathDB metadata request failed (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    context.signal.throwIfAborted();
    throw new Error('VEuPathDB returned unreadable metadata.');
  }
}

/** Current-release discovery is bounded and name-filtered locally, not a gene text search. */
async function discover(context: ProviderContext): Promise<{release: number; entries: {reference: GenomeReference; metadata: Metadata}[]}> {
  const site = siteFor(context.site);
  const base = `https://${site.host}/a/service`;
  const root = await json(base, context);
  if (!isRecord(root) || root.projectId !== site.id || typeof root.buildNumber !== 'string' || !/^[1-9]\d*$/.test(root.buildNumber)) {
    throw new Error('VEuPathDB service did not identify the selected site and release.');
  }
  const release = Number(root.buildNumber);
  if (!Number.isSafeInteger(release)) {
    throw new Error('Invalid VEuPathDB service release.');
  }
  const entries: {reference: GenomeReference; metadata: Metadata}[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    const url = new URL(`${base}/record-types/organism/searches/GenomeDataTypes/reports/standard`);
    url.searchParams.set('reportConfig', JSON.stringify({
      attributes: organismAttributes, tables: [], attributeFormat: 'text',
      pagination: {offset: entries.length, numRecords: 200}, sorting: [{attributeName: 'primary_key', direction: 'ASC'}],
    }));
    const page = await json(url.href, context);
    if (!isRecord(page) || !isRecord(page.meta) || !Array.isArray(page.records) || !Number.isSafeInteger(page.meta.totalCount)
      || Number(page.meta.totalCount) < 0 || page.meta.responseCount !== page.records.length || page.records.length > 200
      || (total !== undefined && total !== page.meta.totalCount)) {
      throw new Error('VEuPathDB returned an inconsistent organism listing. Retry discovery.');
    }
    total = page.meta.totalCount as number;
    if ((page.records.length === 0 && entries.length < total) || entries.length + page.records.length > total) {
      throw new Error('VEuPathDB returned an incomplete organism listing.');
    }
    for (const record of page.records) {
      if (!isRecord(record) || !isRecord(record.attributes) || !Array.isArray(record.id) || !Array.isArray(record.tableErrors) || record.tableErrors.length) {
        throw new Error('Invalid VEuPathDB organism record.');
      }
      const attr = record.attributes;
      const organismId = record.id.find((id: unknown) => isRecord(id) && id.name === 'source_id');
      const project = record.id.find((id: unknown) => isRecord(id) && id.name === 'project_id');
      if (!isRecord(organismId) || typeof organismId.value !== 'string' || !isRecord(project) || project.value !== site.id
        || attr.project_id !== site.id || typeof attr.primary_key !== 'string' || !attr.primary_key.trim()) {
        throw new Error('VEuPathDB organism identity does not match the selected site.');
      }
      const params = parameters({site: site.id, release, organism_abbreviation: attr.name_for_filenames});
      const reference = referenceFor(params);
      if (seen.has(reference.id)) {
        throw new Error('VEuPathDB returned duplicate organisms across discovery pages.');
      }
      seen.add(reference.id);
      const taxId = reportedNumber(attr.ncbi_tax_id);
      const optional = {
        assembly: reportedText(attr.genome_version), strain: reportedText(attr.strain), species: reportedText(attr.species),
        annotation_version: reportedText(attr.annotation_version), tax_id: taxId && taxId > 0 ? taxId : undefined,
        number_of_contigs: reportedNumber(attr.contigCount), supercontig_count: reportedNumber(attr.supercontigCount),
        chromosome_count: reportedNumber(attr.chromosomeCount), megabps: reportedNumber(attr.megabps, false),
      };
      entries.push({reference, metadata: metadata({...params, organism: reportedText(attr.primary_key), organism_id: organismId.value,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)), retrieved_at: new Date().toISOString()})!});
    }
  } while (entries.length < total);
  const after = await json(base, context);
  if (!isRecord(after) || after.projectId !== site.id || after.buildNumber !== String(release)) {
    throw new Error('VEuPathDB changed release during discovery. Retry.');
  }
  return {release, entries};
}

const suffixes: Record<FileKind, string> = {fasta: '_Genome.fasta', gff3: '.gff', proteins: '_AnnotatedProteins.fasta', transcripts: '_AnnotatedTranscripts.fasta', cds: '_AnnotatedCDSs.fasta'};
function fileUrl(params: Parameters, kind: FileKind): string {
  const site = siteFor(params.site);
  const filename = `${site.id}-${params.release}_${params.organism_abbreviation}${suffixes[kind]}`;
  return `https://${site.host}/a/service/raw-files/release-${params.release}/${params.organism_abbreviation}/${kind === 'gff3' ? 'gff' : 'fasta'}/data/${filename}`;
}

export const veupathdbProvider: GenomeProvider = {
  id: 'veupathdb', label: 'VEuPathDB', description: 'Whole-genome downloads and current-release organism search.',
  cacheDirectory: 'veupathdb-accessions-cache',
  fields: [{id: 'api-key', label: 'API key', kind: 'secret', required: true}],
  sites: veupathdbSites,
  artifacts: [
    {kind: 'fasta', label: 'Genome sequence (FASTA)'}, {kind: 'gff3', label: 'Genome annotation (GFF3)'},
    {kind: 'proteins', label: 'Annotated proteins (FASTA)'}, {kind: 'transcripts', label: 'Annotated transcripts (FASTA)'}, {kind: 'cds', label: 'Annotated CDS (FASTA)'},
  ],
  downloadOptions: [{
    id: 'include-mitochondrial', label: 'Include mitochondrial sequences', defaultValue: false,
    description: 'When unchecked, explicitly labeled mitochondrial sequences and their annotations are excluded from genomic FASTA/GFF3. Other artifacts remain whole-genome; unclassified sequences are retained.',
    checked: reference => !parameters(reference.parameters).exclude_mitochondrial,
    apply(reference, checked) {
      const {exclude_mitochondrial: _excluded, ...base} = parameters(validateReference(reference.id, reference.parameters).parameters);
      return referenceFor({...base, ...(!checked ? {exclude_mitochondrial: true as const} : {})});
    },
  }],
  validateReference,
  validateMetadata(value) { metadata(value); },
  downloadSummary(facts) {
    const filter = facts.mitochondrial_filter;
    if (!isRecord(filter) || !isRecord(filter.originals) || !Object.keys(filter.originals).length || !Array.isArray(filter.excluded_sequences)) {
      return undefined;
    }
    const sequences = filter.excluded_sequences.filter(isRecord).filter(sequence => typeof sequence.id === 'string');
    if (!sequences.length) {
      return 'No explicitly labeled mitochondrial sequences found; unclassified sequences were retained.';
    }
    const names = sequences.slice(0, 3).map(sequence => `${sequence.id}${typeof sequence.bases === 'number' ? ` (${sequence.bases} bp)` : ''}`).join(', ')
      + (sequences.length > 3 ? `; ${sequences.length - 3} more in genome.json` : '');
    return `Excluded mitochondrial sequences: ${names}.${filter.originals.gff3 && typeof filter.removed_features === 'number' ? ` Removed ${filter.removed_features} GFF3 features.` : ''}`;
  },
  metadataSummary(value) {
    const facts = metadata(value);
    return facts ? [facts.organism ?? facts.organism_abbreviation, facts.site, `release ${facts.release}`, facts.assembly].filter(Boolean).join(' · ') : 'metadata not retrieved';
  },
  mapMetadata(value) {
    const facts = metadata(value);
    if (!facts) {
      return emptyGenomeMetadata();
    }
    const custom: [string, string, string | number | undefined][] = [
      ['site', 'Site', facts.site], ['release', 'Database release', facts.release],
      ['organism_abbreviation', 'File abbreviation', facts.organism_abbreviation], ['organism_id', 'Organism record', facts.organism_id],
      ['species', 'Species', facts.species], ['assembly', 'Genome version / assembly ID', facts.assembly],
      ['annotation_version', 'Annotation version', facts.annotation_version], ['chromosome_count', 'Chromosomes', facts.chromosome_count],
      ['supercontig_count', 'Supercontigs', facts.supercontig_count], ['megabps', 'Reported genome size (Mb)', facts.megabps],
    ];
    return {
      assembly: {...(facts.organism ? {organism: facts.organism} : {}), ...(facts.tax_id ? {tax_id: facts.tax_id} : {}),
        ...(facts.strain ? {strain: facts.strain} : {})},
      statistics: facts.number_of_contigs === undefined ? {} : {number_of_contigs: facts.number_of_contigs},
      provider_attributes: custom.filter((row): row is [string, string, string | number] => row[2] !== undefined)
        .map(([id, label, value]): GenomeAttribute => ({id, label, value})),
      ...(facts.retrieved_at ? {retrieved_at: facts.retrieved_at, retrieval_source: `${facts.site} organism report`} : {}),
    };
  },
  async resolveExact(id, context) {
    context.signal.throwIfAborted();
    const nuclear = id.trim().endsWith('__nuclear');
    const match = /^([A-Za-z]+DB)-([1-9]\d*)_([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(nuclear ? id.trim().slice(0, -9) : id.trim());
    if (!match) {
      throw new Error('Enter a pinned ID such as <site>-<release>_<organism abbreviation>, or search by organism name.');
    }
    const params = parameters({site: match[1], release: Number(match[2]), organism_abbreviation: match[3],
      ...(nuclear ? {exclude_mitochondrial: true} : {})});
    if (context.site !== undefined && params.site !== context.site) {
      throw new Error('The pinned ID belongs to another site. Change the selected site first.');
    }
    return referenceFor(params);
  },
  async search(query, context): Promise<GenomeResult[]> {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      throw new Error('Enter an organism name, ID, or abbreviation to search.');
    }
    const {entries} = await discover(context);
    return entries.filter(({reference, metadata}) => words.every(word => `${metadata.organism} ${metadata.organism_id} ${reference.id}`.toLowerCase().includes(word)))
      .map(({reference, metadata}) => ({reference, summary: `${metadata.organism} · ${reference.id}${metadata.assembly ? ` · ${metadata.assembly}` : ''}`}));
  },
  async lookupMetadata(reference, context) {
    const params = parameters(validateReference(reference.id, reference.parameters).parameters);
    const found = await discover({...context, site: params.site});
    // Current organism facts must never be represented as historical-release metadata.
    if (found.release !== params.release) {
      return {site: params.site, release: params.release, organism_abbreviation: params.organism_abbreviation};
    }
    const entry = found.entries.find(entry => entry.metadata.organism_abbreviation === params.organism_abbreviation);
    if (!entry) {
      throw new Error('The organism is not present in the selected site release.');
    }
    return entry.metadata;
  },
  async download(reference, kinds, staging, context) {
    const params = parameters(validateReference(reference.id, reference.parameters).parameters);
    if (!kinds.length || kinds.some(kind => !fileKinds.includes(kind)) || new Set(kinds).size !== kinds.length) {
      throw new Error('Invalid VEuPathDB artifact selection.');
    }
    const details = await veupathdbProvider.lookupMetadata!(reference, context);
    const files: ArtifactPaths = {};
    const urls: Partial<Record<FileKind, string>> = {};
    let bytes = 0;
    let annotation: 'available' | 'unavailable' | 'not-requested' = 'not-requested';
    // Classification uses the same genomic pair even for a single-artifact request.
    const downloadKinds = params.exclude_mitochondrial && kinds.some(kind => kind === 'fasta' || kind === 'gff3')
      ? [...new Set([...kinds, 'fasta' as const, 'gff3' as const])] : kinds;
    for (const kind of fileKinds.filter(kind => downloadKinds.includes(kind))) {
      context.onProgress?.({phase: 'requesting'});
      const url = fileUrl(params, kind);
      const response = await request(url, context);
      if (response.status === 404 && kind === 'gff3') {
        await response.body?.cancel();
        const genome = await request(fileUrl(params, 'fasta'), context, 'HEAD');
        await genome.body?.cancel();
        if (genome.ok) {
          annotation = 'unavailable';
          continue;
        }
        throw new Error('The pinned VEuPathDB release or organism files are unavailable; no current-release fallback was used.');
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(response.status === 404 ? `The pinned VEuPathDB ${kind} file is unavailable; check the release and organism.` : `VEuPathDB file request failed (HTTP ${response.status}). Retry the download.`);
      }
      urls[kind] = url;
      let reported = bytes;
      context.onProgress?.({phase: 'downloading', bytes});
      const counter = new Transform({transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes - reported >= 1024 * 1024) {
          context.onProgress?.({phase: 'downloading', bytes});
          reported = bytes;
        }
        callback(null, chunk);
      }});
      try {
        await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), counter,
          createWriteStream(join(staging, artifactFiles[kind]), {flags: 'wx', mode: 0o600}), {signal: context.signal});
      } catch {
        context.signal.throwIfAborted();
        throw new Error('VEuPathDB transfer or local file writing failed. Retry; the previous verified copy is unchanged.');
      }
      context.signal.throwIfAborted();
      context.onProgress?.({phase: 'downloading', bytes});
      files[kind] = artifactFiles[kind];
      if (kind === 'gff3') {
        annotation = 'available';
      }
    }
    const derived = params.exclude_mitochondrial
      ? await filterMitochondria(staging, files, context.signal) : undefined;
    const filtering = derived ? {...derived,
      classification_inputs: Object.fromEntries(Object.entries(derived.originals).map(([kind, original]) => [kind, original.sha256])),
    } : undefined;
    if (filtering) {
      for (const kind of ['fasta', 'gff3'] as const) {
        if (!kinds.includes(kind) && files[kind]) {
          await rm(join(staging, files[kind]!));
          await rm(join(staging, 'original', files[kind]!));
          delete files[kind];
          delete filtering.originals[kind];
        }
      }
    }
    if (!kinds.includes('gff3')) {
      annotation = 'not-requested';
    }
    return {files, ...(filtering ? {originals: Object.fromEntries(Object.entries(filtering.originals).map(([kind, original]) => [kind, original.path]))} : {}),
      metadata: details, facts: {source: 'veupathdb', ...params, api: 'wdk-raw-files', urls,
        ...(filtering ? {mitochondrial_filter: filtering,
          artifacts: Object.fromEntries(Object.entries(filtering.originals).map(([kind, original]) => [kind,
            {mitochondrial_filter: {...filtering, originals: {[kind]: original}}}]))} : {})}, annotation};
  },
};
