import type {DisplayTrack} from './use-genome-display.js';

type ResizableTrack = DisplayTrack & {autoHeight?: boolean};
// Native scrolling members in the pinned IGV implementation, omitted from its declarations.
type ScrollingView = {
  scrollByPixels: (delta: number) => void;
  setTop: (contentTop: number) => void;
  maxViewportContentHeight: () => number;
  viewports: {viewportElement: HTMLElement; getContentTop: () => number}[];
  innerScroll?: HTMLElement;
  genomeScrollGuard?: true;
};

/**
 * IGV's vertical drag scrolls a track by `scrollByPixels`, which lets content shorter than its
 * track move below the top edge, as happens once a track is resized taller than its content. Keep
 * the content top between 0 and the part that does not fit.
 */
function guardScrolling(view: ScrollingView): void {
  const clamp = (top: number): number => {
    const height = view.viewports[0]?.viewportElement.clientHeight ?? 0;
    return Math.min(Math.max(0, top), Math.max(0, view.maxViewportContentHeight() - height));
  };
  if (!view.genomeScrollGuard) {
    view.genomeScrollGuard = true;
    view.scrollByPixels = delta => {
      const top = clamp((view.viewports[0]?.getContentTop() ?? 0) + delta);
      view.setTop(top);
      // IGV's scroll indicator follows the content, as in the replaced native method.
      const height = view.viewports[0]?.viewportElement.clientHeight ?? 0;
      const content = view.maxViewportContentHeight();
      if (view.innerScroll && content > 0) {
        view.innerScroll.style.top = `${Math.round(top * height / content)}px`;
      }
    };
  }
  const top = view.viewports[0]?.getContentTop() ?? 0;
  if (clamp(top) !== top) {
    view.setTop(clamp(top));
  }
}

const minimumHeight = 30;
const maximumHeight = 2000;

/**
 * A separator at the bottom of each of a track's viewports; dragging it or pressing ↑/↓ sets a
 * fixed height, a double click or Home returns the track to its automatic height. `onResize`
 * receives the fixed height, or nothing when the caller sizes the track again, as for alignments.
 * IGV replaces a track's viewports when the number of region panels changes, so the caller attaches
 * again after a locus change; viewports that already have a separator are skipped.
 */
export function attachTrackResize(track: ResizableTrack, name: string, onResize: (height: number | undefined) => void): void {
  const view = track.trackView;
  if (!view) {
    return;
  }
  const automatic = track.type !== 'alignment';
  const scrolling = view as unknown as ScrollingView;
  if (typeof scrolling.scrollByPixels === 'function') {
    guardScrolling(scrolling);
  }
  const setHeight = (height: number): void => {
    const next = Math.round(Math.min(maximumHeight, Math.max(minimumHeight, height)));
    track.autoHeight = false;
    view.setTrackHeight(next, true);
    if (typeof scrolling.scrollByPixels === 'function') {
      guardScrolling(scrolling);
    }
    onResize(next);
  };
  const restore = (): void => {
    if (automatic) {
      track.autoHeight = true;
      view.checkContentHeight();
    }
    onResize(undefined);
  };
  const viewports = (view as {viewports?: unknown[]}).viewports as {viewportElement: HTMLElement}[] | undefined;
  for (const viewport of viewports ?? []) {
    if (viewport.viewportElement.querySelector(':scope > .genome-track-resize')) {
      continue;
    }
    const handle = document.createElement('div');
    handle.className = 'genome-track-resize';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', `Resize ${name}`);
    handle.tabIndex = 0;
    // IGV pans and opens popups from its viewport listeners; the handle keeps its events.
    for (const type of ['mousedown', 'click', 'dblclick', 'touchstart']) {
      handle.addEventListener(type, event => event.stopPropagation());
    }
    handle.addEventListener('dblclick', restore);
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = track.height ?? viewport.viewportElement.clientHeight;
      const move = (next: PointerEvent): void => setHeight(startHeight + next.clientY - startY);
      const end = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('keydown', event => {
      const height = track.height ?? viewport.viewportElement.clientHeight;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        setHeight(height + (event.key === 'ArrowUp' ? -10 : 10));
      } else if (event.key === 'Home') {
        restore();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });
    viewport.viewportElement.appendChild(handle);
  }
}
