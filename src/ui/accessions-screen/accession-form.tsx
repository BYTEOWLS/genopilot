import {sameReference, type GenomeReference, type GenomeProviderRegistry, type GenomeDownloadProgress, type FileKind} from '../../accessions/provider.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import {Alert, ProgressBar} from '@inkjs/ui';
import {formatBytes} from '../../workflows/systems-check.js';
import type {ScannedCopy} from '../../accessions/cache-discovery.js';
import {
  recordedCacheState,
  type AccessionCatalog,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import {EditPage, SaveButton} from '../components/page.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {metadataSections} from './metadata-summary.js';
import {ParameterList, parameterLabelWidth, type ParameterRow} from '../components/parameter-list.js';
import {Section} from '../components/section.js';
import {CheckboxGroup} from '../components/checkbox-group.js';
import {formatLocalDateTime} from '../utils.js';
import {readProviderDocuments, type DocumentsLoader} from '../../docs/documents.js';
import {MarkdownDocumentPage} from '../components/markdown-document-page.js';

type DetailRow = 'name' | 'description' | 'download' | 'refresh' | `artifact.${FileKind}` | `option.${string}` | 'metadata' | 'save';

export type AccessionMessage = {text: string; variant: 'info' | 'warning' | 'error'};

/** The researcher-editable part of an entry; provider facts and cached copies are read-only. */
export type LocalAccessionFields = Pick<AccessionEntry, 'name' | 'description'>;

export function localFields(name: string, description: string): LocalAccessionFields {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  return {
    ...(trimmedName.length > 0 ? {name: trimmedName} : {}),
    ...(trimmedDescription.length > 0 ? {description: trimmedDescription} : {}),
  };
}

/** Replaces only the local name and description of an existing entry. */
export function withLocalFields(
  catalog: AccessionCatalog,
  reference: GenomeReference,
  fields: LocalAccessionFields,
): AccessionCatalog {
  return {
    ...catalog,
    accessions: catalog.accessions.map(entry => {
      if (!sameReference(entry, reference)) {
        return entry;
      }
      const {name: _name, description: _description, ...facts} = entry;
      return {...facts, ...fields};
    }),
  };
}

/** Shared genome details: edit catalog labels, or confirm a download after reviewing metadata. */
export function AccessionForm({editing, registry, onSubmit, onCancel, inputActive, unverifiedCopies = [], downloadRoot, onSaveMetadata, progress, downloadArtifacts = [], onArtifactsChange, onReferenceChange, onDownload, onRefreshMetadata, onCancelMetadataRefresh, message, loadHelp = () => readProviderDocuments(registry.get(editing.source))}: {
  editing: AccessionEntry;
  loadHelp?: DocumentsLoader;
  /** A destination switches this form to read-only metadata review with a Download action. */
  downloadRoot?: string;
  onSaveMetadata?: (entry: AccessionEntry) => Promise<void>;
  downloadArtifacts?: readonly FileKind[];
  onArtifactsChange?: (kinds: readonly FileKind[]) => void;
  onReferenceChange?: (reference: GenomeReference) => void;
  onDownload?: (signal: AbortSignal) => void | Promise<void>;
  message?: AccessionMessage;
  onRefreshMetadata?: () => Promise<void>;
  onCancelMetadataRefresh?: () => void;
  progress?: GenomeDownloadProgress;
  registry: GenomeProviderRegistry;
  unverifiedCopies?: readonly ScannedCopy[];
  onSubmit: (entry: AccessionEntry) => Promise<void>;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const [showHelp, setShowHelp] = useState(false);
  const reviewing = downloadRoot !== undefined;
  const provider = registry.get(editing.source);
  const artifacts = provider.artifacts;
  const options = onReferenceChange ? provider.downloadOptions ?? [] : [];
  const selectableRows: readonly DetailRow[] = reviewing
    ? [...(onArtifactsChange ? [...artifacts.map(artifact => `artifact.${artifact.kind}` as const), ...options.map(option => `option.${option.id}` as const)] : []), ...(onSaveMetadata ? ['metadata' as const] : []), 'save']
    : ['name', 'description', ...(onDownload ? ['download' as const] : []), ...(onRefreshMetadata ? ['refresh' as const] : []), 'save'];
  const {rows: terminalRows, columns} = useWindowSize();
  const pageRef = useRef<DOMElement>(null);
  const viewportRef = useRef<DOMElement>(null);
  const detailsRef = useRef<DOMElement>(null);
  const reviewDestinationRef = useRef<DOMElement>(null);
  const [layout, setLayout] = useState({details: 0, chrome: 12, artifactsTop: 0});
  const [detailsScroll, setDetailsScroll] = useState(0);
  const accession = editing.id;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [selectedRow, setSelectedRow] = useState<DetailRow>(reviewing ? 'save' : 'name');
  const metadata = registry.get(editing.source).mapMetadata(editing.metadata);
  const sections = metadataSections(metadata);
  const [busy, setBusy] = useState<'saving' | 'metadata' | 'refreshing' | 'downloading'>();
  const downloadController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => downloadController.current?.abort(), []);
  const [problems, setProblems] = useState<string[]>([]);
  const typing = selectedRow === 'name' || selectedRow === 'description';
  useHomeSuspension(!inputActive || showHelp ? undefined : busy ? 'busy' : typing ? 'typing' : undefined);
  const viewportHeight = Math.min(layout.details || 1, Math.max(1, terminalRows - layout.chrome));
  // Keep the focused artifact in view, including its heading whenever there is room.
  useLayoutEffect(() => {
    const index = [...artifacts.map(artifact => `artifact.${artifact.kind}`), ...options.map(option => `option.${option.id}`)].indexOf(selectedRow);
    if (reviewing && onArtifactsChange && index >= 0) {
      setDetailsScroll(Math.max(0, layout.artifactsTop + index + 2 - viewportHeight));
    }
  }, [selectedRow, viewportHeight, reviewing, onArtifactsChange, artifacts, layout.artifactsTop]);
  const maximumScroll = Math.max(0, layout.details - viewportHeight);
  const scrollOffset = Math.min(detailsScroll, maximumScroll);
  // Measure wrapped metadata and page chrome instead of estimating their line counts.
  useLayoutEffect(() => {
    if (pageRef.current && viewportRef.current && detailsRef.current) {
      const details = measureElement(detailsRef.current).height;
      const chrome = measureElement(pageRef.current).height - measureElement(viewportRef.current).height;
      const artifactsTop = reviewDestinationRef.current ? measureElement(reviewDestinationRef.current).height + 1 : 0;
      setLayout(current => current.details === details && current.chrome === chrome && current.artifactsTop === artifactsTop
        ? current : {details, chrome, artifactsTop});
    }
  });

  const submit = (): void => {
    const {name: _name, description: _description, ...facts} = editing;
    const entry = reviewing ? editing : {...facts, ...localFields(name, description)};
    setProblems([]);
    setBusy(selectedRow === 'metadata' ? 'metadata' : 'saving');
    const save = selectedRow === 'metadata' && onSaveMetadata ? onSaveMetadata : onSubmit;
    save(entry).catch(error => {
      setBusy(undefined);
      setProblems([error instanceof Error ? error.message : String(error)]);
    });
  };

  const refreshMetadata = async (): Promise<void> => {
    if (!onRefreshMetadata) {
      return;
    }
    setProblems([]);
    setBusy('refreshing');
    try {
      await onRefreshMetadata();
    } catch (error) {
      setProblems([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(undefined);
    }
  };

  const download = async (): Promise<void> => {
    if (!onDownload) {
      return;
    }
    const controller = new AbortController();
    downloadController.current = controller;
    setProblems([]);
    setBusy('downloading');
    try {
      await onDownload(controller.signal);
    } catch (error) {
      setProblems([controller.signal.aborted ? 'Download cancelled. The previous verified copy remains usable.' : error instanceof Error ? error.message : String(error)]);
    } finally {
      downloadController.current = undefined;
      setBusy(undefined);
    }
  };

  useInput(
    (input, key) => {
      if (showHelp) {
        return;
      }
      if (busy) {
        if (key.escape) {
          if (busy === 'refreshing') {
            onCancelMetadataRefresh?.();
          } else if (busy === 'downloading') {
            downloadController.current?.abort();
          }
        }
        return;
      }
      if (input === '?' && !typing) {
        setShowHelp(true);
        return;
      }
      if (!reviewing && onRefreshMetadata && ((!typing && input === 'm') || (key.return && selectedRow === 'refresh'))) {
        void refreshMetadata();
        return;
      }
      if (!reviewing && onDownload && ((!typing && input === 'g') || (key.return && selectedRow === 'download'))) {
        void download();
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.pageUp || key.pageDown) {
        setDetailsScroll(Math.max(0, Math.min(maximumScroll, scrollOffset + (key.pageUp ? -viewportHeight : viewportHeight))));
        return;
      }
      const index = selectableRows.indexOf(selectedRow);
      if (key.tab || key.upArrow || key.downArrow) {
        const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
        setSelectedRow(selectableRows[(index + offset + selectableRows.length) % selectableRows.length] ?? 'save');
        return;
      }
      // Enter never submits from a text field.
      if (key.return && (selectedRow === 'save' || selectedRow === 'metadata')) {
        submit();
      }
    },
    {isActive: inputActive},
  );

  if (showHelp) {
    return <MarkdownDocumentPage title={provider.label} load={loadHelp} onClose={() => setShowHelp(false)} back="Close help" inputActive={inputActive} />;
  }

  const shownProblems = problems.slice(0, 1).map(problem => {
    const text = sanitizeTerminalText(problem).replace(/\s+/g, ' ');
    const limit = Math.max(12, columns - 8);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  });
  if (problems.length > 1) {
    shownProblems.push(`${problems.length - 1} more; fix this first.`);
  }

  // One label column for the editable rows and every section of facts.
  const labelWidth = parameterLabelWidth([
    {label: 'Description'}, ...sections.flatMap(section => section.rows),
    ...(reviewing && onArtifactsChange ? [...artifacts, ...options] : []),
  ]);
  // The editable rows stay one line each, so a long note cannot push Save off a short terminal.
  const oneLine = (value: string): string => {
    const text = sanitizeTerminalText(value).replace(/\s+/g, ' ');
    const limit = Math.max(12, columns - labelWidth - 1);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };
  const localRows: ParameterRow[] = [
    {id: 'accession', label: 'Accession', value: accession},
    {
      id: 'name',
      label: 'Name',
      value: oneLine(name.length > 0 ? name : `not set, shown as ${accession}`),
      muted: name.length === 0,
      edit: {defaultValue: name, onChange: setName},
    },
    {
      id: 'description',
      label: 'Description',
      value: oneLine(description.length > 0 ? description : 'not set'),
      muted: description.length === 0,
      edit: {defaultValue: description, onChange: setDescription},
    },
  ];

  return (
    <Box ref={pageRef} flexDirection="column">
      <EditPage
        title={reviewing ? `Review ${editing.id}` : `Edit ${editing.id}`}
        description={undefined}
        shortcuts={busy ? [] : ['Tab/↑/↓ — Action or field', !typing && '? — Help', 'PageUp/PageDown — Details', !reviewing && !!onDownload && !typing && 'g — Download / refresh', !reviewing && !!onRefreshMetadata && !typing && 'm — Refresh metadata', reviewing && (selectedRow === 'metadata' ? 'Enter — Save metadata' : selectedRow === 'save' && 'Enter — Download')]}
        back={busy === 'refreshing' ? 'Cancel lookup' : busy === 'downloading' || (busy === 'saving' && reviewing) ? 'Cancel download' : 'Cancel'}
        saveLabel={reviewing ? 'Download selected artifacts' : 'Save changes'}
        savingLabel={reviewing ? 'Downloading…' : 'Saving…'}
        saveSelected={selectedRow === 'save'}
        saving={busy === 'saving'}
        problems={shownProblems}
        after={message && !busy && shownProblems.length === 0 ? <Alert variant={message.variant}>{sanitizeTerminalText(message.text)}</Alert> : undefined}
      >
        {!reviewing ? <Section title="Catalog labels" marginTop={0}>
          <ParameterList rows={localRows} selectedId={selectedRow} inputActive={inputActive && !busy} labelWidth={labelWidth} />
        </Section> : null}
        <Box ref={viewportRef} display={busy === 'downloading' ? 'none' : 'flex'} height={viewportHeight} overflow="hidden" flexDirection="column" marginTop={1}>
          <Box ref={detailsRef} marginTop={-scrollOffset} flexDirection="column" flexShrink={0}>
            {reviewing ? <Box ref={reviewDestinationRef} flexDirection="column">
              <Section title="Download destination" marginTop={0}>
                <ParameterList rows={[
                  {id: 'provider', label: 'Provider', value: registry.get(editing.source).label},
                  localRows[0]!, {id: 'root', label: 'Output root', value: downloadRoot},
                ]} inputActive={false} labelWidth={labelWidth} />
              </Section>
            </Box> : null}
            {reviewing && onArtifactsChange && busy !== 'saving' ? <Section title="Artifacts">
              <CheckboxGroup rows={[
                ...artifacts.map(artifact => ({id: `artifact.${artifact.kind}`, label: artifact.label, checked: downloadArtifacts.includes(artifact.kind)})),
                ...options.map(option => ({id: `option.${option.id}`, label: option.label, checked: option.checked(editing)})),
              ]} selectedId={selectedRow} inputActive={inputActive && !busy} labelWidth={labelWidth}
                onChange={(id, checked) => {
                  const option = options.find(option => `option.${option.id}` === id);
                  if (option) {
                    onReferenceChange?.(option.apply(editing, checked));
                  } else {
                    onArtifactsChange(artifacts.filter(artifact => `artifact.${artifact.kind}` === id
                      ? checked : downloadArtifacts.includes(artifact.kind)).map(artifact => artifact.kind));
                  }
                }} />
              {options.map(option => <Text key={option.id} wrap="wrap">{sanitizeTerminalText(option.description)}</Text>)}
            </Section> : null}
            {reviewing && Object.keys(editing.parameters).length > 0 ? <Section title="Pinned parameters" marginTop={onArtifactsChange ? 1 : 0}>
              <ParameterList rows={Object.entries(editing.parameters).map(([id, value]) => ({id, label: id, value: typeof value === 'string' ? value : JSON.stringify(value) ?? 'not provided'}))} inputActive={false} />
            </Section> : null}
            {sections.map((section, index) => (
              <Section key={section.id} title={section.title} marginTop={index === 0 && !onArtifactsChange ? 0 : 1}>
                <ParameterList rows={section.rows} inputActive={false} labelWidth={labelWidth} />
              </Section>
            ))}
            {editing.metadata === null ? (
              <Section title="Provider metadata" marginTop={onArtifactsChange ? 1 : 0}>
                <Text wrap="wrap">{sanitizeTerminalText(registry.get(editing.source).metadataSummary(editing.metadata))}</Text>
                {reviewing && !registry.get(editing.source).lookupMetadata ? <Text wrap="wrap">This provider does not offer metadata lookup. Check the pinned reference before downloading.</Text> : null}
              </Section>
            ) : null}
            {!reviewing ? (
              <Section title="Local copies">
                {editing.cached_copies.length === 0 && unverifiedCopies.length === 0 ? (
                  <Text color={mutedColor} wrap="wrap">
                    None. A workflow that needs this accession downloads it.
                  </Text>
                ) : null}
                {editing.cached_copies.map(copy => (
                  <Text key={copy.path} wrap="wrap">
                    ✔ {sanitizeTerminalText(copy.path)}
                    <Text color={mutedColor}> · verified since {formatLocalDateTime(copy.verified_at)}</Text>
                  </Text>
                ))}
                {unverifiedCopies.map(copy => (
                  <Text key={copy.path} color="red" wrap="wrap">
                    ✖ {sanitizeTerminalText(copy.path)} · not trusted: {sanitizeTerminalText(copy.problem ?? '')}
                  </Text>
                ))}
                {recordedCacheState(editing) === 'conflict' ? (
                  <Alert variant="warning">
                    The verified copies hold different files for the same versioned accession. Inspect
                    them before a workflow uses this accession; none is preferred automatically.
                  </Alert>
                ) : null}
              </Section>
            ) : null}
          </Box>
        </Box>
        {busy !== 'downloading' ? <Text color={mutedColor} wrap="truncate">
          {maximumScroll > 0 ? `${scrollOffset > 0 ? '↑ ' : ''}${scrollOffset + 1}–${Math.min(layout.details, scrollOffset + viewportHeight)} / ${layout.details}${scrollOffset < maximumScroll ? ' ↓' : ''}` : ' '}
        </Text> : null}
        {progress ? <Section title="Download progress">
          <ParameterList rows={progress.phase === 'downloading' ? [{
            id: 'transfer', label: 'Received', value: `${formatBytes(progress.bytes)}${progress.total ? ` / ${formatBytes(progress.total)}` : ' (total size not supplied)'}`,
          }] : [{id: 'phase', label: 'Stage', value: {
            requesting: 'Requesting genome package…', extracting: 'Extracting genome files…',
            verifying: 'Validating files and checksums…', publishing: 'Publishing verified files…',
          }[progress.phase]}]} inputActive={false} />
          {progress.phase === 'downloading' && progress.total ? <ProgressBar value={Math.min(100, 100 * progress.bytes / progress.total)} /> : null}
        </Section> : null}
        {!reviewing && (onDownload || onRefreshMetadata) ? <Box marginTop={1} flexDirection="column">
          {onDownload ? <SaveButton label="Download / refresh" selected={selectedRow === 'download'} busyLabel={busy === 'downloading' ? 'Downloading…' : undefined} /> : null}
          {onRefreshMetadata ? <SaveButton label="Refresh metadata" selected={selectedRow === 'refresh'} busyLabel={busy === 'refreshing' ? 'Looking up metadata…' : undefined} /> : null}
        </Box> : null}
        {reviewing && onSaveMetadata && busy !== 'saving' ? <Box marginTop={1}>
          <SaveButton label="Save metadata only" selected={selectedRow === 'metadata'} busyLabel={busy === 'metadata' ? 'Saving metadata…' : undefined} />
        </Box> : null}
      </EditPage>
    </Box>
  );
}
