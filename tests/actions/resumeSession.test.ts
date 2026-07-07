import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dispatcher so the test never actually spawns osascript, and so we
// can assert which {cwd, command} payload the action builds from a given
// Session without coupling to the backends' own escaping / spawn logic.
vi.mock('../../src/terminal/index.js', () => ({
  dispatchOpen: vi.fn(),
}));

import { dispatchOpen } from '../../src/terminal/index.js';
import type { Session, TerminalChoice } from '../../src/state/types.js';
import { resumeSession } from '../../src/actions/resumeSession.js';

const mockedDispatchOpen = vi.mocked(dispatchOpen);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'abc-123',
    displayName: 'Refactor auth flow',
    cwd: '/Users/alice/code/my-app',
    lastActiveRelative: '2h ago',
    lastTimestamp: '2026-07-07T10:00:00.000Z',
    sizeBytes: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockedDispatchOpen.mockReset();
  // Default: dispatch resolves successfully. Individual tests override
  // to inspect the call args or to simulate a backend failure.
  mockedDispatchOpen.mockResolvedValue(undefined);
});

describe('resumeSession', () => {
  it('dispatches `claude --resume <id>` to the chosen terminal in the session cwd', async () => {
    const session = makeSession({
      id: 'sess-xyz-42',
      cwd: '/Users/bob/work/proj',
    });
    const terminal: TerminalChoice = 'iterm2';

    await resumeSession(session, terminal);

    expect(mockedDispatchOpen).toHaveBeenCalledTimes(1);
    expect(mockedDispatchOpen).toHaveBeenCalledWith('iterm2', {
      cwd: '/Users/bob/work/proj',
      command: 'claude --resume sess-xyz-42',
      sessionId: 'sess-xyz-42',
      jsonlPath: undefined,
    });
  });

  it('propagates a rejection from the dispatcher without swallowing it', async () => {
    // The UI relies on this rejection to surface a "switch terminal in
    // Settings" hint (see TerminalNotInstalledError in src/terminal/index.ts);
    // a silently-swallowed error would hide the actionable recovery path.
    const session = makeSession();
    const err = new Error('osascript: not authorized');
    mockedDispatchOpen.mockRejectedValueOnce(err);

    await expect(resumeSession(session, 'terminal')).rejects.toBe(err);
  });

  it('passes the exact TerminalChoice through (terminal)', async () => {
    const session = makeSession();
    await resumeSession(session, 'terminal');
    expect(mockedDispatchOpen).toHaveBeenCalledWith('terminal', expect.any(Object));
  });

  it('passes the exact TerminalChoice through (warp)', async () => {
    const session = makeSession();
    await resumeSession(session, 'warp');
    expect(mockedDispatchOpen).toHaveBeenCalledWith('warp', expect.any(Object));
  });

  it('quotes nothing around the session id (delegates shell escaping to the backend)', async () => {
    // The dispatcher / chosen backend owns shell-safe escaping (see
    // src/terminal/escape.ts). resumeSession must NOT pre-quote or wrap the
    // id, or it will double-escape in the AppleScript payload.
    const session = makeSession({ id: 'weird id with spaces & symbols' });
    await resumeSession(session, 'terminal');

    expect(mockedDispatchOpen).toHaveBeenCalledWith('terminal', {
      cwd: session.cwd,
      command: 'claude --resume weird id with spaces & symbols',
      sessionId: 'weird id with spaces & symbols',
      jsonlPath: undefined,
    });
  });
});