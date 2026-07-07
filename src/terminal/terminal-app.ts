/**
 * Terminal.app backend — spawns `osascript` to open or focus the macOS
 * Terminal.app and execute `cd <cwd> && <command>` in a new shell.
 *
 * Security notes (cross-ref with src/terminal/escape.ts):
 *   - We never call `child_process.exec` (string) — that would re-introduce a
 *     shell interpretation layer on top of user-controlled cwd/command.
 *   - Instead we use `execFile` with an args array: each argument is passed
 *     verbatim to the child, no shell metacharacter processing.
 *   - The actual AppleScript snippet is built by `buildTerminalAppScript`,
 *     which POSIX-escapes the cwd (single-quote context) and double-quote
 *     escapes the command (AppleScript context). That keeps the osascript
 *     payload well-formed even if cwd/command contain `"`, `'`, `&`, `|`,
 *     `;`, `$`, etc.
 */

// 安全：所有子进程调用均通过 execFile 参数数组，规避 shell 注入。
// execFile-only policy: every child_process call MUST go through execFile(file, args[])
// — never `exec` with a shell-string command. Verified by
// tests/terminal/execFile-contract.test.ts (Task 5.7).
/* eslint-disable security/detect-child-process */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildTerminalAppScript } from './escape.js';
import { isOsascriptBinaryMissing } from './errors.js';
import { TerminalNotInstalledError } from './index.js';

const exec = promisify(execFile);

export interface OpenRequest {
  cwd: string;
  command: string;
}

/**
 * Open (or focus) Terminal.app and run `cd <cwd> && <command>` in a new shell.
 *
 * Returns once `osascript` has accepted the script. The actual command runs
 * asynchronously inside Terminal.app; this function does not wait for it to
 * finish, nor does it capture its stdout/stderr.
 *
 * Rejects if `osascript` exits non-zero (e.g. macOS Automation permission
 * denied — Terminal is not in the allowed apps list).
 *
 * Rejects with `TerminalNotInstalledError('osascript')` if `osascript`
 * itself cannot be spawned (ENOENT / "command not found"), so the UI can
 * surface a "switch terminal in Settings" hint instead of a raw spawn
 * failure. Terminal.app itself is bundled with macOS and cannot be
 * uninstalled, so we don't need a separate "Terminal.app missing" branch.
 */
export async function terminalApp(req: OpenRequest): Promise<void> {
  const script = buildTerminalAppScript(req.cwd, req.command);
  try {
    await exec('osascript', ['-e', script]);
  } catch (err) {
    if (isOsascriptBinaryMissing(err)) {
      throw new TerminalNotInstalledError('osascript');
    }
    throw err;
  }
}