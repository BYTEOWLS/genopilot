import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {inspectCopy} from '../accessions/cache-discovery.js';
import {genomeSources} from './registry.js';
import {missingProviderFields, type FileKind, type GenomeProviderRegistry, type GenomeReference, type ProviderContext} from './provider.js';

export type GenomeCacheRequest = {
  reference: GenomeReference;
  kinds: readonly FileKind[];
  root: string;
  mode: 'reuse' | 'refresh';
  copy?: {path: string; fasta_sha256: string; gff3_sha256?: string};
};
export type VerifiedGenome = {
  reference: GenomeReference;
  fasta: string;
  gff3?: string;
  fasta_sha256: string;
  gff3_sha256?: string;
  metadata: unknown;
  facts: Record<string, unknown>;
  downloaded: boolean;
  annotation: 'available' | 'unavailable' | 'not-requested';
};

type CacheRecord = {reference: GenomeReference; metadata: unknown; facts: Record<string, unknown>; annotation: VerifiedGenome['annotation']};

async function verified(directory: string, request: GenomeCacheRequest, registry: GenomeProviderRegistry, signal: AbortSignal): Promise<VerifiedGenome | undefined> {
  try {
    if ((await lstat(directory)).isSymbolicLink()) {
      return undefined;
    }
    const record = JSON.parse(await readFile(join(directory, 'genome.json'), 'utf8')) as CacheRecord;
    const reference = registry.validateReference(record.reference);
    if (reference.source !== request.reference.source || reference.id !== request.reference.id || JSON.stringify(reference.parameters) !== JSON.stringify(request.reference.parameters)) {
      return undefined;
    }
    registry.get(reference.source).validateMetadata(record.metadata);
    const copy = await inspectCopy(reference, request.root, directory, record.metadata, {signal, kinds: request.kinds});
    if (copy.state !== 'verified') {
      return undefined;
    }
    if (request.copy && (copy.fasta_sha256 !== request.copy.fasta_sha256 || (request.kinds.includes('gff3') && copy.gff3_sha256 !== request.copy.gff3_sha256))) {
      return undefined;
    }
    if (request.kinds.includes('gff3') && !copy.gff3_sha256 && record.annotation !== 'unavailable') {
      return undefined;
    }
    return {reference, fasta: join(directory, 'genomic.fna'), ...(copy.gff3_sha256 ? {gff3: join(directory, 'genomic.gff'), gff3_sha256: copy.gff3_sha256} : {}),
      fasta_sha256: copy.fasta_sha256!, metadata: record.metadata, facts: record.facts, annotation: request.kinds.includes('gff3') ? record.annotation : 'not-requested', downloaded: false};
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

async function validateFile(path: string, kind: FileKind, signal: AbortSignal): Promise<string> {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('Provider output must be a regular file.');
  }
  const hash = createHash('sha256');
  const stream = createReadStream(path, {signal});
  stream.on('data', chunk => hash.update(chunk));
  const lines = createInterface({input: stream, crlfDelay: Infinity});
  let header = false;
  let sequence = false;
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      if (!line.trim()) {
        continue;
      }
      if (kind === 'fasta') {
        if (line.startsWith('>') && line.slice(1).trim()) {
          if (header && !sequence) {
            throw new Error('Provider returned an empty FASTA sequence record.');
          }
          header = true;
          sequence = false;
        } else if (!header || !/^[ACGTRYSWKMBDHVNacgtryswkmbdhvn]+$/.test(line)) {
          throw new Error('Provider returned invalid nucleotide FASTA.');
        } else {
          sequence = true;
        }
      } else if (!line.startsWith('#') && line.split('\t').length !== 9) {
        throw new Error('Provider returned invalid GFF3.');
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if ((kind === 'fasta' && (!header || !sequence)) || details.size === 0) {
    throw new Error('Provider returned an empty genome file.');
  }
  return hash.digest('hex');
}

/** One shared download path for catalog actions and the packaged noninteractive resolver. */
export async function resolveGenomeCache(
  request: GenomeCacheRequest,
  context: ProviderContext,
  registry: GenomeProviderRegistry = genomeSources,
): Promise<VerifiedGenome> {
  const reference = registry.validateReference(request.reference);
  const provider = registry.get(reference.source);
  if (!['reuse', 'refresh'].includes(request.mode) || request.kinds.length === 0 || request.kinds.some(kind => !['fasta', 'gff3'].includes(kind))) {
    throw new Error('Invalid genome cache mode or requested files.');
  }
  context.signal.throwIfAborted();
  const cache = resolve(request.root, provider.cacheDirectory);
  const destination = join(cache, reference.id);
  if (request.mode === 'reuse') {
    const existing = await verified(request.copy?.path ?? destination, request, registry, context.signal);
    context.signal.throwIfAborted();
    if (existing) {
      return existing;
    }
    if (request.copy) {
      throw new Error('The snapshotted genome copy no longer matches its required checksums.');
    }
  }
  if (missingProviderFields(provider, context.secrets).length > 0) {
    throw new Error('Configure this genome provider before accessing remote files.');
  }
  await mkdir(cache, {recursive: true});
  const canonicalCache = await realpath(cache);
  const lock = join(canonicalCache, `.${reference.id}.lock`);
  try {
    await mkdir(lock);
  } catch {
    throw new Error('Another genome cache writer holds this entry. Retry after it finishes.');
  }
  let staging: string | undefined;
  let backup: string | undefined;
  try {
    context.signal.throwIfAborted();
    // A concurrent writer may have completed between the first check and acquiring the lock.
    if (request.mode === 'reuse') {
      const existing = await verified(destination, request, registry, context.signal);
      if (existing) {
        context.signal.throwIfAborted();
        return existing;
      }
    }
    staging = await mkdtemp(join(canonicalCache, `.${reference.id}-staging-`));
    const result = await provider.download(reference, request.kinds, staging, context);
    if (result.files.fasta !== 'genomic.fna' || (result.files.gff3 !== undefined && result.files.gff3 !== 'genomic.gff')) {
      throw new Error('Provider returned unexpected genome file names.');
    }
    provider.validateMetadata(result.metadata);
    const fasta = await validateFile(join(staging, 'genomic.fna'), 'fasta', context.signal);
    const gff3 = result.files.gff3 ? await validateFile(join(staging, 'genomic.gff'), 'gff3', context.signal) : undefined;
    await writeFile(join(staging, 'checksums.json'), JSON.stringify({fasta, ...(gff3 ? {gff3} : {})}), {flag: 'wx', mode: 0o600});
    await writeFile(join(staging, 'genome.json'), JSON.stringify({reference, metadata: result.metadata, facts: result.facts, annotation: result.annotation}), {flag: 'wx', mode: 0o600});
    if (!(await verified(staging, {...request, copy: undefined}, registry, context.signal))) {
      throw new Error('Staged genome failed checksum verification.');
    }
    context.signal.throwIfAborted();
    try {
      const old = await lstat(destination);
      if (!old.isDirectory() || old.isSymbolicLink()) {
        throw new Error('Refusing to replace a linked or non-directory genome cache.');
      }
      backup = join(canonicalCache, `.${reference.id}-previous-${randomUUID()}`);
      await rename(destination, backup);
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    // Commit point: no cancellation or unverified bytes are exposed between these renames.
    try {
      await rename(staging, destination);
      staging = undefined;
    } catch (error) {
      if (backup) {
        await rename(backup, destination);
        backup = undefined;
      }
      throw error;
    }
    const value: VerifiedGenome = {reference, fasta: join(destination, 'genomic.fna'), fasta_sha256: fasta,
      ...(gff3 ? {gff3: join(destination, 'genomic.gff'), gff3_sha256: gff3} : {}),
      metadata: result.metadata, facts: result.facts, annotation: result.annotation, downloaded: true};
    if (backup) {
      await rm(backup, {recursive: true, force: true}).catch(() => {});
    }
    return value;
  } finally {
    if (staging) {
      await rm(staging, {recursive: true, force: true});
    }
    await rm(lock, {recursive: true, force: true});
  }
}
