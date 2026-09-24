import {constants} from 'node:fs';
import {access, open, stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {constants as zlibConstants, gunzipSync} from 'node:zlib';

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

async function readPrefix(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(inspectedBytes);
    const {bytesRead} = await handle.read(buffer, 0, inspectedBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isGzip(prefix: Buffer): boolean {
  return prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
}

/** Checks that `text` starts with one complete four-line FASTQ record. */
function startsWithFastqRecord(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 5) {
    // A fifth element exists only when the fourth line was terminated, i.e. the record is complete.
    return false;
  }
  const [header, sequence, separator, quality] = lines;
  return (
    header !== undefined &&
    header.startsWith('@') &&
    header.length > 1 &&
    sequence !== undefined &&
    sequence.length > 0 &&
    /^[A-Za-z.*-]+$/.test(sequence) &&
    separator !== undefined &&
    separator.startsWith('+') &&
    quality !== undefined &&
    quality.length === sequence.length
  );
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
