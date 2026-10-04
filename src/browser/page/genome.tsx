import React, {useEffect, useRef, useState} from 'react';
import {ActionIcon, Alert, Button, Group, Popover, Text} from '@mantine/core';
import type {Browser, IGV} from 'igv';
import type {GenomeTrack, GenomeView} from '../contract.js';
import {DocumentBody} from './document.js';
import {Provenance} from './provenance.js';
import {defaultGenomeTextSize, themeGenomeBrowser} from './genome-theme.js';

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
type ReferenceFrame = {chr: string; start: number; end: number; getLocusString?: () => string};
// These native members are implemented by the pinned library but omitted from
// its declarations. Its browser-level zoom/layout wrappers detach redraw
// promises; use the underlying methods to await loads and failures.
type NativeReferenceFrame = ReferenceFrame & {
  zoomWithScaleFactor: (browser: Browser, scale: number, width: number, center?: number) => Promise<void>;
};
type ViewerBrowser = Browser & {
  referenceFrameList: NativeReferenceFrame[];
  calculateViewportWidth: (columns: number) => number;
  boundWindowResizeHandler: () => Promise<void>;
  fireEvent: (name: string, args: unknown[]) => void;
  setCursorGuideVisibility: (visible: boolean) => void;
};
async function zoomGenome(instance: Browser, scale: number, center?: number): Promise<void> {
  const viewer = instance as ViewerBrowser;
  const current = viewer.referenceFrameList[0];
  if (current) {
    await current.zoomWithScaleFactor(instance, scale, viewer.calculateViewportWidth(1), center);
    viewer.fireEvent('zoom', [[current]]);
  }
}
const minimumBases = 10;
type FeatureDetails = {trackId?: string; title: string; rows: {label: string; value: string}[]};
// These layout/label properties are present in the pinned IGV implementation but omitted
// from its declarations. Keep this small adapter separate from the documented click API.
type DisplayTrack = Parameters<Browser['removeTrack']>[0] & {
  height?: number;
  trackView?: {setTrackHeight: (height: number, force: boolean) => void; viewports?: {trackLabelElement: HTMLElement}[]};
};

