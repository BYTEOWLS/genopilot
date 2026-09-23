/**
 * Formats a UTC instant as `yyyy-MM-dd_hhmmssSSS`, the compact, sortable, filesystem-safe
 * form shared by run identifiers and per-attempt log file names.
 */
export function formatCompactUtcTimestamp(now: Date = new Date()): string {
  const [date, time] = now.toISOString().split('T');
  return `${date}_${time.replace(/[:.]/g, '').slice(0, 9)}`;
}
