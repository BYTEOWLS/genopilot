import {createWriteStream} from 'node:fs';
import {mkdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable, Transform} from 'node:stream';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {pipeline} from 'node:stream/promises';
import {isVersionedAssemblyAccession, normalizeAccession, ncbiAccessionFormatMessage} from './accession.js';
import {fetchAssemblyMetadata, ncbiDatasetsApiBaseUrl, parseAssemblyReport} from './metadata-fetch.js';
import {validateNcbiMetadata, type NcbiAssemblyMetadata} from './metadata.js';
import {emptyGenomeMetadata} from '../../metadata.js';
import type {GenomeProvider, GenomeReference} from '../../provider.js';
import {extractZipMember, zipMembers, type ZipMember} from './zip.js';

export function ncbiMetadata(value: unknown): NcbiAssemblyMetadata | null {
  const issues: {path: string; message: string}[] = [];
  validateNcbiMetadata(value, 'metadata', issues);
  if (issues.length > 0) {
    throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  }
  return value as NcbiAssemblyMetadata | null;
}

function validateReference(id: string, parameters: unknown): GenomeReference {
  if (!isVersionedAssemblyAccession(id)) {
    throw new Error(ncbiAccessionFormatMessage);
  }
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters) || Object.keys(parameters).length !== 0) {
    throw new Error('NCBI parameters must be an empty mapping.');
  }
  return {source: 'ncbi', id, parameters: {}};
}

function uniqueMember(members: ZipMember[], description: string, required: boolean): ZipMember | undefined {
  if (members.length > 1 || (required && members.length !== 1)) {
    throw new Error(`NCBI package has missing or ambiguous ${description}.`);
  }
  return members[0];
}

export const ncbiCacheDirectoryName = 'ncbi-accessions-cache';

