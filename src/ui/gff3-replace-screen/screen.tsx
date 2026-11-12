import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import React, {useEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text, useInput} from 'ink';
import {
  attributeGroups,
  compileReplacement,
  defaultAttributeGroups,
  ReplaceOptionsError,
  type AttributeGroup,
  type ReplaceOptions,
} from '../../gff3-replace/core.js';
import {defaultOutputParent, derivedFolderName, findRunDirectory} from '../../gff3-replace/derived.js';
import {
  idMappingFileName,
  previewRewrite,
  recordFileName,
  writeRewrite,
  type WriteOutcome,
  type WriteRequest,
} from '../../gff3-replace/job.js';
import type {PassResult} from '../../gff3-replace/pass.js';
import {readGeneralDocuments, type DocumentsLoader} from '../../docs/documents.js';
import {EditPage, Page} from '../components/page.js';
import {ParameterList, parameterLabelWidth, type ParameterRow} from '../components/parameter-list.js';
import {PathBrowser} from '../components/path-browser.js';
import {expandHomeDirectory} from '../components/path-field.js';
import {MarkdownDocumentPage} from '../components/markdown-document-page.js';
import {Section} from '../components/section.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

const groupLabels: Record<AttributeGroup, string> = {
  ids: 'IDs and references',
  Name: 'Name',
  locus_tag: 'locus_tag',
  gene: 'gene',
  product: 'product',
  Note: 'Note',
  Alias: 'Alias',
  Dbxref: 'Dbxref',
};

const groupDetails: Partial<Record<AttributeGroup, string>> = {
  ids: 'ID, Parent, Derives_from',
  Alias: 'earlier names, including former IDs',
};

type RowId = 'source' | 'search' | 'replacement' | 'regex' | `attribute.${AttributeGroup}` | 'attribute.all' | 'output' | 'save';

const rowOrder: readonly RowId[] = [
  'source', 'search', 'replacement', 'regex',
  ...attributeGroups.map(group => `attribute.${group}` as const), 'attribute.all',
  'output', 'save',
];

const textRows = new Set<RowId>(['source', 'search', 'replacement', 'output']);

export type PreviewRewrite = (request: {source: string; options: ReplaceOptions}, signal: AbortSignal) => Promise<PassResult>;
export type WriteRewrite = (request: WriteRequest, signal: AbortSignal) => Promise<WriteOutcome>;

type Busy = {kind: 'previewing' | 'writing'; controller: AbortController};

