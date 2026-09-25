import {constants, createReadStream} from 'node:fs';
import {access, open, stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {constants as zlibConstants, createGunzip, gunzipSync} from 'node:zlib';

export type ReadFileCheck =
  | {state: 'ok'}
  | {state: 'missing' | 'unreadable' | 'not-a-file' | 'invalid'; reason: string};

export type ReadPairsCheck = {
  /** One result per read pair, in the order the pairs were given. */
  pairs: {r1: ReadFileCheck; r2: ReadFileCheck}[];
  /** Paths that name one file more than once, for example through a symlink or hard link. */
  sameFiles: {first: string; second: string}[];
};

export type ReadPairsChecker = (pairs: readonly {r1: string; r2: string}[]) => Promise<ReadPairsCheck>;

const inspectedBytes = 64 * 1024;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function readPrefix(path: string, length = inspectedBytes): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isGzip(prefix: Buffer): boolean {
  return prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
}

function isFastqRecord(header: string, sequence: string, separator: string, quality: string): boolean {
  return (
    header.startsWith('@') &&
    header.length > 1 &&
    sequence.length > 0 &&
    /^[A-Za-z.*-]+$/.test(sequence) &&
    separator.startsWith('+') &&
    quality.length === sequence.length
  );
}

/** Checks that `text` starts with one complete four-line FASTQ record. */
function startsWithFastqRecord(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 5) {
    // A fifth element exists only when the fourth line was terminated, i.e. the record is complete.
    return false;
  }
  const [header = '', sequence = '', separator = '', quality = ''] = lines;
  return isFastqRecord(header, sequence, separator, quality);
}

/**
 * A lightweight check that a file exists, is readable, and starts like plain or gzip-compressed
 * FASTQ. It inspects only the file's first record; full validation belongs to the workflow.
 */
export async function checkReadFile(path: string): Promise<ReadFileCheck> {
  if (!isAbsolute(path)) {
    return {state: 'invalid', reason: 'not an absolute path'};
  }
  try {
    const details = await stat(path);
    if (!details.isFile()) {
      return {state: 'not-a-file', reason: 'not a regular file'};
    }
    await access(path, constants.R_OK);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return {state: 'missing', reason: 'file not found'};
    }
    return {state: 'unreadable', reason: 'file cannot be read'};
  }

  let prefix: Buffer;
  try {
    prefix = await readPrefix(path);
  } catch {
    return {state: 'unreadable', reason: 'file cannot be read'};
  }
  let text: string;
  if (isGzip(prefix)) {
    try {
      // The prefix usually ends mid-stream; a sync flush returns what was decompressed so far.
      text = gunzipSync(prefix, {finishFlush: zlibConstants.Z_SYNC_FLUSH}).toString('latin1');
    } catch {
      return {state: 'invalid', reason: 'damaged gzip data'};
    }
  } else {
    text = prefix.toString('latin1');
  }
  if (!startsWithFastqRecord(text)) {
    return {state: 'invalid', reason: 'does not start with a FASTQ record'};
  }
  return {state: 'ok'};
}

/** Checks every file of an isolate's read pairs, including files reachable under two paths. */
export async function checkReadPairs(pairs: readonly {r1: string; r2: string}[]): Promise<ReadPairsCheck> {
  const results = await Promise.all(
    pairs.map(async pair => {
      const [r1, r2] = await Promise.all([checkReadFile(pair.r1), checkReadFile(pair.r2)]);
      return {r1, r2};
    }),
  );
  const readable = pairs
    .flatMap((pair, index) => [
      {path: pair.r1, check: results[index]?.r1},
      {path: pair.r2, check: results[index]?.r2},
    ])
    .filter(entry => entry.check?.state === 'ok');
  // Device and inode identify the file behind symlinks and hard links alike.
  const identities = await Promise.all(
    readable.map(async ({path}) => {
      const details = await stat(path);
      return `${String(details.dev)}:${String(details.ino)}`;
    }),
  );
  const firstPathByIdentity = new Map<string, string>();
  const sameFiles: ReadPairsCheck['sameFiles'] = [];
  readable.forEach(({path}, index) => {
    const identity = identities[index] ?? '';
    const first = firstPathByIdentity.get(identity);
    if (first === undefined) {
      firstPathByIdentity.set(identity, path);
    } else {
      sameFiles.push({first, second: path});
    }
  });
  return {pairs: results, sameFiles};
}