export const ncbiProvider: GenomeProvider = {
  id: 'ncbi',
  label: 'NCBI',
  description: 'Versioned genome assemblies from NCBI Datasets.',
  cacheDirectory: ncbiCacheDirectoryName,
  fields: [{id: 'api-key', label: 'API key', kind: 'secret', required: false}],
  artifacts: [{kind: 'fasta', label: 'Genome sequence (FASTA)'}, {kind: 'gff3', label: 'Genome annotation (GFF3)'},
    {kind: 'proteins', label: 'Annotated proteins (FASTA)'}],
  validateReference,
  validateMetadata(value) { ncbiMetadata(value); },
  metadataSummary(value) {
    const metadata = ncbiMetadata(value);
    return metadata ? [metadata.organism, metadata.assembly_name, metadata.strain, metadata.assembly_type, metadata.refseq_category].filter(Boolean).join(' · ') : 'metadata not retrieved';
  },
  mapMetadata(value) {
    const facts = ncbiMetadata(value);
    if (!facts) {
      return emptyGenomeMetadata();
    }
    const {total_sequence_length, gc_percent, number_of_contigs, number_of_scaffolds, contig_n50, scaffold_n50,
      bioproject_accession, biosample_accession, retrieved_at, source, ...assembly} = facts;
    return {
      assembly,
      statistics: {total_sequence_length, gc_percent, number_of_contigs, number_of_scaffolds, contig_n50, scaffold_n50},
      provider_attributes: [
        ...(bioproject_accession ? [{id: 'bioproject_accession', label: 'BioProject', value: `https://www.ncbi.nlm.nih.gov/bioproject/${encodeURIComponent(bioproject_accession)}`}] : []),
        ...(biosample_accession ? [{id: 'biosample_accession', label: 'BioSample', value: `https://www.ncbi.nlm.nih.gov/biosample/${encodeURIComponent(biosample_accession)}`}] : []),
      ],
      retrieved_at,
      retrieval_source: source === 'datasets-v2-rest' ? 'NCBI Datasets API' : 'NCBI assembly report from a previous download',
    };
  },
  async resolveExact(id, context) {
    context.signal.throwIfAborted();
    return validateReference(normalizeAccession(id), {});
  },
  async lookupMetadata(reference, context) {
    validateReference(reference.id, reference.parameters);
    context.signal.throwIfAborted();
    const result = await fetchAssemblyMetadata(reference.id, {apiKey: context.secrets['api-key'], fetchImpl: context.fetchImpl, signal: context.signal});
    context.signal.throwIfAborted();
    if (result.state === 'failed') {
      throw new Error(result.message);
    }
    return result.metadata;
  },
  async download(reference, kinds, staging, context) {
    validateReference(reference.id, reference.parameters);
    context.signal.throwIfAborted();
    const url = new URL(`${ncbiDatasetsApiBaseUrl}/genome/accession/${encodeURIComponent(reference.id)}/download`);
    if (kinds.includes('fasta')) {
      url.searchParams.append('include_annotation_type', 'GENOME_FASTA');
    }
    if (kinds.includes('gff3')) {
      url.searchParams.append('include_annotation_type', 'GENOME_GFF');
    }
    if (kinds.includes('proteins')) {
      url.searchParams.append('include_annotation_type', 'PROT_FASTA');
    }
    context.onProgress?.({phase: 'requesting'});
    context.signal.throwIfAborted();
    let response: Response;
    try {
      response = await (context.fetchImpl ?? fetch)(url, {
        headers: {accept: 'application/zip', ...(context.secrets['api-key'] ? {'api-key': context.secrets['api-key']} : {})},
        signal: context.signal,
      });
    } catch {
      context.signal.throwIfAborted();
      throw new Error('NCBI could not be reached. Check the network connection and retry.');
    }
    if (!response.ok || !response.body) {
      throw new Error(`NCBI genome request failed (HTTP ${String(response.status)}).`);
    }
    const archive = join(staging, 'dataset.zip');
    try {
      const length = Number(response.headers.get('content-length'));
      const total = Number.isSafeInteger(length) && length > 0 && !response.headers.get('content-encoding') ? length : undefined;
      let bytes = 0;
      let reported = 0;
      context.onProgress?.({phase: 'downloading', bytes, ...(total ? {total} : {})});
      const count = new Transform({transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        // Bound UI updates by bytes, without timers or guessing a missing transfer length.
        if (reported === 0 || bytes - reported >= 1024 * 1024) {
          context.onProgress?.({phase: 'downloading', bytes, ...(total ? {total} : {})});
          reported = bytes;
        }
        callback(null, chunk);
      }});
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), count, createWriteStream(archive, {flags: 'wx', mode: 0o600}), {signal: context.signal});
      context.signal.throwIfAborted();
      context.onProgress?.({phase: 'downloading', bytes, ...(total ? {total} : {})});
      context.signal.throwIfAborted();
      context.onProgress?.({phase: 'extracting'});
      const members = await zipMembers(archive);
      const prefix = `ncbi_dataset/data/${reference.id}/`;
      const fasta = kinds.includes('fasta') ? uniqueMember(members.filter(member => member.name.startsWith(prefix) && !member.name.slice(prefix.length).includes('/') && member.name.endsWith('_genomic.fna')), 'genome FASTA', true)! : undefined;
      const gff3 = kinds.includes('gff3') ? uniqueMember(members.filter(member => member.name === `${prefix}genomic.gff`), 'genome GFF3', false) : undefined;
      const proteins = kinds.includes('proteins') ? uniqueMember(members.filter(member => member.name === `${prefix}protein.faa`), 'protein FASTA', false) : undefined;
      if (kinds.includes('proteins') && !proteins) {
        throw new Error('NCBI supplied no protein FASTA for this assembly. Deselect annotated proteins in download review to download its other available artifacts.');
      }
      const report = uniqueMember(members.filter(member => member.name === 'ncbi_dataset/data/assembly_data_report.jsonl'), 'assembly report', true)!;
      if (report.size > 16 * 1024 * 1024) {
        throw new Error('NCBI assembly report is too large.');
      }
      const reportDirectory = join(staging, 'ncbi_dataset', 'data');
      await mkdir(reportDirectory, {recursive: true});
      const reportPath = join(reportDirectory, 'assembly_data_report.jsonl');
      await extractZipMember(archive, report, reportPath, context.signal);
      let reports: unknown[];
      try {
        reports = (await readFile(reportPath, 'utf8')).split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as unknown);
      } catch {
        throw new Error('NCBI package contains an unreadable assembly report.');
      }
      const matching = reports.map(value => parseAssemblyReport(value, reference.id, 'cached-download-report', new Date().toISOString())).filter(value => value !== undefined);
      if (matching.length !== 1 || reports.length !== 1) {
        throw new Error('NCBI package does not contain exactly one matching assembly report.');
      }
      if (fasta) {
        await extractZipMember(archive, fasta, join(staging, 'genomic.fna'), context.signal);
      }
      if (gff3) {
        await extractZipMember(archive, gff3, join(staging, 'genomic.gff'), context.signal);
      }
      if (proteins) {
        await extractZipMember(archive, proteins, join(staging, 'proteins.faa'), context.signal);
      }
      return {
        files: {...(fasta ? {fasta: 'genomic.fna'} : {}), ...(gff3 ? {gff3: 'genomic.gff'} : {}), ...(proteins ? {proteins: 'proteins.faa'} : {})},
        metadata: matching[0],
        facts: {source: 'ncbi', id: reference.id, api: 'datasets-v2-rest'},
        annotation: kinds.includes('gff3') ? (gff3 ? 'available' : 'unavailable') : 'not-requested',
      };
    } finally {
      await rm(archive, {force: true});
    }
  },
};
