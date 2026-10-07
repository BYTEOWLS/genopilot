import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import test from 'node:test';
import React from 'react';
import {render} from 'ink';
import {
  missingResultPaths,
  RunResultsScreen,
  runSupportPaths,
} from '../../src/ui/run-results-screen/screen.js';
import type {WorkflowManifest} from '../../src/workflows/manifest.js';
import {
  annotationTransferShell,
  type CompatibleAnnotationTransferResult,
  type LoadedWorkflowResult,
} from '../../src/workflows/results.js';
import type {DocumentsLoader} from '../../src/docs/documents.js';
import {parseMarkdown} from '../../src/docs/markdown.js';
import type {ReviewGene} from '../../src/workflows/annotation-transfer/proteins.js';
import {genoPilotSummary} from '../../src/browser/contract.js';
import {withRunCitation} from '../../src/browser/use-genome-session.js';
import {readRunCitation, type Document} from '../../src/docs/documents.js';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(_mode: boolean): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends Writable {
  columns = 240;
  rows = 100;
  readonly isTTY = false;
  private output = '';
  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
  readOutput(): string { return this.output; }
  clearOutput(): void { this.output = ''; }
}

const ARROW_DOWN = '\x1b[B';
const PAGE_DOWN = '\x1b[6~';
const ESCAPE = '\x1b';
const HELP = '?';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';

async function settle(milliseconds = 80): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

const manifest: WorkflowManifest = {
  schema_version: 1,
  workflow_version: 1,
  id: 'annotation-transfer',
  label: 'Transfer genome annotation',
  description: 'Transfer an annotation.',
  entry_snakefile: 'Snakefile',
  'parameter-definitions': 'manifest.parameters.yaml',
  stages: [],
  artifacts: [],
};

function path(name: string, available = true) {
  return {path: `results/${name}`, absolutePath: `/runs/result-42/results/${name}`, available};
}

