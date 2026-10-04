import type {ThemeTrack} from './genome-geometry.js';

export type CanvasPaint = string | CanvasGradient | CanvasPattern;
export type AnnotationColors = {forward: string; reverse: string};
export type GenomePalette = {
  dark: boolean;
  background: string;
  foreground: string;
  track: string;
  reverse: string;
  codons: [string, string];
  start: {fill: string; text: string};
  stop: {fill: string; text: string};
};

export function annotationDefaults(dark: boolean): AnnotationColors {
  return {forward: dark ? '#74c0fc' : '#1c7ed6', reverse: dark ? '#e599f7' : '#862e9c'};
}

/** Resolve CSS to canvas colors inside IGV's shadow tree, with usable startup fallbacks. */
export function genomePalette(host: HTMLElement): GenomePalette {
  const dark = document.documentElement.dataset.mantineColorScheme === 'dark';
  const defaults = annotationDefaults(dark);
  const styles = getComputedStyle(host);
  const probe = document.createElement('span');
  probe.style.color = `var(--genome-track-color, ${defaults.forward})`;
  (host.shadowRoot ?? host).appendChild(probe);
  const track = getComputedStyle(probe).color;
  probe.remove();
  return {
    dark,
    background: styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? styles.backgroundColor : dark ? '#1a1b1e' : '#ffffff',
    foreground: styles.color || (dark ? '#c1c2c5' : '#212529'),
    track: track && CSS.supports('color', track) ? track : defaults.forward,
    reverse: defaults.reverse,
    codons: dark ? ['#343a40', '#495057'] : ['#dee2e6', '#f1f3f5'],
    start: dark ? {fill: '#064e3b', text: '#c3fae8'} : {fill: '#c3fae8', text: '#064e3b'},
    stop: dark ? {fill: '#702031', text: '#ffe3e3'} : {fill: '#ffe3e3', text: '#702031'},
  };
}

/** Canonicalize the hex/RGB paints returned by canvas, including alpha, without changing it. */
export function colorChannels(value: CanvasPaint): [number, number, number, number] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const color = value.replace(/\s/g, '').toLowerCase();
  const names: Record<string, string> = {white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', transparent: '#00000000'};
  const hex = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/.exec(names[color] ?? color);
  if (hex) {
    const digits = hex[1]!;
    const expanded = digits.length <= 4 ? [...digits].map(digit => digit + digit).join('') : digits;
    return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1];
  }
  const rgb = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)] : undefined;
}

export function colorKey(value: CanvasPaint): string | undefined {
  const channels = colorChannels(value);
  return channels ? channels.join(',') : undefined;
}

export function nucleotideGlyphColor(value: CanvasPaint, dark: boolean): CanvasPaint {
  const channels = colorChannels(value);
  if (!channels) {
    return value;
  }
  const rgb = channels.slice(0, 3).map(channel => Math.round(dark ? channel + (255 - channel) * 0.4 : channel * 0.7));
  return `rgba(${rgb.join(',')},${channels[3]})`;
}

