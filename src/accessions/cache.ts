import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {inspectCopy} from './cache-discovery.js';
import {accessionSources} from './registry.js';
import {artifactFiles, fileKinds, missingProviderFields, type ArtifactPaths, type ArtifactDigests, type FileKind, type GenomeProviderRegistry, type GenomeReference, type ProviderContext} from './provider.js';

export type GenomeCacheRequest = {
  reference: GenomeReference;
  kinds: readonly FileKind[];
  root: string;
  mode: 'reuse' | 'refresh';
  copy?: {path: string; fasta_sha256?: string; gff3_sha256?: string};
};
export type VerifiedGenome = ArtifactPaths & ArtifactDigests & {
  reference: GenomeReference;
  metadata: unknown;
  facts: Record<string, unknown>;
  originals?: Partial<Record<FileKind, string>>;
  downloaded: boolean;
  annotation: 'available' | 'unavailable' | 'not-requested';
};

type CacheRecord = {reference: GenomeReference; metadata: unknown; facts: Record<string, unknown>; originals?: Partial<Record<FileKind, string>>; annotation: VerifiedGenome['annotation']};

function artifactFacts(facts: Record<string, unknown>): Record<string, unknown> {
  return typeof facts.artifacts === 'object' && facts.artifacts !== null && !Array.isArray(facts.artifacts)
    ? facts.artifacts as Record<string, unknown> : {};
}

function artifactResult(directory: string, kinds: readonly FileKind[], digests: ArtifactDigests): ArtifactPaths & ArtifactDigests {
  const result: ArtifactPaths & ArtifactDigests = {};
  for (const kind of kinds) {
    const digest = digests[`${kind}_sha256`];
    if (digest) {
      result[kind] = join(directory, artifactFiles[kind]);
      result[`${kind}_sha256`] = digest;
    }
  }
  return result;
}

