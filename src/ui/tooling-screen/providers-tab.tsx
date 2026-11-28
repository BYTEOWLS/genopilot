import React, {useEffect, useState} from 'react';
import {Text, useInput, useWindowSize} from 'ink';
import type {GenomeProviderRegistry} from '../../accessions/provider.js';
import {missingProviderFields} from '../../accessions/provider.js';
import type {ProviderSettings} from '../../tooling/provider-settings.js';
import {Page, type PageProps} from '../components/page.js';
import {SelectableList} from '../components/selectable-list.js';
import {Section} from '../components/section.js';
import {sanitizeTerminalText} from '../sanitize.js';

export function ProvidersTab({registry, settings, selectedId, onSelect, onEdit, page, inputActive}: {
  registry: GenomeProviderRegistry;
  settings: ProviderSettings;
  selectedId?: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  page: Pick<PageProps, 'title' | 'header'>;
  inputActive: boolean;
}): React.JSX.Element {
  const providers = registry.list();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const {rows} = useWindowSize();
  const selectedIndex = Math.max(0, providers.findIndex(provider => provider.id === selectedId));
  useEffect(() => {
    let active = true;
    void Promise.all(providers.map(async provider => {
      try {
        const values = await settings.read(provider);
        return [provider.id, missingProviderFields(provider, values).length ? 'configuration required'
          : provider.fields.some(field => !values[field.id]) ? 'optional settings not set' : 'configured'] as const;
      } catch {
        return [provider.id, 'settings unavailable'] as const;
      }
    })).then(entries => { if (active) { setStatuses(Object.fromEntries(entries)); } });
    return () => { active = false; };
  }, [registry, settings]);
  useInput((_input, key) => {
    if (key.return && providers[selectedIndex]?.fields.length) {
      onEdit(providers[selectedIndex]!.id);
    }
  }, {isActive: inputActive});
  return (
    <Page {...page} shortcuts={['Enter — Configure provider', '? — Help', 'Tab/←/→ — Tab']}>
      <Section title="Accession Providers" marginTop={0}>
        <SelectableList count={providers.length} selectedIndex={selectedIndex} onSelect={index => onSelect(providers[index]!.id)}
          active={inputActive} height={Math.max(2, rows - 14)} noun="providers"
          renderItem={(index, selected) => {
            const provider = providers[index]!;
            return <Text color={selected ? 'cyan' : undefined} wrap="truncate">{selected ? '› ' : '  '}{sanitizeTerminalText(provider.label)} · {statuses[provider.id] ?? 'checking…'} · {sanitizeTerminalText(provider.description)}</Text>;
          }} />
      </Section>
    </Page>
  );
}
