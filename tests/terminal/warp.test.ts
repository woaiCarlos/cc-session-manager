import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process so we never actually spawn osascript or pbcopy
// during unit tests. The factory must return a function whose `.length`
// matches the real execFile (4) so that `util.promisify` correctly places
// its callback as the last argument.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { warp } from '../../src/terminal/warp.js';
import { TerminalNotInstalledError } from '../../src/terminal/index.js';

const mockedExecFile = vi.mocked(execFile);

// promisify(execFile) invokes the underlying function as:
//   execFile(...userArgs, callback)
// so the callback is always the LAST positional argument, regardless of whether
// the caller passed 2, 3, or 4 positional args. Our mock simply fires the
// callback asynchronously to resolve the promise.
function makeExecFileMock(
  impl: (cb: (err: Error | null, stdout: string, stderr: string) => void) => void
) {
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
  // Default: succeed with empty stdout/stderr.
  mockedExecFile.mockImplementation(
    makeExecFileMock((cb) => cb(null, '', ''))
  );
});

describe('warp', () => {
  it('activates Warp and performs a best-effort keystroke injection (basic execution path)', async () => {
    await warp({ cwd: '/Users/foo/bar', command: 'claude --resume abc' });

    // TDD red-focus: the keystroke path itself is hard to verify against a
    // real Warp terminal (sandboxed macOS automation), so we instead assert
    // that we DID attempt keystroke injection — i.e. the first execFile call
    // targets osascript, not pbcopy, and the snippet contains the Warp activate
    // tell block plus a keystroke injection step.
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0]!;
    expect(call[0]).toBe('osascript');
    const args = call[1] as string[];
    expect(args[0]).toBe('-e');
    const script = args[1]!;
    expect(script).toContain('tell application "Warp" to activate');
    expect(script).toContain('keystroke');
    expect(script).toContain(`cd '/Users/foo/bar' && claude --resume abc`);
  });

  it('does not concatenate cwd/command into a shell string (C14: execFile + args array)', async () => {
    await warp({ cwd: '/tmp', command: 'echo hi' });

    const call = mockedExecFile.mock.calls[0]!;
    expect(typeof call[0]).toBe('string');
    expect(Array.isArray(call[1])).toBe(true);
    const args = call[1] as string[];
    expect(args[0]).toBe('-e');
  });

  it('escapes single quotes in cwd before passing the script to osascript (injection blocked)', async () => {
    await warp({ cwd: "/Users/O'Brien", command: 'ls' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // The script is wrapped in AppleScript double-quoted `keystroke "..."`.
    // We expect the POSIX escape pattern (`'` -> `'\''`) to appear as
    // `\'\\''` because Apple's double-quote context doubles each backslash.
    // Concretely: `O'Brien` -> `O'\''Brien` (4 chars between O and B), and
    // embedded inside the AppleScript double-quoted body, those 4 chars
    // appear as `O'\\''Brien` (the `\` is doubled for AppleScript, the
    // remaining `'''` are literal). The shell receives the 4-char sequence.
    expect(script).toMatch(/keystroke "cd '\/Users\/O'\\\\''Brien' && ls"/);
  });

  it('escapes double quotes in command before keystroke injection (injection blocked)', async () => {
    // Attempt to break out of the AppleScript double-quoted keystroke string.
    await warp({ cwd: '/x', command: 'echo "; rm -rf /' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // The unescaped `"` would terminate the AppleScript string; we expect it
    // to appear as `\"` inside the keystroke call. Inside an AppleScript
    // double-quoted body, `\\` is one literal `\` and `\"` is one literal `"`.
    // We verify the literal `"` from the command is NOT present as-is.
    expect(script).toContain('echo \\"');
    // Sanity: the literal `"; rm -rf /` must NOT appear unescaped inside
    // the AppleScript quoted body.
    expect(script).not.toContain('keystroke "cd \'/x\' && echo "; rm -rf /');
  });

  // ---------------------------------------------------------------
  // Fallback path — the primary red-test target of this task.
  // Warp keystroke injection is unreliable on many macOS configurations
  // (focus races, accessibility/automation permissions, Warp's key-handling
  // stack), so we ALWAYS need a clipboard fallback that the caller can
  // surface to the user.
  // ---------------------------------------------------------------

  it('falls back to pbcopy when the keystroke injection fails (best-effort contract)', async () => {
    // First execFile call = osascript — reject it.
    // Second execFile call = pbcopy — succeed.
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb !== 'function') {
        throw new Error('mock execFile: expected callback as last argument');
      }
      const command = args[0];
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => {
        if (command === 'pbcopy') {
          callback(null, '', '');
        } else {
          callback(
            Object.assign(new Error('Not authorized to send Apple events'), { code: 1 }),
            '',
            ''
          );
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return undefined as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    // Trigger the fallback path: warp must (1) try osascript (which fails
    // in this mock) and (2) fall back to pbcopy (which succeeds) before
    // surfacing the rejection to us.
    await expect(
      warp({ cwd: "/Users/O'Brien", command: 'echo "hi"' })
    ).rejects.toThrow(/clipboard|pbcopy/i);

    // Two execFile calls total: osascript (failed) + pbcopy (succeeded).
    expect(mockedExecFile).toHaveBeenCalledTimes(2);

    // We don't reconstruct the exact clipboard byte sequence here — that's
    // covered by the implementation's deterministic escape chain in
    // escapeForAppleScript. We only assert the salient invariants:
    //   (a) pbcopy is the target binary (not osascript)
    //   (b) execFile was used with an args array (C14)
    //   (c) the `input` option carries the full `cd <cwd> && <command>`
    //       string, ending with the trailing command and including the
    //       escaped cwd (so that pasting yields the right path).
    const pbcopyCall = mockedExecFile.mock.calls.find((c) => c[0] === 'pbcopy')!;
    expect(pbcopyCall).toBeDefined();
    expect(pbcopyCall[0]).toBe('pbcopy');
    expect(Array.isArray(pbcopyCall[1])).toBe(true);
    const opts = pbcopyCall[2] as { input?: string } | undefined;
    expect(opts).toBeDefined();
    const input = opts!.input!;
    expect(input).toMatch(/^cd '\/Users\/O/);
    expect(input).toContain(`Brien' && echo "hi"`);
    expect(input.length).toBeGreaterThan(`cd '/Users/O'Brien' && echo "hi"`.length);
  });

  it('still uses execFile (not exec) for the pbcopy fallback (C14)', async () => {
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb !== 'function') {
        throw new Error('mock execFile: expected callback as last argument');
      }
      const command = args[0];
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => {
        if (command === 'pbcopy') {
          callback(null, '', '');
        } else {
          callback(new Error('keystroke failed'), '', '');
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return undefined as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    await expect(warp({ cwd: '/x', command: 'ls' })).rejects.toThrow();

    // The pbcopy call is at index 1 (osascript at index 0 failed).
    const pbcopyCall = mockedExecFile.mock.calls[1]!;
    // C14: must be execFile('pbcopy', [...]) with an args array — NOT a shell
    // string. If a refactor reintroduces `exec('echo ... | pbcopy')` it breaks.
    expect(typeof pbcopyCall[0]).toBe('string');
    expect(pbcopyCall[0]).toBe('pbcopy');
    expect(Array.isArray(pbcopyCall[1])).toBe(true);
  });

  it('rejects without invoking pbcopy when the keystroke injection succeeds', async () => {
    // Default mock: osascript succeeds. We must NOT touch pbcopy.
    await expect(
      warp({ cwd: '/Users/foo/bar', command: 'pwd' })
    ).resolves.toBeUndefined();

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    expect(mockedExecFile.mock.calls[0]![0]).toBe('osascript');
  });

  it('propagates a useful error after the pbcopy fallback has succeeded', async () => {
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb !== 'function') {
        throw new Error('mock execFile: expected callback as last argument');
      }
      const command = args[0];
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => {
        if (command === 'pbcopy') {
          callback(null, '', '');
        } else {
          callback(new Error('keystroke injection refused'), '', '');
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return undefined as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    await expect(warp({ cwd: '/x', command: 'ls' })).rejects.toThrow(
      /clipboard|Paste manually|Warp/i
    );
  });

  // ---------------------------------------------------------------
  // Task 5.6: TerminalNotInstalledError contract for the Warp backend.
  // When Warp is genuinely not installed, osascript's `tell application "Warp"`
  // fails with a "Can't get application" error — we must rewrap that into
  // TerminalNotInstalledError so the UI can prompt the user to switch
  // terminals in Settings instead of showing a raw osascript diagnostic.
  //
  // Note: a generic keystroke-injection failure (e.g. accessibility
  // permission refused) must continue to take the pbcopy fallback path —
  // those tests are above; only Warp-missing takes the new error path.
  // ---------------------------------------------------------------

  it('throws TerminalNotInstalledError("Warp") when osascript reports Warp application is missing (skips pbcopy fallback)', async () => {
    // Typical osascript failure when Warp is not installed:
    //   execution error: Can't get application "Warp". (-1728)
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) =>
        cb(
          Object.assign(
            new Error('execution error: Can\'t get application "Warp". (-1728)'),
            { code: 1 }
          ),
          '',
          ''
        )
      )
    );

    const err = await warp({ cwd: '/x', command: 'ls' }).catch((e) => e);
    expect(err).toBeInstanceOf(TerminalNotInstalledError);
    expect((err as TerminalNotInstalledError).binary).toBe('Warp');
    // Sanity: when Warp is missing there is no point in stuffing the
    // clipboard — the user wouldn't be able to paste into Warp anyway.
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it('throws TerminalNotInstalledError("osascript") when execFile reports ENOENT (skips pbcopy fallback)', async () => {
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) =>
        cb(
          Object.assign(new Error('spawn osascript ENOENT'), { code: 'ENOENT' }),
          '',
          ''
        )
      )
    );

    const err = await warp({ cwd: '/x', command: 'ls' }).catch((e) => e);
    expect(err).toBeInstanceOf(TerminalNotInstalledError);
    expect((err as TerminalNotInstalledError).binary).toBe('osascript');
    // Sanity: no pbcopy fallback for a missing binary — pasting wouldn't help.
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it('TerminalNotInstalledError message from warp contains an actionable "Settings" hint', async () => {
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) =>
        cb(
          Object.assign(
            new Error('execution error: Can\'t get application "Warp". (-1728)'),
            { code: 1 }
          ),
          '',
          ''
        )
      )
    );

    const err = (await warp({ cwd: '/x', command: 'ls' }).catch(
      (e) => e
    )) as TerminalNotInstalledError;
    expect(err.message).toMatch(/Warp/);
    expect(err.message).toMatch(/Settings/i);
  });
});
