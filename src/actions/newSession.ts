/**
 * Action: open a fresh Claude Code session in the user's chosen terminal.
 *
 * Builds a bare `claude` invocation for the project's working directory
 * and hands it off to the terminal dispatcher (`src/terminal/index.ts`).
 * The dispatcher routes the request to the Terminal.app / iTerm2 / Warp
 * backend currently selected in `state.terminal`; this module owns no
 * terminal-specific logic itself.
 *
 * Unlike `resumeSession`, this action does NOT pass `--resume <id>` or
 * any other flag — a brand-new session is a plain `claude` invocation
 * that starts an unscoped conversation in `project.cwd`.
 *
 * Shell-safe escaping of `cwd` and `command` is the chosen backend's
 * responsibility (see `src/terminal/escape.ts`). `newSession` does NOT
 * pre-quote or wrap either field — doing so would double-escape inside
 * the AppleScript payload and produce a broken command.
 *
 * Any rejection from the dispatcher propagates verbatim, so the UI can
 * detect `TerminalNotInstalledError` (or an osascript permission error)
 * and surface the appropriate recovery prompt.
 */

import { dispatchOpen } from '../terminal/index.js';
import type { Project, TerminalChoice } from '../state/types.js';

/**
 * Open a new Claude session in the terminal selected by the caller,
 * inside `project.cwd`, executing `claude`.
 *
 * Resolves once the chosen backend has accepted the open request (the
 * actual `claude` process then runs asynchronously inside the spawned
 * terminal). Rejects if the backend rejects — the caller (typically the
 * TUI status bar) is expected to surface the error.
 */
export async function newSession(
  project: Project,
  terminal: TerminalChoice,
): Promise<void> {
  await dispatchOpen(terminal, {
    cwd: project.cwd,
    command: 'claude',
  });
}