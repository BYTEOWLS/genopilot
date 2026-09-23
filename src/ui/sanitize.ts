/** Removes terminal control characters from untrusted text before rendering it. */
export function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}
