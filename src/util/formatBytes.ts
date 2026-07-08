/**
 * Human-readable byte formatter for the SessionPane.
 *
 * Produces compact labels (`"0 B"`, `"999 B"`, `"1.2 KB"`, `"3.4 MB"`,
 * `"5.6 GB"`) so each session row stays single-line in normal-width
 * terminals. The function is intentionally simple: no locale awareness,
 * no pluralization beyond the unit letter, no sign handling — bytes
 * should never be negative in this codebase.
 *
 * Examples:
 *   formatBytes(0)            // "0 B"
 *   formatBytes(512)          // "512 B"
 *   formatBytes(1024)         // "1.0 KB"
 *   formatBytes(1536)         // "1.5 KB"
 *   formatBytes(1024 * 1024)  // "1.0 MB"
 *   formatBytes(2.5e9)        // "2.3 GB"
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}