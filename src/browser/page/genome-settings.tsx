import React from 'react';
import {Button, Group, Popover, Stack, Switch, Text} from '@mantine/core';
import type {GenomeTrack} from '../contract.js';
import {defaultAlignmentDisplay, defaultHiddenTypes, type useGenomeDisplay} from './use-genome-display.js';

type Display = ReturnType<typeof useGenomeDisplay>;

export function GenomeSettings({ready, opened, setOpened, referenceName, tracks, shown, display, changeHiddenTypes}: {
  ready: boolean;
  opened: boolean;
  setOpened: (opened: boolean) => void;
  referenceName: string;
  tracks: GenomeTrack[];
  shown: (id: string) => boolean;
  display: Display;
  changeHiddenTypes: (types: readonly string[]) => void;
}): React.JSX.Element {
  const selected = tracks.find(track => track.id === display.target);
  const {alignment, referenceDisplay, colors, hiddenTypes} = display;
  const showType = (type: string, visible: boolean): void => changeHiddenTypes(visible ? hiddenTypes.filter(hidden => hidden !== type) : [...hiddenTypes, type]);
  return <Popover opened={opened} onChange={setOpened} position="bottom-end" width={360} withinPortal>
    <Popover.Target><Button data-control="genome-settings" type="button" variant="default" disabled={!ready} aria-expanded={opened} onClick={() => setOpened(!opened)}>Settings</Button></Popover.Target>
    <Popover.Dropdown className="genome-settings">
      <Stack gap="sm">
        <Text fw={600}>Display settings</Text>
        <Group gap="xs" role="group" aria-label="Viewer text size">
          <Text size="sm">Text</Text>
          <Button data-control="genome-text-smaller" type="button" variant="default" disabled={!ready || display.textSize <= 12} aria-label="Smaller viewer text" onClick={() => display.setTextSize(size => Math.max(12, size - 2))}>A−</Button>
          <output aria-live="polite" aria-label="Viewer text size">{display.textSize} px</output>
          <Button data-control="genome-text-larger" type="button" variant="default" disabled={!ready || display.textSize >= 24} aria-label="Larger viewer text" onClick={() => display.setTextSize(size => Math.min(24, size + 2))}>A+</Button>
        </Group>
        <Text size="xs" c="dimmed">Text size applies to the whole viewer. Annotation spacing and read lanes scale with it, keeping bases aligned.</Text>
        <Switch data-control="genome-track-labels" label="Show track labels" checked={display.trackLabels} disabled={!ready} onChange={event => display.changeTrackLabels(event.currentTarget.checked)} />
        <Text size="xs" c="dimmed">Applies to all tracks, including those shown later. Track names remain available in the chooser when labels are hidden.</Text>
        <label htmlFor="genome-settings-target">Reference or track</label>
        <select id="genome-settings-target" value={display.target} onChange={event => display.setTarget(event.currentTarget.value)}>
          <option value="reference">{referenceName} · reference</option>
          {tracks.filter(track => track.kind === 'annotation' || track.kind === 'alignment').map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
        </select>
        {display.target === 'reference' ? <>
          <label><input type="checkbox" checked={referenceDisplay.reversed} onChange={event => display.changeReference({...referenceDisplay, reversed: event.currentTarget.checked})} /> Reverse-complement sequence display</label>
          <label><input type="checkbox" checked={referenceDisplay.translated} onChange={event => display.changeReference({...referenceDisplay, translated: event.currentTarget.checked})} /> Show three-frame translation</label>
          <Text size="xs" c="dimmed">Translation appears at close zoom using IGV’s standard genetic code. It is not a gene prediction or an organism-specific code selection. Reference orientation does not change annotation strand or genomic coordinates.</Text>
          <Button variant="default" onClick={() => display.changeReference({translated: false, reversed: false})}>Reset reference display</Button>
        </> : selected?.kind === 'alignment' ? <>
          {selected.problem ? <Text role="alert" size="sm">{selected.problem}</Text> : null}
          <label><input type="checkbox" checked={alignment.coverage} onChange={event => display.changeAlignment({...alignment, coverage: event.currentTarget.checked})} /> Show coverage (read depth)</label>
          <label><input type="checkbox" checked={alignment.reads} onChange={event => display.changeAlignment({...alignment, reads: event.currentTarget.checked})} /> Show aligned reads</label>
          <label htmlFor="genome-read-layout">Read lanes</label>
          <select id="genome-read-layout" value={alignment.layout} onChange={event => display.changeAlignment({...alignment, layout: event.currentTarget.value as Display['alignment']['layout']})}>
            <option value="EXPANDED">Expanded · readable bases</option>
            <option value="SQUISHED">Compact · colored marks</option>
          </select>
          <Text size="xs" c="dimmed">{shown(display.target) ? 'Changes apply immediately.' : 'Show this track to see its display settings.'} The histogram is read depth, not confidence or votes. Stacked rows are reads aligned to the reference. Expanded lanes grow with text size; compact lanes show colored marks instead of base letters. No alignment coordinates change.</Text>
          <Button variant="default" onClick={() => display.changeAlignment(defaultAlignmentDisplay)}>Reset alignment display</Button>
        </> : selected ? <>
          {selected.problem ? <Text role="alert" size="sm">{selected.problem}</Text> : null}
          <label className="genome-color-setting">Forward strand <input type="color" aria-label="Forward-strand annotation color" value={colors.forward} onChange={event => display.changeColors({...colors, forward: event.currentTarget.value})} /></label>
          <label className="genome-color-setting">Reverse strand <input type="color" aria-label="Reverse-strand annotation color" value={colors.reverse} onChange={event => display.changeColors({...colors, reverse: event.currentTarget.value})} /></label>
          <label htmlFor="genome-annotation-layout">Annotation layout</label>
          <select id="genome-annotation-layout" value={display.mode} onChange={event => display.changeMode(event.currentTarget.value)}>
            <option value="EXPANDED">Expanded</option><option value="SQUISHED">Compact</option><option value="COLLAPSED">Collapsed</option>
          </select>
          {selected.format === 'gff3' ? <>
            <label><input type="checkbox" checked={!hiddenTypes.includes('region')} onChange={event => showType('region', event.currentTarget.checked)} /> Show <code>region</code> records</label>
            <label><input type="checkbox" checked={!hiddenTypes.includes('chromosome')} onChange={event => showType('chromosome', event.currentTarget.checked)} /> Show <code>chromosome</code> records (hidden by default)</label>
            <Text size="xs" c="dimmed">These records span a whole sequence and describe its source, such as strain and collection site, rather than a gene. Changing them reloads the track.</Text>
          </> : null}
          <Text size="xs" c="dimmed">{shown(display.target) ? 'Changes apply immediately.' : 'Show this track to see its display settings.'} Coding-exon translation appears automatically at close zoom when CDS frame information is available. Start/stop highlights keep their own colors.</Text>
          <Button variant="default" onClick={() => display.changeColors()}>Reset strand colors to theme defaults</Button>
          {selected.format === 'gff3' ? <Button variant="default" onClick={() => changeHiddenTypes(defaultHiddenTypes)}>Reset record types</Button> : null}
        </> : null}
        <Switch data-control="genome-color-diagnostics" label="Collect unmapped canvas colors (browser console)" checked={display.colorDiagnostics} disabled={!ready} onChange={event => display.setColorDiagnostics(event.currentTarget.checked)} />
        <Text size="xs" c="dimmed">Presentation only. Nothing is written to source files or saved workflow settings. Custom colors persist across theme changes until reset; check their contrast in both themes.</Text>
      </Stack>
    </Popover.Dropdown>
  </Popover>;
}
