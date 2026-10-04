import {colorChannels, type CanvasPaint} from './genome-palette.js';

/** Opt-in, bounded and local-only. Never inspect or log labels, files, coordinates or features. */
export function genomeColorDiagnostics() {
  let enabled = false;
  const seen = new Set<string>();
  const limit = 256;
  const record = (track: string, operation: string, paint: CanvasPaint): void => {
    if (!enabled) {
      return;
    }
    const channels = colorChannels(paint);
    const color = channels ? `rgba(${channels.join(',')})` : typeof paint === 'string' ? 'unparsed-color' : 'gradient-or-pattern';
    const type = ['annotation', 'alignment', 'variant', 'sequence', 'ruler'].includes(track) ? track : 'other';
    const key = `${type}:${operation}:${color}`;
    if (seen.has(key) || seen.size >= limit) {
      return;
    }
    seen.add(key);
    console.info('[GenoPilot canvas] Unmapped paint', {track: type, operation, color});
    if (seen.size === limit) {
      console.info('[GenoPilot canvas] Diagnostic limit reached; toggle collection off/on to start a new collection.');
    }
  };
  return {record, setEnabled: (value: boolean): void => {
    if (value !== enabled) {
      seen.clear();
    }
    enabled = value;
  }, clear: (): void => { seen.clear(); enabled = false; }};
}
export type GenomeColorDiagnostics = ReturnType<typeof genomeColorDiagnostics>;
