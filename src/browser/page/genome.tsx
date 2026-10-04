import React, {useEffect, useRef, useState} from 'react';
import {ActionIcon, Alert, Button, Group, Menu, Modal, Popover, Switch, Text} from '@mantine/core';
import type {Browser, IGV} from 'igv';
import type {BrowserDocument, GenomePreset, GenomeTrack, GenomeView} from '../contract.js';
import {inlineText, markdownSection} from '../../docs/markdown.js';
import {DocumentBody} from './document.js';
import {Provenance} from './provenance.js';
import {themeGenomeBrowser} from './genome-theme.js';
import {alignmentColorDetails, captureAlignmentClicks} from './alignment-details.js';
import {FeatureDetailsPanel, type FeatureDetails} from './feature-details.js';
import {useGenomeNavigation, zoomGenome, type ReferenceFrame, type ViewerBrowser} from './use-genome-navigation.js';
import {useGenomeDisplay, type DisplayTrack} from './use-genome-display.js';
import {GenomeSettings} from './genome-settings.js';

export type GenomeLibrary = Pick<IGV, 'createBrowser' | 'removeBrowser' | 'removeAllBrowsers'>;
export type GenomeLibraryLoader = () => Promise<GenomeLibrary>;
export const loadGenomeLibrary: GenomeLibraryLoader = async () => {
  const url = new URL('igv.js', window.location.href).href;
  return (await import(url)).default as GenomeLibrary;
};

