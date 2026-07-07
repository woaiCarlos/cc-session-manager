/**
 * Action: rename a Claude Code session by updating its alias in persistent state.
 *
 * Session aliases are stored in `AppState.sessionAliases` (Task 2.6) keyed by
 * `sessionId`. The TUI rename modal (Group 7) collects the new name and calls
 * this action; on success the discovery layer re-reads `state.sessionAliases`
 * via `getAlias` so the next render shows the new `displayName`.
 *
 * Persistence goes through `setAlias` which performs an atomic write of
 * `state.json` and updates the in-process cache. Any rejection from the
 * store propagates verbatim, so the UI can surface a persistence failure
 * (disk full, EACCES on the config dir, etc.) instead of silently
 * dropping the rename.
 */

import { setAlias } from '../state/store.js';

/**
 * Set the display name for `sessionId` by writing the `session` alias map.
 *
 * Resolves once the alias has been written to disk. Rejects if the store
 * rejects — the caller (the TUI rename modal) is expected to surface the
 * error and keep the modal open so the user can retry.
 */
export async function renameSession(
  sessionId: string,
  newName: string,
): Promise<void> {
  await setAlias('session', sessionId, newName);
}