export function contrastingText(value: CanvasPaint): string {
  const channels = colorChannels(value);
  if (!channels) {
    return '#ffffff';
  }
  const [r, g, b] = channels.slice(0, 3).map(channel => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? '#000000' : '#ffffff';
}

function codonShade(value: CanvasPaint, lighter: boolean, fallback: string): string {
  const channels = colorChannels(value) ?? colorChannels(fallback)!;
  return `rgb(${channels.slice(0, 3).map(channel => Math.round(lighter ? channel + (255 - channel) * 0.22 : channel * 0.78)).join(',')})`;
}

// Semantic evidence colors stay native. See resources/concepts/browser-view/canvas-colors.md.
const evidenceProperties: Record<string, string[]> = {
  variant: ['color', 'noGenotypeColor', 'noCallColor', 'nonRefColor', 'mixedColor', 'homrefColor', 'homvarColor', 'hetvarColor', 'refColor', 'altColor', 'refColorFiltered', 'altColorFiltered'],
  alignment: ['color', 'negStrandColor', 'posStrandColor', 'baseModPosStrandColor', 'baseModNegStrandColor', 'insertionColor', 'skippedColor', 'pairConnectorColor', 'smallTLENColor', 'largeTLENColor', 'rlColor', 'rrColor', 'llColor', 'highlightColor'],
};

export function knownEvidenceColors(track: ThemeTrack): Set<string> {
  const objects = [track, track.alignmentTrack, track.coverageTrack];
  const keys = new Set<string>();
  for (const object of objects) {
    if (!object) {
      continue;
    }
    for (const property of evidenceProperties[track.type] ?? []) {
      const value = (object as unknown as Record<string, unknown>)[property];
      if (typeof value === 'string') {
        const key = colorKey(value);
        if (key) {
          keys.add(key);
        }
      }
    }
  }
  // Native neutral read and coverage bars; black deletion strokes are handled as linework.
  if (track.type === 'alignment') {
    keys.add('185,185,185,1');
    keys.add('150,150,150,1');
  }
  return keys;
}

export type PaintRole = 'background' | 'text' | 'fill' | 'stroke' | 'nucleotide' | 'codon';
export function genomePaint(track: ThemeTrack, role: PaintRole, value: CanvasPaint, palette: GenomePalette,
  featureFill: CanvasPaint, knownEvidence: Set<string>): {paint: CanvasPaint; known: boolean} {
  const key = colorKey(value);
  if (role === 'background') {
    return {paint: palette.background, known: true};
  }
  if (role === 'nucleotide') {
    if (track.type === 'sequence' && key === '128,128,128,1') {
      return {paint: palette.foreground, known: true};
    }
    const source = track.type === 'alignment' && key === '0,0,0,1' ? palette.foreground : value;
    return {paint: nucleotideGlyphColor(source, palette.dark), known: colorChannels(source) !== undefined};
  }
  if (track.type === 'annotation' && role === 'codon') {
    if (key === '124,124,204,1' || key === '12,12,120,1') {
      return {paint: codonShade(featureFill, key === '124,124,204,1', track.color ?? palette.track), known: true};
    }
    if (key === '131,249,2,1' || key === '255,33,1,1') {
      return {paint: key === '131,249,2,1' ? palette.start.fill : palette.stop.fill, known: true};
    }
    return {paint: value, known: false};
  }
  if (track.type === 'annotation' && key !== undefined && [track.color, track.altColor].some(color => color && key === colorKey(color))) {
    return {paint: value, known: true};
  }
  if (track.type === 'annotation' && role === 'fill' && key === '0,0,150,1') {
    return {paint: palette.track, known: true};
  }
  if (track.type === 'sequence') {
    if (key === '160,160,160,1' || key === '224,224,224,1') {
      return {paint: palette.codons[key === '160,160,160,1' ? 0 : 1], known: true};
    }
    if (key === '128,128,128,1') {
      return {paint: palette.foreground, known: true};
    }
  }
  if (key !== undefined && knownEvidence.has(key)) {
    return {paint: value, known: true};
  }
  if (key !== undefined && [track.color ?? palette.track, track.altColor ?? palette.reverse, palette.foreground, palette.background].some(color => key === colorKey(color))) {
    return {paint: value, known: true};
  }
  // These are known neutral UI paints in the supported renderers, not arbitrary RGB replacements.
  if (['ruler', 'annotation', 'variant', 'alignment', 'sequence'].includes(track.type)) {
    if ((role === 'text' || role === 'stroke') && (key === '0,0,0,1' || key === '68,68,68,1')) {
      return {paint: palette.foreground, known: true};
    }
    if (key === '255,255,255,1' && (role === 'text' || (role === 'stroke' && track.type === 'annotation'))) {
      return {paint: role === 'text' ? palette.foreground : palette.background, known: true};
    }
    if (role === 'text') {
      return {paint: palette.foreground, known: false};
    }
  }
  return {paint: value, known: false};
}
