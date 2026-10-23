import {randomUUID} from 'node:crypto';
import React, {useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {IsolateCatalogValidationError, readPairs, suggestIsolateId, suggestLibraryId, validateIsolateCatalog, type Isolate, type IsolateCatalog, type ReadSet} from '../../isolates/catalog.js';
import {createIlluminaReadSet} from '../../isolates/illumina/metadata.js';
import {isolateTechnique} from '../../isolates/presentation.js';
import type {ReadPairsChecker} from '../../isolates/reads.js';
import type {DirectoryReader} from '../components/path-browser.js';
import {expandHomeDirectory, PathField} from '../components/path-field.js';
import {TextField} from '../components/text-field.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {EditPage} from '../components/page.js';
import {Section} from '../components/section.js';
import {isolateDocumentNames, readGeneralDocuments, type DocumentsLoader} from '../../docs/documents.js';
import {MarkdownDocumentPage} from '../components/markdown-document-page.js';

export function withIsolate(catalog: IsolateCatalog, isolate: Isolate, replacesId?: string): IsolateCatalog {
  return {...catalog, isolates: replacesId === undefined || !catalog.isolates.some(entry => entry.id === replacesId)
    ? [...catalog.isolates, isolate]
    : catalog.isolates.map(entry => entry.id === replacesId ? isolate : entry)};
}

function newReadSet(): ReadSet {
  return createIlluminaReadSet({id: `reads-${randomUUID()}`, name: '', library_id: '',
    read_pairs: [{r1: '', r2: '', trimmed: null}]});
}

type Row = {
  id: string;
  label: string;
  kind: 'text' | 'path' | 'choice' | 'button';
  section?: string;
  pair?: number;
  value?: string;
  change?: (value: string) => void;
  options?: string[];
  activate?: () => void;
};

export function IsolateForm({catalog, editing, onSubmit, onCancel, checkReads, inputActive, currentDirectory, readDirectory,
  loadHelp = () => readGeneralDocuments(isolateDocumentNames)}: {
  catalog: IsolateCatalog;
  editing?: Isolate;
  onSubmit: (isolate: Isolate) => Promise<void>;
  onCancel: () => void;
  checkReads: ReadPairsChecker;
  inputActive: boolean;
  currentDirectory: string;
  readDirectory?: DirectoryReader;
  loadHelp?: DocumentsLoader;
}): React.JSX.Element {
  const {rows: terminalRows, columns} = useWindowSize();
  const [name, setName] = useState(editing?.name ?? '');
  const [id, setId] = useState(editing?.id ?? '');
  const [idEdited, setIdEdited] = useState(Boolean(editing));
  const [description, setDescription] = useState(editing?.description ?? '');
  const [wildtype, setWildtype] = useState(editing?.wildtype === null || !editing ? 'unknown' : String(editing.wildtype));
  const [parent, setParent] = useState(editing?.derived_from ?? '');
  const [sets, setSets] = useState<ReadSet[]>(() => editing ? structuredClone(editing.read_sets) : [newReadSet()]);
  const [fixedLibraries, setFixedLibraries] = useState(() => new Set(editing?.read_sets.map(set => set.id) ?? []));
  const [selectedId, setSelectedId] = useState('name');
  const [browsing, setBrowsing] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const effectiveId = idEdited ? id : suggestIsolateId(name, catalog.isolates.map(entry => entry.id));
  const usedLibraries = new Set(sets.filter(set => fixedLibraries.has(set.id)).map(set => set.library_id));
  const readSets = sets.map(set => {
    if (fixedLibraries.has(set.id)) {
      return set;
    }
    const libraryId = suggestLibraryId(effectiveId, usedLibraries);
    usedLibraries.add(libraryId);
    return {...set, library_id: libraryId};
  });
  const updateSet = (setId: string, change: (entry: ReadSet) => ReadSet): void => {
    setSets(current => current.map(entry => entry.id === setId ? change(entry) : entry));
  };

  const submit = async (): Promise<void> => {
    setProblems([]);
    const isolate: Isolate = {
      id: effectiveId, name: name.trim(), ...(description.trim() ? {description: description.trim()} : {}),
      wildtype: wildtype === 'unknown' ? null : wildtype === 'true', derived_from: parent || null,
      read_sets: readSets.map(entry => ({...entry, name: entry.name.trim(), library_id: entry.library_id.trim(),
        read_pairs: entry.read_pairs.map(pair => ({...pair,
          r1: expandHomeDirectory(pair.r1.trim()), r2: expandHomeDirectory(pair.r2.trim())}))})),
    };
    try {
      validateIsolateCatalog(withIsolate(catalog, isolate, editing?.id));
      setSaving(true);
      const checks = await checkReads(readPairs(isolate));
      const errors = checks.pairs.flatMap((pair, index) => (['r1', 'r2'] as const).flatMap(mate =>
        pair[mate].state === 'ok' ? [] : [`Pair ${index + 1} ${mate}: ${pair[mate].reason}`]));
      errors.push(...checks.sameFiles.map(pair => `${pair.second}: same file as ${pair.first}`));
      if (errors.length > 0) {
        setProblems(errors);
      } else {
        await onSubmit(isolate);
      }
    } catch (error) {
      setProblems(error instanceof IsolateCatalogValidationError
        ? error.issues.map(issue => `${issue.message} (${issue.path})`)
        : [error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  const rows: Row[] = [
    {id: 'name', label: 'Name', kind: 'text', value: name, change: setName},
    ...(!editing ? [{id: 'id', label: 'ID', kind: 'text' as const, value: effectiveId,
      change: (value: string) => {setIdEdited(true); setId(value);}}] : []),
    {id: 'description', label: 'Description', kind: 'text', value: description, change: setDescription},
    {id: 'wildtype', label: 'Wild type', kind: 'choice', value: wildtype, options: ['unknown', 'true', 'false'], change: setWildtype},
    {id: 'parent', label: 'Derived from', kind: 'choice', value: parent,
      options: ['', ...catalog.isolates.filter(entry => entry.id !== editing?.id).map(entry => entry.id)], change: setParent},
  ];
  rows.forEach(row => {row.section = 'isolate';});
  readSets.forEach(entry => {
    const prefix = entry.id;
    const section = `read-set:${prefix}`;
    const sectionRows: Row[] = [];
    sectionRows.push(
      {id: `${prefix}:name`, label: 'Name', kind: 'text', value: entry.name,
        change: value => updateSet(prefix, current => ({...current, name: value}))},
      {id: `${prefix}:library`, label: 'Library ID', kind: 'text', value: entry.library_id,
        change: value => {
          setFixedLibraries(current => new Set(current).add(prefix));
          updateSet(prefix, current => ({...current, library_id: value}));
        }},
      {id: `${prefix}:chemistry`, label: 'Chemistry', kind: 'choice', value: entry.illumina.chemistry,
        options: ['two-colour', 'four-colour', 'one-channel', 'unknown'],
        change: value => updateSet(prefix, current => ({...current, illumina: {...current.illumina, chemistry: value as ReadSet['illumina']['chemistry']}}))},
      {id: `${prefix}:poly-g`, label: 'Poly-G', kind: 'choice', value: entry.illumina.poly_g,
        options: ['auto', 'on', 'off'],
        change: value => updateSet(prefix, current => ({...current, illumina: {...current.illumina, poly_g: value as ReadSet['illumina']['poly_g']}}))},
    );
    entry.read_pairs.forEach((pair, pairIndex) => {
      for (const mate of ['r1', 'r2'] as const) {
        sectionRows.push({id: `${prefix}:${pairIndex}:${mate}`, label: mate.toUpperCase(), pair: pairIndex,
          kind: 'path', value: pair[mate], change: value => updateSet(prefix, current => ({...current,
            read_pairs: current.read_pairs.map((item, index) => index === pairIndex ? {...item, [mate]: value} : item)}))});
      }
      sectionRows.push({id: `${prefix}:${pairIndex}:processing`, label: 'Provider trimmed', pair: pairIndex,
        kind: 'choice', value: pair.trimmed === null ? 'unknown' : pair.trimmed ? 'yes' : 'no',
        options: ['unknown', 'yes', 'no'], change: value => updateSet(prefix, current => ({...current,
          read_pairs: current.read_pairs.map((item, index) => index === pairIndex
            ? {...item, trimmed: value === 'unknown' ? null : value === 'yes'} : item)}))});
      if (entry.read_pairs.length > 1) {
        sectionRows.push({id: `${prefix}:${pairIndex}:remove`, label: `Remove pair ${pairIndex + 1}`, pair: pairIndex, kind: 'button',
          activate: () => {updateSet(prefix, current => ({...current, read_pairs: current.read_pairs.filter((_, index) => index !== pairIndex)})); setSelectedId(`${prefix}:name`);}});
      }
    });
    sectionRows.push({id: `${prefix}:add-pair`, label: 'Add read pair to this set', kind: 'button',
      activate: () => updateSet(prefix, current => ({...current, read_pairs: [...current.read_pairs, {r1: '', r2: '', trimmed: null}]}))});
    if (sets.length > 1) {
      sectionRows.push({id: `${prefix}:remove`, label: 'Remove this read set', kind: 'button',
        activate: () => {setSets(current => current.filter(item => item.id !== prefix)); setSelectedId('name');}});
    }
    rows.push(...sectionRows.map(row => ({...row, section})));
  });
  rows.push({id: 'add-set', label: 'Add paired set', kind: 'button', activate: () => {
    const entry = newReadSet();
    setSets(current => [...current, entry]);
    setSelectedId(`${entry.id}:name`);
  }}, {id: 'save', label: 'Save isolate', kind: 'button', activate: () => {void submit();}});
  const selectedIndex = Math.max(0, rows.findIndex(row => row.id === selectedId));
  const selected = rows[selectedIndex];
  const typing = selected?.kind === 'text' || selected?.kind === 'path';
  useHomeSuspension(showHelp ? undefined : saving ? 'busy' : typing ? 'typing' : undefined);
  useInput((input, key) => {
    if (saving || browsing || showHelp) {
      return;
    }
    if (input === '?' && !typing) {
      setShowHelp(true);
      return;
    }
    if (key.escape) {
      onCancel();
    } else if (key.tab || key.upArrow || key.downArrow) {
      const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      setSelectedId(rows[(selectedIndex + offset + rows.length) % rows.length]?.id ?? 'name');
    } else if (selected?.kind === 'choice' && (input === ' ' || key.leftArrow || key.rightArrow)) {
      const options = selected.options ?? [];
      const index = options.indexOf(selected.value ?? '');
      selected.change?.(options[(index + (key.leftArrow ? -1 : 1) + options.length) % options.length] ?? '');
    } else if (key.return && selected?.kind === 'button') {
      selected.activate?.();
    }
  }, {isActive: inputActive});

  const render = (row: Row): React.JSX.Element => {
    const active = row.id === selected?.id;
    if (row.kind === 'path') {
      return <PathField key={row.id} label={row.label} required selected={active} inputActive={inputActive && !saving}
        value={row.value ?? ''} onChange={value => row.change?.(value)} browsing={browsing === row.id}
        onBrowsingChange={open => setBrowsing(open ? row.id : undefined)} startDirectory={currentDirectory} readDirectory={readDirectory} />;
    }
    if (row.kind === 'text') {
      return <TextField key={row.id} label={row.label} selected={active} inputActive={inputActive && !saving}
        defaultValue={row.value ?? ''} displayValue={row.value ?? ''} onChange={value => row.change?.(value)} />;
    }
    const content = <Text key={row.id} color={active ? 'cyan' : undefined} wrap="truncate">
      {active ? '› ' : '  '}{row.kind === 'button' ? `[ ${sanitizeTerminalText(row.label)} ]` : sanitizeTerminalText(row.label)}
      {row.kind === 'choice' ? `: ‹ ${sanitizeTerminalText(row.value || 'none')} ›` : ''}
    </Text>;
    return row.kind === 'button' && row.section?.startsWith('read-set:')
      ? <Box key={row.id} paddingY={readSetButtonPadding}>{content}</Box> : content;
  };
  // Bound the error preview too: a rejected catalog can contain hundreds of issues.
  const problemWidth = Math.max(1, columns - 6);
  const shownProblems = problems.slice(0, 2).map(problem => {
    const text = sanitizeTerminalText(problem).replace(/\s+/g, ' ');
    let preview = '';
    let width = 0;
    for (const character of text) {
      // Conservatively budget non-ASCII characters as wide terminal cells.
      width += character.codePointAt(0)! > 127 ? 2 : 1;
      if (width > problemWidth * 2 - 2) {
        return `${preview}…`;
      }
      preview += character;
    }
    return preview;
  });
  if (problems.length > shownProblems.length) {
    shownProblems.push(`${problems.length - shownProblems.length} more; fix these first.`);
  }
  const problemLines = shownProblems.length > 0
    ? 5 + shownProblems.reduce((count, problem) => count + Math.ceil(
      Array.from(problem).reduce((width, character) => width + (character.codePointAt(0)! > 127 ? 2 : 1), 0) / problemWidth), 0)
    : 0;
  // Reserve the title, save action, scroll indicator, wrapped shortcuts, and error preview.
  const availableLines = Math.max(selected?.section === 'isolate' || selected?.pair !== undefined ? 5 : 4,
    terminalRows - 8 - Math.ceil(110 / Math.max(1, columns)) - problemLines);
  const readSetButtonPadding = availableLines >= 7 ? 1 : 0;
  const fields = rows.filter(row => row.id !== 'save');
  const rangeHeight = (start: number, end: number): number => {
    let height = 0;
    for (let index = start; index < end; index++) {
      const newSection = index === start || fields[index]?.section !== fields[index - 1]?.section;
      if (newSection) {
        height += (index > start ? 1 : 0) + (fields[index]?.section ? 1 : 0);
        if (fields[index]?.section === 'isolate') {
          height++;
        }
      }
      if (newSection || fields[index]?.pair !== fields[index - 1]?.pair) {
        height += (!newSection ? 1 : 0) + (fields[index]?.pair !== undefined ? 1 : 0);
      }
      height += 1 + (fields[index]?.kind === 'button' && fields[index]?.section?.startsWith('read-set:')
        ? 2 * readSetButtonPadding : 0);
    }
    return height;
  };
  const focusedIndex = Math.min(selectedIndex, fields.length - 1);
  let visibleStart = focusedIndex;
  let visibleEnd = focusedIndex + 1;
  while (visibleStart > Math.max(0, focusedIndex - 2) && rangeHeight(visibleStart - 1, visibleEnd) <= availableLines) {
    visibleStart--;
  }
  while (visibleEnd < fields.length && rangeHeight(visibleStart, visibleEnd + 1) <= availableLines) {
    visibleEnd++;
  }
  while (visibleStart > 0 && rangeHeight(visibleStart - 1, visibleEnd) <= availableLines) {
    visibleStart--;
  }
  const visibleRows = fields.slice(visibleStart, visibleEnd);
  const isolateFields = visibleRows.filter(row => row.section === 'isolate');
  const readSetSections = readSets.flatMap((entry, setIndex) => {
    const setRows = visibleRows.filter(row => row.section === `read-set:${entry.id}`);
    if (setRows.length === 0) {
      return [];
    }
    return [{
      id: entry.id,
      title: `Read set ${setIndex + 1}${entry.name ? ` · ${entry.name}` : ''}`,
      fields: setRows.filter(row => row.pair === undefined && row.kind !== 'button'),
      pairs: entry.read_pairs.flatMap((_pair, pairIndex) => {
        const pairRows = setRows.filter(row => row.pair === pairIndex);
        return pairRows.length > 0 ? [{index: pairIndex, rows: pairRows}] : [];
      }),
      actions: setRows.filter(row => row.pair === undefined && row.kind === 'button'),
    }];
  });
  const formActions = visibleRows.filter(row => row.section === undefined);
  const windowed = visibleStart > 0 || visibleEnd < fields.length;

  if (showHelp) {
    return <MarkdownDocumentPage title="Managing isolates" load={loadHelp}
      onClose={() => setShowHelp(false)} back="Close help" inputActive={inputActive} />;
  }
  const browser = rows.find(row => row.id === browsing);
  if (browser) {
    return render(browser);
  }
  return <EditPage title={editing ? `Edit isolate ${editing.id}` : 'New isolate'}
    shortcuts={['Tab/↑/↓ — Field', selected?.kind === 'choice' ? 'Space/←/→ — Change' : 'Enter — Activate button or browse', !typing && '? — Help']}
    back="Cancel" saveLabel="Save isolate" saveSelected={selected?.id === 'save'} saving={saving}
    problems={shownProblems}>
    {isolateFields.length > 0 ? (
      <Section title="Isolate details" marginTop={0}>
        <Text wrap="truncate">  Technique: <Text bold>{sanitizeTerminalText(isolateTechnique({read_sets: readSets}))}</Text></Text>
        {isolateFields.map(render)}
      </Section>
    ) : null}
    {readSetSections.map((readSet, setIndex) => (
      <Section key={readSet.id} title={readSet.title} marginTop={isolateFields.length > 0 || setIndex > 0 ? 1 : 0}>
        {readSet.fields.map(render)}
        {readSet.pairs.map((pair, pairIndex) => (
          <Section key={pair.index} title={`Pair ${pair.index + 1}`} marginTop={readSet.fields.length > 0 || pairIndex > 0 ? 1 : 0}>
            {pair.rows.map(render)}
          </Section>
        ))}
        {readSet.actions.length > 0 ? (
          <Box flexDirection="column" marginTop={readSet.fields.length > 0 || readSet.pairs.length > 0 ? 1 : 0}>
            {readSet.actions.map(render)}
          </Box>
        ) : null}
      </Section>
    ))}
    {formActions.length > 0 ? (
      <Box flexDirection="column" marginTop={isolateFields.length > 0 || readSetSections.length > 0 ? 1 : 0}>
        {formActions.map(render)}
      </Box>
    ) : null}
    {windowed ? <Text wrap="truncate">
      {visibleStart > 0 ? '↑ ' : ''}{visibleStart + 1}–{visibleEnd} / {fields.length}
      {visibleEnd < fields.length ? ' ↓' : ''}
    </Text> : null}
  </EditPage>;
}
