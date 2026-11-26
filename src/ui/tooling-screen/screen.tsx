import React, {useState} from 'react';
import {genomeSources} from '../../accessions/registry.js';
import type {GenomeProviderRegistry} from '../../accessions/provider.js';
import {providerSettings, type ProviderSettings} from '../../tooling/provider-settings.js';
import {TabBar} from '../components/tabs.js';
import {ProvidersTab} from './providers-tab.js';
import {ProviderForm} from './provider-form.js';

const defaultSettings = providerSettings();
import {Alert} from '@inkjs/ui';
import {Box, Text, useInput} from 'ink';
import type {ToolingStatus} from '../../tooling/check.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {ToolingList} from '../welcome-screen/tooling/section.js';
import {mutedColor} from '../theme.js';
import {Page} from '../components/page.js';
import {Section} from '../components/section.js';
import {ParameterList, type ParameterRow} from '../components/parameter-list.js';
import {formatLocalDateTime} from '../utils.js';
import type {CliMetadata} from '../welcome-screen/screen.js';

/** The application's own version and, when known, the commit it was built from. */
export function applicationRows(metadata: Pick<CliMetadata, 'version' | 'build'>): ParameterRow[] {
  const rows: ParameterRow[] = [{id: 'version', label: 'Version', value: `v${metadata.version}`}];
  if (metadata.build) {
    rows.push(
      {
        id: 'commit',
        label: 'Commit',
        value: metadata.build.commit.slice(0, 12) + (metadata.build.modified ? ' with uncommitted changes' : ''),
      },
      {id: 'committed-at', label: 'Commit date', value: formatLocalDateTime(metadata.build.committedAt)},
    );
  }
  return rows;
}

export function ToolingScreen({
  metadata,
  status,
  message,
  onCheck,
  onBack,
  inputActive,
  registry = genomeSources,
  settings = defaultSettings,
  initialProvider,
}: {
  metadata: Pick<CliMetadata, 'label' | 'version' | 'build'>;
  status: ToolingStatus;
  message?: string;
  onCheck: () => void;
  onBack: () => void;
  inputActive: boolean;
  registry?: GenomeProviderRegistry;
  settings?: ProviderSettings;
  initialProvider?: string;
}): React.JSX.Element {
  const [tab, setTab] = useState<'tools' | 'providers'>(initialProvider ? 'providers' : 'tools');
  const [selectedProvider, setSelectedProvider] = useState(initialProvider);
  const [editing, setEditing] = useState(initialProvider && registry.get(initialProvider).fields.length ? initialProvider : undefined);
  const header = <TabBar tabs={[{id: 'tools', label: 'Tooling'}, {id: 'providers', label: 'Accession Providers'}]}
    activeId={tab} onChange={setTab} inputActive={inputActive && !editing} />;
  useInput((input, key) => {
    if (!inputActive || editing) {
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (tab === 'tools' && status.state !== 'checking' && (key.return || input.toLowerCase() === 'r')) {
      onCheck();
    }
  });

  if (editing) {
    return <ProviderForm provider={registry.get(editing)} settings={settings} inputActive={inputActive} onBack={() => setEditing(undefined)} />;
  }
  if (tab === 'providers') {
    return <ProvidersTab registry={registry} settings={settings} selectedId={selectedProvider} onSelect={setSelectedProvider}
      onEdit={setEditing} inputActive={inputActive} page={{title: 'Manage Tools', header}} />;
  }
  return (
    <Page
      title="Manage Tools"
      header={header}
      shortcuts={[status.state === 'checking' ? 'Checking…' : 'R/Enter — Check tooling', 'Tab/←/→ — Tab']}
    >
      {status.state === 'checking' ? (
        <Text color={mutedColor}>○ Checking availability…</Text>
      ) : status.state === 'check-failed' ? (
        <Alert variant="error">
          Tooling check failed: {sanitizeTerminalText(status.message)}
        </Alert>
      ) : (
        <ToolingList status={status} />
      )}
      <Section title={metadata.label}>
        <ParameterList rows={applicationRows(metadata)} inputActive={false} />
      </Section>
      {message ? (
        <Box marginTop={1}>
          <Alert variant={status.state === 'ready' ? 'success' : 'warning'}>
            {sanitizeTerminalText(message)}
          </Alert>
        </Box>
      ) : null}
    </Page>
  );
}
