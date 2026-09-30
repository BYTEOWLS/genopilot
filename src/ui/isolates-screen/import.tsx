import {basename, dirname, relative} from 'node:path';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {IsolateCatalogValidationError, suggestIsolateId, validateIsolateCatalog} from '../../isolates/catalog.js';
import type {DeliveryScan, SkipReason} from '../../isolates/illumina-delivery.js';
import {
  applyImportDecisions,
  chooseVariant,
  ImportDecisionError,
  initialDecisions,
  type CandidateDecision,
} from '../../isolates/illumina-import.js';
import type {ReadPairsChecker} from '../../isolates/reads.js';
import {IsolateCatalogChangedError, type LoadedIsolateCatalog} from '../../isolates/store.js';
import {useHomeSuspension} from '../home-navigation.js';
import {DocumentPage} from '../components/document-page.js';
import {EditPage, Page} from '../components/page.js';
import {PathBrowser, type DirectoryReader} from '../components/path-browser.js';
import {TextField} from '../components/text-field.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {readGeneralDocuments, type DocumentsLoader} from '../../docs/documents.js';
import type {IsolateCatalogLoader, IsolateCatalogUpdater} from './screen.js';

export type DeliveryScanner = (
  root: string,
  catalog: LoadedIsolateCatalog['catalog'],
  signal?: AbortSignal,
) => Promise<DeliveryScan>;

type Stage =
  | {kind: 'folder'}
  | {kind: 'scanning'; root: string}
  | {kind: 'failed'; message: string}
  | {kind: 'report'; scan: DeliveryScan}
  | {kind: 'review'; scan: DeliveryScan};

type Row =
  | {id: string; kind: 'target'; candidate: number}
  | {id: string; kind: 'name' | 'id'; candidate: number}
  | {id: string; kind: 'wildtype' | 'parent'; candidate: number}
  | {id: string; kind: 'variant' | 'trimmed'; candidate: number; readSet: number}
  | {id: string; kind: 'save'};