export type FastqRecordSummary = {header: string; sequenceLength: number};

export type FastqHead =
  | {state: 'ok'; records: FastqRecordSummary[]}
  | {state: 'unreadable' | 'invalid'; reason: string};

/** Longest FASTQ line accepted while sampling; far above any short-read header or sequence. */
const maxSampledLineLength = 64 * 1024;
/** Decompressed bytes allowed per compressed byte read, so a gzip bomb cannot exhaust memory. */
const maxExpansionRatio = 32;

/**
 * Streams the first `maxRecords` records of a plain or gzip-compressed FASTQ file, reading at most
 * `maxBytes` bytes from disk, and stops as soon as either limit is reached. A record cut off by the
 * byte limit is dropped; damage or truncation before the limit makes the file invalid.
 */
export async function readFastqHead(
  path: string,
  {maxRecords, maxBytes}: {maxRecords: number; maxBytes: number},
): Promise<FastqHead> {
  let gzip: boolean;
  try {
    gzip = isGzip(await readPrefix(path, 2));
  } catch {
    return {state: 'unreadable', reason: 'file cannot be read'};
  }

  const source = createReadStream(path, {start: 0, end: maxBytes - 1});
  const gunzip = gzip ? createGunzip() : undefined;
  if (gunzip) {
    source.on('error', error => gunzip.destroy(error));
    source.pipe(gunzip);
  }
  const decoded = gunzip ?? source;
  const records: FastqRecordSummary[] = [];
  let lines: string[] = [];
  let pending = '';
  let decodedBytes = 0;
  let problem: string | undefined;
  let endOfFile = false;

  /** Adds one line; returns false once reading should stop. */
  const accept = (line: string): boolean => {
    lines.push(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (lines.length < 4) {
      return true;
    }
    const [header = '', sequence = '', separator = '', quality = ''] = lines;
    lines = [];
    if (!isFastqRecord(header, sequence, separator, quality)) {
      problem = 'malformed FASTQ record';
      return false;
    }
    records.push({header, sequenceLength: sequence.length});
    return records.length < maxRecords;
  };

  try {
    reading: for await (const chunk of decoded) {
      const text = (chunk as Buffer).toString('latin1');
      decodedBytes += text.length;
      if (decodedBytes > maxBytes * maxExpansionRatio) {
        problem = 'decompresses to far more data than FASTQ would';
        break;
      }
      pending += text;
      const complete = pending.split('\n');
      pending = complete.pop() ?? '';
      if (pending.length > maxSampledLineLength) {
        problem = 'line too long for FASTQ';
        break;
      }
      for (const line of complete) {
        if (!accept(line)) {
          break reading;
        }
      }
    }
    endOfFile = problem === undefined && records.length < maxRecords && source.bytesRead < maxBytes;
  } catch (error) {
    // Stopping at the byte limit truncates a gzip stream, which zlib reports as a buffer error;
    // any other error, or a truncation before the limit, is damage.
    if ((error as NodeJS.ErrnoException).code !== 'Z_BUF_ERROR' || source.bytesRead < maxBytes) {
      return {state: 'invalid', reason: 'damaged gzip data'};
    }
  } finally {
    source.destroy();
    decoded.destroy();
  }
  // At the true end of the file, a final line without a newline still counts.
  if (endOfFile && pending.length > 0) {
    accept(pending);
    pending = '';
  }
  if (problem !== undefined) {
    return {state: 'invalid', reason: problem};
  }
  if (endOfFile && lines.length > 0) {
    return {state: 'invalid', reason: 'file ends inside a FASTQ record'};
  }
  if (records.length === 0) {
    return {state: 'invalid', reason: 'no complete FASTQ record'};
  }
  return {state: 'ok', records};
}
