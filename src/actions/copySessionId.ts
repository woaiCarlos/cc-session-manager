/**
 * Action: copy a Claude Code session id to the macOS clipboard.
 *
 * Writes `sessionId` to the system clipboard via `pbcopy` so the user can
 * paste it elsewhere (a PR comment, a bug report, an `rm -rf` recovery
 * script, etc.). The TUI status bar surfaces a transient "Copied!" toast
 * on success — this module owns ONLY the clipboard write.
 *
 * Security note (cross-ref with src/terminal/escape.ts):
 *   - We use `execFile('pbcopy', [], { input })` rather than `exec` with a
 *     shell-string or `spawn` with stdin piped separately. pbcopy takes no
 *     CLI args and the session id travels as the process's stdin payload,
 *     so there is no shell interpretation layer on top of user input.
 *   - This satisfies the project-wide execFile-only policy (C14).
 *
 * Any rejection from `execFile` propagates verbatim, so the status bar
 * can render a "clipboard unavailable" hint instead of silently claiming
 * success against an empty clipboard.
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

// @types/node `ExecFileOptions` does not declare `input` (it lives on
// `CommonExecOptions`, which `exec`/`execSync` use but `execFile` does not
// inherit). In practice Node's `execFile` does support `input` — it's how
// `pbcopy` receives its stdin payload. We narrow the type locally so we
// keep strict typing around the options object.
type ExecFileOptionsWithInput = ExecFileOptions & {
  input?: string | NodeJS.ArrayBufferView;
};

const exec = promisify(execFile);

/**
 * Copy `sessionId` to the system clipboard via `pbcopy`.
 *
 * Resolves once `pbcopy` has accepted the payload (exit code 0). Rejects
 * if `pbcopy` is missing, rejects the payload, or exits non-zero — the
 * caller (the TUI status bar) is expected to surface the error and skip
 * the "Copied!" toast.
 */
export async function copySessionId(sessionId: string): Promise<void> {
  const opts: ExecFileOptionsWithInput = { input: sessionId };
  await exec('pbcopy', [], opts);
}
