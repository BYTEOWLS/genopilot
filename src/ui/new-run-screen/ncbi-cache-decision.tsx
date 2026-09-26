import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {NcbiCacheMode} from '../../workflows/configuration-validation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {EditPage} from '../components/page.js';

/** An NCBI input whose accession already has a cache entry, such as `reference` or `backbone`. */
export type NcbiCacheEntry = {id: string; label: string};

export type NcbiCacheModes = Readonly<Record<string, NcbiCacheMode>>;

const options: readonly {value: NcbiCacheMode; label: string}[] = [
  {value: 'reuse', label: 'Reuse cache (verify checksum first)'},
  {value: 'refresh', label: 'Download fresh copy'},
];

/**
 * Asks, for each cached NCBI input, whether to verify and reuse its cache entry or download it
 * again. Every entry starts at `reuse`. Like a choice field on the form, Tab moves between the
 * entries and the continue button, and ↑/↓ or Space choose an entry's option.
 */
export function NcbiCacheDecisionPage({
  entries,
  inputActive,
  onBack,
  onContinue,
}: {
  entries: readonly NcbiCacheEntry[];
  inputActive: boolean;
  onBack: () => void;
  onContinue: (modes: NcbiCacheModes) => void;
}): React.JSX.Element {
  // The rows are the entries, then the continue button at index `entries.length`.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modes, setModes] = useState<NcbiCacheModes>(
    () => Object.fromEntries(entries.map(entry => [entry.id, 'reuse'])),
  );
  const selectedEntry = entries[selectedIndex];
  const continueSelected = selectedIndex === entries.length;

  useInput(
    (input, key) => {
      const rowCount = entries.length + 1;
      if (key.escape) {
        onBack();
      } else if (key.tab) {
        setSelectedIndex((selectedIndex + (key.shift ? -1 : 1) + rowCount) % rowCount);
      } else if (selectedEntry && (key.upArrow || key.downArrow || input === ' ')) {
        const currentIndex = Math.max(0, options.findIndex(option => option.value === modes[selectedEntry.id]));
        const option = options[(currentIndex + (key.upArrow ? -1 : 1) + options.length) % options.length];
        if (option) {
          setModes({...modes, [selectedEntry.id]: option.value});
        }
      } else if (key.upArrow || key.downArrow) {
        setSelectedIndex((selectedIndex + (key.upArrow ? -1 : 1) + rowCount) % rowCount);
      } else if (key.return && continueSelected) {
        onContinue(modes);
      }
    },
    {isActive: inputActive},
  );

  return (
    <EditPage
      title="NCBI cache entries found"
      description="Choose whether to verify and reuse each cache entry or download it again."
      shortcuts={[
        continueSelected ? 'Tab/↑/↓ — Entry' : 'Tab — Next entry',
        continueSelected ? 'Enter — Continue to review' : 'Space/↑/↓ — Choose',
      ]}
      saveLabel="Continue to review"
      saveSelected={continueSelected}
    >
      {entries.map((entry, index) => (
        <Box key={entry.id} marginTop={index === 0 ? 0 : 1} flexDirection="column">
          <Text color={index === selectedIndex ? 'cyan' : undefined}>
            {index === selectedIndex ? '›' : ' '} {sanitizeTerminalText(entry.label)}
          </Text>
          {options.map(option => (
            <Text key={option.value} color={modes[entry.id] === option.value ? undefined : mutedColor}>
              {'    '}({modes[entry.id] === option.value ? '●' : ' '}) {option.label}
            </Text>
          ))}
        </Box>
      ))}
    </EditPage>
  );
}
