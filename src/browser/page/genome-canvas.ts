import {centeredBaseline, nativeGeometry, textGrowth, type ThemeTrack} from './genome-geometry.js';
import {colorChannels, colorKey, contrastingText, genomePaint, knownEvidenceColors, type CanvasPaint, type GenomePalette, type PaintRole} from './genome-palette.js';
import type {GenomeColorDiagnostics} from './genome-color-diagnostics.js';

type Appearance = {palette: GenomePalette; textSize: number};

function fillGlyph(context: CanvasRenderingContext2D, text: string, x: number, y: number, paint: CanvasPaint, maxWidth?: number): void {
  context.fillStyle = paint;
  if (maxWidth === undefined) {
    context.fillText(text, x, y);
  } else {
    context.fillText(text, x, y, maxWidth);
  }
}

/** Only local canvas methods are intercepted. No canvas filters or global prototype changes. */
export function wrapGenomeDraw(track: ThemeTrack, draw: ThemeTrack['draw'], appearance: Appearance,
  diagnostics: GenomeColorDiagnostics): ThemeTrack['draw'] {
  return function (this: ThemeTrack, options): void {
    const {context} = options;
    const {palette, textSize} = appearance;
    const savedFills: CanvasPaint[] = [];
    const evidence = knownEvidenceColors(track);
    const nucleotideRGB = new Set(Object.values(track.browser?.nucleotideColors ?? {}).map(color => colorChannels(color)?.slice(0, 3).join(',')));
    let lastPaintedFill: CanvasPaint = context.fillStyle;

    const paint = (operation: string, role: PaintRole, source: CanvasPaint): CanvasPaint => {
      const result = genomePaint(track, role, source, palette, savedFills.at(-1) ?? track.color ?? palette.track, evidence);
      // Base-quality alpha changes the paint, not the nucleotide identity.
      const nucleotide = track.type === 'alignment' && nucleotideRGB.has(colorChannels(source)?.slice(0, 3).join(','));
      if (!result.known && !nucleotide) {
        diagnostics.record(track.type, operation, source);
      }
      return result.paint;
    };
    const withPaint = (operation: string, role: PaintRole, stroke: boolean, action: () => void): void => {
      const property = stroke ? 'strokeStyle' : 'fillStyle';
      const original = context[property];
      const adapted = paint(operation, role, original);
      if (adapted !== original) {
        context[property] = adapted;
      }
      if (!stroke) {
        lastPaintedFill = adapted;
      }
      try {
        action();
      } finally {
        if (adapted !== original) {
          context[property] = original;
        }
      }
    };

    const drawSequenceGlyph = (text: string, x: number, y: number, maxWidth?: number): void => {
      context.save();
      try {
        const marker = text === 'START' ? palette.start : text === 'STOP' ? palette.stop : undefined;
        const dna = y === nativeGeometry.dnaBaseline && /^[A-Z]$/i.test(text);
        const color = marker?.text ?? paint('strokeText', dna ? 'nucleotide' : 'text', context.strokeStyle);
        if (dna && options.bpPerPixel) {
          const width = 1 / options.bpPerPixel;
          const center = x + context.measureText(text).width / 2;
          context.fillStyle = color;
          context.globalAlpha = palette.dark ? 0.18 : 0.1;
          context.fillRect(center - width / 2, y - textSize, width, textSize + 4);
          context.globalAlpha = 1;
        }
        let baseline = y;
        if (y >= nativeGeometry.translationBaseline && (y - nativeGeometry.translationBaseline) % nativeGeometry.translationRowStep === 0) {
          context.textBaseline = 'alphabetic';
          const rowTop = y - nativeGeometry.dnaBaseline;
          baseline = centeredBaseline(context, text, rowTop + nativeGeometry.translationBarHeight / 2, textSize);
        }
        fillGlyph(context, text, x, baseline, color, maxWidth);
      } finally {
        context.restore();
      }
    };
    const drawAlignmentGlyph = (text: string, x: number, y: number, maxWidth?: number): void => {
      context.save();
      try {
        const base = /^[ACGTN=]$/i.test(text);
        const rows = track.alignmentTrack;
        const color = paint('strokeText', base ? 'nucleotide' : 'text', context.strokeStyle);
        context.textBaseline = 'alphabetic';
        let baseline = y;
        if (rows && base) {
          const rowHeight = rows.displayMode === 'SQUISHED' ? rows.squishedRowHeight : rows.alignmentRowHeight;
          const barHeight = rowHeight <= 4 ? rowHeight : rowHeight - 2;
          const rowTop = y - (Math.min(nativeGeometry.mismatchBaseline, barHeight) - 1);
          baseline = centeredBaseline(context, text, rowTop + barHeight / 2, textSize);
        }
        fillGlyph(context, text, x, baseline, color, maxWidth);
      } finally {
        context.restore();
      }
    };
    const drawAnnotationGlyph = (text: string, x: number, y: number, maxWidth?: number): void => {
      context.save();
      try {
        const color = colorKey(context.fillStyle) === '255,255,255,1'
          ? contrastingText(lastPaintedFill) : paint('fillText', 'text', context.fillStyle);
        const baseline = y + (context.textAlign === 'center' ? 2 * textGrowth(textSize) : 0);
        fillGlyph(context, text, x, baseline, color, maxWidth);
      } finally {
        context.restore();
      }
    };
    const fillRectangle = (x: number, y: number, width: number, height: number): void => {
      const key = colorKey(context.fillStyle);
      const background = ['ruler', 'annotation', 'alignment', 'variant'].includes(track.type) && key === '255,255,255,1' &&
        x === 0 && y === (options.pixelTop ?? 0) && width === options.pixelWidth && height === options.pixelHeight;
      const sequenceMarker = track.type === 'sequence' && y >= nativeGeometry.translationTop
        ? key === '0,153,0,1' ? palette.start : key === '255,0,0,1' ? palette.stop : undefined : undefined;
      if (sequenceMarker) {
        context.save();
        context.fillStyle = sequenceMarker.fill;
        context.fillRect(x, y, width, height);
        context.restore();
        return;
      }
      const nucleotide = track.type === 'sequence' && nucleotideRGB.has(colorChannels(context.fillStyle)?.slice(0, 3).join(','));
      // In the pinned FeatureTrack renderer, body/exon fills are at depth 1 and codon
      // fills are at depth 2 below the translation threshold, even when their RGBs match.
      const codon = track.type === 'annotation' && savedFills.length === nativeGeometry.annotationCodonSaveDepth &&
        options.bpPerPixel !== undefined && options.bpPerPixel < nativeGeometry.annotationCodonThreshold;
      const role: PaintRole = background ? 'background' : nucleotide ? 'nucleotide' : codon ? 'codon' : 'fill';
      withPaint('fillRect', role, false, () => context.fillRect(x, y, width, height));
    };

    // Named renderer-specific methods handle glyphs; other fills/linework share paint handling.
    const methods = {
      save: (): void => { savedFills.push(context.fillStyle); context.save(); },
      restore: (): void => { savedFills.pop(); context.restore(); },
      fillRect: fillRectangle,
      clearRect: (x: number, y: number, width: number, height: number): void => {
        context.clearRect(x, y + (track.type === 'annotation' ? 2 * textGrowth(textSize) : 0), width, height);
      },
      fillText: (text: string, x: number, y: number, maxWidth?: number): void => {
        if (track.type === 'annotation') {
          drawAnnotationGlyph(text, x, y, maxWidth);
        } else {
          withPaint('fillText', 'text', false, () => fillGlyph(context, text, x, y, context.fillStyle, maxWidth));
        }
      },
      strokeText: (text: string, x: number, y: number, maxWidth?: number): void => {
        if (track.type === 'sequence') {
          drawSequenceGlyph(text, x, y, maxWidth);
        } else if (track.type === 'alignment') {
          drawAlignmentGlyph(text, x, y, maxWidth);
        } else {
          withPaint('strokeText', 'text', true, () => {
            if (maxWidth === undefined) {
              context.strokeText(text, x, y);
            } else {
              context.strokeText(text, x, y, maxWidth);
            }
          });
        }
      },
    };
    const themed = new Proxy(context, {
      get(target, key) {
        if (Object.hasOwn(methods, key)) {
          return methods[key as keyof typeof methods];
        }
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value === 'function' && ['fill', 'stroke', 'strokeRect'].includes(String(key))) {
          return (...args: unknown[]): void => withPaint(String(key), key === 'fill' ? 'fill' : 'stroke', key !== 'fill', () => value.apply(target, args));
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value: unknown) {
        const adapted = key === 'font' && typeof value === 'string' ? value.replace(/[\d.]+px/, `${textSize}px`) : value;
        return Reflect.set(target, key, adapted, target);
      },
    });
    context.save();
    context.fillStyle = palette.foreground;
    context.strokeStyle = palette.foreground;
    context.font = `${textSize}px sans-serif`;
    if (track.type === 'sequence') {
      context.translate(0, textGrowth(textSize));
    }
    try {
      draw.call(this, {...options, context: themed});
    } finally {
      context.restore();
    }
  };
}
