import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {isNcbiApiKeyConfigured} from '../../tooling/ncbi-api-key.js';
import {resolveToolingPaths} from '../../tooling/paths.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {useHomeSuspension} from '../home-navigation.js';
import {TextInput} from '../components/text-input.js';
import {EditPage} from '../components/page.js';
import type {AccessionsPageFrame} from './screen.js';

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

const statusLabelWidth = 12;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The key field inserts pasted text verbatim, so a clipboard key can arrive padded with
// whitespace or carrying an embedded control character (e.g. a trailing newline). Neither
// belongs in a stored secret; strip and trim only at the save boundary, once the value is final.
function sanitizeKey(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

export function ApiKeyTab({
  page,
  inputActive,
  checkConfigured = defaultCheckConfigured,
  saveKey,
  clearKey,
  keyPath = resolveToolingPaths().ncbiApiKeyPath,
  onDraftChange,
}: {
  page: AccessionsPageFrame;
  inputActive: boolean;
  /** Whether the key field holds a draft, whose cursor then owns ←/→. */
  onDraftChange?: (hasDraft: boolean) => void;
  checkConfigured?: NcbiAccessStatusCheck;
  saveKey: NcbiApiKeySaver;
  clearKey: NcbiApiKeyClearer;
  keyPath?: string;
}): React.JSX.Element {
  const [status, setStatus] = useState<StatusState>({state: 'loading'});
  const [message, setMessage] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedRow, setSelectedRow] = useState<'key' | 'save'>('key');
  const [draft, setDraft] = useState('');
  // The key field is uncontrolled (its value lives inside the component, seeded once at mount),
  // so clearing the draft — after a successful save, or on Ctrl+U — is done by bumping this
  // generation and folding it into the field's `key` to force a fresh, empty mount.
  const [draftGeneration, setDraftGeneration] = useState(0);
  // Every draft reset remounts the field empty, so the draft is gone as well.
  useEffect(() => {
    setDraft('');
    onDraftChange?.(false);
  }, [draftGeneration, onDraftChange]);
  // While the key field is selected, `h` belongs to the draft.
  useHomeSuspension(busy ? 'busy' : inputActive && selectedRow === 'key' ? 'typing' : undefined);

  const refresh = (): void => {
    setStatus({state: 'loading'});
    checkConfigured().then(
      configured => setStatus({state: 'ready', configured}),
      error => setStatus({state: 'failed', message: errorMessage(error)}),
    );
  };

  useEffect(refresh, []);

  const save = (): void => {
    const sanitized = sanitizeKey(draft);
    if (busy) {
      return;
    }
    setMessage(undefined);
    if (sanitized.length === 0) {
      setProblems(['New key: type or paste a key before saving']);
      setSelectedRow('key');
      return;
    }
    setProblems([]);
    setBusy(true);
    saveKey(sanitized).then(
      () => {
        setDraftGeneration(generation => generation + 1);
        setSelectedRow('key');
        setMessage('NCBI API key saved.');
        setBusy(false);
        refresh();
      },
      error => {
        setProblems([errorMessage(error)]);
        setBusy(false);
      },
    );
  };

  useInput(
    (input, key) => {
      if (busy) {
        return;
      }
      if ((input.toLowerCase() === 'x' && key.ctrl) || input === '\x18') {
        setBusy(true);
        setProblems([]);
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
        setSelectedRow('key');
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSelectedRow(current => (current === 'key' ? 'save' : 'key'));
      } else if (key.return && selectedRow === 'save') {
        // Enter acts only on the save button; the arrows move between the field and the button.
        save();
      }
    },
    {isActive: inputActive},
  );

  const statusText = status.state === 'loading'
    ? 'Checking…'
    : status.state === 'failed'
      ? sanitizeTerminalText(status.message)
      : status.configured ? 'Configured' : 'Not set';

  return (
    <EditPage
      {...page}
      description={
        'An optional NCBI API key raises NCBI\'s rate limit for metadata lookups and accession-sourced ' +
        'workflow inputs. It is stored locally, never committed, and never shown again once saved.'
      }
      shortcuts={[
        '↑/↓ — Field',
        selectedRow === 'save' && 'Enter — Save',
        'Ctrl+X — Clear stored key',
        'Ctrl+U — Clear draft',
        'Tab — Tab (←/→ when empty)',
      ]}
      saveLabel="Save key"
      saveSelected={selectedRow === 'save'}
      saving={busy}
      savingLabel="Saving…"
      problems={problems}
      after={message ? (
        <Box marginTop={1}>
          <Text wrap="wrap">{sanitizeTerminalText(message)}</Text>
        </Box>
      ) : null}
    >
      <Box flexDirection="column">
        <Box>
          <Box width={statusLabelWidth} flexShrink={0}><Text bold>Status</Text></Box>
          <Text color={status.state === 'failed' ? 'red' : undefined} wrap="wrap">{statusText}</Text>
        </Box>
        <Box>
          <Box width={statusLabelWidth} flexShrink={0}><Text bold>Stored in</Text></Box>
          <Text color={mutedColor} wrap="wrap">{sanitizeTerminalText(keyPath)}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={selectedRow === 'key' ? 'cyan' : undefined}>
          {selectedRow === 'key' ? '› ' : '  '}New key:{' '}
        </Text>
        <TextInput
          key={draftGeneration}
          mask="*"
          isDisabled={!inputActive || busy || selectedRow !== 'key'}
          placeholder="Type or paste"
          onChange={value => {
            setDraft(value);
            onDraftChange?.(value.length > 0);
          }}
        />
      </Box>
    </EditPage>
  );
}