type Preview = {key: string; result: PassResult};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${String(value)} ${value === 1 ? noun : plural}`;
}

/** The statistics of a preview or a written rewrite, as aligned rows. */
export function RewriteStatistics({result}: {result: PassResult}): React.JSX.Element {
  const {statistics, samples} = result;
  const rows: ParameterRow[] = [
    {id: 'replacements', label: 'Replacements', value: String(statistics.replacements)},
    {id: 'ids', label: 'IDs', value: `${String(statistics.ids.changed)} changed · ${String(statistics.ids.matchedUnchanged)} matched without changing · ${String(statistics.ids.unmatched)} not matched`},
    {id: 'aliases', label: 'Aliases added', value: String(statistics.aliasesAdded)},
    ...(statistics.danglingInSource > 0
      ? [{id: 'dangling', label: 'Unresolved references', value: `${String(statistics.danglingInSource)} already in the source`}]
      : []),
  ];
  const changed = Object.entries(statistics.changedValues).sort(([left], [right]) => left.localeCompare(right));
  const changedRows: ParameterRow[] = changed.map(([name, value]) => {
    const sample = samples[name]?.[0];
    return {id: `changed.${name}`, label: name, value: `${count(value, 'value')}${sample ? ` · e.g. ${sample.before} → ${sample.after}` : ''}`};
  });
  const labelWidth = parameterLabelWidth([...rows, ...changedRows]);
  return (
    <>
      <ParameterList rows={rows} inputActive={false} labelWidth={labelWidth} />
      <Section title="Changed values per attribute">
        {changedRows.length > 0
          ? <ParameterList rows={changedRows} inputActive={false} labelWidth={labelWidth} />
          : <Text color={mutedColor}>None: the search text matches no value of the chosen attributes.</Text>}
      </Section>
    </>
  );
}

/** The help page of this screen. */
const loadScreenHelp: DocumentsLoader = () => readGeneralDocuments(['gff3-find-and-replace']);

/**
 * Finds and replaces text in the attributes of a GFF3, with a preview before anything is written.
 * Started from a run's result page, the source is fixed and the rewrite goes to the run's `derived/`.
 */
export function Gff3ReplaceScreen({
  currentDirectory,
  source: initialSource = '',
  sourceFixed = false,
  onBack,
  inputActive,
  preview = (request, signal) => previewRewrite(request, signal),
  write = (request, signal) => writeRewrite(request, signal),
  findRun = findRunDirectory,
  pathExists = existsSync,
  loadHelp = loadScreenHelp,
}: {
  currentDirectory: string;
  source?: string;
  /** The source cannot be changed, such as a run's artifact chosen on its result page. */
  sourceFixed?: boolean;
  onBack: () => void;
  inputActive: boolean;
  preview?: PreviewRewrite;
  write?: WriteRewrite;
  findRun?: (path: string) => Promise<string | undefined>;
  pathExists?: (path: string) => boolean;
  loadHelp?: DocumentsLoader;
}): React.JSX.Element {
  const [source, setSource] = useState(initialSource);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regularExpression, setRegularExpression] = useState(false);
  const [groups, setGroups] = useState<readonly AttributeGroup[]>(defaultAttributeGroups);
  const [allAttributes, setAllAttributes] = useState(false);
  const [output, setOutput] = useState('');
  const [runDirectory, setRunDirectory] = useState<string>();
  const [selected, setSelected] = useState<RowId>(sourceFixed ? 'search' : 'source');
  const [browsing, setBrowsing] = useState<'source' | 'output'>();
  const [busy, setBusy] = useState<Busy>();
  const [previewed, setPreviewed] = useState<Preview>();
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [written, setWritten] = useState<Extract<WriteOutcome, {state: 'written'}>>();
  const [help, setHelp] = useState(false);
  const busyRef = useRef<Busy>(undefined);
  busyRef.current = busy;

  const sourcePath = resolve(currentDirectory, expandHomeDirectory(source.trim()));
  useEffect(() => {
    let active = true;
    if (source.trim().length === 0) {
      setRunDirectory(undefined);
      return;
    }
    findRun(sourcePath).then(
      directory => {
        if (active) {
          setRunDirectory(directory);
        }
      },
      () => {
        if (active) {
          setRunDirectory(undefined);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [sourcePath, findRun]);
  // Leaving the screen while work runs cancels it.
  useEffect(() => () => busyRef.current?.controller.abort(), []);

  const typing = !browsing && !help && !written && textRows.has(selected);
  useHomeSuspension(busy ? 'busy' : typing ? 'typing' : undefined);

  const options: ReplaceOptions = {search, replacement, regularExpression, attributes: allAttributes ? 'all' : groups};
  const outputParent = runDirectory
    ? defaultOutputParent(sourcePath, runDirectory)
    : output.trim().length > 0 ? resolve(currentDirectory, expandHomeDirectory(output.trim())) : dirname(sourcePath);
  const inputKey = JSON.stringify([sourcePath, options, outputParent]);
  const ready = previewed?.key === inputKey && previewed.result.problems.length === 0;

  const start = (kind: Busy['kind'], run: (signal: AbortSignal) => Promise<void>): void => {
    const controller = new AbortController();
    setBusy({kind, controller});
    setProblems([]);
    setNotice(undefined);
    run(controller.signal).then(
      () => setBusy(undefined),
      error => {
        setBusy(undefined);
        if (controller.signal.aborted) {
          setNotice(kind === 'writing' ? 'Cancelled; nothing was written.' : 'Preview cancelled.');
        } else {
          setProblems([message(error)]);
        }
      },
    );
  };

  const validate = (): string[] => {
    const found: string[] = [];
    if (source.trim().length === 0) {
      found.push('GFF3 file: choose a file.');
    } else if (!pathExists(sourcePath)) {
      found.push(`GFF3 file: ${sourcePath} does not exist.`);
    }
    try {
      compileReplacement(options);
    } catch (error) {
      found.push(`Search: ${error instanceof ReplaceOptionsError ? error.message : message(error)}`);
    }
    if (!allAttributes && groups.length === 0) {
      found.push('Attributes: choose at least one, or all attributes.');
    }
    return found;
  };

  const save = (): void => {
    const found = validate();
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    if (!ready) {
      const key = inputKey;
      start('previewing', async signal => {
        const result = await preview({source: sourcePath, options}, signal);
        setPreviewed({key, result});
        if (result.problems.length > 0) {
          setProblems([...result.problems, ...(result.moreProblems > 0 ? [`${String(result.moreProblems)} more problems.`] : [])]);
        }
      });
      return;
    }
    const expected = previewed.result.sourceSha256;
    start('writing', async signal => {
      const outcome = await write({
        source: sourcePath,
        options,
        expectedSourceSha256: expected,
        outputParent,
        ...(runDirectory ? {runDirectory} : {}),
      }, signal);
      if (outcome.state === 'written') {
        setWritten(outcome);
      } else {
        setPreviewed({key: inputKey, result: outcome.result});
        setProblems(outcome.result.problems);
      }
    });
  };

  const toggle = (row: RowId): void => {
    if (row === 'regex') {
      setRegularExpression(current => !current);
    } else if (row === 'attribute.all') {
      setAllAttributes(current => !current);
    } else if (row.startsWith('attribute.') && !allAttributes) {
      const group = row.slice('attribute.'.length) as AttributeGroup;
      setGroups(current => current.includes(group) ? current.filter(value => value !== group) : [...current, group]);
    }
  };

  // A fixed source and a run's output folder are shown but not selectable.
  const rows = rowOrder.filter(row => !(row === 'source' && sourceFixed) && !(row === 'output' && runDirectory));
  // The output folder stops being selectable once the source turns out to lie in a run.
  useEffect(() => {
    if (!rows.includes(selected)) {
      setSelected('search');
    }
  });
  useInput((input, key) => {
    if (written) {
      if (key.escape) {
        onBack();
      }
      return;
    }
    if (busy) {
      if (key.escape) {
        busy.controller.abort();
      }
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.tab || key.upArrow || key.downArrow) {
      const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      const index = Math.max(0, rows.indexOf(selected));
      setSelected(rows[(index + offset + rows.length) % rows.length]!);
      return;
    }
    if (!typing && input === '?') {
      setHelp(true);
      return;
    }
    if (!textRows.has(selected) && selected !== 'save' && (input === ' ' || key.leftArrow || key.rightArrow)) {
      toggle(selected);
      return;
    }
    if (key.return) {
      if (selected === 'save') {
        save();
      } else if (selected === 'source' || selected === 'output') {
        setBrowsing(selected);
      }
    }
  }, {isActive: inputActive && !browsing && !help});

  if (help) {
    return (
      <MarkdownDocumentPage
        title="Find and replace help"
        load={loadHelp}
        onClose={() => setHelp(false)}
        back="Back to find and replace"
        inputActive={inputActive}
      />
    );
  }

  if (browsing) {
    const current = browsing === 'source' ? sourcePath : outputParent;
    return (
      <PathBrowser
        initialDirectory={browsing === 'source' && source.trim().length === 0 ? currentDirectory : browsing === 'source' ? dirname(current) : current}
        selectFolder={browsing === 'output'}
        title={browsing === 'source' ? 'Select a GFF3 file' : 'Select the output folder'}
        {...(browsing === 'output' ? {intro: 'Each rewrite writes a new folder inside the chosen one.'} : {})}
        onSelect={path => {
          if (browsing === 'source') {
            setSource(path);
          } else {
            setOutput(path);
          }
          setBrowsing(undefined);
        }}
        onCancel={() => setBrowsing(undefined)}
        inputActive={inputActive}
      />
    );
  }

  if (written) {
    const fileRows: ParameterRow[] = [
      {id: 'folder', label: 'Folder', value: written.folder},
      {id: 'gff3', label: 'GFF3', value: written.record.files.gff3.path},
      {id: 'mapping', label: 'ID mapping', value: idMappingFileName},
      {id: 'record', label: 'Record', value: recordFileName},
    ];
    return (
      <Page title="GFF3 rewritten" detail={written.record.files.gff3.path} back="Back">
        <Section title="Files" marginTop={0}>
          <ParameterList rows={fileRows} inputActive={false} />
        </Section>
        <Section title="Statistics">
          <RewriteStatistics result={written.result} />
        </Section>
      </Page>
    );
  }

  const attributeValue = (group: AttributeGroup | 'all'): string => {
    const checked = group === 'all' ? allAttributes : allAttributes || groups.includes(group);
    const detail = group === 'all' ? 'every attribute, without guard rails' : groupDetails[group];
    return `${checked ? '[x]' : '[ ]'}${detail ? ` ${detail}` : ''}`;
  };
  const sourceRow: ParameterRow = sourceFixed
    ? {id: 'source', label: 'GFF3 file', value: sourcePath}
    : {
      id: 'source',
      label: 'GFF3 file',
      value: source.length > 0 ? source : 'Required: type a path, or press Enter to browse',
      muted: source.length === 0,
      edit: {defaultValue: source, placeholder: 'Type or paste a path, or press Enter to browse', onChange: setSource},
    };
  const mainRows: ParameterRow[] = [
    sourceRow,
    {
      id: 'search',
      label: 'Search',
      value: search.length > 0 ? search : 'Required',
      muted: search.length === 0,
      edit: {defaultValue: search, placeholder: regularExpression ? 'A JavaScript regular expression, such as ^AN' : 'The exact text, such as AN', onChange: setSearch},
    },
    {
      id: 'replacement',
      label: 'Replacement',
      value: replacement.length > 0 ? replacement : 'empty: removes the matched text',
      muted: replacement.length === 0,
      edit: {defaultValue: replacement, placeholder: regularExpression ? 'Text, with $1 for a captured group' : 'Inserted exactly as typed', onChange: setReplacement},
    },
    {id: 'regex', label: 'Regular expression', value: regularExpression ? 'yes' : 'no', choice: true},
  ];
  const attributeRows: ParameterRow[] = [
    ...attributeGroups.map(group => ({
      id: `attribute.${group}`,
      label: groupLabels[group],
      value: attributeValue(group),
      muted: allAttributes,
      choice: true,
    })),
    {id: 'attribute.all', label: 'All attributes', value: attributeValue('all'), choice: true},
  ];
  const outputRow: ParameterRow = runDirectory
    ? {id: 'output', label: 'Output folder', value: `${join(runDirectory, derivedFolderName)} (inside the run)`}
    : {
      id: 'output',
      label: 'Output folder',
      value: output.length > 0 ? output : source.trim().length > 0 ? `${dirname(sourcePath)} (next to the file)` : 'next to the GFF3 file',
      muted: output.length === 0,
      edit: {defaultValue: output, placeholder: 'Next to the GFF3 file; type a path, or press Enter to browse', onChange: setOutput},
    };
  const labelWidth = parameterLabelWidth([...mainRows, ...attributeRows, outputRow]);
  const browsable = selected === 'source' || selected === 'output';
  const choiceSelected = selected === 'regex' || selected.startsWith('attribute.');

  return (
    <EditPage
      title="Find and replace in GFF3"
      description="Replaces text in the attribute values of a GFF3 and writes the result to a new folder with an ID mapping and a record. The source file is never changed."
      shortcuts={busy ? [] : [
        'Tab/↑/↓ — Field',
        choiceSelected && 'Space/←/→ — Change',
        browsable && 'Enter — Browse',
        selected === 'save' && `Enter — ${ready ? 'Write' : 'Preview'}`,
        !typing && '? — Help',
      ]}
      back={busy ? 'Cancel' : 'Back'}
      saveLabel={ready ? 'Write rewrite' : 'Preview'}
      saveSelected={selected === 'save'}
      saving={!!busy}
      savingLabel={busy?.kind === 'writing' ? 'Writing the rewrite…' : 'Previewing…'}
      problems={problems}
      problemsTitle={busy || !previewed ? 'Not previewed:' : 'Not written:'}
      after={
        <>
          {notice ? <Alert variant="warning">{sanitizeTerminalText(notice)}</Alert> : null}
          {previewed?.key === inputKey ? (
            <Section title={ready ? 'Preview: written like this' : 'Preview'}>
              <RewriteStatistics result={previewed.result} />
            </Section>
          ) : null}
        </>
      }
    >
      <Alert variant="info">
        Sequence IDs in column 1 must match the FASTA headers, so they are never changed; only attribute values in column 9 are.
      </Alert>
      <Box marginTop={1} flexDirection="column">
        <ParameterList rows={mainRows} selectedId={selected} inputActive={inputActive && !busy} labelWidth={labelWidth} />
      </Box>
      <Section title="Attributes searched">
        <ParameterList rows={attributeRows} selectedId={selected} inputActive={inputActive && !busy} labelWidth={labelWidth} />
      </Section>
      <Box marginTop={1} flexDirection="column">
        <ParameterList rows={[outputRow]} selectedId={selected} inputActive={inputActive && !busy} labelWidth={labelWidth} />
      </Box>
    </EditPage>
  );
}
