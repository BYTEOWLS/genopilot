import type {Dirent} from 'node:fs';
import {readdir, realpath, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve, sep} from 'node:path';
import type {IsolateCatalog} from './catalog.js';
import {readFastqHead, type FastqHead} from './reads.js';

/**
 * Records sampled from each R1. Adapter trimming shortens only reads from fragments shorter than
 * the read length, often a few percent, so a few hundred records could miss every one of them.
 */
export const sampledRecordsPerFile = 1000;
/** Upper bound on bytes read from disk per sampled file, whatever the records look like. */
export const maxSampledBytes = 1024 * 1024;

const illuminaNamePattern = /^(.+)_S(\d+)(?:_L(\d{3}))?_(R[12]|I[12])_(\d{3})\.fastq\.gz$/;
const fastqNamePattern = /\.(?:fastq|fq)(?:\.gz)?$/i;
const undeterminedSample = 'Undetermined';

export type IlluminaFileName = {
  sample: string;
  sampleNumber: number;
  /** Absent when the delivery merged all lanes of a flowcell into one file. */
  lane: number | null;
  read: 'R1' | 'R2' | 'I1' | 'I2';
  chunk: number;
};

/** Parses `<sample>_S<n>[_L<lane>]_<read>_<chunk>.fastq.gz`, anchored from the right. */
export function parseIlluminaFileName(name: string): IlluminaFileName | undefined {
  const match = illuminaNamePattern.exec(name);
  if (!match) {
    return undefined;
  }
  const [, sample = '', sampleNumber = '', lane, read = '', chunk = ''] = match;
  return {
    sample,
    sampleNumber: Number(sampleNumber),
    lane: lane === undefined ? null : Number(lane),
    read: read as IlluminaFileName['read'],
    chunk: Number(chunk),
  };
}

export type IlluminaReadHeader = {
  readName: string;
  instrument: string;
  run: number;
  flowcell: string;
  lane: number;
};

/** Parses `@<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y> <comment>`. */
export function parseIlluminaReadHeader(header: string): IlluminaReadHeader | undefined {
  const readName = /^@(\S+)/.exec(header)?.[1];
  const fields = readName?.split(':');
  if (readName === undefined || fields?.length !== 7) {
    return undefined;
  }
  const [instrument = '', run = '', flowcell = '', lane = '', ...position] = fields;
  if (instrument === '' || flowcell === '' || ![run, lane, ...position].every(value => /^\d+$/.test(value))) {
    return undefined;
  }
  return {readName, instrument, run: Number(run), flowcell, lane: Number(lane)};
}

/** One R1/R2 pair of a read set. Variants of one read set are copies of the same reads. */
export type DeliveryVariant = {
  r1: string;
  r2: string;
  r1Bytes: number;
  r2Bytes: number;
  sampleNumber: number;
  /** Shortest and longest read among the sampled R1 records. */
  readLength: {min: number; max: number};
  sampledReads: number;
  /**
   * Raw Illumina reads share one length, so varying lengths suggest trimming or filtering. It is a
   * suggestion only: demultiplexing can itself trim adapters, and the researcher confirms the flag.
   */
  suggestedTrimmed: boolean;
};

/** Reads of one flowcell lane, or of a whole flowcell when the lanes were merged. */
export type DeliveryReadSet = {
  instrument: string;
  run: number;
  flowcell: string;
  lane: number | null;
  variants: DeliveryVariant[];
};

export type DeliveryCandidate = {
  sample: string;
  readSets: DeliveryReadSet[];
};

export type SkipReason =
  | 'not-illumina-name'
  | 'undetermined'
  | 'index-read'
  | 'split-chunk'
  | 'missing-mate'
  | 'invalid-fastq'
  | 'unreadable'
  | 'not-illumina-header'
  | 'mate-mismatch'
  | 'outside-folder'
  | 'same-file';

export type SkippedFile = {path: string; reason: SkipReason; detail?: string};

export type SkippedDirectory = {path: string; reason: 'symlink' | 'unreadable'};

export type DeliveryScan = {
  root: string;
  candidates: DeliveryCandidate[];
  /** Files the catalog already references, by path or through a link to the same file. */
  alreadyImported: {path: string; isolateId: string}[];
  skippedFiles: SkippedFile[];
  skippedDirectories: SkippedDirectory[];
};

type FoundFile = {path: string; identity: string; bytes: number};

type NamedFile = FoundFile & {name: IlluminaFileName};

