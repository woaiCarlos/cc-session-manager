import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the three backend modules so we never actually spawn osascript during
// unit tests, and so we can assert which backend the dispatcher chose without
// caring about the backend's own escaping / spawn logic.
vi.mock('../../src/terminal/terminal-app.js', () => ({
  terminalApp: vi.fn(),
}));
vi.mock('../../src/terminal/iterm2.js', () => ({
  iterm2: vi.fn(),
}));
vi.mock('../../src/terminal/warp.js', () => ({
  warp: vi.fn(),
}));

import { terminalApp } from '../../src/terminal/terminal-app.js';
import { iterm2 } from '../../src/terminal/iterm2.js';
import { warp } from '../../src/terminal/warp.js';
import { dispatchOpen, TerminalNotInstalledError } from '../../src/terminal/index.js';
import type { TerminalChoice } from '../../src/state/types.js';

const mockedTerminalApp = vi.mocked(terminalApp);
const mockedIterm2 = vi.mocked(iterm2);
const mockedWarp = vi.mocked(warp);

const REQ = { cwd: '/Users/foo/bar', command: 'claude --resume abc' };

beforeEach(() => {
  mockedTerminalApp.mockReset();
  mockedIterm2.mockReset();
  mockedWarp.mockReset();
  // Default: every backend resolves successfully. Individual tests override
  // the one they care about to inspect the call args.
  mockedTerminalApp.mockResolvedValue(undefined);
  mockedIterm2.mockResolvedValue(undefined);
  mockedWarp.mockResolvedValue(undefined);
});

describe('dispatchOpen', () => {
  it('routes to terminalApp when state.terminal === "terminal"', async () => {
    await dispatchOpen('terminal', REQ);

    expect(mockedTerminalApp).toHaveBeenCalledTimes(1);
    expect(mockedTerminalApp).toHaveBeenCalledWith(REQ);
    // Cross-check: the OTHER backends must NOT have been called.
    expect(mockedIterm2).not.toHaveBeenCalled();
    expect(mockedWarp).not.toHaveBeenCalled();
  });

  it('routes to iterm2 when state.terminal === "iterm2"', async () => {
    await dispatchOpen('iterm2', REQ);

    expect(mockedIterm2).toHaveBeenCalledTimes(1);
    expect(mockedIterm2).toHaveBeenCalledWith(REQ);
    expect(mockedTerminalApp).not.toHaveBeenCalled();
    expect(mockedWarp).not.toHaveBeenCalled();
  });

  it('routes to warp when state.terminal === "warp"', async () => {
    await dispatchOpen('warp', REQ);

    expect(mockedWarp).toHaveBeenCalledTimes(1);
    expect(mockedWarp).toHaveBeenCalledWith(REQ);
    expect(mockedTerminalApp).not.toHaveBeenCalled();
    expect(mockedIterm2).not.toHaveBeenCalled();
  });

  it('forwards the exact {cwd, command} payload to the chosen backend', async () => {
    // Belt-and-braces: a refactor that wraps or destructures the request
    // before forwarding would silently lose fields. Asserting on the call
    // args keeps the dispatcher's contract tight.
    const payload = { cwd: '/tmp/has spaces & stuff', command: 'echo "hi"' };
    await dispatchOpen('terminal', payload);

    expect(mockedTerminalApp).toHaveBeenCalledTimes(1);
    expect(mockedTerminalApp).toHaveBeenCalledWith(payload);
  });

  it('propagates a rejection from the chosen backend without involving the others', async () => {
    const err = new Error('osascript: not authorized');
    mockedIterm2.mockRejectedValueOnce(err);

    await expect(dispatchOpen('iterm2', REQ)).rejects.toBe(err);
    // Sanity: a rejecting backend must not silently fall through to another
    // backend — the dispatcher is a one-shot switch.
    expect(mockedTerminalApp).not.toHaveBeenCalled();
    expect(mockedWarp).not.toHaveBeenCalled();
  });

  it('exhaustiveness: throws a clear error for an unknown terminal choice', async () => {
    // Cast to bypass the type guard — the runtime check is what we are testing.
    const bogus = 'hyper' as unknown as TerminalChoice;

    await expect(dispatchOpen(bogus, REQ)).rejects.toThrow(/Unknown terminal/i);
    expect(mockedTerminalApp).not.toHaveBeenCalled();
    expect(mockedIterm2).not.toHaveBeenCalled();
    expect(mockedWarp).not.toHaveBeenCalled();
  });
});

describe('TerminalNotInstalledError', () => {
  it('is an Error subclass named "TerminalNotInstalledError"', () => {
    const err = new TerminalNotInstalledError('iTerm2');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TerminalNotInstalledError');
  });

  it('exposes the offending binary on `.binary`', () => {
    const err = new TerminalNotInstalledError('Warp');
    expect(err.binary).toBe('Warp');
  });

  it('includes the binary name and an actionable hint in the message', () => {
    // The UI keys off this string to render the "switch terminal in Settings"
    // guidance; the regex is intentionally permissive so wording tweaks do
    // not silently break the contract.
    const err = new TerminalNotInstalledError('Terminal.app');
    expect(err.message).toMatch(/Terminal\.app/);
    expect(err.message).toMatch(/Settings/i);
  });
});