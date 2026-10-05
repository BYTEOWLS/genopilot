import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parse} from 'yaml';
import {inlineText} from '../../docs/markdown.js';
import {verifyFileChecksum} from '../../browser/verified-file.js';
import {isRecord} from '../configuration-validation.js';
import {runViewTitle, type BrowserDocument, type GenomeTrack, type GenomeView, type ViewProvenance} from '../../browser/contract.js';
import type {AnnotationTransferConfiguration} from './configuration.js';

/** The heading of the guide section in the workflow's `results.md`. */
export const transferGuideHeading = 'Transfer genome views';

export type TransferViewContext = {
  runDirectory: string;
  configuration: AnnotationTransferConfiguration;
  application: ViewProvenance['application'];
  workflow: {id: string; version: number; label: string};
  guide?: BrowserDocument;
  signal?: AbortSignal;
};

type RecordedArtifact = {sha256: string; origin: string};

/** The run's `artifacts.yaml`, keyed by run-relative path; only regular files with a SHA-256. */
async function recordedArtifacts(runDirectory: string, signal?: AbortSignal): Promise<Map<string, RecordedArtifact>> {
  const path = join(runDirectory, 'artifacts.yaml');
  let source: string;
  try {
    source = await readFile(path, {encoding: 'utf8', signal});
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(`The run has no readable artifact index, so its files cannot be verified: ${path}`, {cause: error});
  }
  const index: unknown = parse(source);
  if (!isRecord(index) || index.schema_version !== 1 || !Array.isArray(index.artifacts)) {
    throw new Error(`Unsupported artifact index: ${path}`);
  }
  const artifacts = new Map<string, RecordedArtifact>();
  for (const artifact of index.artifacts) {
    if (isRecord(artifact) && typeof artifact.path === 'string' && typeof artifact.origin === 'string' && isRecord(artifact.checksum) &&
        artifact.checksum.algorithm === 'sha256' && typeof artifact.checksum.value === 'string' && /^[a-f0-9]{64}$/.test(artifact.checksum.value)) {
      artifacts.set(artifact.path, {sha256: artifact.checksum.value, origin: artifact.origin});
    }
  }
  return artifacts;
}

type VerifiedFile = {path: string; artifact: RecordedArtifact; snapshot: Awaited<ReturnType<typeof verifyFileChecksum>>};

async function verified(context: TransferViewContext, artifacts: Map<string, RecordedArtifact>, relativePath: string): Promise<VerifiedFile> {
  const artifact = artifacts.get(relativePath);
  if (!artifact) {
    throw new Error(`The artifact index records no checksum for ${relativePath}.`);
  }
  const path = resolve(context.runDirectory, relativePath);
  return {path, artifact, snapshot: await verifyFileChecksum(path, artifact.sha256, context.signal)};
}

function inputName(input: AnnotationTransferConfiguration['inputs']['reference' | 'target'], fallback: string): string {
  return input.source === 'ncbi' ? input.accession : fallback;
}

function guideSection(guide: BrowserDocument | undefined): BrowserDocument | undefined {
  const blocks = guide?.blocks ?? [];
  const start = blocks.findIndex(block => block.kind === 'heading' && inlineText(block.content) === transferGuideHeading);
  const heading = blocks[start];
  // The guide closes the results page, so its own `##` sections, listed in the help menu, run to the end.
  return guide && heading?.kind === 'heading' ? {...guide, title: inlineText(heading.content), blocks: blocks.slice(start)} : undefined;
}

function view(context: TransferViewContext, side: 'reference' | 'target', fasta: VerifiedFile, name: string,
  tracks: GenomeTrack[], sources: ViewProvenance['sources']): GenomeView {
  const {configuration, application, workflow} = context;
  const label = side === 'reference' ? 'Reference' : 'Target';
  return {
    id: createHash('sha256').update(JSON.stringify([resolve(context.runDirectory), side])).digest('hex'),
    title: runViewTitle(workflow, configuration.run, name === label ? label : `${label} · ${name}`),
    provenance: {application, run: {id: configuration.run.id, name: configuration.run.name, workflow: {id: workflow.id, version: workflow.version}}, sources: [
      {label: `Verified ${fasta.artifact.origin} ${side} FASTA`, path: fasta.path, sha256: fasta.artifact.sha256},
      ...sources,
    ]},
    guide: guideSection(context.guide),
    content: {kind: 'genome', reference: {name, fasta: fasta.path, snapshot: fasta.snapshot,
      ...(existsSync(`${fasta.path}.fai`) ? {index: `${fasta.path}.fai`} : {})}, tracks},
  };
}

/** The resolved reference with the source annotation LiftOn transferred from. */
export async function transferReferenceView(context: TransferViewContext): Promise<GenomeView> {
  const artifacts = await recordedArtifacts(context.runDirectory, context.signal);
  const fasta = await verified(context, artifacts, 'resolved/reference.fasta');
  const annotation = await verified(context, artifacts, 'resolved/reference.gff3');
  context.signal?.throwIfAborted();
  return view(context, 'reference', fasta, inputName(context.configuration.inputs.reference, 'Reference'), [
    {id: 'reference-annotation', name: 'Reference annotation · GFF3 · source of the transfer', kind: 'annotation', format: 'gff3', file: annotation.path, snapshot: annotation.snapshot, shown: true},
  ], [{label: `Verified ${annotation.artifact.origin} reference annotation`, path: annotation.path, sha256: annotation.artifact.sha256}]);
}

/**
 * LiftOn's intermediate annotations, in the order LiftOn computes them, recorded only as part of one
 * directory checksum. Both start hidden: Liftoff's matches the result for almost every gene, and
 * miniprot aligns every reference protein to its best match anywhere, including relatives' loci
 * LiftOn never uses.
 */
const intermediates = [
  {id: 'liftoff', name: 'Liftoff annotation · GFF3 · LiftOn intermediate, unverified', path: 'results/annotation/lifton_output/liftoff/liftoff.gff3'},
  {id: 'miniprot', name: 'miniprot annotation · GFF3 · LiftOn intermediate, unverified', path: 'results/annotation/lifton_output/miniprot/miniprot.gff3'},
] as const;

/** The resolved target with the transferred annotation and the intermediate annotations LiftOn built it from. */
export async function transferTargetView(context: TransferViewContext): Promise<GenomeView> {
  const artifacts = await recordedArtifacts(context.runDirectory, context.signal);
  const fasta = await verified(context, artifacts, 'resolved/target.fasta');
  const transferred = await verified(context, artifacts, 'results/annotation/lifton.raw.gff3');
  context.signal?.throwIfAborted();
  const tracks: GenomeTrack[] = [
    {id: 'transferred', name: 'Transferred annotation · GFF3 · LiftOn result', kind: 'annotation', format: 'gff3', file: transferred.path, snapshot: transferred.snapshot, shown: true},
    ...intermediates.map(intermediate => {
      const file = resolve(context.runDirectory, intermediate.path);
      return {id: intermediate.id, name: intermediate.name, kind: 'annotation' as const, format: 'gff3' as const, file, shown: false,
        ...(existsSync(file) ? {} : {problem: `${file}: not found in this run.`})};
    }),
  ];
  return view(context, 'target', fasta, inputName(context.configuration.inputs.target, 'Target'), tracks, [
    {label: `Verified ${transferred.artifact.origin} transferred annotation`, path: transferred.path, sha256: transferred.artifact.sha256},
    ...tracks.slice(1).map(track => ({label: `Unverified LiftOn intermediate ${track.id} annotation`, path: track.file})),
  ]);
}
