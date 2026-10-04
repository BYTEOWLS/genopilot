export type ReadColorRow = {label: string; value: string; color?: string};
// Native members of the pinned IGV renderer, absent from its public declarations.
// Read the active color, grouping and thresholds from IGV; never infer a verdict from RGB.
type Read = {
  readName: string;
  chr: string;
  strand: boolean;
  mq?: number;
  fragmentLength?: number;
  pairOrientation?: string;
  mate?: {chr: string};
  firstAlignment?: Read;
  getAlignmentAtGenomicLocation?: (position: number) => Read | undefined;
  getGroupValue?: (groupBy: string, expectedOrientation: string) => string;
  isMateMapped?: () => boolean;
};
type NativeAlignment = {
  colorBy?: string;
  expectedPairOrientation: string;
  minTemplateLength: number;
  maxTemplateLength: number;
  getAlignmentColor: (read: Read) => string;
};

type NativeClickTrack = {
  clickedFeatures: (state: unknown) => unknown;
  popupData: (state: unknown, features?: unknown) => unknown;
};

/** IGV's public trackclick passes features only for annotations. Preserve the actual
 * alignment click target alongside its own popup payload, including asynchronous popups.
 * Key by payload rather than track so rapid overlapping clicks cannot exchange reads.
 */
export function captureAlignmentClicks(track: unknown, payloads: WeakMap<object, unknown>): void {
  const native = track as NativeClickTrack;
  if (typeof native.clickedFeatures !== 'function' || typeof native.popupData !== 'function') {
    return;
  }
  const original = native.popupData;
  native.popupData = async function (state, features): Promise<unknown> {
    const clicked = this.clickedFeatures(state);
    const data = await original.call(this, state, features);
    if (data && typeof data === 'object') {
      payloads.set(data, clicked);
    }
    return data;
  };
}

export function alignmentColorDetails(track: unknown, features: unknown, position?: number): ReadColorRow[] {
  if (!track || typeof track !== 'object' || !('alignmentTrack' in track) || !Array.isArray(features)) {
    return [];
  }
  const native = track.alignmentTrack as NativeAlignment | undefined;
  const feature = features.find(feature => feature && typeof feature === 'object' && 'readName' in feature) as Read | undefined;
  if (!native || typeof native.getAlignmentColor !== 'function' || !feature) {
    return [];
  }
  const read = (position !== undefined ? feature.getAlignmentAtGenomicLocation?.(position) : undefined) ?? feature.firstAlignment ?? feature;
  const mode = native.colorBy ?? 'none';
  const expected = native.expectedPairOrientation;
  const rows: ReadColorRow[] = [];
  let explanation = 'This coloring mode is not explained here; inspect the recorded read attributes and the IGV alignment documentation.';
  if (mode === 'none') {
    explanation = 'Uniform read color; pairing anomalies are not highlighted in this mode.';
  } else if (mode === 'strand') {
    explanation = `Read maps to the ${read.strand ? 'forward (+)' : 'reverse (−)'} strand. This color does not indicate a pairing anomaly.`;
  } else if (mode === 'unexpectedPair' || mode === 'pairOrientation' || mode === 'tlen' || mode === 'fragmentLength') {
    const orientationMode = mode === 'unexpectedPair' || mode === 'pairOrientation';
    let orientation: string | undefined;
    if (orientationMode && read.pairOrientation && ['fr', 'rf', 'ff'].includes(expected)) {
      orientation = read.getGroupValue?.('pairOrientation', expected);
    }
    const descriptions: Record<string, string> = {
      RL: 'Pair has the reversed/outward relative orientation for the expected library orientation.',
      RR: 'Pair has the RR relative orientation for the expected library orientation (both reverse-facing when fr is expected).',
      LL: 'Pair has the LL relative orientation for the expected library orientation (both forward-facing when fr is expected).',
    };
    const orientationExplanation = orientation ? descriptions[orientation] : undefined;
    if (orientationExplanation) {
      explanation = orientationExplanation;
    } else if (mode !== 'pairOrientation' && read.mate && read.isMateMapped?.()) {
      const length = Math.abs(read.fragmentLength ?? 0);
      if (read.mate.chr !== read.chr) {
        explanation = `Mate maps to ${read.mate.chr}, a different chromosome/contig. Its chromosome determines the read color.`;
      } else if (native.minTemplateLength && length < native.minTemplateLength) {
        explanation = `Absolute template length ${length} is below IGV’s current lower threshold ${native.minTemplateLength}.`;
      } else if (native.maxTemplateLength && length > native.maxTemplateLength) {
        explanation = `Absolute template length ${length} exceeds IGV’s current upper threshold ${native.maxTemplateLength}.`;
      } else {
        explanation = 'No pairing anomaly is highlighted by the active mode; this does not establish that the read is correct.';
      }
    } else {
      explanation = 'No pairing anomaly is highlighted by the active mode; mate information may be unavailable.';
    }
  }
  const color = native.getAlignmentColor(read);
  rows.push({label: 'Whole-read color', value: `${color} (IGV)`, color},
    {label: 'Why this color', value: explanation},
    {label: 'Interpretation', value: 'A visual diagnostic cue, not proof of a structural variant or a bad read. Individual mismatch-base colors mean something different.'});
  if (read.mq === 0) {
    rows.push({label: 'Read fading', value: 'Mapping quality is zero; IGV fades this read independently of its pairing color.'});
  }
  return rows;
}
