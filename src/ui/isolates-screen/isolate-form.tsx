import {dirname, isAbsolute} from 'node:path';
import React, {useCallback, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  IsolateCatalogValidationError,
  suggestIsolateId,
  validateIsolateCatalog,
  type Isolate,
  type IsolateCatalog,
} from '../../isolates/catalog.js';
import type {ReadFileCheck, ReadPairsChecker} from '../../isolates/reads.js';
import {PathBrowser, type DirectoryReader} from '../new-run-screen/path-browser.js';
import {TextField} from '../new-run-screen/text-field.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

type Mate = 'r1' | 'r2';

/** A read pair being edited; `key` stays stable while pairs are added and removed. */
type PairDraft = {key: number; r1: string; r2: string; trimmed: boolean};

type Values = {
  name: string;
  id: string;
  description: string;
  wildtype: '' | 'true' | 'false';
  derived_from: string;
};

type Row =
  | {id: string; kind: 'text'; field: 'name' | 'id' | 'description'}
  | {id: string; kind: 'choice'; field: 'wildtype' | 'derived_from'}
  | {id: string; kind: 'mate'; pair: PairDraft; index: number; mate: Mate}
  | {id: string; kind: 'trimmed'; pair: PairDraft; index: number}
  | {id: string; kind: 'remove-pair'; pair: PairDraft; index: number}
  | {id: string; kind: 'add-pair'}
  | {id: string; kind: 'save'};

const fieldLabels: Record<string, string> = {
  id: 'ID',
  name: 'Name',
  description: 'Description',
  wildtype: 'Wild type',
  derived_from: 'Derived from',
  read_pairs: 'Read pairs',
};

function initialValues(isolate: Isolate | undefined): Values {
  return {
    name: isolate?.name ?? '',
    id: isolate?.id ?? '',
    description: isolate?.description ?? '',
    wildtype: isolate === undefined ? '' : isolate.wildtype ? 'true' : 'false',
    derived_from: isolate?.derived_from ?? '',
  };
}

/** Turns a catalog issue path such as `read_pairs[1].r2` into a researcher-facing field name. */
function fieldLabel(field: string): string {
  const pair = /^read_pairs\[(\d+)\](?:\.(r1|r2|trimmed))?$/.exec(field);
  if (pair) {
    const number = Number(pair[1]) + 1;
    const part = pair[2] === 'trimmed' ? ' trimmed' : pair[2] ? ` ${pair[2].toUpperCase()}` : '';
    return `Pair ${String(number)}${part}`;
  }
  return fieldLabels[field] ?? field;
}

function readProblem(label: string, check: ReadFileCheck | undefined): string | undefined {
  return !check || check.state === 'ok' ? undefined : `${label}: ${check.reason}`;
}

/** Replaces the isolate with the same ID, or appends a new one. */
export function withIsolate(catalog: IsolateCatalog, isolate: Isolate, replacesId?: string): IsolateCatalog {
  const index = replacesId === undefined
    ? -1
    : catalog.isolates.findIndex(candidate => candidate.id === replacesId);
  const isolates = index < 0
    ? [...catalog.isolates, isolate]
    : catalog.isolates.map((candidate, candidateIndex) => candidateIndex === index ? isolate : candidate);
  return {...catalog, isolates};
}

