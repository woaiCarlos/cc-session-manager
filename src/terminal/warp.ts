/**
 * Warp backend — best-effort.
 *
 * Warp does NOT expose an AppleScript `do script` verb (unlike Terminal.app
 * and iTerm2). Its AppleScript dictionary only lets us bring it to the
 * foreground. To actually deliver the command we therefore have two options:
 *
 *   1. **Keystroke injection** via `System Events`: activate Warp, wait for
 *      its input surface to settle, then `keystroke` the full command line
 *      and press Return (`key code 36`). This is fast and seamless when it
 *      works, but it is unreliable — Warp's input stack sometimes swallows
 *      or reorders synthetic keystrokes, and macOS Automation / Accessibility
 *      permissions may be missing for Terminal / Warp / System Events.
 *
 *   2. **Clipboard fallback** via `pbcopy`: copy the same command string to
 *      the OS clipboard and surface a "paste manually" error so the caller
 *      can prompt the user. Reliable across every macOS configuration.
 *
 * This module implements (1) and ALWAYS falls back to (2) on any failure,
 * then throws — the caller (UI) can decide whether the partial success
 * (`pbcopy` populated) is still actionable for the user.
 *
 * Security notes (cross-ref with src/terminal/escape.ts):
 *   - We never call `child_process.exec` (string) — that would re-introduce
 *     a shell interpretation layer on top of user-controlled cwd/command.
 *   - Instead we use `execFile` with an args array for both the
 *     `osascript` keystroke path and the `pbcopy` fallback path.
 *   - The injected AppleScript snippet double-quote escapes both `\\` and
 *     `"` so a malicious command cannot break out of the `keystroke "..."`
 *     literal. cwd is POSIX single-quote escaped.
 */

// 安全：所有子进程调用均通过 execFile 参数数组，规避 shell 注入。
// execFile-only policy: every child_process call MUST go through execFile(file, args[])
// — never `exec` with a shell-string command. Verified by
// tests/terminal/execFile-contract.test.ts (Task 5.7).
/* eslint-disable security/detect-child-process */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { escapeForAppleScript } from './escape.js';
import { isAppleScriptApplicationMissing, isOsascriptBinaryMissing } from './errors.js';
import { TerminalNotInstalledError } from './index.js';

const exec = promisify(execFile);

// @types/node `ExecFileOptions` does not declare `input` (it lives on
// `CommonExecOptions`, which `exec`/`execSync` use but `execFile` does not
// inherit). In practice Node's `execFile` does support `input` — it's how
// `pbcopy` receives its stdin payload. We narrow the type locally so we
// keep strict typing around the options object.
type ExecFileOptionsWithInput = ExecFileOptions & {
  input?: string | NodeJS.ArrayBufferView;
};

export interface OpenRequest {
  cwd: string;
  command: string;
}

/**
 * Open (or focus) Warp and attempt keystroke injection of `cd <cwd> && <command>`.
 *
 * Returns once `osascript` has accepted the keystroke snippet (best-effort
 * success path). If `osascript` fails for ANY reason (Automation permission,
 * Warp not installed, focus race, etc.), this function:
 *
 *   1. If osascript reports Warp is not installed (or `osascript` itself is
 *      missing), rejects with `TerminalNotInstalledError` so the UI can
 *      prompt the user to switch terminals in Settings. In this case we
 *      SKIP the pbcopy fallback — there is no point in copying a command
 *      that the user cannot paste into a missing terminal.
 *   2. Otherwise copies the same command string to the system clipboard via
 *      `pbcopy` using `execFile` (no shell). The clipboard is left
 *      populated so the user can paste into Warp manually. Rejects with an
 *      Error whose message tells the caller what happened and that the
 *      command is in the clipboard ready to paste.
 *
 * The function never silently swallows errors: every failure mode is
 * surfaced to the caller (either as a typed rejection, or as a populated
 * clipboard + rejection).
 */
export async function warp(req: OpenRequest): Promise<void> {
  const eCwd = escapeForAppleScript(req.cwd);
  // The injected line is `cd '<cwd>' && <command>`; we then escape it for
  // AppleScript's double-quoted string context so the keystroke call's body
  // is well-formed regardless of what `command` contains.
  const full = `cd '${eCwd}' && ${req.command}`;
  const eFull = full.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = `
tell application "Warp" to activate
delay 0.4
tell application "System Events"
  keystroke "${eFull}"
  key code 36
end tell
`;

  try {
    await exec('osascript', ['-e', script]);
  } catch (err) {
    // If Warp itself is not installed, the pbcopy fallback would be
    // pointless — the user cannot paste into a terminal that doesn't exist.
    // Surface a typed error so the UI can render a "switch terminal in
    // Settings" hint instead of a clipboard dance.
    if (isAppleScriptApplicationMissing(err, 'Warp')) {
      throw new TerminalNotInstalledError('Warp');
    }
    if (isOsascriptBinaryMissing(err)) {
      throw new TerminalNotInstalledError('osascript');
    }
    // Best-effort contract: leave the clipboard populated so the user can
    // paste into Warp manually, then reject so the UI can show a status.
    try {
      const pbcopyOpts: ExecFileOptionsWithInput = { input: full };
      await exec('pbcopy', [], pbcopyOpts);
    } catch {
      // If even pbcopy fails we still reject — the user gets the original
      // keystroke error context and we don't silently swallow it.
    }
    throw new Error(
      'Warp keystroke injection failed; the command was copied to clipboard. ' +
        'Paste manually in Warp.'
    );
  }
}
