import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dispatcher so the test never actually spawns osascript, and so we
// can assert which {cwd, command} payload the action builds from a given
// Project without coupling to the backends' own escaping / spawn logic.
vi.mock('../../src/terminal/index.js', () => ({
  dispatchOpen: vi.fn(),
}));

import { dispatchOpen } from '../../src/terminal/index.js';
import type { Project, TerminalChoice } from '../../src/state/types.js';
import { newSession } from '../../src/actions/newSession.js';

const mockedDispatchOpen = vi.mocked(dispatchOpen);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    key: 'proj-abc',
    displayName: 'my-app',
    cwd: '/Users/alice/code/my-app',
    manual: false,
    hidden: false,
    sessions: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockedDispatchOpen.mockReset();
  // Default: dispatch resolves successfully. Individual tests override
  // to inspect the call args or to simulate a backend failure.
  mockedDispatchOpen.mockResolvedValue(undefined);
});

describe('newSession', () => {
  it('dispatches `claude` to the chosen terminal in the project cwd', async () => {
    const project = makeProject({
      key: 'proj-xyz',
      cwd: '/Users/bob/work/proj',
    });
    const terminal: TerminalChoice = 'iterm2';

    await newSession(project, terminal);

    expect(mockedDispatchOpen).toHaveBeenCalledTimes(1);
    expect(mockedDispatchOpen).toHaveBeenCalledWith('iterm2', {
      cwd: '/Users/bob/work/proj',
      command: 'claude',
    });
  });

  it('propagates a rejection from the dispatcher without swallowing it', async () => {
    // The UI relies on this rejection to surface a "switch terminal in
    // Settings" hint (see TerminalNotInstalledError in src/terminal/index.ts);
    // a silently-swallowed error would hide the actionable recovery path.
    const project = makeProject();
    const err = new Error('osascript: not authorized');
    mockedDispatchOpen.mockRejectedValueOnce(err);

    await expect(newSession(project, 'terminal')).rejects.toBe(err);
  });

  it('passes the exact TerminalChoice through (terminal)', async () => {
    const project = makeProject();
    await newSession(project, 'terminal');
    expect(mockedDispatchOpen).toHaveBeenCalledWith('terminal', expect.any(Object));
  });

  it('passes the exact TerminalChoice through (warp)', async () => {
    const project = makeProject();
    await newSession(project, 'warp');
    expect(mockedDispatchOpen).toHaveBeenCalledWith('warp', expect.any(Object));
  });

  it('uses the literal command `claude` with no extra flags', async () => {
    // newSession must not append --resume, --continue, or any other flag —
    // a fresh Claude session is a plain `claude` invocation. A future
    // "open with profile" feature should be a separate action, not a
    // hidden overload of newSession.
    const project = makeProject();
    await newSession(project, 'terminal');

    expect(mockedDispatchOpen).toHaveBeenCalledWith('terminal', {
      cwd: project.cwd,
      command: 'claude',
    });
  });
});