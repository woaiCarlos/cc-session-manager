import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the state store so the action's contract is observable in isolation
// from on-disk persistence (which is already covered by store.test.ts for
// setAlias itself — we just need to verify the action wires the right args).
vi.mock('../../src/state/store.js', () => ({
  setAlias: vi.fn(),
}));

import { setAlias } from '../../src/state/store.js';
import { renameSession } from '../../src/actions/renameSession.js';

const mockedSetAlias = vi.mocked(setAlias);

beforeEach(() => {
  mockedSetAlias.mockReset();
  // Default: setAlias resolves successfully. Individual tests override
  // to inspect call args or simulate a persistence failure.
  mockedSetAlias.mockResolvedValue(undefined);
});

describe('renameSession', () => {
  it('writes the new name as a session alias keyed by sessionId', async () => {
    await renameSession('abc-123', 'My login bug');

    expect(mockedSetAlias).toHaveBeenCalledTimes(1);
    expect(mockedSetAlias).toHaveBeenCalledWith('session', 'abc-123', 'My login bug');
  });

  it('persists via the type=session alias map (not project)', async () => {
    // Project aliases are keyed by cwd, session aliases by sessionId.
    // A wrong type would corrupt the alias lookup layer in store.ts and
    // could overwrite a project alias by accident.
    await renameSession('sess-xyz', 'Refactor auth flow');

    const [type] = mockedSetAlias.mock.calls[0]!;
    expect(type).toBe('session');
  });

  it('overwrites a previous alias for the same sessionId', async () => {
    // Rename is an update, not an add — calling it twice must not throw,
    // and the second value must be the one passed to setAlias.
    await renameSession('sess-1', 'Old name');
    await renameSession('sess-1', 'New name');

    expect(mockedSetAlias).toHaveBeenCalledTimes(2);
    expect(mockedSetAlias).toHaveBeenNthCalledWith(1, 'session', 'sess-1', 'Old name');
    expect(mockedSetAlias).toHaveBeenNthCalledWith(2, 'session', 'sess-1', 'New name');
  });

  it('propagates a rejection from the store without swallowing it', async () => {
    // The UI relies on this rejection to surface a persistence failure
    // (disk full, EACCES on the config dir, etc.). A silently-swallowed
    // error would leave the TUI showing the new name while the state
    // file is unchanged.
    const err = new Error('EACCES: permission denied');
    mockedSetAlias.mockRejectedValueOnce(err);

    await expect(renameSession('abc-123', 'New name')).rejects.toBe(err);
  });
});