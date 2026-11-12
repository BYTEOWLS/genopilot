import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, type WriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {Gff3Replacer, idMappingTsv, type ReplaceOptions, type ReplaceSummary} from './core.js';

export type PassRequest = {
  source: string;
  options: ReplaceOptions;
  /** Present when writing: the rewritten GFF3 and its ID mapping go to these paths. */
  output?: {gff3: string; idMapping: string};
  /** The source checksum the preview saw; a write refuses a source that changed since. */
  expectedSourceSha256?: string;
};

export type PassResult = ReplaceSummary & {
  sourceSha256: string;
  /** The checksums of the written files; absent for a preview or when nothing may be written. */
  written?: {gff3Sha256: string; idMappingSha256: string};
};

/** Buffers output lines and writes them in chunks, waiting whenever the stream asks to. */
class ChunkedWriter {
  private parts: string[] = [];
  private size = 0;
  readonly hash = createHash('sha256');
  private error: unknown;

  constructor(private readonly stream: WriteStream) {
    // Kept until the end, so a failed write is reported rather than crashing the worker.
    stream.on('error', error => {
      this.error ??= error;
    });
  }

  private check(): void {
    if (this.error !== undefined) {
      throw this.error;
    }
  }

  async push(text: string): Promise<void> {
    this.check();
    this.parts.push(text);
    this.size += text.length;
    if (this.size >= 1 << 16) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.parts.length === 0) {
      return;
    }
    const chunk = Buffer.from(this.parts.join(''), 'utf8');
    this.parts = [];
    this.size = 0;
    this.hash.update(chunk);
    if (!this.stream.write(chunk)) {
      await once(this.stream, 'drain');
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.check();
    this.stream.end();
    await once(this.stream, 'finish');
    this.check();
  }
}

/**
 * Reads the source once: hashes its bytes, rewrites each line, and when writing streams the result
 * to the output. Line endings, including a missing final newline, are kept as they were.
 */
export async function runPass(request: PassRequest): Promise<PassResult> {
  const replacer = new Gff3Replacer(request.options);
  const sourceHash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const writer = request.output ? new ChunkedWriter(createWriteStream(request.output.gff3)) : undefined;
  let pending = '';
  const emit = async (line: string, ending: string): Promise<void> => {
    const carriage = line.endsWith('\r');
    const text = carriage ? line.slice(0, -1) : line;
    const rewritten = replacer.line(text);
    await writer?.push(`${rewritten}${carriage ? '\r' : ''}${ending}`);
  };
  for await (const chunk of createReadStream(request.source)) {
    sourceHash.update(chunk as Buffer);
    pending += decoder.write(chunk as Buffer);
    let newline = pending.indexOf('\n');
    let start = 0;
    while (newline >= 0) {
      await emit(pending.slice(start, newline), '\n');
      start = newline + 1;
      newline = pending.indexOf('\n', start);
    }
    pending = pending.slice(start);
  }
  pending += decoder.end();
  if (pending.length > 0) {
    await emit(pending, '');
  }
  const sourceSha256 = sourceHash.digest('hex');
  const {mapping, ...summary} = replacer.finish();
  if (request.expectedSourceSha256 !== undefined && request.expectedSourceSha256 !== sourceSha256) {
    summary.problems.unshift('The source file changed since the preview; preview it again.');
  }
  if (!writer || !request.output) {
    return {...summary, sourceSha256};
  }
  await writer.close();
  if (summary.problems.length > 0) {
    return {...summary, sourceSha256};
  }
  const tsv = idMappingTsv(mapping);
  await writeFile(request.output.idMapping, tsv, 'utf8');
  return {
    ...summary,
    sourceSha256,
    written: {
      gff3Sha256: writer.hash.digest('hex'),
      idMappingSha256: createHash('sha256').update(tsv, 'utf8').digest('hex'),
    },
  };
}