function compatibleResult(): CompatibleAnnotationTransferResult {
  const loaded: Omit<CompatibleAnnotationTransferResult, 'shell'> = {
    kind: 'compatible',
    workflow: {id: 'annotation-transfer', version: 1},
    configuration: {
      schema_version: 1,
      workflow_id: 'annotation-transfer',
      workflow_version: 1,
      genopilot: {version: '1.2.3'},
      inputs: {
        reference: {source: 'local', fasta: '/data/reference.fa', gff3: '/data/reference.gff3'},
        target: {source: 'local', fasta: '/data/target.fa'},
      },
      lifton: {profile: 'same-species'},
      review: {minimum_protein_identity: 99},
      resources: {cpu_mode: 'automatic', effective_cpus: 7},
      run: {
        output_root: '/runs',
        id: 'result-42',
        name: 'Synthetic transfer',
        description: 'A deliberately distinctive result.',
        created_at: '2026-09-05T20:00:00.000Z',
      },
    },
    result: {
      generatedAt: '2026-09-05T20:12:00.000Z',
      run: {id: 'result-42', createdAt: '2026-09-05T20:00:00.000Z', effectiveCpus: 7},
      status: 'completed-with-warnings',
      statusExplanation: 'Completed with one validation warning.',
      transfer: {
        referenceFeatures: 137,
        referenceFeaturesByType: {gene: 137},
        mappedFeatures: 131,
        mappedFeaturesByType: {gene: 131},
        unmappedFeatures: 6,
        unmappedFeaturesByType: {gene: 6},
        mappingFraction: 131 / 137,
        targetFeatureCopies: 134,
        targetFeatureCopiesByType: {gene: 134},
        featuresWithExtraCopies: 2,
        featuresWithExtraCopiesByType: {gene: 2},
        extraCopies: 3,
        miniprotRescues: 11,
        transferMethodsByTargetCopy: {Liftoff: 123, miniprot: 11},
        changedPrimaryProteinCodingFeatures: 19,
        mutationClassificationsByTargetCopy: {frameshift: 4, nonsynonymous: 15},
        dnaIdentityByTranscriptModel: {unit: 'transcript_model', count: 20, minimum: 0.91, mean: 0.96, maximum: 1},
        proteinIdentityByTranscriptModel: {unit: 'transcript_model', count: 0, minimum: null, mean: null, maximum: null, unavailableReason: 'No protein values.'},
      },
      validation: {status: 'passed', errors: 0, warnings: 1},
      proteins: {
        minimumProteinIdentityPercent: 99,
        ratedGenes: 120,
        genesByCategory: {unmapped: 0, lost: 0, disrupted: 1, inframe_indel: 0, substitutions: 1, unchanged: 118},
        genesByReviewReason: {unmapped_or_lost: 0, disrupted: 1, below_threshold: 2, unresolved_bases: 0},
        genesListedForReview: 2,
        genesByMatch: {exactMatch: 117, nearMatch: 1, needsReview: 2},
        unresolvedTargetBases: {n: 0, other: 0},
      },
      definitions: {
        metrics: {mapped_features: 'Persisted definition sentinel for mapped features.'},
        detailColumns: {},
      },
      reports: {
        feature_transfer: path('feature-transfer.tsv'),
        aggregated_metrics: path('metrics.json'),
        completion_summary: path('summary.json'),
        validation: path('validation.json', false),
      },
      evidence: {
        raw_gff3: {...path('annotation/lifton.raw.gff3'), recordedAvailable: true},
        lifton_diagnostics: {...path('annotation/lifton_output'), recordedAvailable: true},
        run_manifest: {...path('annotation/lifton_output/run_manifest.json'), recordedAvailable: true},
        completeness_by_feature_type: {...path('annotation/lifton_output/stats/completeness.txt'), recordedAvailable: true},
        mapped_features: {...path('annotation/lifton_output/stats/mapped.txt'), recordedAvailable: true},
        mapped_transcripts: {...path('annotation/lifton_output/stats/transcripts.txt'), recordedAvailable: true},
        unmapped_features: {...path('annotation/lifton_output/stats/unmapped.txt'), recordedAvailable: true},
        extra_copy_features: {...path('annotation/lifton_output/stats/copies.txt'), recordedAvailable: true},
        selected_feature_types: {...path('annotation/lifton_output/types.txt'), recordedAvailable: true},
      },
      metricsPath: path('metrics.json'),
    },
  };
  return {...loaded, shell: annotationTransferShell(loaded.result, loaded.configuration.resources.effective_cpus)};
}

/** Recomputes the shell after a test changed the annotation-transfer result it derives from. */
function refreshed(loaded: LoadedWorkflowResult): LoadedWorkflowResult {
  if (loaded.kind !== 'compatible' || loaded.workflow.id !== 'annotation-transfer') {
    return loaded;
  }
  const annotation = loaded as CompatibleAnnotationTransferResult;
  return {...annotation, shell: annotationTransferShell(annotation.result, annotation.configuration.resources.effective_cpus)};
}

/** Result help as a stand-in document; the packaged pages are tested on their own. */
const helpDocuments: DocumentsLoader = async () => [
  {id: 'results', title: 'Results', blocks: parseMarkdown('# Results\n\n' + 'Filler line.\n\n'.repeat(30) + 'Result help sentinel.')},
  {id: 'run-results', title: 'Run results', blocks: parseMarkdown('# Run results\n\nRun help.')},
];

function renderScreen(
  loaded: LoadedWorkflowResult,
  options: {
    rows?: number;
    inputActive?: boolean;
    onBack?: () => void;
    pathExists?: (path: string) => boolean;
    formatDateTime?: (value: string) => string;
    loadHelp?: DocumentsLoader;
    readReviewGenes?: (options: {path: string; signal?: AbortSignal}) => Promise<ReviewGene[]>;
    readCitation?: (runDirectory: string) => Promise<Document | undefined>;
  } = {},
): {input: TestInput; output: TestOutput; frame: () => string; unmount: () => void} {
  const input = new TestInput();
  const output = new TestOutput();
  output.rows = options.rows ?? output.rows;
  const instance = render(
    <RunResultsScreen
      runDirectory="/runs/result-42"
      manifest={manifest}
      loaded={refreshed(loaded)}
      inputActive={options.inputActive ?? false}
      onBack={options.onBack}
      pathExists={options.pathExists ?? (() => true)}
      formatDateTime={options.formatDateTime ?? (value => `formatted:${value}`)}
      loadHelp={options.loadHelp ?? helpDocuments}
      readReviewGenes={options.readReviewGenes}
      readCitation={options.readCitation ?? (async () => undefined)}
    />,
    {
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    },
  );
  return {input, output, frame: () => output.readOutput(), unmount: () => instance.unmount()};
}

