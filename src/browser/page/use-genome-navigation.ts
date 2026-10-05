import {useRef, useState, type RefObject} from 'react';
import type {Browser} from 'igv';

export type ReferenceFrame = {chr: string; start: number; end: number; getLocusString?: () => string};
// Native methods in the pinned IGV implementation, omitted from its declarations.
export type ViewerBrowser = Browser & {
  referenceFrameList: (ReferenceFrame & {
    zoomWithScaleFactor: (browser: Browser, scale: number, width: number, center?: number) => Promise<void>;
  })[];
  calculateViewportWidth: (columns: number) => number;
  boundWindowResizeHandler: () => Promise<void>;
  fireEvent: (name: string, args: unknown[]) => void;
  setCursorGuideVisibility: (visible: boolean) => void;
  doShowTrackLabels: boolean;
  setTrackLabelVisibility: (visible: boolean) => void;
  /** One viewport per region panel, in the order of `referenceFrameList`. */
  trackViews: {viewports?: {viewportElement: HTMLElement}[]}[];
};

/** The region panel an element lies in, as an index into `referenceFrameList`; 0 outside any panel. */
export function frameIndexAt(instance: Browser, target: EventTarget | null): number {
  const element = target instanceof Element ? target.closest('.igv-viewport') : null;
  for (const trackView of (instance as ViewerBrowser).trackViews ?? []) {
    const index = trackView.viewports?.findIndex(viewport => viewport.viewportElement === element) ?? -1;
    if (index >= 0) {
      return index;
    }
  }
  return 0;
}

/** Zooms one region panel, or every panel around its own centre when no panel is given. */
export async function zoomGenome(instance: Browser, scale: number, center?: number, index?: number): Promise<void> {
  const viewer = instance as ViewerBrowser;
  const frames = index === undefined ? viewer.referenceFrameList : viewer.referenceFrameList.slice(index, index + 1);
  const width = viewer.calculateViewportWidth(viewer.referenceFrameList.length);
  for (const current of frames) {
    await current.zoomWithScaleFactor(instance, scale, width, index === undefined ? undefined : center);
  }
  if (frames.length > 0) {
    viewer.fireEvent('zoom', [frames]);
  }
}

/** Serialize IGV operations whose native wrappers otherwise detach redraw promises. */
export function useGenomeNavigation(browser: RefObject<Browser | undefined>) {
  const pending = useRef<Promise<void>>(Promise.resolve());
  const [error, setError] = useState<string>();
  const run = (instance: Browser, action: () => unknown, current = () => browser.current === instance): Promise<void> => {
    const next = pending.current.then(async () => {
      if (current()) {
        await action();
      }
    }).catch(cause => {
      if (current()) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    pending.current = next;
    return next;
  };
  const zoom = (scale: number): void => {
    const instance = browser.current;
    if (instance) {
      setError(undefined);
      void run(instance, () => zoomGenome(instance, scale));
    }
  };
  return {run, zoom, error, setError, reset: () => { pending.current = Promise.resolve(); }};
}
