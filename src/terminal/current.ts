/**
 * 'current' terminal backend: run the command in the SAME terminal that
 * ccsm is running in, then return to the TUI when the command exits.
 *
 * The Ink TUI uses raw mode on stdin. To run an interactive child
 * (e.g. `claude --resume <id>`), we must:
 *   1. Tear down Ink (unmount) so raw mode is released.
 *   2. Spawn the child with stdio 'inherit' so it sees the user's real TTY.
 *   3. Wait for the child to exit.
 *   4. Re-render the Ink App to restore raw mode.
 *
 * The Ink render instance is owned by `src/cli.tsx`; this module gets a
 * reference to the relevant pieces via {@link setCurrentTerminalDeps} which
 * cli.tsx calls after the first render.
 */
import { spawn } from 'node:child_process';
import type { ReactElement } from 'react';
import type { OpenRequest } from './terminal-app.js';
import { escapeForAppleScript } from './escape.js';

interface CurrentDeps {
  unmount: () => void;
  createAppElement: () => ReactElement;
  render: (el: ReactElement) => { rerender: (el: ReactElement) => void; unmount: () => void };
}

let deps: CurrentDeps | null = null;

export function setCurrentTerminalDeps(d: CurrentDeps): void {
  deps = d;
}

export function clearCurrentTerminalDeps(): void {
  deps = null;
}

/**
 * Run `req.command` in `req.cwd` in the foreground of the current TTY.
 *
 * Semantics:
 *  - Synchronously: unmount Ink, release raw mode.
 *  - Spawn child with stdio 'inherit' so the user sees a real prompt.
 *  - Await child exit.
 *  - Re-render Ink App (which re-acquires raw mode on next input).
 *
 * Errors:
 *  - If cli.tsx hasn't registered deps (e.g. running under vitest), we
 *    throw a clear error so the caller's catch surfaces it in the UI.
 */
export function current(req: OpenRequest): Promise<void> {
  if (!deps) {
    return Promise.reject(
      new Error(
        "'current' terminal backend not initialized (cli.tsx did not register deps). " +
          'This is a code error, not a user-facing one.',
      ),
    );
  }
  return new Promise<void>((resolve, reject) => {
    // 1. Tear down Ink
    deps!.unmount();
    // 2. Tell the user what's happening
    const masked = escapeForAppleScript(req.cwd);
    process.stderr.write(`\n[ccsm] launching in current terminal: cd '${masked}' && ${req.command}\n`);
    // 3. Spawn child with inherited stdio
    const child = spawn(req.command, {
      cwd: req.cwd,
      shell: true,
      stdio: 'inherit',
    });
    let exited = false;
    child.on('error', (err) => {
      if (exited) return;
      exited = true;
      // Re-mount Ink before rejecting so the TUI is usable
      try {
        deps!.render(deps!.createAppElement());
      } catch {
        /* re-render failure is best-effort */
      }
      reject(err);
    });
    child.on('exit', (code) => {
      if (exited) return;
      exited = true;
      // 4. Re-render Ink (will re-acquire raw mode on next keystroke)
      try {
        deps!.render(deps!.createAppElement());
      } catch {
        /* best-effort */
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code ?? 'null'}`));
      }
    });
  });
}
