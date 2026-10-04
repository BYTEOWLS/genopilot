import type {Browser} from 'igv';
import {wrapGenomeDraw} from './genome-canvas.js';
import {genomeColorDiagnostics} from './genome-color-diagnostics.js';
import {applyGenomeGeometry, defaultGenomeTextSize, type ThemeTrack, type ThemeTrackView} from './genome-geometry.js';
import {genomePalette, type AnnotationColors} from './genome-palette.js';

export {defaultGenomeTextSize} from './genome-geometry.js';
export type {AnnotationColors} from './genome-palette.js';

type ThemeBrowser = Browser & {trackViews: ThemeTrackView[]};

/** Own one canvas wrapper per track and release it when the track leaves the viewer. */
export function themeGenomeBrowser(browser: Browser, host: HTMLElement, initialTextSize = defaultGenomeTextSize): {
  refresh: () => void;
  setTextSize: (size: number) => void;
  setAnnotationColors: (track: object, colors?: AnnotationColors) => void;
  setColorDiagnostics: (enabled: boolean) => void;
  releaseTrack: (track: object) => void;
  dispose: () => void;
} {
  const instance = browser as ThemeBrowser;
  const originals = new Map<ThemeTrack, ThemeTrack['draw']>();
  const annotationColors = new Map<object, AnnotationColors>();
  const originalHeights = new Map<ThemeTrack, NonNullable<ThemeTrack['computePixelHeight']>>();
  const diagnostics = genomeColorDiagnostics();
  const appearance = {palette: genomePalette(host), textSize: initialTextSize};

  const refresh = (): void => {
    appearance.palette = genomePalette(host);
    host.style.setProperty('--genome-text-size', `${appearance.textSize}px`);
    for (const view of instance.trackViews) {
      const track = view.track;
      if (track.type === 'annotation') {
        const colors = annotationColors.get(track);
        track.color = colors?.forward ?? appearance.palette.track;
        track.altColor = colors?.reverse ?? appearance.palette.reverse;
      }
      applyGenomeGeometry(view, appearance.textSize, originalHeights);
      if (!originals.has(track)) {
        originals.set(track, track.draw);
        track.draw = wrapGenomeDraw(track, track.draw, appearance, diagnostics);
      }
      view.repaintViews();
    }
  };
  const releaseTrack = (track: object): void => {
    const themed = track as ThemeTrack;
    const draw = originals.get(themed);
    if (draw) {
      themed.draw = draw;
      originals.delete(themed);
    }
    const compute = originalHeights.get(themed);
    if (compute) {
      themed.computePixelHeight = compute;
      originalHeights.delete(themed);
    }
    annotationColors.delete(track);
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-mantine-color-scheme']});
  return {
    refresh,
    setTextSize: size => {
      appearance.textSize = Math.max(12, Math.min(24, size));
      refresh();
    },
    setAnnotationColors: (track, colors) => {
      if (colors) {
        annotationColors.set(track, colors);
      } else {
        annotationColors.delete(track);
      }
      refresh();
    },
    setColorDiagnostics: enabled => {
      diagnostics.setEnabled(enabled);
      refresh();
    },
    releaseTrack,
    dispose: () => {
      observer.disconnect();
      for (const track of originals.keys()) {
        releaseTrack(track);
      }
      annotationColors.clear();
      diagnostics.clear();
      host.style.removeProperty('--genome-text-size');
    },
  };
}
