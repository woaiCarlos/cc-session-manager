/**
 * Error-classification helpers for the terminal backends.
 *
 * Each backend spawns `osascript` via `execFile` and can fail in two
 * distinguishable ways:
 *
 *   1. **The binary itself is missing.** Node surfaces this as an error with
 *      `code === 'ENOENT'` (e.g. "spawn osascript ENOENT") or, when called
 *      through a shell, with a "command not found" / "No such file" message.
 *      This is the only failure mode that maps to `TerminalNotInstalledError`
 *      for the binary name itself.
 *
 *   2. **The target application is missing.** osascript runs successfully but
 *      AppleScript reports `execution error: Can't get application "<name>".
 *      (-1728)`. This maps to `TerminalNotInstalledError` for the user-selected
 *      terminal name (e.g. `iTerm2`, `Warp`).
 *
 * Any other failure (Automation permission denied, AppleScript runtime error,
 * etc.) is propagated verbatim so the UI can show the original diagnostic.
 */

/**
 * Type guard: did `execFile` fail because the binary itself could not be
 * spawned?
 *
 * Handles both the direct ENOENT case (Node sets `err.code = 'ENOENT'`) and
 * the indirect case where a shell layer prepends "command not found" /
 * "No such file or directory" to the message.
 */
export function isOsascriptBinaryMissing(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | null | undefined;
  if (e && e.code === 'ENOENT') return true;
  const msg = (e?.message ?? '').toString();
  return /command not found/i.test(msg) || /No such file/i.test(msg);
}

/**
 * Type guard: did osascript reject because the named application is not
 * installed (or otherwise unreachable)?
 *
 * Recognizes the canonical AppleScript errors:
 *
 *   - `Can't get application "<name>".`  (error -1728, most common)
 *   - `application "<name>" is not running.`  (a related shape we tolerate)
 *   - the more generic `<name> isn't running.` (error -600, sometimes seen
 *     when `tell application "..."` fails to launch the binary)
 *
 * The match is anchored on the application name so we never misclassify a
 * different app's failure as a missing target app.
 */
export function isAppleScriptApplicationMissing(
  err: unknown,
  appName: string
): boolean {
  const msg = ((err as Error | null | undefined)?.message ?? '').toString();
  if (!msg) return false;
  // Escape regex metacharacters in the application name (e.g. "iTerm2" has
  // none, but future app names like "Windows Terminal" could).
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Order: more specific patterns first.
  const patterns: RegExp[] = [
    new RegExp(`Can't get application "${escaped}"`, 'i'),
    new RegExp(`Can't get application ${escaped}`, 'i'),
    new RegExp(`application "${escaped}" is not running`, 'i'),
    new RegExp(`${escaped} isn't running`, 'i'),
  ];
  return patterns.some((p) => p.test(msg));
}