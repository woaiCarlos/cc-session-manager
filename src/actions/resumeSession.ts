/**
 * Action: resume an existing Claude Code session in the user's chosen terminal.
 *
 * Builds the `claude --resume <id>` invocation for the session's original
 * working directory and hands it off to the terminal dispatcher
 * (`src/terminal/index.ts`). The dispatcher routes the request to the
 * Terminal.app / iTerm2 / Warp backend currently selected in
 * `state.terminal`; this module owns no terminal-specific logic itself.
 *
 * Shell-safe escaping of `cwd` and `command` is the chosen backend's
 * responsibility (see `src/terminal/escape.ts`). `resumeSession` does NOT
 * pre-quote or wrap either field — doing so would double-escape inside
 * the AppleScript payload and produce a broken command.
 *
 * Any rejection from the dispatcher propagates verbatim, so the UI can
 * detect `TerminalNotInstalledError` (or an osascript permission error)
 * and surface the appropriate recovery prompt.
 */

import { dispatchOpen } from '../terminal/index.js';
import type { Session, TerminalChoice } from '../state/types.js';

/**
 * Re-open `session` in the terminal selected by the caller, in the session's
 * original `cwd`, executing `claude --resume <session.id>`.
 *
 * Resolves once the chosen backend has accepted the open request (the actual
 * `claude --resume` process then runs asynchronously inside the spawned
 * terminal). Rejects if the backend rejects — the caller (typically the TUI
 * status bar) is expected to surface the error.
 */
export async function resumeSession(
  session: Session,
  terminal: TerminalChoice,
): Promise<void> {
  await dispatchOpen(terminal, {
    cwd: session.cwd,
    command: `claude --resume ${session.id}`,
    // Forward session id so the 'current' backend can rescan this session's
    // JSONL after the claude child exits. cli.tsx holds the sessionId →
    // jsonlPath index in its own closure (populated by runDiscovery), so
    // we don't need to also pass jsonlPath.
    sessionId: session.id,
  });
}