export function IsolateForm({
  catalog,
  editing,
  onSubmit,
  onCancel,
  checkReads,
  inputActive,
  currentDirectory,
  readDirectory,
}: {
  catalog: IsolateCatalog;
  /** The isolate being edited; undefined when creating one. Its ID stays fixed. */
  editing?: Isolate;
  onSubmit: (isolate: Isolate) => Promise<void>;
  onCancel: () => void;
  checkReads: ReadPairsChecker;
  inputActive: boolean;
  currentDirectory: string;
  readDirectory?: DirectoryReader;
}): React.JSX.Element {
  const creating = editing === undefined;
  const nextPairKey = useRef(0);
  const newPair = (pair?: Omit<PairDraft, 'key'>): PairDraft => {
    nextPairKey.current += 1;
    return {key: nextPairKey.current, r1: '', r2: '', trimmed: false, ...pair};
  };
  const [values, setValues] = useState<Values>(() => initialValues(editing));
  const [pairs, setPairs] = useState<PairDraft[]>(() =>
    editing ? editing.read_pairs.map(pair => newPair(pair)) : [newPair()],
  );
  const [idEdited, setIdEdited] = useState(!creating);
  const [selectedRowId, setSelectedRowId] = useState('name');
  const [browsing, setBrowsing] = useState<{pairKey: number; mate: Mate}>();
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const existingIds = catalog.isolates.map(isolate => isolate.id);
  const effectiveId = idEdited ? values.id : suggestIsolateId(values.name, existingIds);
  const parentOptions = [
    '',
    ...catalog.isolates.map(isolate => isolate.id).filter(id => id !== editing?.id),
  ];

  const rows: Row[] = [
    {id: 'name', kind: 'text', field: 'name'},
    ...(creating ? [{id: 'id', kind: 'text', field: 'id'} as const] : []),
    {id: 'description', kind: 'text', field: 'description'},
    {id: 'wildtype', kind: 'choice', field: 'wildtype'},
    {id: 'derived_from', kind: 'choice', field: 'derived_from'},
    ...pairs.flatMap((pair, index): Row[] => [
      {id: `pair:${String(pair.key)}:r1`, kind: 'mate', pair, index, mate: 'r1'},
      {id: `pair:${String(pair.key)}:r2`, kind: 'mate', pair, index, mate: 'r2'},
      {id: `pair:${String(pair.key)}:trimmed`, kind: 'trimmed', pair, index},
      ...(pairs.length > 1
        ? [{id: `pair:${String(pair.key)}:remove`, kind: 'remove-pair', pair, index} as const]
        : []),
    ]),
    {id: 'add-pair', kind: 'add-pair'},
    {id: 'save', kind: 'save'},
  ];
  const selectedIndex = Math.max(0, rows.findIndex(row => row.id === selectedRowId));
  const selectedRow = rows[selectedIndex] ?? rows[0];
  const typing = selectedRow?.kind === 'text' || selectedRow?.kind === 'mate';

  useHomeSuspension(submitting ? 'busy' : !browsing && typing ? 'typing' : undefined);

  // TextInput re-fires onChange whenever its callback reference changes, so each field keeps one
  // stable callback (see WorkflowConfigurationScreen).
  const onChangeCache = useRef(new Map<string, (value: string) => void>());
  const onChangeFor = useCallback((rowId: string, apply: (value: string) => void): ((value: string) => void) => {
    let cached = onChangeCache.current.get(rowId);
    if (!cached) {
      cached = apply;
      onChangeCache.current.set(rowId, cached);
    }
    return cached;
  }, []);

  const updatePair = (key: number, change: Partial<Omit<PairDraft, 'key'>>): void => {
    setPairs(current => current.map(pair => pair.key === key ? {...pair, ...change} : pair));
  };

  const moveRow = (offset: -1 | 1): void => {
    setSelectedRowId(rows[(selectedIndex + offset + rows.length) % rows.length]?.id ?? 'name');
  };

  const cycleChoice = (field: 'wildtype' | 'derived_from', offset: -1 | 1): void => {
    const options = field === 'wildtype' ? ['true', 'false'] : parentOptions;
    const index = options.indexOf(values[field]);
    const next = index < 0
      ? options[offset === 1 ? 0 : options.length - 1]
      : options[(index + offset + options.length) % options.length];
    setValues(current => ({...current, [field]: next ?? ''}));
  };

  const submit = async (): Promise<void> => {
    const missing: string[] = [];
    if (values.name.trim().length === 0) {
      missing.push('Name: is required');
    }
    if (values.wildtype === '') {
      missing.push('Wild type: choose yes or no');
    }
    pairs.forEach((pair, index) => {
      for (const mate of ['r1', 'r2'] as const) {
        if (pair[mate].trim().length === 0) {
          missing.push(`Pair ${String(index + 1)} ${mate.toUpperCase()}: is required`);
        }
      }
    });
    if (missing.length > 0) {
      setProblems(missing);
      return;
    }
    const description = values.description.trim();
    const isolate: Isolate = {
      id: creating ? effectiveId : editing.id,
      name: values.name.trim(),
      ...(description.length > 0 ? {description} : {}),
      wildtype: values.wildtype === 'true',
      derived_from: values.derived_from === '' ? null : values.derived_from,
      read_pairs: pairs.map(pair => ({r1: pair.r1.trim(), r2: pair.r2.trim(), trimmed: pair.trimmed})),
    };

    const candidate = withIsolate(catalog, isolate, editing?.id);
    const index = candidate.isolates.indexOf(isolate);
    try {
      validateIsolateCatalog(candidate);
    } catch (error) {
      if (!(error instanceof IsolateCatalogValidationError)) {
        setProblems([error instanceof Error ? error.message : String(error)]);
        return;
      }
      const prefix = `$.isolates[${String(index)}].`;
      setProblems(error.issues.map(issue => {
        const field = issue.path.startsWith(prefix) ? issue.path.slice(prefix.length) : issue.path;
        return `${fieldLabel(field)}: ${issue.message}`;
      }));
      return;
    }

    setSubmitting(true);
    setProblems([]);
    try {
      const reads = await checkReads(isolate.read_pairs);
      const readProblems = reads.pairs
        .flatMap((check, pairIndex) => [
          readProblem(`Pair ${String(pairIndex + 1)} R1`, check.r1),
          readProblem(`Pair ${String(pairIndex + 1)} R2`, check.r2),
        ])
        .filter((problem): problem is string => problem !== undefined);
      for (const {first, second} of reads.sameFiles) {
        readProblems.push(`${second}: is the same file as ${first}`);
      }
      if (readProblems.length > 0) {
        setProblems(readProblems);
        setSubmitting(false);
        return;
      }
      await onSubmit(isolate);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : String(error)]);
      setSubmitting(false);
    }
  };

  useInput(
    (input, key) => {
      if (browsing || submitting || !selectedRow) {
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.tab) {
        moveRow(key.shift ? -1 : 1);
        return;
      }
      if (key.upArrow || key.downArrow) {
        moveRow(key.upArrow ? -1 : 1);
        return;
      }
      const change = input === ' ' || key.rightArrow ? 1 : key.leftArrow ? -1 : undefined;
      if (change !== undefined && selectedRow.kind === 'choice') {
        cycleChoice(selectedRow.field, change);
        return;
      }
      if (change !== undefined && selectedRow.kind === 'trimmed') {
        updatePair(selectedRow.pair.key, {trimmed: !selectedRow.pair.trimmed});
        return;
      }
      if (!key.return) {
        return;
      }
      switch (selectedRow.kind) {
        case 'mate':
          setBrowsing({pairKey: selectedRow.pair.key, mate: selectedRow.mate});
          return;
        case 'add-pair': {
          const pair = newPair();
          setPairs(current => [...current, pair]);
          setSelectedRowId(`pair:${String(pair.key)}:r1`);
          return;
        }
        case 'remove-pair': {
          const following = pairs[selectedRow.index + 1] ?? pairs[selectedRow.index - 1];
          setPairs(current => current.filter(pair => pair.key !== selectedRow.pair.key));
          setSelectedRowId(following ? `pair:${String(following.key)}:r1` : 'add-pair');
          return;
        }
        case 'save':
          void submit();
          return;
        default:
          moveRow(1);
      }
    },
    {isActive: inputActive},
  );

  if (browsing) {
    const current = pairs.find(pair => pair.key === browsing.pairKey)?.[browsing.mate].trim() ?? '';
    return (
      <PathBrowser
        initialDirectory={isAbsolute(current) ? dirname(current) : currentDirectory}
        onSelect={path => {
          updatePair(browsing.pairKey, {[browsing.mate]: path});
          setBrowsing(undefined);
        }}
        onCancel={() => setBrowsing(undefined)}
        inputActive={inputActive}
        readDirectory={readDirectory}
      />
    );
  }

  const marker = (row: Row): string => row.id === selectedRow?.id ? '› ' : '  ';
  const color = (row: Row): string | undefined => row.id === selectedRow?.id ? 'cyan' : undefined;
  const parent = catalog.isolates.find(isolate => isolate.id === values.derived_from);

  const renderRow = (row: Row): React.JSX.Element => {
    switch (row.kind) {
      case 'text': {
        const value = row.field === 'id' ? effectiveId : values[row.field];
        const idHint = row.field === 'id' && !idEdited && row.id !== selectedRow?.id;
        return (
          <React.Fragment key={row.id}>
            <TextField
              label={fieldLabels[row.field] ?? row.field}
              required={row.field !== 'description'}
              selected={row.id === selectedRow?.id}
              inputActive={inputActive && !submitting}
              defaultValue={value}
              displayValue={value}
              onChange={onChangeFor(row.id, text => {
                if (row.field === 'id') {
                  setIdEdited(true);
                }
                setValues(current => ({...current, [row.field]: text}));
              })}
            />
            {idHint ? (
              <Text color={mutedColor}>{'  '}ID is suggested from the name and fixed after saving.</Text>
            ) : null}
          </React.Fragment>
        );
      }
      case 'choice': {
        const display = row.field === 'wildtype'
          ? values.wildtype === '' ? 'not set' : values.wildtype === 'true' ? 'yes' : 'no'
          : values.derived_from === '' ? 'none' : `${parent?.name ?? ''} (${values.derived_from})`;
        return (
          <Text key={row.id} color={color(row)} wrap="truncate">
            {marker(row)}{fieldLabels[row.field]}{row.field === 'wildtype' ? '*' : ''}: ‹ {sanitizeTerminalText(display)} ›
          </Text>
        );
      }
      case 'mate': {
        const header = row.mate === 'r1' ? (
          <Box key={`${row.id}:header`} marginTop={1}>
            <Text bold>Read pair {row.index + 1}</Text>
          </Box>
        ) : null;
        return (
          <React.Fragment key={row.id}>
            {header}
            <TextField
              label={row.mate.toUpperCase()}
              required
              selected={row.id === selectedRow?.id}
              inputActive={inputActive && !submitting}
              defaultValue={row.pair[row.mate]}
              displayValue={row.pair[row.mate]}
              placeholder="Type or paste an absolute path"
              onChange={onChangeFor(row.id, text => updatePair(row.pair.key, {[row.mate]: text}))}
            />
          </React.Fragment>
        );
      }
      case 'trimmed':
        return (
          <Text key={row.id} color={color(row)} wrap="truncate">
            {marker(row)}Already trimmed: ‹ {row.pair.trimmed ? 'yes' : 'no'} ›
          </Text>
        );
      case 'remove-pair':
        return (
          <Text key={row.id} color={color(row)}>{marker(row)}[ Remove read pair {row.index + 1} ]</Text>
        );
      case 'add-pair':
        return (
          <Box key={row.id} marginTop={1}>
            <Text color={color(row)}>{marker(row)}[ Add read pair ]</Text>
          </Box>
        );
      case 'save':
        return (
          <Text key={row.id} color={color(row)} bold={row.id === selectedRow?.id}>{marker(row)}[ Save isolate ]</Text>
        );
    }
  };

  const hint = (() => {
    switch (selectedRow?.kind) {
      case 'mate':
        return 'Enter — Browse for file';
      case 'choice':
      case 'trimmed':
        return 'Space/←/→ — Change · Enter — Next field';
      case 'add-pair':
        return 'Enter — Add read pair';
      case 'remove-pair':
        return 'Enter — Remove this read pair';
      case 'save':
        return 'Enter — Save';
      default:
        return 'Enter — Next field';
    }
  })();

  return (
    <Box flexDirection="column">
      <Text bold>{creating ? 'New isolate' : `Edit isolate ${sanitizeTerminalText(editing.id)}`}</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map(renderRow)}
      </Box>
      {submitting ? <Text>Checking reads and saving…</Text> : null}
      {problems.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Not saved:</Text>
          {problems.map(problem => (
            <Text key={problem} wrap="wrap">• {sanitizeTerminalText(problem)}</Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={mutedColor} wrap="wrap">
          Add one read pair per lane or sequencing run. Prefer untrimmed reads; mark pairs that the
          provider already trimmed or filtered.
        </Text>
        <Text color={mutedColor} wrap="wrap">Tab/↑/↓ — Field · {hint} · Esc — Cancel</Text>
      </Box>
    </Box>
  );
}
