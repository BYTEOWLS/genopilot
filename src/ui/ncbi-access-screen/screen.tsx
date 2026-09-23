import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {PasswordInput} from '@inkjs/ui';
import {isNcbiApiKeyConfigured} from '../../tooling/ncbi-api-key.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

export type NcbiAccessStatusCheck = () => Promise<boolean>;
export type NcbiApiKeySaver = (key: string) => Promise<void>;
export type NcbiApiKeyClearer = () => Promise<void>;

type StatusState =
  | {state: 'loading'}
  | {state: 'ready'; configured: boolean}
  | {state: 'failed'; message: string};

async function defaultCheckConfigured(): Promise<boolean> {
  return isNcbiApiKeyConfigured(resolveToolingPaths().ncbiApiKeyPath);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// PasswordInput inserts pasted text verbatim, so a clipboard key can arrive padded with
// whitespace or carrying an embedded control character (e.g. a trailing newline). Neither
// belongs in a stored secret; strip and trim only at the save boundary, once the value is final.
function sanitizeKey(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

export function NcbiAccessScreen({
  onBack,
  inputActive,
  checkConfigured = defaultCheckConfigured,
  saveKey,
  clearKey,
  keyPath = resolveToolingPaths().ncbiApiKeyPath,
}: {
  onBack: () => void;
  inputActive: boolean;
  checkConfigured?: NcbiAccessStatusCheck;
  saveKey: NcbiApiKeySaver;
  clearKey: NcbiApiKeyClearer;
  keyPath?: string;
}): React.JSX.Element {
  const [status, setStatus] = useState<StatusState>({state: 'loading'});
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  // PasswordInput is uncontrolled (its value lives inside the component, seeded once at mount),
  // so clearing the draft — after a successful save, or on Ctrl+U — is done by bumping this
  // generation and folding it into the field's `key` to force a fresh, empty mount.
  const [draftGeneration, setDraftGeneration] = useState(0);

  const refresh = (): void => {
    setStatus({state: 'loading'});
    checkConfigured().then(
      configured => setStatus({state: 'ready', configured}),
      error => setStatus({state: 'failed', message: errorMessage(error)}),
    );
  };

  useEffect(refresh, []);

  const handleSubmit = (value: string): void => {
    const sanitized = sanitizeKey(value);
    if (busy || sanitized.length === 0) {
      return;
    }
    setBusy(true);
    saveKey(sanitized).then(
      () => {
        setDraftGeneration(generation => generation + 1);
        setMessage('NCBI API key saved.');
        setBusy(false);
        refresh();
      },
      error => {
        setMessage(`Unable to save the NCBI API key: ${errorMessage(error)}`);
        setBusy(false);
      },
    );
  };

  useInput(
    (input, key) => {
      if (busy) {
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
      if ((input.toLowerCase() === 'x' && key.ctrl) || input === '\x18') {
        setBusy(true);
        clearKey().then(
          () => {
            setMessage('NCBI API key cleared.');
            setBusy(false);
            refresh();
          },
          error => {
            setMessage(`Unable to clear the NCBI API key: ${errorMessage(error)}`);
            setBusy(false);
          },
        );
        return;
      }
      if ((input.toLowerCase() === 'u' && key.ctrl) || input === '\x15') {
        setDraftGeneration(generation => generation + 1);
      }
    },
    {isActive: inputActive},
  );

  return (
    <Box flexDirection="column">
      <Text bold>NCBI access</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={mutedColor} wrap="wrap">
          An optional NCBI API key raises the Datasets CLI's rate limit for accession-sourced
          inputs. It is stored locally, never committed, and never shown again once saved.
        </Text>
        {status.state === 'loading' ? <Text>Checking…</Text> : null}
        {status.state === 'failed' ? (
          <Text color="red">{sanitizeTerminalText(status.message)}</Text>
        ) : null}
        {status.state === 'ready' ? (
          <Text>API key: {status.configured ? 'Configured' : 'Not set'}</Text>
        ) : null}
        <Text color={mutedColor} wrap="wrap">Saved to: {sanitizeTerminalText(keyPath)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>New key: </Text>
        <PasswordInput
          key={draftGeneration}
          isDisabled={!inputActive || busy}
          placeholder="Type or paste"
          onSubmit={handleSubmit}
        />
      </Box>
      {message ? (
        <Box marginTop={1}>
          <Text>{sanitizeTerminalText(message)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={mutedColor}>
          Enter — Save · Ctrl+X — Clear stored key · Ctrl+U — Clear draft · Esc — Back
        </Text>
      </Box>
    </Box>
  );
}