function detailRows(data: unknown): FeatureDetails['rows'] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || !('name' in entry) || !('value' in entry) || entry.value === undefined || entry.value === null) {
      return [];
    }
    // Render the recorded values as text, never IGV's popup HTML or executable markup.
    return [{label: String(entry.name), value: String(entry.value)}];
  });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GenomePanel({view, load = loadGenomeLibrary}: {view: GenomeView; load?: GenomeLibraryLoader}): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null);
  const browser = useRef<Browser | undefined>(undefined);
  const theme = useRef<ReturnType<typeof themeGenomeBrowser> | undefined>(undefined);
  const navigation = useRef<Promise<void>>(Promise.resolve());
  const loaded = useRef(new Map<string, Parameters<Browser['removeTrack']>[0]>());
  const [ready, setReady] = useState(false);
  const [textSize, setTextSize] = useState(defaultGenomeTextSize);
  const textSizeRef = useRef(textSize);
  textSizeRef.current = textSize;
  const [error, setError] = useState<string>();
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});
  const [locus, setLocus] = useState('');
  const [legend, setLegend] = useState(false);
  const [chromosome, setChromosome] = useState('');
  const frame = useRef<ReferenceFrame | undefined>(undefined);
  const [details, setDetails] = useState<FeatureDetails>();
  const reference = view.content.reference;

  const runNavigation = (instance: Browser, action: () => unknown): Promise<void> => {
    const pending = navigation.current.then(async () => {
      if (browser.current === instance) {
        await action();
      }
    }).catch(cause => {
      if (browser.current === instance) {
        setError(message(cause));
      }
    });
    navigation.current = pending;
    return pending;
  };
  const zoom = (scale: number): void => {
    const instance = browser.current;
    if (instance) {
      setError(undefined);
      void runNavigation(instance, () => zoomGenome(instance, scale));
    }
  };

  const fitTracks = (): void => {
    const height = Math.max(180, Math.floor(((element.current?.clientHeight || 560) - 100) / Math.max(1, loaded.current.size)));
    for (const track of loaded.current.values()) {
      const display = track as DisplayTrack;
      if (display.height !== height) {
        display.trackView?.setTrackHeight(height, true);
      }
    }
  };

  const addTrack = async (instance: Browser, track: GenomeTrack): Promise<void> => {
    setTracks(current => ({...current, [track.id]: {state: 'loading'}}));
    try {
      const result = await instance.loadTrack({name: track.name, type: 'annotation', format: track.format, url: track.file, indexed: false,
        order: view.content.tracks.indexOf(track), removable: false,
        height: Math.max(280, (element.current?.clientHeight || 560) - 100), autoHeight: false});
      if (browser.current !== instance) {
        return;
      }
      if (!result) {
        throw new Error('The genome library could not load this track.');
      }
      loaded.current.set(track.id, result);
      theme.current?.refresh();
      fitTracks();
      setTracks(current => ({...current, [track.id]: {state: 'shown'}}));
    } catch (cause) {
      if (browser.current === instance) {
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
    navigation.current = Promise.resolve();
    setReady(false);
    setError(undefined);
    setDetails(undefined);
    loaded.current.clear();
    setTracks(Object.fromEntries(view.content.tracks.map(track => [track.id, {state: track.problem ? 'failed' : 'hidden', message: track.problem}])));
    const sequence = reference.sequences?.[0];
    const initialLocus = sequence ? `${sequence.name}:1-${Math.min(sequence.length, 2000)}` : '';
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
        instance.on('trackclick', (track, data) => {
          if (active && browser.current === instance) {
            const source = view.content.tracks.find(candidate => loaded.current.get(candidate.id) === track);
            const rows = detailRows(data);
            setDetails(rows.length ? {trackId: source?.id, title: source?.name ?? track.name ?? reference.name, rows} : undefined);
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
            .igv-viewport { border-color: var(--border); background: var(--background); }
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
            if (!target) {
              return;
            }
            // Labels have a separate IGV popup handler; capture them before that handler.
            event.stopImmediatePropagation();
            event.preventDefault();
            const source = view.content.tracks.find(candidate => (loaded.current.get(candidate.id) as DisplayTrack | undefined)?.trackView?.viewports?.some(viewport => viewport.trackLabelElement === target));
            setDetails({trackId: source?.id, title: source?.name ?? target.textContent ?? reference.name,
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
              if (!active || !current || !wheelBounds || browser.current !== instance) {
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
          shadow.addEventListener('wheel', wheel, {passive: false});
          shadow.addEventListener('mouseover', clearTitles);
          shadow.addEventListener('mousemove', clearTitles);
          shadow.addEventListener('click', labelClick, true);
          removeMouseHandlers = () => {
            style.remove();
            if (wheelFrame !== undefined) {
              cancelAnimationFrame(wheelFrame);
            }
            shadow.removeEventListener('wheel', wheel);
            shadow.removeEventListener('mouseover', clearTitles);
            shadow.removeEventListener('mousemove', clearTitles);
            shadow.removeEventListener('click', labelClick, true);
          };
        }
        theme.current = themeGenomeBrowser(instance, element.current!, textSizeRef.current);
        setReady(true);
        for (const track of view.content.tracks) {
          if (!active) {
            break;
          }
          if (track.shown && !track.problem) {
            await addTrack(instance, track);
          }
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
    theme.current?.setTextSize(textSize);
  }, [textSize]);

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
        setLegend(current => !current);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

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
    if (!instance) {
      return;
    }
    const existing = loaded.current.get(track.id);
    if (existing) {
      instance.removeTrack(existing);
      loaded.current.delete(track.id);
      setDetails(current => current?.trackId === track.id ? undefined : current);
      fitTracks();
      setTracks(current => ({...current, [track.id]: {state: 'hidden'}}));
    } else {
      void addTrack(instance, track);
    }
  };
  return <section className="genome-area" data-view-kind="genome">
    <form onSubmit={navigate} className="genome-navigation">
      <label htmlFor="genome-chromosome">Chromosome / contig</label>
      <select id="genome-chromosome" value={chromosome} disabled={!ready} onChange={event => {
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
      <input id="genome-locus" value={locus} onInput={event => setLocus(event.currentTarget.value)} disabled={!ready} />
      <Button data-control="genome-go" type="submit" variant="default" disabled={!ready}>Go</Button>
      <Button data-control="genome-zoom-in" type="button" variant="default" disabled={!ready || chromosome === 'all'} onClick={() => zoom(0.5)} aria-label="Zoom in">+</Button>
      <Button data-control="genome-zoom-out" type="button" variant="default" disabled={!ready || chromosome === 'all'} onClick={() => zoom(2)} aria-label="Zoom out">−</Button>
      <Group gap="xs" role="group" aria-label="Viewer text size">
        <Text size="sm">Text</Text>
        <Button data-control="genome-text-smaller" type="button" variant="default" disabled={!ready || textSize <= 12} aria-label="Smaller viewer text" onClick={() => setTextSize(size => Math.max(12, size - 2))}>A−</Button>
        <output aria-live="polite" aria-label="Viewer text size">{textSize} px</output>
        <Button data-control="genome-text-larger" type="button" variant="default" disabled={!ready || textSize >= 24} aria-label="Larger viewer text" onClick={() => setTextSize(size => Math.min(24, size + 2))}>A+</Button>
      </Group>
      <Popover opened={legend} onChange={setLegend} position="bottom-end" width={420} withinPortal>
        <Popover.Target><ActionIcon data-control="genome-help" type="button" variant="default" size="lg" aria-label="How to read the viewer" aria-expanded={legend} onClick={() => setLegend(current => !current)}>?</ActionIcon></Popover.Target>
        <Popover.Dropdown className="genome-help">{view.content.legend ? <DocumentBody document={view.content.legend} select={() => {}} /> : null}<Provenance view={view} /></Popover.Dropdown>
      </Popover>
    </form>
    {error ? <Alert role="alert" color="red">{error}</Alert> : !ready ? <Text role="status">Loading reference…</Text> : null}
    <fieldset className="genome-tracks"><legend>Tracks</legend>
      {view.content.tracks.length === 0 ? <Text size="sm">No annotation is available for this reference.</Text> : null}
      {view.content.tracks.map(track => <div key={track.id} className="genome-track">
        <label><input type="checkbox" data-track-id={track.id} checked={tracks[track.id]?.state === 'shown' || tracks[track.id]?.state === 'loading'} disabled={!ready || !!track.problem || tracks[track.id]?.state === 'loading'} onChange={() => toggle(track)} /> {track.name}</label>
        <Text size="xs" c="dimmed">{track.size === undefined ? '' : `${(track.size / 1024 / 1024).toFixed(1)} MiB · `}{tracks[track.id]?.state ?? 'hidden'}</Text>
        {tracks[track.id]?.message ? <Text role="alert" size="sm">{tracks[track.id]?.message}</Text> : null}
      </div>)}
    </fieldset>
    <div className={details ? 'genome-viewer with-details' : 'genome-viewer'}>
      <div className="genome-canvas" ref={element} />
      {details ? <aside className="genome-details" data-panel="feature-details" aria-live="polite">
        <Group justify="space-between" align="flex-start" mb="md"><Text fw={600}>{details.title}</Text><Button data-control="close-feature-details" variant="subtle" size="compact-sm" onClick={() => setDetails(undefined)}>Close</Button></Group>
        <dl>{details.rows.map((row, index) => <React.Fragment key={index}><dt>{row.label}</dt><dd>{row.value}</dd></React.Fragment>)}</dl>
      </aside> : null}
    </div>
  </section>;
}
