import React from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text, useInput} from 'ink';
import type {ToolingStatus} from '../../tooling/check.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {ToolingList} from '../welcome-screen/tooling/section.js';
import {mutedColor} from '../theme.js';
import {Page} from '../components/page.js';
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
}: {
  metadata: Pick<CliMetadata, 'label' | 'version' | 'build'>;
  status: ToolingStatus;
  message?: string;
  onCheck: () => void;
  onBack: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  useInput((input, key) => {
    if (!inputActive) {
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (status.state !== 'checking' && (key.return || input.toLowerCase() === 'r')) {
      onCheck();
    }
  });

  return (
    <Page
      title="Required tooling"
      shortcuts={[status.state === 'checking' ? 'Checking…' : 'R/Enter — Check tooling']}
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
      <Box marginTop={1} flexDirection="column">
        <Text bold>{sanitizeTerminalText(metadata.label)}</Text>
        <ParameterList rows={applicationRows(metadata)} inputActive={false} />
      </Box>
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
