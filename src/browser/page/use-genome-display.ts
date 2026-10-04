import {useEffect, useRef, useState, type RefObject} from 'react';
import {useComputedColorScheme} from '@mantine/core';
import type {Browser} from 'igv';
import {defaultGenomeTextSize, type AnnotationColors, type themeGenomeBrowser} from './genome-theme.js';
import type {ViewerBrowser} from './use-genome-navigation.js';
import {annotationDefaults} from './genome-palette.js';

// Native track display properties in the pinned library, omitted from its declarations.
export type DisplayTrack = Parameters<Browser['removeTrack']>[0] & {
  type?: string;
  height?: number;
  frameTranslate?: boolean;
  reversed?: boolean;
  displayMode?: string;
  showCoverage?: boolean;
  showAlignments?: boolean;
  alignmentTrack?: {displayMode: string; setDisplayMode: (mode: string) => void};
  trackView?: {setTrackHeight: (height: number, force: boolean) => void; checkContentHeight: () => void; repaintViews: () => void; viewports?: {trackLabelElement: HTMLElement}[]};
};
type AlignmentDisplay = {coverage: boolean; reads: boolean; layout: 'EXPANDED' | 'SQUISHED'};
export const defaultAlignmentDisplay: AlignmentDisplay = {coverage: true, reads: true, layout: 'EXPANDED'};
type TrackSettings = {
  colors: Record<string, AnnotationColors>;
  modes: Record<string, string>;
  alignments: Record<string, AlignmentDisplay>;
};
function applyAlignmentDisplay(track: DisplayTrack, settings: AlignmentDisplay): void {
  track.showCoverage = settings.coverage;
  track.showAlignments = settings.reads;
  const height = track.height;
  if (height !== undefined) {
    // The native setter recalculates space below coverage without changing x geometry.
    track.height = height;
  }
  track.alignmentTrack?.setDisplayMode(settings.layout);
  track.trackView?.checkContentHeight();
  track.trackView?.repaintViews();
}

/** Presentation state and its native IGV application, including tracks loaded later. */
export function useGenomeDisplay(
  browser: RefObject<Browser | undefined>,
  theme: RefObject<ReturnType<typeof themeGenomeBrowser> | undefined>,
  loaded: RefObject<Map<string, Parameters<Browser['removeTrack']>[0]>>,
  setError: (error: string) => void,
) {
  const [textSize, setTextSize] = useState(defaultGenomeTextSize);
  const textSizeRef = useRef(textSize);
  textSizeRef.current = textSize;
  const [colorDiagnostics, setColorDiagnostics] = useState(false);
  const colorDiagnosticsRef = useRef(colorDiagnostics);
  colorDiagnosticsRef.current = colorDiagnostics;
  const [target, setTarget] = useState('reference');
  const [trackSettings, setTrackSettings] = useState<TrackSettings>({colors: {}, modes: {}, alignments: {}});
  const settingsRef = useRef(trackSettings);
  const [trackLabels, setTrackLabels] = useState(true);
  const [referenceDisplay, setReferenceDisplay] = useState({translated: false, reversed: false});
  const colorScheme = useComputedColorScheme('light');

  useEffect(() => {
    theme.current?.setTextSize(textSize);
  }, [textSize]);

  useEffect(() => {
    theme.current?.setColorDiagnostics(colorDiagnostics);
  }, [colorDiagnostics]);

  const updateSettings = (next: TrackSettings): void => {
    // Pending track loads read the latest settings before React's next render.
    settingsRef.current = next;
    setTrackSettings(next);
  };
  const reset = (): void => {
    setTarget('reference');
    updateSettings({colors: {}, modes: {}, alignments: {}});
    setReferenceDisplay({translated: false, reversed: false});
    setTrackLabels(true);
  };
  const applyTrack = (id: string, kind: string, track: DisplayTrack): void => {
    const viewer = browser.current as ViewerBrowser | undefined;
    if (viewer) {
      viewer.setTrackLabelVisibility(viewer.doShowTrackLabels);
    }
    if (kind === 'alignment') {
      applyAlignmentDisplay(track, settingsRef.current.alignments[id] ?? defaultAlignmentDisplay);
    } else if (kind === 'annotation') {
      track.displayMode = settingsRef.current.modes[id] ?? track.displayMode;
      theme.current?.setAnnotationColors(track, settingsRef.current.colors[id]);
    }
  };
  const changeAlignment = (next: AlignmentDisplay): void => {
    const current = settingsRef.current;
    updateSettings({...current, alignments: {...current.alignments, [target]: next}});
    const track = loaded.current.get(target) as DisplayTrack | undefined;
    if (track) {
      applyAlignmentDisplay(track, next);
      theme.current?.refresh();
    }
  };
  const colors = trackSettings.colors[target] ?? annotationDefaults(colorScheme === 'dark');
  const changeColors = (next?: AnnotationColors): void => {
    const updated = {...settingsRef.current.colors};
    if (next) {
      updated[target] = next;
    } else {
      delete updated[target];
    }
    updateSettings({...settingsRef.current, colors: updated});
    const track = loaded.current.get(target);
    if (track) {
      theme.current?.setAnnotationColors(track, next);
    }
  };
  const changeMode = (mode: string): void => {
    const current = settingsRef.current;
    updateSettings({...current, modes: {...current.modes, [target]: mode}});
    const track = loaded.current.get(target) as DisplayTrack | undefined;
    if (track) {
      track.displayMode = mode;
      track.trackView?.checkContentHeight();
      track.trackView?.repaintViews();
    }
  };
  const changeTrackLabels = (visible: boolean): void => {
    const viewer = browser.current as ViewerBrowser | undefined;
    if (viewer) {
      viewer.doShowTrackLabels = visible;
      viewer.setTrackLabelVisibility(visible);
      setTrackLabels(visible);
    }
  };
  const changeReference = (next: typeof referenceDisplay): void => {
    const instance = browser.current as (Browser & {trackViews: {track: DisplayTrack}[]}) | undefined;
    if (!instance) {
      return;
    }
    const sequence = instance.trackViews.find(view => view.track.type === 'sequence')?.track;
    if (!sequence) {
      setError('The reference sequence display is unavailable.');
      return;
    }
    sequence.frameTranslate = next.translated;
    sequence.reversed = next.reversed;
    setReferenceDisplay(next);
    theme.current?.refresh();
  };
  return {textSize, textSizeRef, setTextSize, colorDiagnostics, colorDiagnosticsRef, setColorDiagnostics, target, setTarget, trackLabels, changeTrackLabels,
    referenceDisplay, changeReference, colors, changeColors, mode: trackSettings.modes[target] ?? 'EXPANDED', changeMode,
    alignment: trackSettings.alignments[target] ?? defaultAlignmentDisplay, changeAlignment, applyTrack, reset};
}
