// Native IGV members omitted from its declarations. Renderer assumptions are documented in
// resources/concepts/browser-view/canvas-colors.md; this module changes y geometry only.
export type DrawOptions = {
  context: CanvasRenderingContext2D;
  bpPerPixel?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  pixelTop?: number;
};
export type ThemeTrack = {
  type: string;
  color?: string;
  altColor?: string;
  height: number;
  featureHeight?: number;
  expandedRowHeight?: number;
  squishedRowHeight?: number;
  alignmentTrack?: {alignmentRowHeight: number; squishedRowHeight: number; displayMode?: string};
  coverageTrack?: {color?: string};
  browser?: {nucleotideColors: Record<string, string>};
  computePixelHeight?: (features: unknown) => number;
  draw: (options: DrawOptions) => void;
};
export type ThemeTrackView = {
  track: ThemeTrack;
  repaintViews: () => void;
  checkContentHeight: () => void;
  setTrackHeight: (height: number, force: boolean) => void;
  viewports: {setContentHeight: (height: number) => void}[];
};
export const defaultGenomeTextSize = 16;
export const nativeGeometry = {
  fontSize: 12,
  dnaBaseline: 15,
  sequenceHeight: 25,
  translationTop: 25,
  translationBaseline: 40,
  translationRowStep: 30,
  translationBarHeight: 25,
  mismatchBaseline: 10,
  // renderFeature saves once; renderAminoAcidSequence adds a second save before codon fills.
  annotationCodonSaveDepth: 2,
  annotationCodonThreshold: 0.25,
};
export function textGrowth(size: number): number {
  return size - nativeGeometry.fontSize;
}

export function applyGenomeGeometry(view: ThemeTrackView, textSize: number,
  originalHeights: Map<ThemeTrack, NonNullable<ThemeTrack['computePixelHeight']>>): void {
  const track = view.track;
  const growth = textGrowth(textSize);
  if (track.type === 'annotation') {
    track.featureHeight = 14 + growth;
    track.expandedRowHeight = 30 + 2 * growth;
    track.squishedRowHeight = 15 + growth;
  }
  if (track.type === 'alignment' && track.alignmentTrack) {
    track.alignmentTrack.alignmentRowHeight = textSize + 6;
    track.alignmentTrack.squishedRowHeight = Math.max(3, Math.round(3 * textSize / nativeGeometry.fontSize));
  }
  if (track.type === 'sequence') {
    if (track.computePixelHeight && !originalHeights.has(track)) {
      originalHeights.set(track, track.computePixelHeight);
    }
    const compute = originalHeights.get(track);
    if (compute) {
      track.computePixelHeight = function (features): number {
        this.height = compute.call(this, features) + growth;
        return this.height;
      };
    }
    const height = track.computePixelHeight?.([]) ?? nativeGeometry.sequenceHeight + growth;
    for (const viewport of view.viewports) {
      viewport.setContentHeight(height);
    }
    view.setTrackHeight(height, true);
  } else if (track.type === 'ruler') {
    view.setTrackHeight(40 + growth, true);
  } else if (track.type === 'annotation' || track.type === 'alignment') {
    view.checkContentHeight();
  }
}

export function centeredBaseline(context: CanvasRenderingContext2D, text: string, center: number, textSize: number): number {
  const metrics = context.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent ?? textSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? textSize * 0.2;
  return center + (ascent - descent) / 2;
}
