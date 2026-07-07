/**
 * Action: remove a manual project entry from persistent state.
 *
 * `manualProjects` is the user's curated allow-list of extra project roots
 * the TUI surfaces alongside the auto-discovered sessions (see
 * `addManualProject` for the write side). This action is the symmetric
 * delete: the TUI's confirmation modal (Group 7) collects a yes/no
 * confirmation and only then calls into here, so the action itself does
 * not re-prompt — the UI owns the confirmation guard.
 *
 * Spec constraint: this action MUST NOT remove auto-derived projects.
 * Those entries are produced by the discovery layer and are never written
 * into `state.manualProjects`, so filtering on that array alone enforces
 * the constraint. If a caller passes a `groupKey` that does not match any
 * manual entry (e.g. an auto-derived project path), the filter is a
 * no-op and the state is re-saved unchanged — never an error.
 *
 * Persistence goes through `saveState`, which performs an atomic write
 * of `state.json` and updates the in-process cache. Any rejection from
 * the store propagates verbatim so the UI can surface a persistence
 * failure (disk full, EACCES) instead of silently leaving the entry.
 */

import path from 'node:path';
import { loadState, saveState } from '../state/store.js';

/**
 * Remove the manual project whose resolved path equals `groupKey`.
 *
 * Resolves once the filtered state has been written to disk. The
 * comparison uses `path.resolve` on both sides so callers may pass
 * either the canonical absolute form (as stored by `addManualProject`)
 * or any other absolute path string — resolution is idempotent for
 * absolute inputs and normalises `..` / `.` segments. Rejects if
 * `saveState` rejects; the caller (the TUI confirm modal) is expected
 * to surface the error and keep the modal open so the user can retry.
 */
export async function deleteManualProject(groupKey: string): Promise<void> {
  const state = await loadState();
  await saveState({
    ...state,
    manualProjects: state.manualProjects.filter(
      (m) => path.resolve(m.path) !== groupKey,
    ),
  });
}