/** The screen's frame on each tab, from the first; Tab moves to the next one. */
async function tabFrames(screen: ReturnType<typeof renderScreen>, count = 6): Promise<string[]> {
  await settle();
  const frames = [screen.frame()];
  for (let index = 1; index < count; index += 1) {
    screen.output.clearOutput();
    screen.input.write(TAB);
    await settle();
    frames.push(screen.frame());
  }
  return frames;
}

test('presents compatible run metadata, scientific metrics, and direct result paths in tabs', async () => {
  const screen = renderScreen(compatibleResult(), {inputActive: true});
  try {
    const frames = await tabFrames(screen);
    const [overview, transfer, , , files, details] = frames;
    // The overview shows the outcome; metrics, files, and run metadata have tabs of their own.
    assert.ok(!overview!.includes('annotation-transfer@1') && !overview!.includes('131'));
    assert.ok(transfer!.includes('131') && !transfer!.includes('annotation-transfer@1'));
    assert.ok(details!.includes('annotation-transfer@1') && !details!.includes('131'));
    // The GenoPilot that saved the configuration is a run detail.
    assert.ok(details!.includes('v1.2.3'));
    // The run directory is listed once, in its own section, not again as a run file shown as ".".
    assert.doesNotMatch(files!, /\s\.\s*$/m);
    const frame = frames.join('\n');
    for (const expected of [
      'result-42',
      'Synthetic transfer',
      'annotation-transfer@1',
      'formatted:2026-09-05T20:00:00.000Z',
      'formatted:2026-09-05T20:12:00.000Z',
      '137',
      '131',
      '95.6%',
      '91.0%',
      '96.0%',
      '100.0%',
      'No protein values.',
      '/runs/result-42',
      'results/feature-transfer.tsv',
      'results/annotation/lifton.raw.gff3',
      'provenance/run.json',
    ]) {
      assert.ok(frame.includes(expected), `missing ${expected}`);
    }
  } finally {
    screen.unmount();
  }
});

test('reports unavailable generated reports as missing result paths', () => {
  const loaded = compatibleResult();
  const supportPaths = runSupportPaths('/runs/result-42', () => true);
  assert.ok(supportPaths.every(supportPath => supportPath.available));
  assert.deepEqual(
    missingResultPaths(loaded.shell, supportPaths),
    ['/runs/result-42/results/validation.json'],
  );
});

test('checks support and canonical metrics paths independently from generated reports', () => {
  const loaded = compatibleResult();
  loaded.result.reports.validation!.available = true;
  loaded.result.metricsPath.available = false;
  const supportPaths = runSupportPaths(
    '/runs/result-42',
    candidate => !candidate.endsWith('/provenance/run.json') && !candidate.endsWith('/logs'),
  );
  assert.deepEqual(
    supportPaths.filter(supportPath => !supportPath.available).map(supportPath => supportPath.path),
    ['provenance/run.json', 'logs'],
  );
  assert.deepEqual(
    missingResultPaths(loaded.shell, supportPaths).sort(),
    [
      '/runs/result-42/logs',
      '/runs/result-42/provenance/run.json',
      '/runs/result-42/results/metrics.json',
    ],
  );
});

