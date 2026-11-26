import React, {useState} from 'react';
import {Text, useInput, useWindowSize} from 'ink';
import type {FileKind, GenomeArtifact} from '../../accessions/provider.js';
import {Page} from '../components/page.js';
import {Section} from '../components/section.js';
import {SelectableList} from '../components/selectable-list.js';
import {sanitizeTerminalText} from '../sanitize.js';

/** Provider-declared artifacts; the shared list owns selection and viewport navigation. */
export function ArtifactPicker({artifacts, initialKinds, onConfirm, onCancel, inputActive}: {
  artifacts: readonly GenomeArtifact[];
  initialKinds: readonly FileKind[];
  onConfirm: (kinds: FileKind[]) => void;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const [chosen, setChosen] = useState<readonly FileKind[]>(initialKinds);
  const {rows} = useWindowSize();
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      onConfirm(artifacts.filter(artifact => chosen.includes(artifact.kind)).map(artifact => artifact.kind));
    } else if (input === ' ' && artifacts[selected]) {
      const kind = artifacts[selected]!.kind;
      setChosen(current => current.includes(kind) ? current.filter(candidate => candidate !== kind) : [...current, kind]);
    }
  }, {isActive: inputActive});
  return <Page title="Choose download artifacts" detail={`${chosen.length} selected`}
    shortcuts={['Space — Check/uncheck', 'Enter — Done']} back="Keep previous selection">
    <Section title="Available artifacts" marginTop={0}>
      <SelectableList count={artifacts.length} selectedIndex={selected} onSelect={setSelected} active={inputActive}
        height={Math.max(2, rows - 10)} noun="artifacts" renderItem={(index, focused) => {
          const artifact = artifacts[index]!;
          return <Text color={focused ? 'cyan' : undefined} wrap="truncate">
            {focused ? '› ' : '  '}[{chosen.includes(artifact.kind) ? '✔' : ' '}] {sanitizeTerminalText(artifact.label)}
          </Text>;
        }} />
    </Section>
  </Page>;
}
