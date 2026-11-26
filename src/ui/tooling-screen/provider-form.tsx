import React, {useEffect, useState} from 'react';
import {Text, useInput, useWindowSize} from 'ink';
import type {GenomeProvider} from '../../accessions/provider.js';
import type {ProviderSettings} from '../../tooling/provider-settings.js';
import {EditPage} from '../components/page.js';
import {Section} from '../components/section.js';
import {TextField} from '../components/text-field.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';

export function ProviderForm({provider, settings, inputActive, onBack}: {
  provider: GenomeProvider;
  settings: ProviderSettings;
  inputActive: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const [configured, setConfigured] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [generation, setGeneration] = useState(0);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const {rows} = useWindowSize();
  const field = provider.fields[selected];
  useHomeSuspension(busy ? 'busy' : field ? 'typing' : undefined);
  useEffect(() => {
    let active = true;
    settings.read(provider).then(values => {
      if (active) {
        setConfigured(Object.keys(values));
      }
    }, () => {
      if (active) {
        setProblems(['Unable to read provider settings.']);
      }
    });
    return () => { active = false; };
  }, [provider, settings, generation]);
  const save = async (): Promise<void> => {
    const clean = Object.fromEntries(Object.entries(drafts).map(([id, value]) => [id, value.replace(/[\x00-\x1f\x7f]/g, '').trim()]));
    const missing = provider.fields.filter(item => item.required && !configured.includes(item.id) && !clean[item.id]);
    if (missing.length) {
      setProblems(missing.map(item => `${item.label}: required`));
      return;
    }
    setProblems([]);
    setBusy(true);
    try {
      for (const item of provider.fields) {
        if (clean[item.id]) {
          await settings.save(provider, item.id, clean[item.id]!);
        }
      }
      setDrafts({});
      setGeneration(value => value + 1);
      setMessage('Settings saved. Configured does not mean verified by the service.');
    } catch {
      setProblems(['Unable to save provider settings.']);
    } finally {
      setBusy(false);
    }
  };
  useInput((input, key) => {
    if (busy) {
      return;
    }
    if (key.escape) {
      onBack();
    } else if (key.tab || key.upArrow || key.downArrow) {
      const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      setSelected(value => (value + offset + provider.fields.length + 1) % (provider.fields.length + 1));
    } else if (key.return && !field) {
      void save();
    } else if (key.ctrl && input.toLowerCase() === 'u' && field) {
      setDrafts(values => ({...values, [field.id]: ''}));
      setGeneration(value => value + 1);
    } else if (key.ctrl && input.toLowerCase() === 'x' && field) {
      setBusy(true);
      void settings.clear(provider, field.id).then(() => {
        setMessage('Stored secret cleared. Cached genomes are unchanged.');
        setConfigured(values => values.filter(id => id !== field.id));
        setGeneration(value => value + 1);
      }, () => setProblems(['Unable to clear provider setting.'])).finally(() => setBusy(false));
    }
  }, {isActive: inputActive});
  const capacity = Math.max(1, rows - 17);
  const first = Math.max(0, Math.min(selected, provider.fields.length - capacity));
  return (
    <EditPage title={provider.label} description={provider.description}
      shortcuts={['Tab/↑/↓ — Field', !field && 'Enter — Save', field && 'Ctrl+X — Clear stored secret', field && 'Ctrl+U — Clear draft']}
      saveLabel="Save settings" saveSelected={!field} saving={busy} problems={problems}
      after={message ? <Text wrap="wrap">{sanitizeTerminalText(message)}</Text> : undefined}>
      <Section title="Provider credentials" marginTop={0}>
        {provider.fields.slice(first, first + capacity).map(item => (
          <TextField key={`${item.id}-${generation}`} label={`${item.label} (${configured.includes(item.id) ? 'configured' : item.required ? 'required' : 'optional, not set'})`}
            required={item.required} selected={field?.id === item.id} inputActive={inputActive && !busy}
            defaultValue={drafts[item.id] ?? ''} displayValue={drafts[item.id] ? '*'.repeat(drafts[item.id]!.length) : 'not entered'}
            mask="*" onChange={value => setDrafts(values => ({...values, [item.id]: value}))} />
        ))}
      </Section>
    </EditPage>
  );
}
