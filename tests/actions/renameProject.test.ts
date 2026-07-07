import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the state store so the action's contract is observable in isolation
// from on-disk persistence (which is already covered by store.test.ts for
// setAlias itself — we just need to verify the action wires the right args).
vi.mock('../../src/state/store.js', () => ({
  setAlias: vi.fn(),
}));

import { setAlias } from '../../src/state/store.js';
import { renameProject } from '../../src/actions/renameProject.js';

const mockedSetAlias = vi.mocked(setAlias);

beforeEach(() => {
  mockedSetAlias.mockReset();
  // Default: setAlias resolves successfully. Individual tests override
  // to inspect call args or simulate a persistence failure.
  mockedSetAlias.mockResolvedValue(undefined);
});

describe('renameProject', () => {
  it('writes the new name as a project alias keyed by groupKey', async () => {
    await renameProject('/Users/me/code/myapp', 'My App');

    expect(mockedSetAlias).toHaveBeenCalledTimes(1);
    expect(mockedSetAlias).toHaveBeenCalledWith('project', '/Users/me/code/myapp', 'My App');
  });

  it('persists via the type=project alias map (not session)', async () => {
    // Project aliases are keyed by cwd/groupKey, session aliases by sessionId.
    // A wrong type would corrupt the alias lookup layer in store.ts and
    // could overwrite a session alias by accident.
    await renameProject('/Users/me/code/foo', 'Foo repo');

    const [type] = mockedSetAlias.mock.calls[0]!;
    expect(type).toBe('project');
  });

  it('overwrites a previous alias for the same groupKey', async () => {
    // Rename is an update, not an add — calling it twice must not throw,
    // and the second value must be the one passed to setAlias.
    await renameProject('/repo/a', 'Old');
    await renameProject('/repo/a', 'New');

    expect(mockedSetAlias).toHaveBeenCalledTimes(2);
    expect(mockedSetAlias).toHaveBeenNthCalledWith(1, 'project', '/repo/a', 'Old');
    expect(mockedSetAlias).toHaveBeenNthCalledWith(2, 'project', '/repo/a', 'New');
  });

  it('propagates a rejection from the store without swallowing it', async () => {
    // The UI relies on this rejection to surface a persistence failure
    // (disk full, EACCES on the config dir, etc.). A silently-swallowed
    // error would leave the TUI showing the new name while the state
    // file is unchanged.
    const err = new Error('EACCES: permission denied');
    mockedSetAlias.mockRejectedValueOnce(err);

    await expect(renameProject('/repo/x', 'New')).rejects.toBe(err);
  });
});