import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Alert} from '@inkjs/ui';
import {missingProviderFields, type GenomeProviderRegistry, type GenomeReference, type ProviderContext, type GenomeResult, type GenomeDownloadProgress, type FileKind} from '../../accessions/provider.js';
import {resolveGenomeCache, type GenomeCacheRequest, type VerifiedGenome} from '../../accessions/cache.js';
import {providerError, type ProviderSettings} from '../../tooling/provider-settings.js';
import {Page, EditPage} from '../components/page.js';
import {Section} from '../components/section.js';
import {SelectableList} from '../components/selectable-list.js';
import {TextField} from '../components/text-field.js';
import {ParameterList} from '../components/parameter-list.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import type {AccessionEntry} from '../../accessions/catalog.js';
import {AccessionForm} from './accession-form.js';
import {ArtifactPicker} from './artifact-picker.js';

export type CatalogDownloader = (request: GenomeCacheRequest, context: ProviderContext, registry: GenomeProviderRegistry) => Promise<VerifiedGenome>;

export function DownloadForm({registry, settings, outputRoot, inputActive, existing, download = resolveGenomeCache, onRecord, onComplete, onCancel, onConfigure}: {
  registry: GenomeProviderRegistry;
  settings: ProviderSettings;
  outputRoot: string;
  inputActive: boolean;
  existing?: GenomeReference;
  download?: CatalogDownloader;
  onRecord: (entry: AccessionEntry) => Promise<void>;
  onComplete: (genome: VerifiedGenome) => void;
  onCancel: () => void;
  onConfigure: (source: string) => void;
}): React.JSX.Element {
  const providers = registry.list();
  const [sourceIndex, setSourceIndex] = useState(Math.max(0, providers.findIndex(provider => provider.id === existing?.source)));
  const [stage, setStage] = useState<'providers' | 'form' | 'results' | 'review' | 'artifacts'>(existing ? 'form' : 'providers');
  const [id, setId] = useState(existing?.id ?? '');
  const [selected, setSelected] = useState(0);
  const [secrets, setSecrets] = useState<Record<string, string>>();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GenomeResult[]>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [review, setReview] = useState<AccessionEntry>();
  const [kinds, setKinds] = useState<readonly FileKind[]>([]);
  const [progress, setProgress] = useState<GenomeDownloadProgress>();
  const controller = useRef<AbortController | undefined>(undefined);
  const {rows} = useWindowSize();
  const provider = providers[sourceIndex];
  const missing = provider && secrets ? missingProviderFields(provider, secrets) : [];
  const actions = ['id', ...(missing.length ? ['configure'] : []), ...(provider?.search ? ['search'] : []), ...(provider?.browse ? ['browse'] : []), 'download'];
  useEffect(() => setSelected(value => Math.min(value, actions.length - 1)), [actions.length]);
  useHomeSuspension(busy ? 'busy' : stage === 'form' && selected === 0 ? 'typing' : undefined);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let active = true;
    setSecrets(undefined);
    if (provider && inputActive) {
      settings.read(provider).then(values => { if (active) { setSecrets(values); } }, () => {
        if (active) { setProblems(['Unable to read provider settings.']); }
      });
    }
    return () => { active = false; };
  }, [provider, settings, inputActive]);
  const operate = async (action: 'download' | 'search' | 'browse', reference?: GenomeReference, confirmed = false): Promise<void> => {
    if (!provider || !secrets || busy || missing.length) {
      if (confirmed) {
        throw new Error('Provider settings are unavailable or required credentials are missing.');
      }
      return;
    }
    setBusy(true);
    setProblems([]);
    const abort = new AbortController();
    controller.current = abort;
    const context: ProviderContext = {signal: abort.signal, secrets, onProgress: setProgress};
    try {
      if (action !== 'download') {
        const found = action === 'search' ? await provider.search!(id, context) : await provider.browse!(context);
        abort.signal.throwIfAborted();
        setResults(found);
        setResultIndex(0);
        setStage('results');
      } else {
        const canonical = registry.validateReference(reference ?? existing ?? await provider.resolveExact(id, context));
        if (canonical.source !== provider.id) {
          throw new Error('The selected genome belongs to another provider.');
        }
        abort.signal.throwIfAborted();
        if (!confirmed) {
          const metadata = provider.lookupMetadata ? await provider.lookupMetadata(canonical, context) : null;
          abort.signal.throwIfAborted();
          provider.validateMetadata(metadata);
          setReview({...canonical, metadata, cached_copies: []});
          setKinds(provider.artifacts.map(artifact => artifact.kind));
          setStage('review');
          return;
        }
        if (kinds.length === 0) {
          throw new Error('Select at least one artifact to download, or choose Save metadata only.');
        }
        // Preserve reviewed metadata even if the later file transfer fails.
        await onRecord({...canonical, metadata: review?.metadata ?? null, cached_copies: []});
        abort.signal.throwIfAborted();
        setProgress({phase: 'requesting'});
        const genome = await download({reference: canonical, kinds, root: outputRoot, mode: 'refresh'}, context, registry);
        abort.signal.throwIfAborted();
        onComplete(genome);
      }
    } catch (error) {
      const message = abort.signal.aborted ? 'Operation cancelled. The previous verified copy is unchanged.' : providerError(error, secrets);
      if (confirmed) {
        throw new Error(message);
      }
      setProblems([message]);
    } finally {
      setBusy(false);
      controller.current = undefined;
      setProgress(undefined);
    }
  };
  useInput((_input, key) => {
    if (busy) {
      if (key.escape) { controller.current?.abort(); }
      return;
    }
    if (stage === 'review' || stage === 'artifacts') {
      return;
    }
    if (key.escape) {
      if (stage === 'results') { setStage('form'); } else { onCancel(); }
      return;
    }
    if (stage === 'providers') {
      if (key.return && provider) { setStage('form'); }
      return;
    }
    if (stage === 'results') {
      if (key.return && results[resultIndex]) { void operate('download', results[resultIndex]!.reference); }
      return;
    }
    if (key.tab || key.upArrow || key.downArrow) {
      const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      setSelected(value => (value + offset + actions.length) % actions.length);
    } else if (key.return) {
      const action = actions[selected];
      if (action === 'configure' && provider) { onConfigure(provider.id); }
      else if (action === 'download' || action === 'search' || action === 'browse') { void operate(action); }
    }
  }, {isActive: inputActive});
  if ((stage === 'review' || stage === 'artifacts') && review && provider) {
    return <Box flexDirection="column">
      <Box flexDirection="column" display={stage === 'review' ? 'flex' : 'none'}>
        <AccessionForm editing={review} registry={registry} downloadRoot={outputRoot} progress={progress}
          inputActive={inputActive && stage === 'review'} downloadArtifacts={kinds} onChooseArtifacts={() => setStage('artifacts')}
          onSaveMetadata={async entry => { await onRecord(entry); onCancel(); }}
          onCancel={() => { setReview(undefined); setStage('form'); }}
          onSubmit={async () => operate('download', review, true)} />
      </Box>
      {stage === 'artifacts' ? <ArtifactPicker artifacts={provider.artifacts} initialKinds={kinds}
        onConfirm={selected => { setKinds(selected); setStage('review'); }} onCancel={() => setStage('review')} inputActive={inputActive} /> : null}
    </Box>;
  }
  if (stage !== 'form') {
    const items = stage === 'providers' ? providers.map(item => item.label) : results.map(item => item.summary);
    const index = stage === 'providers' ? sourceIndex : resultIndex;
    return <Page title={stage === 'providers' ? 'Choose provider' : 'Select genome'} shortcuts={['Enter — Select']} back="Cancel">
      <Section title={stage === 'providers' ? 'Accession Providers' : 'Results'} marginTop={0}>
        {!items.length ? <Text>No results.</Text> : null}
        <SelectableList count={items.length} selectedIndex={index} active={inputActive && !busy} height={Math.max(2, rows - 12)} noun="items"
          onSelect={stage === 'providers' ? setSourceIndex : setResultIndex}
          renderItem={(item, focused) => <Text color={focused ? 'cyan' : undefined} wrap="truncate">{focused ? '› ' : '  '}{sanitizeTerminalText(items[item]!)}</Text>} />
      </Section>
      {problems.map(problem => <Text key={problem} color="red">{sanitizeTerminalText(problem)}</Text>)}
    </Page>;
  }
  return <EditPage title={`Download from ${provider?.label ?? 'provider'}`} description={provider?.description}
    shortcuts={['Tab/↑/↓ — Field', selected > 0 && 'Enter — Activate']} back={busy ? 'Cancel download' : 'Cancel'}
    saveLabel="Review genome" saveSelected={actions[selected] === 'download'} saving={busy} savingLabel="Looking up genome…" problems={problems}>
    <Section title="Genome selection" marginTop={0}>
      <TextField label="Identifier or query" required selected={selected === 0} editable={!existing} inputActive={inputActive && !busy}
        defaultValue={id} displayValue={id} onChange={setId} />
      <ParameterList rows={actions.slice(1, -1).map(action => ({id: action,
        label: action === 'configure' ? 'Configure provider' : action === 'search' ? 'Search' : 'Browse',
        value: action === 'configure' ? 'Open Manage Tools' : 'Request results', choice: true,
      }))} selectedId={actions[selected]} inputActive={inputActive && !busy} />
    </Section>
    {missing.length > 0 ? <Alert variant="warning">Required credentials are missing. Configure this provider before accessing remote files.</Alert> : null}
  </EditPage>;
}