const skipReasonLabels: Record<SkipReason, string> = {
  'not-illumina-name': 'not an Illumina FASTQ name',
  undetermined: 'undetermined reads, not a sample',
  'index-read': 'index read',
  'split-chunk': 'lane split into several files, unsupported',
  'missing-mate': 'mate file missing',
  'invalid-fastq': 'not valid FASTQ',
  unreadable: 'cannot be read',
  'not-illumina-header': 'read headers are not Illumina',
  'mate-mismatch': 'R1 and R2 read names differ',
  'outside-folder': 'link leads outside the chosen folder',
  'same-file': 'same file as',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

function reportLines(scan: DeliveryScan): string[] {
  const shown = (path: string): string => relative(scan.root, path) || '.';
  const lines: string[] = [];
  if (scan.alreadyImported.length > 0) {
    lines.push(`Already in the catalog (${String(scan.alreadyImported.length)}):`);
    lines.push(...scan.alreadyImported.map(file => `  ${shown(file.path)} → ${file.isolateId}`));
  }
  if (scan.skippedFiles.length > 0) {
    lines.push(`Not imported (${String(scan.skippedFiles.length)}):`);
    lines.push(...scan.skippedFiles.map(file => {
      const detail = file.detail === undefined ? '' : ` ${file.reason === 'same-file' ? shown(file.detail) : `(${file.detail})`}`;
      return `  ${shown(file.path)} — ${skipReasonLabels[file.reason]}${detail}`;
    }));
  }
  if (scan.skippedDirectories.length > 0) {
    lines.push(`Folders not scanned (${String(scan.skippedDirectories.length)}):`);
    lines.push(...scan.skippedDirectories.map(folder =>
      `  ${shown(folder.path)} — ${folder.reason === 'symlink' ? 'folder link not followed' : 'cannot be read'}`));
  }
  return lines;
}

/**
 * Names catalog issues by isolate ID rather than by list position, or by name while the ID is
 * empty, so every message says which isolate it is about.
 */
function describeIssues(error: IsolateCatalogValidationError, isolates: readonly {id: string; name: string}[]): string[] {
  return error.issues.map(issue => {
    const located = /^\$\.isolates\[(\d+)\]\.?(.*)$/.exec(issue.path);
    const isolate = located ? isolates[Number(located[1])] : undefined;
    const who = isolate ? isolate.id || isolate.name || 'isolate without ID or name' : undefined;
    return who === undefined ? `${issue.path}: ${issue.message}` : `${who} ${located?.[2] ?? ''}: ${issue.message}`;
  });
}

/** Shows at most `limit` problems, so a long list cannot push the review off the screen. */
const shownProblemLimit = 5;
function limitProblems(problems: readonly string[]): string[] {
  if (problems.length <= shownProblemLimit) {
    return [...problems];
  }
  const hidden = problems.length - (shownProblemLimit - 1);
  return [...problems.slice(0, shownProblemLimit - 1), `…and ${String(hidden)} more; fix these first.`];
}

const importTitle = 'Import isolates from an Illumina delivery';
const importIntro =
  'Illumina names FASTQ files and read headers the same way across instruments and delivery ' +
  'formats, so GenoPilot can find each sample\'s read pairs in a delivery folder and propose ' +
  'them as isolates. Nothing is saved until you have reviewed them.';

/**
 * Imports isolates from an Illumina delivery: choose a folder, read the scan report, review each
 * proposed isolate, and save all accepted ones in one catalog update.
 */
export function IsolateImport({
  loaded: initialCatalog,
  loadCatalog,
  updateCatalog,
  checkReads,
  scanDelivery,
  inputActive,
  currentDirectory,
  readDirectory,
  onDone,
  onCancel,
  loadHelp = () => readGeneralDocuments(['import-review']),
}: {
  loaded: LoadedIsolateCatalog;
  loadCatalog: IsolateCatalogLoader;
  updateCatalog: IsolateCatalogUpdater;
  checkReads: ReadPairsChecker;
  scanDelivery: DeliveryScanner;
  inputActive: boolean;
  currentDirectory: string;
  readDirectory?: DirectoryReader;
  onDone: (loaded: LoadedIsolateCatalog, message: string) => void;
  onCancel: () => void;
  /** The document the import review's help shows. */
  loadHelp?: DocumentsLoader;
}): React.JSX.Element {
  const {rows: terminalRows} = useWindowSize();
  const [loaded, setLoaded] = useState(initialCatalog);
  const [stage, setStage] = useState<Stage>({kind: 'folder'});
  const [decisions, setDecisions] = useState<CandidateDecision[]>([]);
  const [editedIds, setEditedIds] = useState<ReadonlySet<number>>(new Set());
  const [selectedRowId, setSelectedRowId] = useState('');
  const [reportOffset, setReportOffset] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // The scan runs once per chosen folder, so it reads the catalog, which a reload may replace,
  // through a ref rather than restarting.
  const catalogRef = useRef(loaded.catalog);
  catalogRef.current = loaded.catalog;

  const scanRoot = stage.kind === 'scanning' ? stage.root : undefined;
  useEffect(() => {
    if (scanRoot === undefined) {
      return;
    }
    const controller = new AbortController();
    scanDelivery(scanRoot, catalogRef.current, controller.signal).then(
      scan => {
        if (!controller.signal.aborted) {
          setDecisions(initialDecisions(scan, catalogRef.current));
          setEditedIds(new Set());
          setReportOffset(0);
          setSelectedRowId('');
          setProblems([]);
          setStage({kind: 'report', scan});
        }
      },
      error => {
        if (!controller.signal.aborted) {
          setStage({kind: 'failed', message: errorMessage(error)});
        }
      },
    );
    return () => controller.abort();
  }, [scanRoot, scanDelivery]);

  const scan = stage.kind === 'review' || stage.kind === 'report' ? stage.scan : undefined;
  const {isolates} = loaded.catalog;

  const rows: Row[] = stage.kind === 'review' && scan
    ? [
      ...scan.candidates.flatMap((candidate, index): Row[] => {
        const decision = decisions[index];
        if (!decision) {
          return [];
        }
        const target: Row = {id: `${String(index)}:target`, kind: 'target', candidate: index};
        if (decision.target === 'skip') {
          return [target];
        }
        const fields: Row[] = decision.target === 'new'
          ? (['name', 'id', 'wildtype', 'parent'] as const).map(kind => ({id: `${String(index)}:${kind}`, kind, candidate: index}))
          : [];
        const readSets = candidate.readSets.flatMap((_readSet, readSet): Row[] => [
          {id: `${String(index)}:${String(readSet)}:variant`, kind: 'variant', candidate: index, readSet},
          ...(typeof decision.readSets[readSet]?.variant === 'number'
            ? [{id: `${String(index)}:${String(readSet)}:trimmed`, kind: 'trimmed', candidate: index, readSet} as const]
            : []),
        ]);
        return [target, ...fields, ...readSets];
      }),
      {id: 'save', kind: 'save'},
    ]
    : [];
  const selectedIndex = Math.max(0, rows.findIndex(row => row.id === selectedRowId));
  const selectedRow = rows[selectedIndex];
  const typing = selectedRow?.kind === 'name' || selectedRow?.kind === 'id';

  useHomeSuspension(saving ? 'busy' : stage.kind === 'review' && typing ? 'typing' : undefined);

  const updateDecision = (index: number, change: (decision: CandidateDecision) => CandidateDecision): void => {
    setDecisions(current => current.map((decision, candidate) => candidate === index ? change(decision) : decision));
  };

  const changeName = (index: number, name: string): void => {
    setDecisions(current => current.map((decision, candidate) => {
      if (candidate !== index) {
        return decision;
      }
      // The ID follows the name until the researcher edits it, as in the isolate form.
      if (editedIds.has(index)) {
        return {...decision, newIsolate: {...decision.newIsolate, name}};
      }
      const otherIds = [
        ...isolates.map(isolate => isolate.id),
        ...current.filter((other, otherIndex) => otherIndex !== index && other.target === 'new').map(other => other.newIsolate.id),
      ];
      return {...decision, newIsolate: {...decision.newIsolate, name, id: suggestIsolateId(name, otherIds)}};
    }));
  };

  const cycle = (row: Row, offset: -1 | 1): void => {
    if (row.kind === 'save' || !scan) {
      return;
    }
    const decision = decisions[row.candidate];
    if (!decision) {
      return;
    }
    const pick = <T,>(options: readonly T[], current: number): T | undefined =>
      options[((current < 0 ? (offset === 1 ? -1 : 0) : current) + offset + options.length) % options.length];
    switch (row.kind) {
      case 'target': {
        const options: CandidateDecision['target'][] = ['new', 'skip', ...isolates.map(isolate => ({existingId: isolate.id}))];
        const key = (target: CandidateDecision['target']): string => typeof target === 'string' ? target : target.existingId;
        const next = pick(options, options.findIndex(option => key(option) === key(decision.target)));
        if (next !== undefined) {
          updateDecision(row.candidate, current => ({...current, target: next}));
        }
        return;
      }
      case 'wildtype': {
        const options = [null, true, false];
        const next = pick(options, options.indexOf(decision.newIsolate.wildtype));
        updateDecision(row.candidate, current => ({...current, newIsolate: {...current.newIsolate, wildtype: next ?? null}}));
        return;
      }
      case 'parent': {
        const options = [null, ...isolates.map(isolate => isolate.id)];
        const next = pick(options, options.indexOf(decision.newIsolate.derivedFrom));
        updateDecision(row.candidate, current => ({...current, newIsolate: {...current.newIsolate, derivedFrom: next ?? null}}));
        return;
      }
      case 'variant': {
        const readSet = scan.candidates[row.candidate]?.readSets[row.readSet];
        if (!readSet) {
          return;
        }
        const options: (number | 'none')[] = [...readSet.variants.keys(), 'none'];
        const current = decision.readSets[row.readSet]?.variant;
        const next = pick(options, current === 'undecided' || current === undefined ? -1 : options.indexOf(current));
        if (next !== undefined) {
          updateDecision(row.candidate, value => ({
            ...value,
            readSets: value.readSets.map((choice, index) => index === row.readSet ? chooseVariant(readSet, next) : choice),
          }));
        }
        return;
      }
      case 'trimmed':
        updateDecision(row.candidate, value => ({
          ...value,
          readSets: value.readSets.map((choice, index) => index === row.readSet ? {...choice, trimmed: !choice.trimmed} : choice),
        }));
        return;
      default:
        return;
    }
  };

  const save = async (): Promise<void> => {
    if (!scan) {
      return;
    }
    setProblems([]);
    let planned: ReturnType<typeof applyImportDecisions>;
    try {
      planned = applyImportDecisions(loaded.catalog, scan, decisions);
    } catch (error) {
      setProblems(error instanceof ImportDecisionError ? [...error.problems] : [errorMessage(error)]);
      return;
    }
    try {
      validateIsolateCatalog(planned.catalog);
    } catch (error) {
      setProblems(error instanceof IsolateCatalogValidationError
        ? describeIssues(error, planned.catalog.isolates)
        : [errorMessage(error)]);
      return;
    }
    setSaving(true);
    try {
      const reads = await checkReads(planned.pairs);
      const readProblems = reads.pairs.flatMap((check, index) => {
        const pair = planned.pairs[index];
        return [
          check.r1.state === 'ok' ? undefined : `${pair?.r1 ?? ''}: ${check.r1.reason}`,
          check.r2.state === 'ok' ? undefined : `${pair?.r2 ?? ''}: ${check.r2.reason}`,
        ].filter((problem): problem is string => problem !== undefined);
      });
      readProblems.push(...reads.sameFiles.map(({first, second}) => `${second}: is the same file as ${first}`));
      if (readProblems.length > 0) {
        setProblems(readProblems);
        setSaving(false);
        return;
      }
      const saved = await updateCatalog(loaded.revision, latest => applyImportDecisions(latest, scan, decisions).catalog);
      const parts = [
        planned.created > 0 ? `created ${String(planned.created)} isolate${planned.created === 1 ? '' : 's'}` : undefined,
        planned.extended > 0 ? `added read pairs to ${String(planned.extended)} existing isolate${planned.extended === 1 ? '' : 's'}` : undefined,
      ].filter(part => part !== undefined);
      onDone(saved, `Import saved: ${parts.join(' and ')}.`);
    } catch (error) {
      if (error instanceof IsolateCatalogChangedError) {
        // Keep every decision; saving again validates against the other window's changes.
        try {
          setLoaded(await loadCatalog());
          setProblems(['The isolate catalog was changed in another GenoPilot window. It was reloaded; review and save again.']);
        } catch (reloadError) {
          setProblems([errorMessage(reloadError)]);
        }
      } else if (error instanceof ImportDecisionError) {
        setProblems([...error.problems]);
      } else {
        setProblems([errorMessage(error)]);
      }
      setSaving(false);
    }
  };

  const reportPageSize = Math.max(5, terminalRows - 12);
  // Below the rows: path lines of the selected copy, the saving note, and the problem box.
  const shownProblems = limitProblems(problems);
  const belowRows = 2 + (shownProblems.length > 0 ? shownProblems.length + 4 : 0) + (saving ? 1 : 0);
  const reviewPageSize = Math.max(4, terminalRows - 15 - belowRows);
  const lines = scan ? reportLines(scan) : [];

  useInput(
    (input, key) => {
      if (saving || showHelp || stage.kind === 'folder') {
        return;
      }
      if (stage.kind === 'scanning' || stage.kind === 'failed') {
        if (key.escape || (stage.kind === 'failed' && key.return)) {
          setStage({kind: 'folder'});
        }
        return;
      }
      if (stage.kind === 'report') {
        if (key.escape) {
          setStage({kind: 'folder'});
        } else if (key.upArrow) {
          setReportOffset(offset => Math.max(0, offset - 1));
        } else if (key.downArrow) {
          setReportOffset(offset => Math.min(Math.max(0, lines.length - reportPageSize), offset + 1));
        } else if (key.return) {
          if (stage.scan.candidates.length === 0) {
            setStage({kind: 'folder'});
          } else {
            // Coming back from the report keeps the row; a fresh scan starts at the first sample.
            setSelectedRowId(current => current === '' ? '0:target' : current);
            setStage({kind: 'review', scan: stage.scan});
          }
        }
        return;
      }
      if (!selectedRow) {
        return;
      }
      if (key.escape) {
        setProblems([]);
        setStage({kind: 'report', scan: stage.scan});
        return;
      }
      if (input === '?' && !typing) {
        setShowHelp(true);
        return;
      }
      if (key.tab || key.upArrow || key.downArrow) {
        const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
        setSelectedRowId(rows[(selectedIndex + offset + rows.length) % rows.length]?.id ?? 'save');
        return;
      }
      const change = input === ' ' || key.rightArrow ? 1 : key.leftArrow ? -1 : undefined;
      if (change !== undefined && !typing) {
        cycle(selectedRow, change);
        return;
      }
      // Enter acts only on the save button; Tab and the arrows move between rows.
      if (key.return && selectedRow.kind === 'save') {
        void save();
      }
    },
    {isActive: inputActive},
  );

  if (stage.kind === 'folder') {
    return (
      <PathBrowser
        title={importTitle}
        intro={importIntro}
        initialDirectory={currentDirectory}
        selectFolder
        onSelect={root => setStage({kind: 'scanning', root})}
        onCancel={onCancel}
        inputActive={inputActive}
        readDirectory={readDirectory}
      />
    );
  }

  if (stage.kind === 'scanning' || stage.kind === 'failed') {
    return (
      <Page
        title={importTitle}
        description={importIntro}
        shortcuts={[stage.kind === 'failed' && 'Enter — Choose another folder']}
        back={stage.kind === 'scanning' ? 'Cancel' : 'Choose another folder'}
      >
        <Box flexDirection="column">
          {stage.kind === 'scanning' ? (
            <Text wrap="truncate">Scanning {sanitizeTerminalText(stage.root)}…</Text>
          ) : (
            <>
              <Text color="red">The folder could not be scanned.</Text>
              <Text wrap="wrap">{sanitizeTerminalText(stage.message)}</Text>
            </>
          )}
        </Box>
      </Page>
    );
  }

  if (stage.kind === 'report') {
    const pairCount = stage.scan.candidates.reduce((sum, candidate) =>
      sum + candidate.readSets.reduce((inner, readSet) => inner + readSet.variants.length, 0), 0);
    const visible = lines.slice(reportOffset, reportOffset + reportPageSize);
    return (
      <Page
        title="Scan report"
        description={sanitizeTerminalText(stage.scan.root)}
        shortcuts={['↑/↓ — Scroll', `Enter — ${stage.scan.candidates.length === 0 ? 'Choose another folder' : 'Review samples'}`]}
      >
        <Box flexDirection="column">
          <Text wrap="wrap">
            {stage.scan.candidates.length === 0
              ? 'No samples to import were found.'
              : `Found ${String(stage.scan.candidates.length)} sample${stage.scan.candidates.length === 1 ? '' : 's'} with ${String(pairCount)} read pair${pairCount === 1 ? '' : 's'} to review.`}
          </Text>
          {lines.length === 0 ? <Text color={mutedColor}>Every FASTQ file in the folder was used.</Text> : null}
          {visible.map((line, index) => (
            <Text key={reportOffset + index} wrap="truncate" color={line.startsWith('  ') ? mutedColor : undefined}>
              {sanitizeTerminalText(line)}
            </Text>
          ))}
          {lines.length > reportPageSize ? (
            <Text color={mutedColor}>
              Lines {reportOffset + 1}–{Math.min(lines.length, reportOffset + reportPageSize)} of {lines.length}
            </Text>
          ) : null}
        </Box>
      </Page>
    );
  }

  if (showHelp) {
    return (
      <DocumentPage
        title="Import review help"
        load={loadHelp}
        onClose={() => setShowHelp(false)}
        back="Close help"
        inputActive={inputActive}
      />
    );
  }

  const describeTarget = (decision: CandidateDecision): string => {
    if (decision.target === 'new') {
      return 'new isolate';
    }
    if (decision.target === 'skip') {
      return 'skip';
    }
    const {existingId} = decision.target;
    const existing = isolates.find(isolate => isolate.id === existingId);
    return `add to ${existing?.name ?? existingId} (${existingId})`;
  };

  // Numbers are right-aligned so sample names line up, e.g. " 9)" above "10)".
  const numberWidth = String(stage.scan.candidates.length).length;
  const sampleNumber = (index: number): string => `${String(index + 1).padStart(numberWidth)}) `;

  const renderRow = (row: Row): React.JSX.Element => {
    const selected = row.id === selectedRow?.id;
    const marker = selected ? '› ' : '  ';
    const color = selected ? 'cyan' : undefined;
    if (row.kind === 'save') {
      // Drawn by the page as its save button.
      return <React.Fragment key={row.id} />;
    }
    const candidate = stage.scan.candidates[row.candidate];
    const decision = decisions[row.candidate];
    if (!candidate || !decision) {
      return <Text key={row.id}> </Text>;
    }
    switch (row.kind) {
      case 'target':
        return (
          <Text key={row.id} color={color} wrap="truncate">
            {marker}{sampleNumber(row.candidate)}<Text bold>{sanitizeTerminalText(candidate.sample)}</Text>: ‹ {sanitizeTerminalText(describeTarget(decision))} ›
          </Text>
        );
      case 'name':
      case 'id': {
        const value = decision.newIsolate[row.kind];
        return (
          <TextField
            key={row.id}
            label={row.kind === 'name' ? '  Name' : '  ID'}
            required
            selected={selected}
            inputActive={inputActive && !saving}
            defaultValue={value}
            displayValue={value}
            onChange={text => {
              if (row.kind === 'name') {
                changeName(row.candidate, text);
              } else {
                setEditedIds(current => new Set(current).add(row.candidate));
                updateDecision(row.candidate, current => ({...current, newIsolate: {...current.newIsolate, id: text}}));
              }
            }}
          />
        );
      }
      case 'wildtype': {
        const {wildtype} = decision.newIsolate;
        return (
          <Text key={row.id} color={color} wrap="truncate">
            {marker}  Wild type: ‹ {wildtype === null ? 'not recorded' : wildtype ? 'yes' : 'no'} ›
          </Text>
        );
      }
      case 'parent':
        return (
          <Text key={row.id} color={color} wrap="truncate">
            {marker}  Derived from: ‹ {sanitizeTerminalText(decision.newIsolate.derivedFrom ?? 'none')} ›
          </Text>
        );
      case 'variant': {
        const readSet = candidate.readSets[row.readSet];
        const choice = decision.readSets[row.readSet];
        if (!readSet || !choice) {
          return <Text key={row.id}> </Text>;
        }
        const variant = typeof choice.variant === 'number' ? readSet.variants[choice.variant] : undefined;
        // Length and size come first, and only the copy's own folder, which usually tells copies
        // apart, so a narrow terminal truncates the least useful part; full paths follow below.
        const label = variant
          ? `copy ${String((choice.variant as number) + 1)} of ${String(readSet.variants.length)} · ` +
            `${String(variant.readLength.min)}–${String(variant.readLength.max)} bp · ` +
            `${formatBytes(variant.r1Bytes + variant.r2Bytes)} · ${basename(dirname(variant.r1))}`
          : choice.variant === 'none' ? 'leave out' : `choose one of ${String(readSet.variants.length)} copies`;
        const lane = readSet.lane === null ? 'merged lanes' : `lane ${String(readSet.lane)}`;
        return (
          <Text key={row.id} color={color ?? (choice.variant === 'undecided' ? 'yellow' : undefined)} wrap="truncate">
            {marker}  Run {readSet.run} · {sanitizeTerminalText(readSet.flowcell)} · {lane}: ‹ {sanitizeTerminalText(label)} ›
          </Text>
        );
      }
      case 'trimmed': {
        const choice = decision.readSets[row.readSet];
        const readSet = candidate.readSets[row.readSet];
        const variant = typeof choice?.variant === 'number' ? readSet?.variants[choice.variant] : undefined;
        const suggestion = variant?.suggestedTrimmed ? 'read lengths vary' : 'read lengths uniform';
        return (
          <Text key={row.id} color={color} wrap="truncate">
            {marker}    Already trimmed: ‹ {choice?.trimmed ? 'yes' : 'no'} ›<Text color={mutedColor}> ({suggestion})</Text>
          </Text>
        );
      }
    }
  };

  const reviewStart = Math.max(0, Math.min(selectedIndex - Math.floor(reviewPageSize / 2), rows.length - reviewPageSize));
  const selectedVariant = (() => {
    if (selectedRow?.kind !== 'variant' && selectedRow?.kind !== 'trimmed') {
      return undefined;
    }
    const choice = decisions[selectedRow.candidate]?.readSets[selectedRow.readSet]?.variant;
    return typeof choice === 'number'
      ? stage.scan.candidates[selectedRow.candidate]?.readSets[selectedRow.readSet]?.variants[choice]
      : undefined;
  })();
  const hint = selectedRow?.kind === 'save'
    ? 'Enter — Save'
    : typing ? undefined : 'Space/←/→ — Change';

  return (
    <EditPage
      title="Review import"
      description={`${sanitizeTerminalText(stage.scan.root)}\nChoose one copy per read set; copies hold the same reads. Prefer untrimmed reads.`}
      shortcuts={['Tab/↑/↓ — Field', hint, !typing && '? — Help']}
      back="Back to report"
      saveLabel="Save import"
      saveSelected={selectedRow?.kind === 'save'}
      saving={saving}
      savingLabel="Checking reads and saving…"
      problems={shownProblems}
    >
      <Text wrap="wrap">
        Press <Text bold color="cyan">?</Text> for help: what each row means, such as run, flowcell, lane,
        {' '}copies, and read lengths.{typing ? ' (Leave the text field first.)' : ''}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {rows.slice(reviewStart, reviewStart + reviewPageSize).map(renderRow)}
        {rows.length > reviewPageSize ? (
          <Text color={mutedColor}>Row {selectedIndex + 1} of {rows.length}</Text>
        ) : null}
      </Box>
      {selectedVariant ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={mutedColor} wrap="truncate-start">R1: {sanitizeTerminalText(selectedVariant.r1)}</Text>
          <Text color={mutedColor} wrap="truncate-start">R2: {sanitizeTerminalText(selectedVariant.r2)}</Text>
        </Box>
      ) : null}
    </EditPage>
  );
}
