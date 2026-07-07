/**
 * Action: add a project directory to `state.manualProjects` by prompting
 * the user via the native folder picker.
 *
 * `manualProjects` is the user's curated allow-list of extra project roots
 * the TUI should surface alongside the auto-discovered sessions. This
 * action is the write side of that flow; Group 7's TUI status-bar exposes
 * an "Add Project" affordance that calls into here.
 *
 * Flow:
 * 1. `pickFolder(prompt)` opens a macOS native folder chooser. Returns
 *    `null` if the user cancels — we propagate that as-is.
 * 2. We `path.resolve` the chosen string (picker returns absolute paths,
 *    but resolving is cheap and defensive) and `fs.stat` to confirm it
 *    exists and is a directory. A non-directory, missing, or symlink-to-
 *    file path is rejected with `null` — no state mutation, no error
 *    thrown — the caller treats it as "nothing added".
 * 3. We load current state and dedupe on resolved path: if the user
 *    re-selects an existing entry we return its path without writing
 *    (idempotent — useful when the user invokes Add from the status
 *    bar while the project is already listed).
 * 4. Otherwise we append `{ path, addedAt }` to `manualProjects` and
 *    `saveState`. The save rejection propagates verbatim so the UI can
 *    surface a persistence failure (EACCES / disk full) instead of
 *    silently losing the add.
 *
 * The folder picker (`src/util/folder-picker.ts`) is currently a stub
 * (Task 8.1 lands the real AppleScript-driven chooser); the action's
 * contract is stable across that swap, so tests mock the picker and
 * stat without ever touching disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pickFolder } from '../util/folder-picker.js';
import { loadState, saveState } from '../state/store.js';

/**
 * Open the folder picker and, if the user selects a valid existing
 * directory, append it to `state.manualProjects`.
 *
 * Returns the resolved absolute path on success (whether newly added or
 * already present). Returns `null` when the user cancels OR when the
 * picked path is not an existing directory (no state mutation in either
 * case). Rejects only if `saveState` rejects — callers should surface
 * the error to the user (e.g. TUI status-bar warning modal).
 */
export async function addManualProject(): Promise<string | null> {
  const picked = await pickFolder('Select a project directory');
  if (!picked) return null;

  const resolved = path.resolve(picked);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) return null;

  const state = await loadState();
  if (
    state.manualProjects.find((m) => path.resolve(m.path) === resolved)
  ) {
    // Already present — idempotent: tell the caller the path, skip the write.
    return resolved;
  }

  await saveState({
    ...state,
    manualProjects: [
      ...state.manualProjects,
      { path: resolved, addedAt: new Date().toISOString() },
    ],
  });
  return resolved;
}