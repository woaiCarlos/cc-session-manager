import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process so we never actually spawn pbcopy during unit
// tests. The factory must return a function whose `.length` matches the
// real execFile (4) so that `util.promisify` correctly places its
// callback as the last argument.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { copySessionId } from '../../src/actions/copySessionId.js';

const mockedExecFile = vi.mocked(execFile);

// promisify(execFile) invokes the underlying function as:
//   execFile(...userArgs, callback)
// so the LAST positional argument is always the callback (or options
// before it). We fire the callback asynchronously to mirror Node's real
// semantics and unblock the awaiting promise.
function makeExecFileMock(
  impl: (cb: (err: Error | null, stdout: string, stderr: string) => void) => void
): unknown {
  return ((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') {
      throw new Error('mock execFile: expected callback as last argument');
    }
    queueMicrotask(() =>
      impl(cb as (err: Error | null, stdout: string, stderr: string) => void)
    );
    return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => {
  mockedExecFile.mockReset();
  // Default: pbcopy succeeds with empty stdout/stderr.
  mockedExecFile.mockImplementation(
    makeExecFileMock((cb) => cb(null, '', ''))
  );
});

describe('copySessionId', () => {
  it('invokes execFile with `pbcopy` and the session id on stdin', async () => {
    await copySessionId('abc-123');

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0]!;
    expect(call[0]).toBe('pbcopy');
  });

  it('passes the session id through `input` (not as an argv entry, not via shell)', async () => {
    // The session id is hostile-controlled user input (it is a Claude Code
    // session uuid, but defensively we still treat it as data). C14 mandates
    // execFile + args array — the id MUST travel via `input`, never as an
    // argv entry (would leak into `ps aux`) and never via `exec` shell-string.
    await copySessionId('sess-xyz-42');

    const call = mockedExecFile.mock.calls[0]!;
    // Second positional arg is the args array — must be empty (pbcopy
    // takes no CLI args; the payload belongs on stdin).
    expect(Array.isArray(call[1])).toBe(true);
    expect(call[1]).toEqual([]);
    // Third positional arg is the options object — the id rides via `input`.
    const opts = call[2] as { input?: unknown };
    expect(opts).toBeDefined();
    expect(opts.input).toBe('sess-xyz-42');
  });

  it('does not concatenate the session id into a shell string (C14: execFile + args array)', async () => {
    // Belt-and-braces: ensure execFile was called with an args array (not a
    // single concatenated string passed through a `-c` flag or similar).
    await copySessionId('any-id');

    const call = mockedExecFile.mock.calls[0]!;
    expect(typeof call[0]).toBe('string');
    expect(call[0]).toBe('pbcopy');
    expect(Array.isArray(call[1])).toBe(true);
    // The args array MUST NOT contain the session id — it must travel on stdin.
    expect(call[1]).not.toContain('any-id');
  });

  it('propagates a rejection from pbcopy without swallowing it', async () => {
    // The UI relies on this rejection to show a "clipboard unavailable"
    // status; a silently-swallowed error would leave the user staring at a
    // "Copied!" flash with an empty clipboard.
    const err = new Error('pbcopy: not found');
    mockedExecFile.mockImplementationOnce(
      makeExecFileMock((cb) => cb(err, '', ''))
    );

    await expect(copySessionId('sess-1')).rejects.toBe(err);
  });
});