async function fileIdentity(path: string): Promise<{identity: string; bytes: number} | undefined> {
  try {
    const details = await stat(path);
    return {identity: `${String(details.dev)}:${String(details.ino)}`, bytes: details.size};
  } catch {
    return undefined;
  }
}

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`);
}

type WalkedFile = {path: string; link: boolean};

/**
 * Collects FASTQ files below `root` without following directory symlinks. A file symlink is used
 * only when it resolves inside the chosen folder; the root itself must be readable.
 */
async function walk(
  root: string,
  signal: AbortSignal | undefined,
  skippedFiles: SkippedFile[],
  skippedDirectories: SkippedDirectory[],
): Promise<WalkedFile[]> {
  const realRoot = await realpath(root);
  const files: WalkedFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(directory, {withFileTypes: true});
    } catch (error) {
      if (directory === root) {
        throw error;
      }
      skippedDirectories.push({path: directory, reason: 'unreadable'});
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isSymbolicLink()) {
        const target = await stat(path).catch(() => undefined);
        if (target?.isDirectory()) {
          skippedDirectories.push({path, reason: 'symlink'});
        } else if (fastqNamePattern.test(entry.name)) {
          const real = target ? await realpath(path).catch(() => undefined) : undefined;
          if (real === undefined) {
            skippedFiles.push({path, reason: 'unreadable', detail: 'broken link'});
          } else if (!isInside(real, realRoot)) {
            skippedFiles.push({path, reason: 'outside-folder'});
          } else {
            files.push({path, link: true});
          }
        }
      } else if (entry.isFile() && fastqNamePattern.test(entry.name)) {
        files.push({path, link: false});
      }
    }
  };
  await visit(root);
  return files;
}

function headProblem(mate: 'R1' | 'R2', head: FastqHead): {reason: SkipReason; detail: string} | undefined {
  if (head.state === 'ok') {
    return undefined;
  }
  return {reason: head.state === 'unreadable' ? 'unreadable' : 'invalid-fastq', detail: `${mate}: ${head.reason}`};
}

/**
 * Proposes isolates from an Illumina delivery folder. It only reads: file names give sample, lane,
 * and mate; the first records give run, flowcell, and read lengths, from which each pair gets a
 * raw/trimmed suggestion. Every FASTQ that is not proposed is listed with its reason.
 */
export async function scanIlluminaDelivery(
  rootPath: string,
  catalog: IsolateCatalog,
  signal?: AbortSignal,
): Promise<DeliveryScan> {
  const root = resolve(rootPath);
  const skippedFiles: SkippedFile[] = [];
  const skippedDirectories: SkippedDirectory[] = [];
  const walked = await walk(root, signal, skippedFiles, skippedDirectories);

  // Device and inode identify one file behind links. Keep one path per file, preferring the file
  // itself over a link to it, so the catalog never stores a link where the real file was found.
  const paths = [...walked.filter(file => !file.link), ...walked.filter(file => file.link)].map(file => file.path);
  const found: FoundFile[] = [];
  const firstByIdentity = new Map<string, string>();
  for (const path of paths) {
    const identity = await fileIdentity(path);
    if (identity === undefined) {
      skippedFiles.push({path, reason: 'unreadable', detail: 'file cannot be read'});
      continue;
    }
    const first = firstByIdentity.get(identity.identity);
    if (first === undefined) {
      firstByIdentity.set(identity.identity, path);
      found.push({path, ...identity});
    } else {
      skippedFiles.push({path, reason: 'same-file', detail: first});
    }
  }

  // Keyed by absolute path and by device:inode identity; the two never collide.
  const importedBy = new Map<string, string>();
  for (const isolate of catalog.isolates) {
    for (const pair of isolate.read_pairs) {
      for (const path of [pair.r1, pair.r2]) {
        importedBy.set(resolve(path), isolate.id);
        const identity = await fileIdentity(path);
        if (identity !== undefined) {
          importedBy.set(identity.identity, isolate.id);
        }
      }
    }
  }

  const named: NamedFile[] = [];
  for (const file of found) {
    const name = parseIlluminaFileName(basename(file.path));
    if (name === undefined) {
      skippedFiles.push({path: file.path, reason: 'not-illumina-name'});
    } else if (name.sample === undeterminedSample) {
      skippedFiles.push({path: file.path, reason: 'undetermined'});
    } else if (name.read === 'I1' || name.read === 'I2') {
      skippedFiles.push({path: file.path, reason: 'index-read'});
    } else {
      named.push({...file, name});
    }
  }

  // The catalog stores one file per mate, so a lane split into several chunks is unsupported.
  const laneKey = (file: NamedFile): string =>
    [dirname(file.path), file.name.sample, file.name.sampleNumber, file.name.lane ?? ''].join('\0');
  const chunksByLane = new Map<string, Set<number>>();
  for (const file of named) {
    const chunks = chunksByLane.get(laneKey(file)) ?? new Set<number>();
    chunks.add(file.name.chunk);
    chunksByLane.set(laneKey(file), chunks);
  }
  const mates = new Map<string, {r1?: NamedFile; r2?: NamedFile}>();
  for (const file of named) {
    const chunks = chunksByLane.get(laneKey(file));
    if (chunks === undefined || chunks.size > 1 || !chunks.has(1)) {
      skippedFiles.push({path: file.path, reason: 'split-chunk'});
      continue;
    }
    const pair = mates.get(laneKey(file)) ?? {};
    pair[file.name.read === 'R1' ? 'r1' : 'r2'] = file;
    mates.set(laneKey(file), pair);
  }

  const alreadyImported: DeliveryScan['alreadyImported'] = [];
  const readSets = new Map<string, {sample: string; readSet: DeliveryReadSet}>();
  for (const {r1, r2} of mates.values()) {
    signal?.throwIfAborted();
    if (r1 === undefined || r2 === undefined) {
      const present = r1 ?? r2;
      if (present) {
        skippedFiles.push({path: present.path, reason: 'missing-mate'});
      }
      continue;
    }
    const importedId = [r1, r2]
      .flatMap(file => [importedBy.get(file.path), importedBy.get(file.identity)])
      .find(id => id !== undefined);
    if (importedId !== undefined) {
      alreadyImported.push({path: r1.path, isolateId: importedId}, {path: r2.path, isolateId: importedId});
      continue;
    }
    const skipPair = (reason: SkipReason, detail?: string): void => {
      for (const file of [r1, r2]) {
        skippedFiles.push({path: file.path, reason, ...(detail === undefined ? {} : {detail})});
      }
    };
    const r1Head = await readFastqHead(r1.path, {maxRecords: sampledRecordsPerFile, maxBytes: maxSampledBytes});
    const r2Head = await readFastqHead(r2.path, {maxRecords: 1, maxBytes: maxSampledBytes});
    if (r1Head.state !== 'ok' || r2Head.state !== 'ok') {
      const problem = headProblem('R1', r1Head) ?? headProblem('R2', r2Head);
      skipPair(problem?.reason ?? 'invalid-fastq', problem?.detail);
      continue;
    }
    const r1Header = parseIlluminaReadHeader(r1Head.records[0]?.header ?? '');
    const r2Header = parseIlluminaReadHeader(r2Head.records[0]?.header ?? '');
    if (r1Header === undefined || r2Header === undefined) {
      skipPair('not-illumina-header');
      continue;
    }
    if (r1Header.readName !== r2Header.readName) {
      skipPair('mate-mismatch', `${r1Header.readName} ≠ ${r2Header.readName}`);
      continue;
    }

    // The header lane is never used: in a lane-merged file the first record's lane is arbitrary.
    const {instrument, run, flowcell} = r1Header;
    const lane = r1.name.lane;
    const key = [r1.name.sample, instrument, run, flowcell, lane ?? ''].join('\0');
    const entry = readSets.get(key) ?? {
      sample: r1.name.sample,
      readSet: {instrument, run, flowcell, lane, variants: []},
    };
    const lengths = r1Head.records.map(record => record.sequenceLength);
    const readLength = {min: Math.min(...lengths), max: Math.max(...lengths)};
    entry.readSet.variants.push({
      r1: r1.path,
      r2: r2.path,
      r1Bytes: r1.bytes,
      r2Bytes: r2.bytes,
      sampleNumber: r1.name.sampleNumber,
      readLength,
      sampledReads: lengths.length,
      suggestedTrimmed: readLength.min !== readLength.max,
    });
    readSets.set(key, entry);
  }

  const candidates = new Map<string, DeliveryCandidate>();
  for (const {sample, readSet} of readSets.values()) {
    const candidate = candidates.get(sample) ?? {sample, readSets: []};
    candidate.readSets.push(readSet);
    candidates.set(sample, candidate);
  }
  const byText = (left: string, right: string): number => left.localeCompare(right);
  for (const candidate of candidates.values()) {
    candidate.readSets.sort((left, right) =>
      left.run - right.run || byText(left.flowcell, right.flowcell) || (left.lane ?? 0) - (right.lane ?? 0));
    for (const readSet of candidate.readSets) {
      readSet.variants.sort((left, right) => byText(left.r1, right.r1));
    }
  }
  skippedFiles.sort((left, right) => byText(left.path, right.path));
  return {
    root,
    candidates: [...candidates.values()].sort((left, right) => byText(left.sample, right.sample)),
    alreadyImported,
    skippedFiles,
    skippedDirectories,
  };
}