test('distinguishes current evidence availability from availability at summary time', async () => {
  const loaded = compatibleResult();
  loaded.result.evidence.raw_gff3!.available = false;
  loaded.result.evidence.mapped_features!.recordedAvailable = false;
  const screen = renderScreen(loaded, {inputActive: true});
  try {
    const frame = (await tabFrames(screen, 5)).at(-1) ?? '';
    assert.match(frame, /lifton\.raw\.gff3 \(missing\) \(available when summarized\)/);
    assert.match(frame, /mapped\.txt \(unavailable when summarized; available now\)/);
  } finally {
    screen.unmount();
  }
});

test('scrolls result content in a short terminal', async () => {
  const screen = renderScreen(compatibleResult(), {
    rows: 20,
    inputActive: true,
  });
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.output.clearOutput();
    screen.output.emit('resize');
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    // The run files are on the Files tab, the third from the end.
    screen.input.write(SHIFT_TAB);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.input.write(SHIFT_TAB);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.input.write(SHIFT_TAB);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.output.clearOutput();
    screen.output.emit('resize');
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    assert.doesNotMatch(screen.frame(), /provenance\/run\.json/);

    let reachedSupportPaths = false;
    for (let index = 0; index < 40 && !reachedSupportPaths; index += 1) {
      screen.output.clearOutput();
      screen.input.write(PAGE_DOWN);
      await new Promise<void>(resolve => setTimeout(resolve, 20));
      reachedSupportPaths = /provenance\/run\.json/.test(screen.frame());
    }
    assert.ok(reachedSupportPaths);

    screen.input.write(ARROW_DOWN);
  } finally {
    screen.unmount();
  }
});