// IGV registers an instance before asynchronous reference loading. Serialize creation so a
// failed creation can clear its partial instance without disposing a newer view's browser.
let creation: Promise<void> = Promise.resolve();
type TrackState = {state: 'hidden' | 'loading' | 'shown' | 'failed'; message?: string};
const minimumBases = 10;
function detailRows(data: unknown): FeatureDetails['rows'] {
  if (!Array.isArray(data)) {
    return [];
  }
  let featureBlock = 0;
  return data.flatMap(entry => {
    // IGV separates GFF gene/transcript/exon/CDS records with fixed <hr/> markers.
    // Preserve their boundaries as metadata; never render the supplied HTML.
    if (typeof entry === 'string' && /^(<hr\s*\/?>)+$/i.test(entry.trim())) {
      featureBlock += 1;
      return [];
    }
    if (!entry || typeof entry !== 'object' || !('name' in entry) || !('value' in entry) || entry.value === undefined || entry.value === null) {
      return [];
    }
    // Render the recorded values as text, never IGV's popup HTML or executable markup.
    return [{label: String(entry.name), value: String(entry.value), featureBlock}];
  });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GenomePanel({view, load = loadGenomeLibrary, select}: {view: GenomeView; load?: GenomeLibraryLoader; select?: (id: string) => void}): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null);
  const browser = useRef<Browser | undefined>(undefined);
  const theme = useRef<ReturnType<typeof themeGenomeBrowser> | undefined>(undefined);
  const navigation = useGenomeNavigation(browser);
  const {run: runNavigation, zoom, error, setError} = navigation;
  const loaded = useRef(new Map<string, Parameters<Browser['removeTrack']>[0]>());
  const readClickPayloads = useRef(new WeakMap<object, unknown>());
  const [ready, setReady] = useState(false);
  const display = useGenomeDisplay(browser, theme, loaded, setError);
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});
  const [locus, setLocus] = useState('');
  const [legend, setLegend] = useState(false);
  const [helpTopic, setHelpTopic] = useState<BrowserDocument | 'sources'>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromosome, setChromosome] = useState('');
  const frame = useRef<ReferenceFrame | undefined>(undefined);
  const [details, setDetails] = useState<FeatureDetails>();
  const [wheelMode, setWheelMode] = useState<'zoom' | 'scroll'>('zoom');
  const wheelModeRef = useRef(wheelMode);
  wheelModeRef.current = wheelMode;
  const reference = view.content.reference;
  const [presetId, setPresetId] = useState(view.content.presets?.[0]?.id);
  const [itemCard, setItemCard] = useState(true);
  const [chooserOpen, setChooserOpen] = useState(false);
  const helpDocuments = [view.content.legend, view.guide].filter((document): document is BrowserDocument => !!document);
  const helpSections = helpDocuments.flatMap(document => {
    const blocks = document.blocks ?? [];
    return blocks.flatMap((block, index) => {
      if (block.kind !== 'heading' || block.level !== 2 || inlineText(block.content) === document.title) {
        return [];
      }
      return [{...document, id: `${document.id}:section:${index}`, title: inlineText(block.content), blocks: markdownSection(blocks, index)}];
    });
  });
  const clickDetailsHelp = helpSections.find(section => section.title === 'Click details');
  const openHelp = (topic: BrowserDocument | 'sources'): void => {
    setLegend(false);
    setHelpTopic(topic);
  };
  const item = view.items?.entries.find(candidate => candidate.id === view.selectedItemId);
  const preset = view.content.presets?.find(candidate => candidate.id === presetId);
  const evidenceKey = item ? JSON.stringify([item.id, preset?.id]) : undefined;
  const requestedEvidence = useRef(evidenceKey);
  requestedEvidence.current = evidenceKey;
  const [displayedEvidence, setDisplayedEvidence] = useState<string>();
  const evidenceUpdating = evidenceKey !== displayedEvidence;
  const evidenceUpdatingRef = useRef(evidenceUpdating);
  evidenceUpdatingRef.current = evidenceUpdating;
  const selectRef = useRef(select);
  selectRef.current = select;
  const itemTracks = item?.target.tracks;
  const trackName = (track: GenomeTrack): string => itemTracks?.find(candidate => candidate.id === track.id)?.name ?? track.name;
  const currentNames = useRef(new Map<string, string>());
  currentNames.current = new Map(view.content.tracks.map(track => [track.id, trackName(track)]));
  const orderedTracks = [...view.content.tracks].sort((left, right) => {
    const order = (id: string): number => itemTracks?.findIndex(track => track.id === id) ?? view.content.tracks.findIndex(track => track.id === id);
    return order(left.id) - order(right.id);
  });

  const fitTracks = (): void => {
    if (view.items) {
      return;
    }
    const height = Math.max(180, Math.floor(((element.current?.clientHeight || 560) - 100) / Math.max(1, loaded.current.size)));
    for (const track of loaded.current.values()) {
      const display = track as DisplayTrack;
      if (display.height !== height) {
        display.trackView?.setTrackHeight(height, true);
      }
    }
  };

  const removeTrack = (instance: Browser, id: string): void => {
    const track = loaded.current.get(id);
    if (track) {
      theme.current?.releaseTrack(track);
      instance.removeTrack(track);
      loaded.current.delete(id);
      setDetails(current => current?.trackId === id ? undefined : current);
    }
  };

  const addTrack = async (instance: Browser, track: GenomeTrack, order = itemTracks?.findIndex(choice => choice.id === track.id) ?? view.content.tracks.indexOf(track), settings: Record<string, unknown> = {}, current = () => browser.current === instance): Promise<void> => {
    if (!current()) {
      return;
    }
    setTracks(current => ({...current, [track.id]: {state: 'loading'}}));
    try {
      const common = {name: trackName(track), url: track.file,
        order, removable: false,
        height: view.items ? track.kind === 'alignment' ? 280 : 65 : Math.max(280, (element.current?.clientHeight || 560) - 100), autoHeight: false,
        ...(item && track.kind === 'alignment' ? {groupBy: `base:${item.target.chrom}:${item.target.start}`, ...(preset?.colorBy ? {colorBy: preset.colorBy} : {})} : {}),
        ...settings};
      const result = track.kind === 'alignment'
        ? await instance.loadTrack({...common, type: 'alignment', format: 'bam', indexURL: track.index})
        : track.kind === 'variant'
          ? await instance.loadTrack({...common, type: 'variant', format: 'vcf', indexURL: track.index, displayMode: 'COLLAPSED'})
          : await instance.loadTrack({...common, type: 'annotation', format: track.format as 'gff3' | 'bed', indexed: false});
      if (!current()) {
        if (browser.current === instance && result) {
          instance.removeTrack(result);
        }
        return;
      }
      if (!result) {
        throw new Error('The genome library could not load this track.');
      }
      loaded.current.set(track.id, result);
      if (track.kind === 'alignment') {
        captureAlignmentClicks(result, readClickPayloads.current);
      }
      display.applyTrack(track.id, track.kind, result as DisplayTrack);
      theme.current?.refresh();
      fitTracks();
      setTracks(current => ({...current, [track.id]: {state: 'shown'}}));
    } catch (cause) {
      if (current()) {
        setTracks(current => ({...current, [track.id]: {state: 'failed', message: message(cause)}}));
      }
    }
  };

  useEffect(() => {
    let active = true;
    let instance: Browser | undefined;
    let library: GenomeLibrary | undefined;
    let removed = false;
    let removeMouseHandlers: (() => void) | undefined;
    const dispose = (): void => {
      if (instance && library && !removed) {
        removed = true;
        removeMouseHandlers?.();
        theme.current?.dispose();
        theme.current = undefined;
        instance.off('trackclick');
        instance.off('locuschange');
        library.removeBrowser(instance);
      }
    };
    navigation.reset();
    setReady(false);
    setDisplayedEvidence(undefined);
    setError(undefined);
    setDetails(undefined);
    setSettingsOpen(false);
    setChooserOpen(false);
    setLegend(false);
    setHelpTopic(undefined);
    display.reset();
    loaded.current.clear();
    readClickPayloads.current = new WeakMap();
    setTracks(Object.fromEntries(view.content.tracks.map(track => [track.id, {state: track.problem ? 'failed' : 'hidden', message: track.problem}])));
    const sequence = reference.sequences?.[0];
    const initialLocus = item ? `${item.target.chrom}:${Math.max(1, item.target.start - (preset?.padding ?? 50))}-${Math.min(reference.sequences?.find(sequence => sequence.name === item.target.chrom)?.length ?? item.target.end, item.target.end + (preset?.padding ?? 50))}`
      : sequence ? `${sequence.name}:1-${Math.min(sequence.length, 2000)}` : '';
    setLocus(initialLocus);
    setChromosome(sequence?.name ?? '');
    frame.current = sequence ? {chr: sequence.name, start: 0, end: Math.min(sequence.length, 2000)} : undefined;
    const initialize = async (): Promise<void> => {
      try {
        library = await load();
        if (!active) {
          return;
        }
        if (!sequence || !reference.index || !element.current) {
          throw new Error('The reference has no usable sequence index.');
        }
        try {
          instance = await library.createBrowser(element.current, {reference: {id: view.id, name: reference.name, fastaURL: reference.fasta, indexURL: reference.index,
            wholeGenomeView: true, chromosomeOrder: reference.sequences?.map(sequence => sequence.name)},
            locus: initialLocus, tracks: [], loadDefaultGenomes: false, queryParametersSupported: false,
            showControls: false, showNavigation: false, showIdeogram: true, showTrackLabels: true, showSVGButton: false,
            showGearColumn: false, showTrackDragHandles: false, showCursorGuide: true, showRuler: true,
            showAllChromosomes: true, minimumBases} as Parameters<IGV['createBrowser']>[1]);
        } catch (cause) {
          library.removeAllBrowsers();
          throw cause;
        }
        if (!active) {
          dispose();
          return;
        }
        browser.current = instance;
        // Replace IGV's fire-and-forget window listener with our queued resize
        // path, which observes both window and details-panel width changes.
        window.removeEventListener('resize', (instance as ViewerBrowser).boundWindowResizeHandler);
        instance.on('locuschange', (frames: ReferenceFrame[]) => {
          if (active && browser.current === instance && frames[0]) {
            frame.current = frames[0];
            // IGV switches its guide off on entry to whole-genome view; retain our crosshair.
            (instance as ViewerBrowser).setCursorGuideVisibility(true);
            setChromosome(frames[0].chr);
            setLocus(frames[0].chr === 'all' ? 'all' : frames[0].getLocusString?.() ?? `${frames[0].chr}:${Math.floor(frames[0].start) + 1}-${Math.ceil(frames[0].end)}`);
          }
        });
        // The fourth event argument is populated only for annotations. Alignment
        // popup payloads are bound to their native click target at track creation.
        instance.on('trackclick', (track, data, position, features?: unknown[]) => {
          if (active && browser.current === instance && !evidenceUpdatingRef.current) {
            if (track.id === 'review-loci') {
              const feature = features?.find(feature => feature && typeof feature === 'object' && 'id' in feature) as {id?: string} | undefined;
              if (feature?.id) {
                selectRef.current?.(feature.id);
              }
              return false;
            }
            const source = view.content.tracks.find(candidate => loaded.current.get(candidate.id) === track);
            const clicked = data && typeof data === 'object' ? readClickPayloads.current.get(data) : undefined;
            const colorRows = alignmentColorDetails(track, clicked ?? features, position);
            const rows = [...colorRows, ...detailRows(data)];
            const clickedRead = (Array.isArray(clicked) ? clicked.find(feature => feature && typeof feature === 'object' && 'readName' in feature) : undefined) as {readName: string} | undefined;
            const isCoverage = Array.isArray(clicked) && clicked.some(feature => feature && typeof feature === 'object' && 'coverage' in feature);
            const kind = clickedRead || colorRows.length ? 'Read' : isCoverage ? 'Coverage position' : source?.kind === 'alignment' ? 'Alignment item' : source?.kind === 'variant' ? 'Variant' : source?.kind === 'annotation' ? 'Annotation' : 'Reference sequence';
            if (clickedRead && !rows.some(row => row.label === 'Read Name')) {
              rows.unshift({label: 'Read Name', value: clickedRead.readName});
            }
            if (rows.length && position !== undefined && frame.current) {
              rows.unshift({label: 'Clicked position', value: `${frame.current.chr}:${Math.floor(position) + 1}`});
            }
            setDetails(rows.length ? {trackId: source?.id, title: source ? currentNames.current.get(source.id) ?? source.name : track.name ?? reference.name, kind, rows} : undefined);
          }
          return false;
        });
        const shadow = element.current?.shadowRoot;
        if (shadow) {
          // App tokens inherit into the shadow root; canvas paints use the adapter below.
          const style = document.createElement('style');
          style.textContent = `
            .igv-container { color: var(--foreground); background: var(--background); }
            .igv-track-label, .igv-track-label:hover, .igv-track-label:focus, .igv-track-label:active,
            .igv-zoom-in-notice-container, .igv-zoom-in-notice-container > div,
            .igv-zoom-in-notice div, .igv-ruler-tooltip > div {
              color: var(--foreground); background: var(--background); border-color: var(--border);
              font-family: var(--mantine-font-family); font-size: var(--genome-text-size, 16px);
            }
            .igv-track-label { border-radius: 3px; padding: 2px 4px; }
            /* IGV retains gear elements even with showGearColumn disabled. */
            .igv-gear-menu-column { display: none !important; }
            /* Emphasize IGV's existing inter-track gutters without changing viewport
               geometry or canvas colors. Boundaries remain visible with labels off. */
            .igv-column { background: var(--muted); }
            .igv-viewport { border-color: var(--border); background: var(--background); }
            .igv-viewport::after {
              content: ''; position: absolute; inset: 0; z-index: 500; pointer-events: none;
              border-block: 1px solid color-mix(in srgb, var(--foreground) 35%, var(--background));
            }
            .igv-column-shim { background: var(--border); }
          `;
          shadow.appendChild(style);
          const clearTitles = (event: Event): void => {
            for (const target of event.composedPath()) {
              if (target instanceof HTMLElement) {
                target.removeAttribute('title');
              }
            }
          };
          const labelClick = (event: Event): void => {
            const target = event.target instanceof HTMLElement ? event.target.closest('.igv-track-label') : null;
            if (!target || evidenceUpdatingRef.current) {
              return;
            }
            // Labels have a separate IGV popup handler; capture them before that handler.
            event.stopImmediatePropagation();
            event.preventDefault();
            const source = view.content.tracks.find(candidate => (loaded.current.get(candidate.id) as DisplayTrack | undefined)?.trackView?.viewports?.some(viewport => viewport.trackLabelElement === target));
            setDetails({trackId: source?.id, title: source ? currentNames.current.get(source.id) ?? source.name : target.textContent ?? reference.name,
              rows: source ? [{label: 'Format', value: source.format.toUpperCase()}] : []});
          };
          let wheelFrame: number | undefined;
          let wheelDelta = 0;
          let wheelX = 0;
          let wheelBounds: DOMRect | undefined;
          let zooming = false;
          const scheduleZoom = (): void => {
            if (wheelFrame !== undefined || zooming) {
              return;
            }
            wheelFrame = requestAnimationFrame(() => {
              wheelFrame = undefined;
              const current = frame.current;
              const delta = wheelDelta;
              wheelDelta = 0;
              if (!active || !current || !wheelBounds || browser.current !== instance || wheelModeRef.current !== 'zoom') {
                return;
              }
              // View coordinates only: preserve the base under the pointer at its pixel position.
              const fraction = Math.max(0, Math.min(1, (wheelX - wheelBounds.left) / wheelBounds.width));
              const span = current.end - current.start;
              const scale = Math.exp(Math.max(-2, Math.min(2, delta / 500)));
              let operation: () => unknown;
              if (current.chr === 'all') {
                if (delta >= 0) {
                  return;
                }
                // Enter the chromosome under the pointer once; subsequent wheel steps zoom
                // its existing viewports in place. Explicit chromosomeOrder includes short contigs.
                const anchor = Math.max(0, Math.min(span - 1, current.start + fraction * span));
                let offset = 0;
                const contig = reference.sequences?.find(candidate => {
                  if (anchor < offset + candidate.length) {
                    return true;
                  }
                  offset += candidate.length;
                  return false;
                });
                if (!contig) {
                  return;
                }
                const length = Math.round(Math.min(contig.length, Math.max(minimumBases, span * scale)));
                const start = Math.round(Math.max(0, Math.min(contig.length - length, anchor - offset - fraction * length)));
                operation = () => instance!.search(`${contig.name}:${start + 1}-${start + length}`);
              } else {
                const contig = reference.sequences?.find(candidate => candidate.name === current.chr);
                if (!contig || span <= 0) {
                  return;
                }
                const length = Math.min(contig.length, Math.max(minimumBases, span * scale));
                const center = current.start + fraction * span + (0.5 - fraction) * length;
                operation = () => zoomGenome(instance!, length / span, center);
              }
              zooming = true;
              void runNavigation(instance!, operation).finally(() => {
                zooming = false;
                if (active && wheelDelta) {
                  scheduleZoom();
                }
              });
            });
          };
          const wheel = (event: Event): void => {
            const input = event as WheelEvent;
            if (wheelModeRef.current === 'scroll') {
              // Bypass native track wheel handlers and scroll the actual viewer.
              // Details live outside this shadow root and scroll independently.
              input.stopImmediatePropagation();
              if (input.deltaY && element.current) {
                input.preventDefault();
                element.current.scrollTop += input.deltaY * (input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? element.current.clientHeight : 1);
              }
              return;
            }
            const viewport = input.target instanceof HTMLElement ? input.target.closest('.igv-viewport') : null;
            const bounds = viewport?.getBoundingClientRect();
            if (!bounds || bounds.width < 1 || !input.deltaY) {
              return;
            }
            input.preventDefault();
            wheelDelta += input.deltaY * (input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? bounds.height : 1);
            wheelX = input.clientX;
            wheelBounds = bounds;
            scheduleZoom();
          };
          shadow.addEventListener('wheel', wheel, {passive: false, capture: true});
          shadow.addEventListener('mouseover', clearTitles);
          shadow.addEventListener('mousemove', clearTitles);
          shadow.addEventListener('click', labelClick, true);
          removeMouseHandlers = () => {
            style.remove();
            if (wheelFrame !== undefined) {
              cancelAnimationFrame(wheelFrame);
            }
            shadow.removeEventListener('wheel', wheel, true);
            shadow.removeEventListener('mouseover', clearTitles);
            shadow.removeEventListener('mousemove', clearTitles);
            shadow.removeEventListener('click', labelClick, true);
          };
        }
        theme.current = themeGenomeBrowser(instance, element.current!, display.textSizeRef.current);
        if (display.colorDiagnosticsRef.current) {
          theme.current.setColorDiagnostics(true);
        }
        if (view.items) {
          await instance.loadTrack({id: 'review-loci', name: view.items.name, type: 'annotation', format: 'bed', order: -1,
            height: 50, removable: false, displayMode: 'COLLAPSED', features: view.items.entries.map(item => ({
              id: item.id, name: item.label, chr: item.target.chrom, start: item.target.start - 1, end: item.target.end,
            }))} as unknown as Parameters<Browser['loadTrack']>[0]);
        }
        for (const track of view.content.tracks) {
          if (!active) {
            break;
          }
          if (!view.items && track.shown && !track.problem) {
            await addTrack(instance, track);
          }
        }
        if (active) {
          setReady(true);
        }
      } catch (cause) {
        if (active) {
          setError(message(cause));
        }
      }
    };
    creation = creation.catch(() => {}).then(initialize);
    return () => {
      active = false;
      browser.current = undefined;
      loaded.current.clear();
      dispose();
    };
  }, [reference.fasta, reference.index, load]);

  useEffect(() => {
    const instance = browser.current;
    if (!ready || !instance || !item || !preset) {
      return;
    }
    const selected = item;
    const mode: GenomePreset = preset;
    const key = evidenceKey;
    let cancelled = false;
    const current = (): boolean => !cancelled && browser.current === instance && requestedEvidence.current === key;
    setDisplayedEvidence(undefined);
    setDetails(undefined);
    setError(undefined);
    void runNavigation(instance, async () => {
      const length = reference.sequences?.find(sequence => sequence.name === selected.target.chrom)?.length;
      if (!length || selected.target.start < 1 || selected.target.end > length) {
        throw new Error('This review locus is outside the reference.');
      }
      // Drop the previous locus's evidence before searching, avoiding a redundant load of
      // every old alignment at the new locus immediately before replacing its grouping.
      for (const id of loaded.current.keys()) {
        removeTrack(instance, id);
      }
      setTracks(Object.fromEntries(view.content.tracks.map(track => [track.id, {state: track.problem ? 'failed' : 'hidden', message: track.problem}])));
      await instance.search(`${selected.target.chrom}:${Math.max(1, selected.target.start - mode.padding)}-${Math.min(length, selected.target.end + mode.padding)}`);
      if (!current()) {
        return;
      }
      const ordered = selected.target.tracks ?? view.content.tracks.map(track => ({id: track.id, shown: track.shown}));
      for (const [order, choice] of ordered.entries()) {
        if (!current()) {
          return;
        }
        const track = view.content.tracks.find(track => track.id === choice.id);
        if (track && choice.shown && !track.problem && (track.kind !== 'annotation' || track.group || track.shown) && (track.kind !== 'alignment' || mode.reads)) {
          await addTrack(instance, track, order, track.kind === 'alignment' ? {
            groupBy: `base:${selected.target.chrom}:${selected.target.start}`, ...(mode.colorBy ? {colorBy: mode.colorBy} : {}),
          } : {}, current);
        }
      }
      if (current()) {
        theme.current?.refresh();
        setDisplayedEvidence(key);
      }
    }, current);
    return () => {
      cancelled = true;
    };
  }, [ready, item?.id, preset?.id]);

  useEffect(() => {
    if (!ready || !element.current) {
      return;
    }
    const resize = (): void => {
      fitTracks();
      const instance = browser.current;
      if (instance) {
        void runNavigation(instance, () => (instance as ViewerBrowser).boundWindowResizeHandler());
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    observer?.observe(element.current);
    if (!observer) {
      window.addEventListener('resize', resize);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [ready]);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey &&
          !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        event.preventDefault();
        if (helpTopic) {
          setHelpTopic(undefined);
        } else {
          setLegend(current => !current);
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [helpTopic]);

  const searchRegion = (query: string): void => {
    const instance = browser.current;
    if (instance) {
      void runNavigation(instance, () => instance.search(query));
    }
  };
  const navigate = (event: React.FormEvent): void => {
    event.preventDefault();
    if (locus.trim().toLowerCase() === 'all' && (reference.sequences?.length ?? 0) > 1) {
      setError(undefined);
      setDetails(undefined);
      searchRegion('all');
      return;
    }
    const match = /^(.+):(\d[\d,]*)(?:-(\d[\d,]*))?$/.exec(locus.trim());
    const sequence = reference.sequences?.find(candidate => candidate.name === match?.[1]);
    const start = Number(match?.[2]?.replaceAll(',', ''));
    const end = Number((match?.[3] ?? match?.[2])?.replaceAll(',', ''));
    if (!sequence || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > sequence.length) {
      setError('Enter a region in this reference as sequence:start-end, using 1-based inclusive coordinates.');
      return;
    }
    setError(undefined);
    searchRegion(`${sequence.name}:${start}-${end}`);
  };
  const toggle = (track: GenomeTrack): void => {
    const instance = browser.current;
    if (!instance || evidenceUpdating) {
      return;
    }
    const key = evidenceKey;
    const current = (): boolean => browser.current === instance && requestedEvidence.current === key;
    void runNavigation(instance, async () => {
      if (loaded.current.has(track.id)) {
        removeTrack(instance, track.id);
        fitTracks();
        setTracks(current => ({...current, [track.id]: {state: 'hidden'}}));
      } else {
        await addTrack(instance, track, undefined, {}, current);
      }
    }, current);
  };
  return <section className="genome-area" data-view-kind="genome">
    <form onSubmit={navigate} className="genome-navigation">
      <label htmlFor="genome-chromosome">Chromosome / contig</label>
      <select id="genome-chromosome" value={chromosome} disabled={!ready || evidenceUpdating} onChange={event => {
        const selected = event.currentTarget.value;
        const sequence = reference.sequences?.find(candidate => candidate.name === selected);
        if (sequence || selected === 'all') {
          setChromosome(selected);
          setError(undefined);
          setDetails(undefined);
          searchRegion(selected === 'all' ? 'all' : `${sequence!.name}:1-${sequence!.length}`);
        }
      }}>{(reference.sequences?.length ?? 0) > 1 ? <option value="all">All chromosomes / contigs</option> : null}{reference.sequences?.map(sequence => <option key={sequence.name} value={sequence.name}>{sequence.name}</option>)}</select>
      <label htmlFor="genome-locus">Region</label>
      <input id="genome-locus" value={locus} onInput={event => setLocus(event.currentTarget.value)} disabled={!ready || evidenceUpdating} />
      <Button data-control="genome-go" type="submit" variant="default" disabled={!ready || evidenceUpdating}>Search</Button>
      <ActionIcon data-control="genome-zoom-in" type="button" variant="default" size="lg" disabled={!ready || evidenceUpdating || chromosome === 'all'} onClick={() => zoom(0.5)} aria-label="Zoom in" title="Zoom in">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10h6M10 7v6" />
        </svg>
      </ActionIcon>
      <ActionIcon data-control="genome-zoom-out" type="button" variant="default" size="lg" disabled={!ready || evidenceUpdating || chromosome === 'all'} onClick={() => zoom(2)} aria-label="Zoom out" title="Zoom out">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10h6" />
        </svg>
      </ActionIcon>
      <Button data-control="genome-wheel-mode" type="button" variant="default" disabled={!ready} aria-pressed={wheelMode === 'scroll'} onClick={() => setWheelMode(current => current === 'zoom' ? 'scroll' : 'zoom')}>Wheel: {wheelMode === 'zoom' ? 'Zoom' : 'Vertical scroll'}</Button>
      <GenomeSettings ready={ready} opened={settingsOpen} setOpened={setSettingsOpen} referenceName={reference.name}
        tracks={view.content.tracks} shown={id => tracks[id]?.state === 'shown'} display={display} />
      <Popover opened={chooserOpen} onChange={setChooserOpen} position="bottom-end" width={420} withinPortal>
        <Popover.Target><Button data-control="genome-track-chooser" type="button" variant="default" disabled={!ready} aria-expanded={chooserOpen} onClick={() => setChooserOpen(current => !current)}>Tracks{Object.values(tracks).some(track => track.state === 'failed') ? ' · unavailable tracks' : ''}</Button></Popover.Target>
        <Popover.Dropdown className="genome-track-chooser">
          <Text fw={600} mb="sm">Track visibility</Text>
          {view.items ? <Text size="xs" c="dimmed" mb="sm">Grouped by isolate and ordered for this locus.</Text> : null}
          {orderedTracks.length === 0 ? <Text size="sm">No tracks are available for this reference.</Text> : null}
          <ul className="genome-track-list" aria-label="Track visibility">
            {orderedTracks.map(track => <li key={track.id} className="genome-track" data-track-group={track.group}>
              <Switch data-track-id={track.id} label={trackName(track)} checked={tracks[track.id]?.state === 'shown' || tracks[track.id]?.state === 'loading'} disabled={!ready || evidenceUpdating || !!track.problem || tracks[track.id]?.state === 'loading'} onChange={() => toggle(track)} />
              <Text size="xs" c="dimmed">{track.size === undefined ? '' : `${(track.size / 1024 / 1024).toFixed(1)} MiB · `}{tracks[track.id]?.state ?? 'hidden'}</Text>
              {tracks[track.id]?.message ? <Text role="alert" size="sm">{tracks[track.id]?.message}</Text> : null}
            </li>)}
          </ul>
        </Popover.Dropdown>
      </Popover>
      <Menu opened={legend} onChange={setLegend} position="bottom-end" width={300} withinPortal>
        <Menu.Target><ActionIcon data-control="genome-help" type="button" variant="default" size="lg" aria-label="Genome help topics" aria-expanded={legend}>?</ActionIcon></Menu.Target>
        <Menu.Dropdown className="genome-help-menu">
          {helpDocuments.map(document => <Menu.Item key={document.id} onClick={() => openHelp(document)}>{document.title}</Menu.Item>)}
          {helpSections.length > 0 ? <Menu.Divider /> : null}
          {helpSections.map(section => <Menu.Item key={section.id} onClick={() => openHelp(section)}>{section.title}</Menu.Item>)}
          <Menu.Divider />
          <Menu.Item onClick={() => openHelp('sources')}>Sources and provenance</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </form>
    <Modal opened={helpTopic !== undefined} onClose={() => setHelpTopic(undefined)} title={helpTopic === 'sources' ? 'Sources and provenance' : helpTopic?.title} size="xl" classNames={{body: 'genome-help-body'}}>
      {helpTopic === 'sources' ? <Provenance view={view} /> : helpTopic ? <DocumentBody document={helpTopic} select={() => {}} /> : null}
    </Modal>
    {item ? <>
      <Group gap="sm" className="genome-review-controls">
        <label htmlFor="genome-preset">Evidence preset</label>
        <select id="genome-preset" value={presetId} disabled={!ready} onChange={event => setPresetId(event.currentTarget.value)}>
          {view.content.presets?.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        <Button variant="default" aria-expanded={itemCard} onClick={() => setItemCard(current => !current)}>Locus details</Button>
      </Group>
      {itemCard ? <aside className="genome-item-card" aria-label="Selected locus">
        <Text fw={600}>{item.label}</Text>
        <div className="genome-item-sections">{item.details?.map(section => <section key={section.title}>
          <Text fw={600} size="sm">{section.title}</Text>
          <dl>{section.rows.map((row, index) => <React.Fragment key={index}><dt>{row.label}</dt><dd>{row.value}</dd></React.Fragment>)}</dl>
        </section>)}</div>
      </aside> : null}
    </> : null}
    {error ? <Alert role="alert" color="red">{error}</Alert> : !ready ? <Text role="status">Loading reference…</Text> : null}
    {ready && evidenceUpdating && !error ? <Text role="status">Updating evidence for the selected locus…</Text> : null}
    <div className={!evidenceUpdating && details ? 'genome-viewer with-details' : 'genome-viewer'} aria-busy={evidenceUpdating}>
      <div className={evidenceUpdating ? 'genome-canvas evidence-updating' : 'genome-canvas'} ref={element} />
      <FeatureDetailsPanel key={view.id} details={evidenceUpdating ? undefined : details} close={() => setDetails(undefined)} help={clickDetailsHelp ? () => openHelp(clickDetailsHelp) : undefined} />
    </div>
  </section>;
}
