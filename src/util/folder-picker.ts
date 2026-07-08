/**
 * macOS native folder picker — wraps `osascript choose folder …`.
 *
 * This module exists so that `src/actions/addManualProject.ts` (Task 6.5)
 * can offer an OS-native directory chooser without bundling a separate
 * GUI tool or relying on `dialog` shims from third-party packages.
 *
 * How it works:
 *   1. We build a tiny AppleScript snippet that calls
 *      `choose folder with prompt "<prompt>"` and returns its POSIX path.
 *   2. The snippet is delivered to `osascript` via `execFile(file, args[])`
 *      with `-e <script>` — NEVER `exec("osascript -e " + script)`. Each
 *      argument is passed verbatim to the child, so the `<prompt>` cannot
 *      be reinterpreted by a shell even if it contains `;`, `|`, `` ` ``,
 *      etc. See tests/terminal/execFile-contract.test.ts for the
 *      cross-component audit that guarantees this same shape across the
 *      codebase.
 *   3. The prompt is double-quote escaped (`"` -> `\"`) so the resulting
 *      AppleScript string literal is always well-formed regardless of the
 *      caller-supplied prompt text.
 *
 * Cancellation contract:
 *   - User clicks Cancel in the dialog → osascript exits with code 1, no
 *     stdout. We resolve to `null` (the action layer treats null as a
 *     quiet no-op).
 *   - Snippets that explicitly `return false` (some legacy AppleScript
 *     styles) print the literal `false` to stdout — we also treat that
 *     as a cancel.
 *   - Anything else (Automation permission denied, AppleScript compile
 *     error, `osascript` missing from `$PATH`, etc.) is REJECTED — never
 *     swallowed — so the UI can surface the underlying diagnostic.
 *
 * macOS-only (C1): `osascript` is not present on Linux/Windows. The TUI is
 * already gated to `darwin` in `package.json#engines.os`, so this module
 * inherits that constraint.
 *
 * Implementation note — we deliberately use the callback form of
 * `execFile` instead of `util.promisify(execFile)`. The promisified
 * version registers `kCustomPromisifyArgs = 2` so the resolved value is
 * the raw stdout string, not a `{ stdout, stderr }` object — the public
 * `@types/node` typings don't model that quirk, so a typed callback
 * keeps the contract both correct at runtime AND readable in TS.
 */

// 安全：所有子进程调用均通过 execFile 参数数组，规避 shell 注入。
// execFile-only policy: every child_process call MUST go through execFile(file, args[])
// — never `exec` with a shell-string command. Verified by
// tests/terminal/execFile-contract.test.ts (Task 5.7) and by
// tests/util/folder-picker.test.ts (Task 8.1).
/* eslint-disable security/detect-child-process */

import { execFile } from 'node:child_process';

/**
 * Open a native macOS folder picker and return the chosen directory's
 * POSIX path.
 *
 * @param prompt - The dialog's title bar text. Double quotes are
 *   escaped so the AppleScript stays syntactically valid regardless of
 *   the prompt content.
 * @returns The chosen absolute POSIX path (e.g. `/Users/alice/code/app`),
 *   or `null` if the user dismissed the dialog without selecting a folder.
 *
 * Rejects (does NOT resolve to null) on:
 *   - `osascript` binary missing / not executable on `$PATH`;
 *   - macOS Automation / Accessibility permission denied for the running
 *     terminal app;
 *   - AppleScript compile or runtime error;
 *   - any other non-cancellation osascript failure (exit code != 1 with
 *     empty stdout).
 *
 * Callers (the TUI status-bar "Add Project" affordance, via
 * `addManualProject`) must treat a `null` return as a quiet cancel and
 * NOT prompt the user again — and must surface any thrown error to the
 * user so a misconfiguration is diagnosable.
 */
export function pickFolder(prompt: string): Promise<string | null> {
  // AppleScript string-literal escaping: backslash-quote every literal `"`
  // so a prompt like Pick "your" dir becomes `Pick \"your\" dir` and the
  // surrounding `choose folder with prompt "…"` literal stays well-formed.
  const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script =
    `set theFolder to choose folder with prompt "${escapedPrompt}"\n` +
    `return POSIX path of theFolder\n`;

  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) {
        // User-clicked-Cancel: osascript exits 1, no stdout, stderr may
        // carry "User canceled. (-128)". Surface that as a null result;
        // the action layer treats it as a quiet no-op.
        const code = (err as { code?: number }).code;
        if (code === 1) {
          resolve(null);
          return;
        }
        // Real failure — Automation denied, AppleScript compile error,
        // osascript missing from $PATH, etc. Do NOT swallow it.
        reject(err);
        return;
      }
      // Successful pick: the snippet prints `POSIX path of theFolder`,
      // which is e.g. `/Users/alice/Projects/my-app\n`. Snippets that
      // cancel programmatically (e.g. `return false`) print `false\n`
      // instead — that's also a "no folder chosen" outcome.
      const out = stdout.trim();
      if (out === 'false' || out === '') {
        resolve(null);
        return;
      }
      resolve(out);
    });
  });
}
