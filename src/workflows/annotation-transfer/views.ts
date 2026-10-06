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
import {geneFacts, type ReviewGene} from './proteins.js';

/** The heading of the guide section in the workflow's `results.md`. */
export const transferGuideHeading = 'Transfer genome views';
/** The heading of the review view's guide section, which directly precedes the transfer guide. */
export const proteinsGuideHeading = 'Proteins genome review';

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

function guideSection(guide: BrowserDocument | undefined, heading = transferGuideHeading): BrowserDocument | undefined {
  const blocks = guide?.blocks ?? [];
  const start = blocks.findIndex(block => block.kind === 'heading' && inlineText(block.content) === heading);
  const found = blocks[start];
  // The guide closes the results page, so its own `##` sections, listed in the help menu, run to the end.
  return guide && found?.kind === 'heading' ? {...guide, title: inlineText(found.content), blocks: blocks.slice(start)} : undefined;
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

const unresolvedBed = 'results/target-unresolved.bed';

/** The resolved target with the transferred annotation, the intermediate annotations LiftOn built it from, and its unresolved bases. */
export async function transferTargetView(context: TransferViewContext): Promise<GenomeView> {
  const artifacts = await recordedArtifacts(context.runDirectory, context.signal);
  const fasta = await verified(context, artifacts, 'resolved/target.fasta');
  const transferred = await verified(context, artifacts, 'results/annotation/lifton.raw.gff3');
  const unresolved = await verified(context, artifacts, unresolvedBed);
  context.signal?.throwIfAborted();
  const tracks: GenomeTrack[] = [
    {id: 'transferred', name: 'Transferred annotation · GFF3 · LiftOn result', kind: 'annotation', format: 'gff3', file: transferred.path, snapshot: transferred.snapshot, shown: true},
    ...intermediates.map(intermediate => {
      const file = resolve(context.runDirectory, intermediate.path);
      return {id: intermediate.id, name: intermediate.name, kind: 'annotation' as const, format: 'gff3' as const, file, shown: false,
        ...(existsSync(file) ? {} : {problem: `${file}: not found in this run.`})};
    }),
    {id: 'unresolved', name: 'Unresolved bases · BED · not A, C, G, or T', kind: 'annotation', format: 'bed', file: unresolved.path,
      snapshot: unresolved.snapshot, shown: true},
  ];
  return view(context, 'target', fasta, inputName(context.configuration.inputs.target, 'Target'), tracks, [
    {label: `Verified ${transferred.artifact.origin} transferred annotation`, path: transferred.path, sha256: transferred.artifact.sha256},
    ...tracks.slice(1, 1 + intermediates.length).map(track => ({label: `Unverified LiftOn intermediate ${track.id} annotation`, path: track.file})),
    {label: `Verified ${unresolved.artifact.origin} unresolved target bases`, path: unresolved.path, sha256: unresolved.artifact.sha256},
  ]);
}

/** The listed gene's item ID: its reference ID, since only a primary copy is rated. */
export function reviewItemId(gene: ReviewGene): string {
  return gene.referenceId;
}

/**
 * The target view with the genes listed for review as its items, in the CLI's order. An unmapped
 * gene has no target locus and is not an item; every track is the same for every gene.
 */
export async function transferReviewView(context: TransferViewContext & {genes: readonly ReviewGene[]; selected?: ReviewGene}): Promise<GenomeView> {
  const target = await transferTargetView(context);
  const items = context.genes.filter(gene => gene.target);
  const listed = createHash('sha256').update(JSON.stringify(items.map(reviewItemId))).digest('hex');
  return {
    ...target,
    id: createHash('sha256').update(JSON.stringify([resolve(context.runDirectory), 'review', listed])).digest('hex'),
    title: runViewTitle(context.workflow, context.configuration.run, `Proteins · ${inputName(context.configuration.inputs.target, 'Target')}`),
    items: {name: 'Genes to review', itemName: 'gene', entries: items.map(gene => ({
      id: reviewItemId(gene),
      label: gene.referenceId,
      target: {chrom: gene.target!.seqid, start: gene.target!.start, end: gene.target!.end},
      details: [{title: 'Gene', rows: geneFacts(gene).map(({label, value}) => ({label, value}))}],
    }))},
    ...(context.selected?.target ? {selectedItemId: reviewItemId(context.selected)} : {}),
    guide: guideSection(context.guide, proteinsGuideHeading),
    // The Liftoff and miniprot annotations bring the reference gene's structure and protein into the
    // target's coordinates, so a review shows them from the start; the general target view hides them.
    content: {...target.content, tracks: target.content.tracks.map(track =>
      intermediates.some(intermediate => intermediate.id === track.id) && !track.problem ? {...track, shown: true} : track), presets: [
      {id: 'gene', label: 'Gene', padding: 500, reads: false},
      {id: 'region', label: 'Region', padding: 10000, reads: false},
    ]},
  };
}
