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
};

export async function zoomGenome(instance: Browser, scale: number, center?: number): Promise<void> {
  const viewer = instance as ViewerBrowser;
  const current = viewer.referenceFrameList[0];
  if (current) {
    await current.zoomWithScaleFactor(instance, scale, viewer.calculateViewportWidth(1), center);
    viewer.fireEvent('zoom', [[current]]);
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
