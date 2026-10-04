import type {Browser} from 'igv';

// The pinned IGV.js renderer has no theme option and hard-codes neutral canvas
// colors. Keep this implementation-specific adapter local to the genome view;
// never filter/invert the canvas, which would also change nucleotide hues.
type DrawOptions = {context: CanvasRenderingContext2D; bpPerPixel?: number};
type ThemeTrack = {
  type: string;
  color?: string;
  height: number;
  featureHeight?: number;
  expandedRowHeight?: number;
  squishedRowHeight?: number;
  computePixelHeight?: (features: unknown) => number;
  draw: (options: DrawOptions) => void;
};
type ThemeBrowser = Browser & {
  trackViews: {
    track: ThemeTrack;
    repaintViews: () => void;
    checkContentHeight: () => void;
    setTrackHeight: (height: number, force: boolean) => void;
    viewports: {setContentHeight: (height: number) => void}[];
  }[];
};

export const defaultGenomeTextSize = 16;
const proteinCodonColors: Record<string, [string, string]> = {
  'rgb(124,124,204)': ['#a5d8ff', '#1864ab'],
  'rgb(12,12,120)': ['#74c0fc', '#1971c2'],
  '#83f902': ['#b2f2bb', '#2b8a3e'],
  '#ff2101': ['#ffc9c9', '#c92a2a'],
};

