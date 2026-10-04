import {randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {readGeneralDocuments} from '../docs/documents.js';
import type {GenomeSequence, GenomeTrack, GenomeView} from './contract.js';
import {FastaIndexes, fileSnapshot, sameFile, type FileSnapshot} from './fasta-index.js';
import {trackSequences} from './track-sequences.js';

export type BrowserResource = {bytes: Buffer} | {snapshot: FileSnapshot};

function requireUnchanged(expected: FileSnapshot | undefined, actual: FileSnapshot): void {
  if (expected && (expected.path !== actual.path || !sameFile(expected, actual))) {
    throw new Error(`Verified file changed before publication: ${actual.path}. Verify the source before reopening.`);
  }
}

async function annotationProblem(track: GenomeTrack, sequences: GenomeSequence[], signal: AbortSignal): Promise<string | undefined> {
  const lengths = new Map(sequences.map(sequence => [sequence.name, sequence.length]));
  const input = createReadStream(track.file, {signal});
  const reader = createInterface({input, crlfDelay: Infinity});
  try {
    for await (const line of reader) {
      if (line === '##FASTA') {
        break;
      }
      if (!line || line.startsWith('#') || (track.format === 'bed' && /^(track|browser)\s/.test(line))) {
        continue;
      }
      const fields = line.split('\t');
      const chrom = fields[0]!;
      const length = lengths.get(chrom);
      if (length === undefined) {
        return `Sequence ${chrom} is not in the reference.`;
      }
      const start = Number(fields[track.format === 'gff3' ? 3 : 1]);
      const end = Number(fields[track.format === 'gff3' ? 4 : 2]);
      if ((track.format === 'gff3' ? fields.length !== 9 : fields.length < 3) ||
          !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < (track.format === 'gff3' ? 1 : 0) || end < start || end > length) {
        return `Invalid or out-of-reference ${track.format.toUpperCase()} coordinates on ${chrom}.`;
      }
    }
    return undefined;
  } finally {
    reader.close();
    input.destroy();
  }
}

// Unindexed annotations load whole in IGV. Large files remain available but require opting in.
const automaticAnnotationLimit = 50 * 1024 * 1024;

export async function prepareGenome(view: GenomeView, indexes: FastaIndexes, signal: AbortSignal): Promise<{view: GenomeView; resources: Map<string, BrowserResource>}> {
  const resources = new Map<string, BrowserResource>();
  const register = (resource: BrowserResource): string => {
    const id = randomBytes(16).toString('hex');
    resources.set(id, resource);
    return `files/${id}`;
  };
  const reference = view.content.reference;
  requireUnchanged(reference.snapshot, await fileSnapshot(reference.fasta));
  const index = await indexes.read(reference.fasta, reference.index, signal);
  requireUnchanged(reference.snapshot, index.snapshot);
  const fasta = register({snapshot: index.snapshot});
  // An existing index is served unchanged; generating the same content in memory is only needed
  // when the caller has no index. Both routes have the same immutable-view resource contract.
  const indexURL = index.indexSnapshot ? register({snapshot: index.indexSnapshot}) : register({bytes: index.bytes});
  const tracks: GenomeTrack[] = [];
  for (const track of view.content.tracks) {
    signal.throwIfAborted();
    const {snapshot: verifiedSnapshot, ...publicTrack} = track;
    if (track.problem) {
      // Caller-rejected evidence must not be inspected or registered for serving.
      tracks.push({...publicTrack, file: '', index: undefined, shown: false});
      continue;
    }
    try {
      const snapshot = await fileSnapshot(track.file);
      requireUnchanged(verifiedSnapshot, snapshot);
      let indexSnapshot: FileSnapshot | undefined;
      let problem: string | undefined;
      if (track.kind === 'annotation') {
        problem = await annotationProblem(track, index.sequences, signal);
      } else {
        if (!track.index) {
          throw new Error(`Missing required index for ${track.file}`);
        }
        indexSnapshot = await fileSnapshot(track.index);
        const names = await trackSequences(track, signal);
        const referenceNames = new Set(index.sequences.map(sequence => sequence.name));
        const mismatch = names.find(name => !referenceNames.has(name));
        problem = mismatch ? `Sequence ${mismatch} is not in the reference.` : undefined;
      }
      if (!sameFile(snapshot, await fileSnapshot(track.file))) {
        throw new Error(`Track changed while checking: ${track.file}`);
      }
      tracks.push({...publicTrack, file: register({snapshot}), index: indexSnapshot ? register({snapshot: indexSnapshot}) : undefined,
        size: snapshot.size, shown: track.shown && !problem && (track.kind !== 'annotation' || snapshot.size <= automaticAnnotationLimit), ...(problem ? {problem} : {})});
    } catch (error) {
      signal.throwIfAborted();
      tracks.push({...publicTrack, file: '', index: undefined, shown: false,
        problem: `${track.file}: ${error instanceof Error ? error.message : String(error)}`});
    }
  }
  const [legend] = await readGeneralDocuments(['genome-view']);
  for (const resource of resources.values()) {
    signal.throwIfAborted();
    if ('snapshot' in resource) {
      requireUnchanged(resource.snapshot, await fileSnapshot(resource.snapshot.path));
    }
  }
  signal.throwIfAborted();
  return {
    resources,
    view: {...view, content: {...view.content, kind: 'genome', reference: {name: reference.name, fasta, index: indexURL, sequences: index.sequences}, tracks,
      ...(legend?.blocks ? {legend: {id: legend.id, title: legend.title, blocks: legend.blocks, links: {}}} : {})}},
  };
}