test('returns from the result screen with Escape', async () => {
  let backedOut = false;
  const screen = renderScreen(compatibleResult(), {
    inputActive: true,
    onBack: () => { backedOut = true; },
  });
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    screen.input.write(ESCAPE);
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('renders an unqualified completed status', () => {
  const loaded = compatibleResult();
  loaded.result.status = 'completed';
  loaded.result.statusExplanation = 'Transfer completed without validation findings.';
  loaded.result.validation = {status: 'passed', errors: 0, warnings: 0};
  const screen = renderScreen(loaded);
  try {
    assert.match(screen.frame(), /Transfer completed without validation findings\./);
  } finally {
    screen.unmount();
  }
});

test('renders validation failure as a retained scientific result', () => {
  const loaded = compatibleResult();
  loaded.result.status = 'validation-failed';
  loaded.result.statusExplanation = 'Structural validation failed; evidence was retained.';
  loaded.result.validation = {status: 'failed', errors: 3, warnings: 0};
  const screen = renderScreen(loaded);
  try {
    assert.match(screen.frame(), /Structural validation failed; evidence was retained\./);
    assert.match(screen.frame(), /failed[\s\S]*\b3\b/);
  } finally {
    screen.unmount();
  }
});

test('keeps run support paths visible when persisted results are incompatible', () => {
  const screen = renderScreen({
    kind: 'incompatible',
    error: {
      kind: 'invalid-summary',
      message: 'Unsupported summary schema 9.',
      path: '/runs/result-42/results/summary.json',
    },
  });
  try {
    const frame = screen.frame();
    assert.match(frame, /Unsupported summary schema 9/);
    assert.match(frame, /\/runs\/result-42\/results\/summary\.json/);
    assert.match(frame, /artifacts\.yaml/);
    assert.match(frame, /provenance\/run\.json/);
    assert.doesNotMatch(frame, /137/);
  } finally {
    screen.unmount();
  }
});

test('opens the help page and returns to the preserved result scroll position', async () => {
  let backedOut = false;
  const screen = renderScreen(compatibleResult(), {
    rows: 20,
    inputActive: true,
    onBack: () => { backedOut = true; },
  });
  try {
    await settle();
    screen.output.emit('resize');
    await settle();
    screen.input.write(PAGE_DOWN);
    await settle();
    screen.output.clearOutput();
    screen.input.write(ARROW_DOWN);
    await settle();
    const scrolledResults = screen.frame();
    assert.doesNotMatch(scrolledResults, /Result help sentinel/);

    screen.output.clearOutput();
    screen.input.write(HELP);
    await settle();
    let helpFrame = screen.frame();
    for (let index = 0; index < 40 && !/Result help sentinel/.test(helpFrame); index += 1) {
      screen.output.clearOutput();
      screen.input.write(PAGE_DOWN);
      await settle();
      helpFrame = screen.frame();
    }
    assert.match(helpFrame, /Result help sentinel\./);

    screen.output.clearOutput();
    screen.input.write(ESCAPE);
    await settle(150);
    assert.equal(backedOut, false);
    assert.doesNotMatch(screen.frame(), /Result help sentinel/);
    const visibleText = (frame: string) => frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    assert.equal(visibleText(screen.frame()), visibleText(scrolledResults));

    screen.input.write(ESCAPE);
    await settle(150);
    assert.equal(backedOut, true);
  } finally {
    screen.unmount();
  }
});

test('opens the result help documents also for incompatible results', async () => {
  const screen = renderScreen({
    kind: 'incompatible',
    error: {kind: 'missing-summary', message: 'No summary.'},
  }, {inputActive: true});
  try {
    await settle();
    screen.output.clearOutput();
    screen.input.write(HELP);
    await settle();
    assert.match(screen.frame(), /Result help sentinel/);
  } finally {
    screen.unmount();
  }
});

const ENTER = '\r';

const reviewGenes: ReviewGene[] = [
  {referenceId: 'gene-low', featureType: 'gene', reference: {seqid: 'refchr', start: 1, end: 900, strand: '+'}, target: {id: 'gene-low', seqid: 'chr1', start: 10, end: 90, strand: '+'}, transferMethod: 'Liftoff',
    proteinIdentity: 0.97, mutations: ['nonsynonymous'], category: 'substitutions', liftonStatus: ['Liftoff'], unresolvedBases: 0, reasons: ['below_threshold']},
  {referenceId: 'gene-frame', featureType: 'gene', reference: {seqid: 'refchr', start: 1, end: 900, strand: '+'}, target: {id: 'gene-frame-target', seqid: 'chr2', start: 100, end: 900, strand: '-'}, transferMethod: 'Liftoff',
    proteinIdentity: 0.6, mutations: ['frameshift'], category: 'disrupted', liftonStatus: ['LiftOn_chaining_algorithm'], unresolvedBases: 0,
    reasons: ['disrupted', 'below_threshold']},
];


/** The screen on the Proteins tab, the fourth. */
async function proteinsTab(screen: ReturnType<typeof renderScreen>): Promise<string> {
  return (await tabFrames(screen, 4)).at(-1) ?? '';
}

test('the Proteins tab lists the genes in review order and opens and closes a gene detail', async () => {
  const paths: string[] = [];
  let backs = 0;
  const screen = renderScreen(compatibleResult(), {inputActive: true, onBack: () => {
    backs += 1;
  }, readReviewGenes: async ({path: table}) => {
    paths.push(table);
    return reviewGenes;
  }});
  try {
    const list = await proteinsTab(screen);
    assert.deepEqual(paths, ['/runs/result-42/results/feature-transfer.tsv']);
    assert.ok(list.includes('99%') && list.includes('120') && list.includes('117'));
    assert.ok(list.indexOf('gene-frame') < list.indexOf('gene-low'), 'the disrupted gene comes first');

    screen.output.clearOutput();
    screen.input.write(ENTER);
    await settle();
    const detail = screen.frame();
    assert.ok(detail.includes('gene-frame-target') && detail.includes('LiftOn_chaining_algorithm') && detail.includes('60.0%'));
    assert.ok(!detail.includes('gene-low'));

    screen.output.clearOutput();
    screen.input.write(ESCAPE);
    await settle();
    assert.ok(screen.frame().includes('gene-low'), 'Escape returns to the list');
    assert.equal(backs, 0);

    screen.output.clearOutput();
    screen.input.write(ARROW_DOWN);
    await settle();
    screen.input.write(ENTER);
    await settle();
    assert.ok(screen.frame().includes('97.0%'), 'the arrow keys move the selection');
  } finally {
    screen.unmount();
  }
});

test('the Proteins tab filters by review reason', async () => {
  const screen = renderScreen(compatibleResult(), {inputActive: true, readReviewGenes: async () => reviewGenes});
  try {
    await proteinsTab(screen);
    screen.output.clearOutput();
    screen.input.write('f');
    await settle();
    screen.output.clearOutput();
    screen.input.write('f');
    await settle();
    const disrupted = screen.frame();
    assert.ok(disrupted.includes('gene-frame') && !disrupted.includes('gene-low'));
  } finally {
    screen.unmount();
  }
});

test('the Proteins tab reports a table it cannot read', async () => {
  const screen = renderScreen(compatibleResult(), {inputActive: true, readReviewGenes: async () => {
    throw new Error('table-failure-sentinel');
  }});
  try {
    assert.ok((await proteinsTab(screen)).includes('table-failure-sentinel'));
  } finally {
    screen.unmount();
  }
});

test('names a release run by its version and marks a development build', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(genoPilotSummary({version: '1.2.3', build: {commit, modified: false, released: true}}), 'v1.2.3');
  const development = genoPilotSummary({version: '1.2.3', build: {commit, modified: false, released: false}});
  const modified = genoPilotSummary({version: '1.2.3', build: {commit, modified: true, released: false}});
  assert.ok(development.includes(commit.slice(0, 12)) && development !== 'v1.2.3');
  assert.ok(modified.startsWith(development) && modified.length > development.length);
  // A build of unknown commit is never presented as a release.
  assert.notEqual(genoPilotSummary({version: '1.2.3'}), 'v1.2.3');
});

const citationDocument: Document = {
  id: 'CITATION',
  title: 'Citing this run',
  blocks: parseMarkdown('# Citing this run\n\n## Methods\n\nReads were aligned with a synthetic aligner.\n'),
  copyable: true,
};

test('shows the run\'s citation on its own tab, or that the run has none yet', async () => {
  for (const [citation, expected] of [[citationDocument, 'synthetic aligner'], [undefined, 'citation/CITATION.md']] as const) {
    const screen = renderScreen(compatibleResult(), {inputActive: true, readCitation: async () => citation});
    try {
      const frames = await tabFrames(screen, 7);
      assert.ok(frames.at(-1)!.includes(expected), `missing ${expected}`);
      assert.ok(frames.slice(0, -1).every(frame => !frame.includes('synthetic aligner')));
    } finally {
      screen.unmount();
    }
  }
});

test('reads a run\'s citation as a copyable document once the run wrote it', async context => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'genopilot-citation-'));
  context.after(() => rm(runDirectory, {recursive: true, force: true}));
  assert.equal(await readRunCitation(runDirectory), undefined);
  assert.equal(runSupportPaths(runDirectory, () => false).find(path => path.id === 'run.citation')?.available, false);
  await mkdir(join(runDirectory, 'citation'));
  await writeFile(join(runDirectory, 'citation', 'CITATION.md'), '# Citing this run\n\nDraft.\n', 'utf8');
  const citation = await readRunCitation(runDirectory);
  assert.equal(citation?.copyable, true);
  assert.ok(citation?.blocks?.length);
});

test('views opened from a run carry its citation, other views do not', () => {
  const run = {id: 'run-1', workflow: {id: 'annotation-transfer', version: 1}, genopilot: {version: '1.2.3'}};
  const view = {id: 'view', title: 'Genome', provenance: {application: {name: 'GenoPilot', version: '1.2.3'}, run, sources: []},
    content: {kind: 'genome', reference: {name: 'ref', fasta: '/ref.fa', snapshot: {size: 1, mtimeMs: 1}}, tracks: []}} as unknown as Parameters<typeof withRunCitation>[0];
  assert.equal(withRunCitation(view, citationDocument).provenance.run?.citation?.copyable, true);
  assert.equal(withRunCitation(view, undefined).provenance.run?.citation, undefined);
  const accession = {...view, provenance: {...view.provenance, run: undefined}};
  assert.equal(withRunCitation(accession, citationDocument).provenance.run, undefined);
});
