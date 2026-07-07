/**
 * Terminal dispatcher.
 *
 * Reads `state.terminal` (a `TerminalChoice` from `src/state/types.ts`) and
 * routes the open request to the corresponding backend:
 *
 *   - `terminal` -> `terminalApp` (Terminal.app via osascript)
 *   - `iterm2`   -> `iterm2`       (iTerm2 via osascript)
 *   - `warp`     -> `warp`         (Warp via System Events keystroke,
 *                                   with a pbcopy fallback)
 *
 * The dispatcher is a thin, type-safe switch. It does NOT inspect the OS,
 * does NOT spawn anything itself, and does NOT swallow backend errors — the
 * chosen backend owns its own retry / fallback / error contract.
 *
 * Error contract:
 *   - Any rejection from the chosen backend is propagated verbatim.
 *   - `TerminalNotInstalledError` is a shared error class (also raised by the
 *     individual backends in Task 5.6) so the UI can detect "the app is not
 *     installed" with a single `instanceof` check and surface a "switch in
 *     Settings" hint instead of a raw osascript error.
 */

import type { TerminalChoice } from '../state/types.js';
import { terminalApp, type OpenRequest } from './terminal-app.js';
import { iterm2 } from './iterm2.js';
import { warp } from './warp.js';

/**
 * Forward an open request to the backend selected by `state.terminal`.
 *
 * Returns once the chosen backend has resolved. Rejects if the backend
 * rejects (e.g. osascript permission denied, Warp not installed).
 */
export async function dispatchOpen(
  terminal: TerminalChoice,
  req: OpenRequest
): Promise<void> {
  switch (terminal) {
    case 'terminal':
      return terminalApp(req);
    case 'iterm2':
      return iterm2(req);
    case 'warp':
      return warp(req);
    default: {
      // Exhaustiveness guard: if a new TerminalChoice is ever added to the
      // union without updating this switch, the `never` assignment fails at
      // compile time. At runtime we still throw so callers get a useful
      // message instead of silently returning `undefined`.
      const exhaustive: never = terminal;
      throw new Error(`Unknown terminal: ${String(exhaustive)}`);
    }
  }
}

/**
 * Raised when the user-selected terminal application is not installed (or
 * `osascript` itself is missing).
 *
 * The UI catches this with `instanceof TerminalNotInstalledError` and shows
 * a "switch terminal in Settings" prompt instead of a raw AppleScript error.
 */
export class TerminalNotInstalledError extends Error {
  constructor(public readonly binary: string) {
    super(`${binary} is not installed. Switch terminal in Settings.`);
    this.name = 'TerminalNotInstalledError';
  }
}