async function verified(directory: string, request: GenomeCacheRequest, registry: GenomeProviderRegistry, signal: AbortSignal, allArtifacts = false): Promise<VerifiedGenome | undefined> {
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
    const copy = await inspectCopy(reference, request.root, directory, record.metadata, {signal, ...(allArtifacts ? {} : {kinds: request.kinds})});
    if (copy.state !== 'verified') {
      return undefined;
    }
    for (const kind of allArtifacts ? fileKinds : request.kinds) {
      const original = record.originals?.[kind];
      if (original !== undefined) {
        const originalDirectory = await lstat(join(directory, 'original'));
        if (!originalDirectory.isDirectory() || originalDirectory.isSymbolicLink()
          || await validateFile(join(directory, 'original', artifactFiles[kind]), kind, signal) !== original) {
          return undefined;
        }
      }
    }
    if (request.copy && ((request.kinds.includes('fasta') && copy.fasta_sha256 !== request.copy.fasta_sha256) || (request.kinds.includes('gff3') && copy.gff3_sha256 !== request.copy.gff3_sha256))) {
      return undefined;
    }
    if (!allArtifacts && request.kinds.includes('gff3') && !copy.gff3_sha256 && record.annotation !== 'unavailable') {
      return undefined;
    }
    return {reference, ...artifactResult(directory, allArtifacts ? fileKinds : request.kinds, copy),
      metadata: record.metadata, facts: record.facts, originals: record.originals, annotation: allArtifacts || request.kinds.includes('gff3') ? record.annotation : 'not-requested', downloaded: false};
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
      if (kind !== 'gff3') {
        if (line.startsWith('>') && line.slice(1).trim()) {
          if (header && !sequence) {
            throw new Error('Provider returned an empty FASTA sequence record.');
          }
          header = true;
          sequence = false;
        } else if (!header || !(kind === 'proteins' ? /^[A-Za-z*]+$/ : kind === 'transcripts'
          ? /^[ACGTRYSWKMBDHVNUacgtryswkmbdhvnu]+$/ : /^[ACGTRYSWKMBDHVNacgtryswkmbdhvn]+$/).test(line)) {
          throw new Error(`Provider returned invalid ${kind === 'proteins' ? 'protein' : 'nucleotide'} FASTA.`);
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
  if ((kind !== 'gff3' && (!header || !sequence)) || details.size === 0) {
    throw new Error('Provider returned an empty genome file.');
  }
  return hash.digest('hex');
}

/** Catalog resolution returns facts; workflow consumers must use withGenomeCache. */
export async function resolveGenomeCache(request: GenomeCacheRequest, context: ProviderContext, registry: GenomeProviderRegistry = accessionSources): Promise<VerifiedGenome> {
  return withGenomeCache(request, context, async genome => genome, registry);
}

/** Holds the publication/deletion lock from verification through the consumer's final copy. */
export async function withGenomeCache<T>(
  request: GenomeCacheRequest,
  context: ProviderContext,
  consume: (genome: VerifiedGenome) => Promise<T>,
  registry: GenomeProviderRegistry = accessionSources,
): Promise<T> {
  const reference = registry.validateReference(request.reference);
  // Compare provider-canonical parameters, not the caller's YAML/JSON key ordering.
  request = {...request, reference};
  const provider = registry.get(reference.source);
  if (!['reuse', 'refresh'].includes(request.mode) || request.kinds.length === 0 || request.kinds.some(kind => !provider.artifacts.some(artifact => artifact.kind === kind)) || new Set(request.kinds).size !== request.kinds.length) {
    throw new Error('Invalid genome cache mode or requested files.');
  }
  context.signal.throwIfAborted();
  const cache = resolve(request.root, provider.cacheDirectory);
  const destination = join(cache, reference.id);
  if (request.copy && (request.mode !== 'reuse' || basename(request.copy.path) !== reference.id)) {
    throw new Error('A snapshotted copy must name this genome and use reuse mode.');
  }
  // Cross-root readers lock the source cache, not the run's output root.
  const lockParent = request.copy ? dirname(resolve(request.copy.path)) : cache;
  await mkdir(lockParent, {recursive: true});
  const canonicalCache = await realpath(lockParent);
  const lock = join(canonicalCache, `.${reference.id}.lock`);
  try {
    await mkdir(lock);
  } catch {
    throw new Error('Another genome cache reader or writer holds this entry. Retry after it finishes.');
  }
  let staging: string | undefined;
  let backup: string | undefined;
  try {
    context.signal.throwIfAborted();
    if (request.mode === 'reuse') {
      context.onProgress?.({phase: 'verifying'});
      const existing = await verified(request.copy?.path ?? destination, request, registry, context.signal);
      context.signal.throwIfAborted();
      if (existing) {
        return await consume(existing);
      }
      if (request.copy) {
        throw new Error('The snapshotted genome copy no longer matches its required checksums.');
      }
    }
    if (missingProviderFields(provider, context.secrets).length > 0) {
      throw new Error('Configure this genome provider before accessing remote files.');
    }
    staging = await mkdtemp(join(canonicalCache, `.${reference.id}-staging-`));
    const result = await provider.download(reference, request.kinds, staging, context);
    const filenames = artifactFiles;
    if ([...Object.keys(result.files), ...Object.keys(result.originals ?? {})].some(kind => !fileKinds.includes(kind as FileKind))) {
      throw new Error('Provider returned an unknown artifact.');
    }
    for (const kind of fileKinds) {
      if (result.files[kind] !== undefined && (result.files[kind] !== filenames[kind] || !request.kinds.includes(kind))) {
        throw new Error('Provider returned an unexpected or unrequested genome artifact.');
      }
    }
    if (result.files.gff3 && result.annotation !== 'available') {
      throw new Error('Provider returned contradictory annotation availability.');
    }
    if (request.kinds.some(kind => kind !== 'gff3' && !result.files[kind])) {
      throw new Error('Provider returned no requested FASTA artifact.');
    }
    if (request.kinds.includes('gff3') && !result.files.gff3 && result.annotation !== 'unavailable') {
      throw new Error('Provider did not establish whether the requested annotation is available.');
    }
    if (!fileKinds.some(kind => result.files[kind])) {
      throw new Error('The selected artifacts are unavailable. The previous verified files are unchanged.');
    }
    provider.validateMetadata(result.metadata);
    context.onProgress?.({phase: 'verifying'});
    // Retain verified, unselected artifacts rather than treating an unchecked box as deletion.
    const previous: Partial<Record<FileKind, VerifiedGenome>> = {};
    for (const {kind} of provider.artifacts) {
      const copy = await verified(destination, {...request, copy: undefined, kinds: [kind]}, registry, context.signal);
      if (copy) {
        previous[kind] = copy;
      }
    }
    const files = {...result.files};
    const preserved: Partial<Record<FileKind, string>> = {};
    for (const kind of fileKinds) {
      const artifact = previous[kind];
      if (!request.kinds.includes(kind) && artifact?.[kind]) {
        await copyFile(artifact[kind]!, join(staging, filenames[kind]));
        files[kind] = filenames[kind];
        preserved[kind] = artifact[`${kind}_sha256`];
      }
    }
    // Derived files keep their original evidence and per-artifact facts across partial refreshes.
    const originals: Partial<Record<FileKind, string>> = {};
    const perArtifact = {...artifactFacts(result.facts)};
    for (const kind of fileKinds) {
      const expected = `original/${filenames[kind]}`;
      const supplied = result.originals?.[kind];
      const previousOriginal = preserved[kind] ? previous[kind]?.originals?.[kind] : undefined;
      if (supplied !== undefined && (supplied !== expected || !result.files[kind])) {
        throw new Error('Provider returned unexpected original artifact evidence.');
      }
      if (previousOriginal) {
        const sourceDirectory = dirname(previous[kind]![kind]!);
        const source = join(sourceDirectory, expected);
        if (await validateFile(source, kind, context.signal) !== previousOriginal) {
          throw new Error('Original artifact evidence no longer matches its checksum.');
        }
        await mkdir(join(staging, 'original'), {recursive: true});
        await copyFile(source, join(staging, expected));
      }
      if (supplied || previousOriginal) {
        originals[kind] = await validateFile(join(staging, expected), kind, context.signal);
        if (previousOriginal && originals[kind] !== previousOriginal) {
          throw new Error('Original artifact evidence changed while copying.');
        }
      }
      if (preserved[kind]) {
        const retained = artifactFacts(previous[kind]!.facts)[kind];
        if (retained !== undefined) {
          perArtifact[kind] = retained;
        }
      }
    }
    const facts = {...result.facts, ...(Object.keys(perArtifact).length ? {artifacts: perArtifact} : {})};
    const checksums: Partial<Record<FileKind, string>> = {};
    for (const kind of fileKinds) {
      if (files[kind]) {
        checksums[kind] = await validateFile(join(staging, filenames[kind]), kind, context.signal);
        if (preserved[kind] && checksums[kind] !== preserved[kind]) {
          throw new Error('A preserved artifact changed while copying into staging.');
        }
      }
    }
    if (fileKinds.some(kind => kind !== 'fasta' && preserved[kind]) && previous.fasta?.fasta_sha256 && checksums.fasta !== previous.fasta.fasta_sha256) {
      throw new Error('The pinned genome sequence changed. Refresh sequence and annotation together, including any preserved proteins, transcripts, or CDS.');
    }
    const annotation = result.annotation === 'not-requested' ? previous.gff3?.annotation ?? 'not-requested' : result.annotation;
    await writeFile(join(staging, 'checksums.json'), JSON.stringify(checksums), {flag: 'wx', mode: 0o600});
    await writeFile(join(staging, 'genome.json'), JSON.stringify({reference, metadata: result.metadata, facts, annotation, ...(Object.keys(originals).length ? {originals} : {})}), {flag: 'wx', mode: 0o600});
    if (!(await verified(staging, {...request, copy: undefined}, registry, context.signal, true))) {
      throw new Error('Staged genome failed checksum verification.');
    }
    context.signal.throwIfAborted();
    context.onProgress?.({phase: 'publishing'});
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
    const value: VerifiedGenome = {reference,
      ...artifactResult(destination, request.kinds, Object.fromEntries(fileKinds.filter(kind => checksums[kind]).map(kind => [`${kind}_sha256`, checksums[kind]]))),
      metadata: result.metadata, facts, originals, annotation: result.annotation, downloaded: true};
    if (backup) {
      await rm(backup, {recursive: true, force: true}).catch(() => {});
    }
    return await consume(value);
  } finally {
    if (staging) {
      await rm(staging, {recursive: true, force: true});
    }
    await rm(lock, {recursive: true, force: true});
  }
}
