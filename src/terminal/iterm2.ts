/**
 * iTerm2 backend — spawns `osascript` against iTerm2's AppleScript dictionary
 * to create a new window and execute `cd <cwd> && <command>` in it.
 *
 * Security notes (cross-ref with src/terminal/escape.ts):
 *   - We never call `child_process.exec` (string) — that would re-introduce a
 *     shell interpretation layer on top of user-controlled cwd/command.
 *   - Instead we use `execFile` with an args array: each argument is passed
 *     verbatim to the child, no shell metacharacter processing.
 *   - The AppleScript snippet is built inline here, but it uses the same
 *     POSIX-escape (single-quote context) for cwd and double-quote escape
 *     (AppleScript context) for command that `buildTerminalAppScript` uses
 *     for the Terminal.app backend. That keeps the osascript payload
 *     well-formed even if cwd/command contain `"`, `'`, `&`, `|`, `;`, `$`,
 *     etc.
 */

// 安全：所有子进程调用均通过 execFile 参数数组，规避 shell 注入。
// execFile-only policy: every child_process call MUST go through execFile(file, args[])
// — never `exec` with a shell-string command. Verified by
// tests/terminal/execFile-contract.test.ts (Task 5.7).
/* eslint-disable security/detect-child-process */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { escapeForAppleScript, escapeForAppleScriptDoubleQuotes } from './escape.js';
import { isAppleScriptApplicationMissing, isOsascriptBinaryMissing } from './errors.js';
import { TerminalNotInstalledError } from './index.js';

const exec = promisify(execFile);

export interface OpenRequest {
  cwd: string;
  command: string;
}

/**
 * Activate iTerm2 and create a new window using the default profile, then run
 * `cd <cwd> && <command>` in that window's shell.
 *
 * Returns once `osascript` has accepted the script. The actual command runs
 * asynchronously inside iTerm2; this function does not wait for it to finish,
 * nor does it capture its stdout/stderr.
 *
 * Rejects if `osascript` exits non-zero (e.g. macOS Automation permission
 * denied — iTerm2 is not in the allowed apps list).
 *
 * Rejects with `TerminalNotInstalledError('iTerm2')` if osascript reports
 * the iTerm2 application is not installed (typical error -1728
 * "Can't get application \"iTerm2\""), or with
 * `TerminalNotInstalledError('osascript')` if `osascript` itself cannot be
 * spawned. Either way the UI catches the typed error and shows a
 * "switch terminal in Settings" hint.
 */
export async function iterm2(req: OpenRequest): Promise<void> {
  const eCwd = escapeForAppleScript(req.cwd);
  const eCmd = escapeForAppleScriptDoubleQuotes(req.command);
  const script = `
tell application "iTerm2"
  activate
  create window with default profile command "cd '${eCwd}' && ${eCmd}"
end tell
`;
  try {
    await exec('osascript', ['-e', script]);
  } catch (err) {
    if (isAppleScriptApplicationMissing(err, 'iTerm2')) {
      throw new TerminalNotInstalledError('iTerm2');
    }
    if (isOsascriptBinaryMissing(err)) {
      throw new TerminalNotInstalledError('osascript');
    }
    throw err;
  }
}