export function themeGenomeBrowser(browser: Browser, host: HTMLElement, initialTextSize = defaultGenomeTextSize): {
  refresh: () => void; setTextSize: (size: number) => void; dispose: () => void;
} {
  const instance = browser as ThemeBrowser;
  const originals = new Map<ThemeTrack, ThemeTrack['draw']>();
  let background = '';
  let foreground = '';
  let trackColor = '';
  let dark = false;
  let textSize = initialTextSize;
  const originalHeights = new Map<ThemeTrack, NonNullable<ThemeTrack['computePixelHeight']>>();

  const neutralColor = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      return value;
    }
    const color = value.replace(/\s/g, '').toLowerCase();
    if (['white', '#fff', '#ffffff', 'rgb(255,255,255)'].includes(color)) {
      return background;
    }
    if (['black', '#000', '#000000', 'rgb(0,0,0)', 'rgb(68,68,68)'].includes(color)) {
      return foreground;
    }
    return value;
  };

  const refresh = (): void => {
    const styles = getComputedStyle(host);
    background = styles.backgroundColor;
    foreground = styles.color;
    // Resolve the dedicated blue token to a concrete canvas color. Keep a
    // contrast-safe fallback if the theme stylesheet has not loaded yet.
    dark = document.documentElement.dataset.mantineColorScheme === 'dark';
    const fallback = dark ? '#74c0fc' : '#1c7ed6';
    const probe = document.createElement('span');
    probe.style.color = `var(--genome-track-color, ${fallback})`;
    // IGV owns a shadow root without a slot. An unslotted light-DOM probe
    // is outside the rendered tree and can have an empty computed color.
    // Canvas silently ignores that paint, leaving the background as the exon
    // fill; codons only become visible because they use separate literal fills.
    (host.shadowRoot ?? host).appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    trackColor = resolved && CSS.supports('color', resolved) ? resolved : fallback;
    probe.remove();
    host.style.setProperty('--genome-text-size', `${textSize}px`);
    for (const view of instance.trackViews) {
      const track = view.track;
      if (track.type === 'annotation') {
        track.color = trackColor;
        track.featureHeight = 14 + (textSize - 12);
        track.expandedRowHeight = 30 + 2 * (textSize - 12);
        track.squishedRowHeight = 15 + (textSize - 12);
      }
      if (track.type === 'sequence' && track.computePixelHeight && !originalHeights.has(track)) {
        const compute = track.computePixelHeight;
        originalHeights.set(track, compute);
        track.computePixelHeight = function (features): number {
          this.height = compute.call(this, features) + textSize - 12;
          return this.height;
        };
      }
      if (track.type === 'sequence') {
        const height = track.computePixelHeight?.([]) ?? 25 + textSize - 12;
        for (const viewport of view.viewports) {
          viewport.setContentHeight(height);
        }
        view.setTrackHeight(height, true);
      } else if (track.type === 'ruler') {
        view.setTrackHeight(40 + textSize - 12, true);
      } else if (track.type === 'annotation') {
        view.checkContentHeight();
      }
      if (!originals.has(track)) {
        const draw = track.draw;
        originals.set(track, draw);
        track.draw = function (options): void {
          const context = options.context;
          // Protein text and canvas backgrounds both use white in IGV, but
          // need different theme roles. Codons keep opaque, alternating fills.
          const proteinText = dark ? '#fff' : '#102a43';
          const paintColor = (value: unknown): unknown => {
            if (typeof value !== 'string') {
              return value;
            }
            const color = value.replace(/\s/g, '').toLowerCase();
            if (track.type === 'annotation') {
              if (color === '#ffffff') {
                return proteinText;
              }
              const codon = proteinCodonColors[color];
              if (codon) {
                return codon[dark ? 1 : 0];
              }
              if (['rgb(0,0,150)', '#000096'].includes(color)) {
                return trackColor;
              }
            }
            if (track.type === 'sequence') {
              // Keep nucleotide hue identities; adjust only brightness for
              // contrast against the current background, including unresolved N.
              const rgb = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color);
              if (rgb) {
                const channels = rgb.slice(1).map(channel => {
                  const original = Number(channel);
                  return Math.round(dark ? original + (255 - original) * 0.4 : original * 0.7);
                });
                return `rgb(${channels.join(',')})`;
              }
              if (color === 'gray') {
                return foreground;
              }
            }
            return neutralColor(value);
          };
          // Bind native canvas methods to the real context while adapting paints
          // and glyphs locally; genomic coordinates and source data stay intact.
          const themed = new Proxy(context, {
            get(target, key) {
              if (track.type === 'sequence' && key === 'strokeText') {
                return (text: string, x: number, y: number, maxWidth?: number): void => {
                  target.save();
                  target.fillStyle = target.strokeStyle;
                  if (y === 15 && options.bpPerPixel && /^[A-Z]$/i.test(text)) {
                    const width = 1 / options.bpPerPixel;
                    const center = x + target.measureText(text).width / 2;
                    target.globalAlpha = dark ? 0.18 : 0.1;
                    target.fillRect(center - width / 2, y - textSize, width, textSize + 4);
                    target.globalAlpha = 1;
                  }
                  // IGV strokes reference letters, leaving them hollow. Filled
                  // glyphs are clearer and retain the nucleotide's themed hue.
                  if (maxWidth === undefined) {
                    target.fillText(text, x, y);
                  } else {
                    target.fillText(text, x, y, maxWidth);
                  }
                  target.restore();
                };
              }
              if (track.type === 'annotation' && key === 'fillText') {
                return (text: string, x: number, y: number, maxWidth?: number): void => {
                  // Feature labels sit below the boxes on a fixed 25px baseline;
                  // leave in-box amino-acid text at its original position.
                  const baseline = y + (target.textAlign === 'center' ? 2 * (textSize - 12) : 0);
                  if (maxWidth === undefined) {
                    target.fillText(text, x, baseline);
                  } else {
                    target.fillText(text, x, baseline, maxWidth);
                  }
                };
              }
              if (track.type === 'annotation' && key === 'clearRect') {
                return (x: number, y: number, width: number, height: number): void => {
                  target.clearRect(x, y + 2 * (textSize - 12), width, height);
                };
              }
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, key, value: unknown) {
              const paint = key === 'fillStyle' || key === 'strokeStyle' ? paintColor(value) : value;
              const adapted = key === 'font' && typeof paint === 'string' ? paint.replace(/[\d.]+px/, `${textSize}px`) : paint;
              return Reflect.set(target, key, adapted, target);
            },
          });
          context.save();
          context.fillStyle = foreground;
          context.strokeStyle = foreground;
          context.font = `${textSize}px sans-serif`;
          // IGV positions reference letters on a fixed 15px baseline. Move the
          // sequence drawing down with its enlarged row to keep ascenders visible.
          if (this.type === 'sequence') {
            context.translate(0, textSize - 12);
          }
          try {
            draw.call(this, {...options, context: themed});
          } finally {
            context.restore();
          }
        };
      }
      view.repaintViews();
    }
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-mantine-color-scheme']});
  return {refresh, setTextSize: size => {
    textSize = Math.max(12, Math.min(24, size));
    refresh();
  }, dispose: () => {
    observer.disconnect();
    for (const [track, draw] of originals) {
      track.draw = draw;
    }
    for (const [track, compute] of originalHeights) {
      track.computePixelHeight = compute;
    }
    originals.clear();
    originalHeights.clear();
    host.style.removeProperty('--genome-text-size');
  }};
}
