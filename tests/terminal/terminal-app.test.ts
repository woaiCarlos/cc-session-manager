import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process so we never actually spawn osascript during unit tests.
// The factory must return a function whose `.length` matches the real execFile (4)
// so that `util.promisify` correctly places its callback as the last argument.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { terminalApp } from '../../src/terminal/terminal-app.js';

const mockedExecFile = vi.mocked(execFile);

// promisify(execFile) invokes the underlying function as:
//   execFile(...userArgs, callback)
// so the callback is always the LAST positional argument, regardless of whether
// the caller passed 2, 3, or 4 positional args. Our mock simply fires the
// callback asynchronously to resolve the promise.
function makeExecFileMock(impl: (cb: (err: Error | null, stdout: string, stderr: string) => void) => void) {
  return ((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') {
      throw new Error('mock execFile: expected callback as last argument');
    }
    queueMicrotask(() => impl(cb as (err: Error | null, stdout: string, stderr: string) => void));
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

describe('terminalApp', () => {
  it('spawns osascript with -e and the built AppleScript snippet (basic execution)', async () => {
    await terminalApp({ cwd: '/Users/foo/bar', command: 'claude --resume abc' });

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0]!;
    // Arg 0: command name
    expect(call[0]).toBe('osascript');
    // Arg 1: array containing the script via -e
    const args = call[1] as string[];
    expect(args).toEqual([
      '-e',
      'tell application "Terminal" to activate\n' +
        'tell application "Terminal" to do script "cd \'/Users/foo/bar\' && claude --resume abc"',
    ]);
  });

  it('does not concatenate cwd/command into a shell string (C14: execFile + args array)', async () => {
    // Belt-and-braces: ensure execFile was called with an args array, not a single
    // string that would imply shell interpretation. If a refactor ever reintroduces
    // a shell-string path (e.g. by switching to exec), this test breaks loudly.
    await terminalApp({ cwd: '/tmp', command: 'echo hi' });

    const call = mockedExecFile.mock.calls[0]!;
    expect(typeof call[0]).toBe('string');
    expect(Array.isArray(call[1])).toBe(true);
    // And the first arg must NOT be a single concatenated "-e tell application ..." string.
    const args = call[1] as string[];
    expect(args[0]).toBe('-e');
    expect(args[1]!.startsWith('tell application "Terminal"')).toBe(true);
  });

  it('escapes single quotes in cwd before passing the script to osascript (injection blocked)', async () => {
    // O'Brien-style cwd — single quote must be POSIX-escaped to '\''.
    await terminalApp({ cwd: "/Users/O'Brien", command: 'ls' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // The escaping pattern produced by escapeForAppleScript: '
    expect(script).toContain(`cd '/Users/O'\\''Brien' && ls`);
  });

  it('escapes double quotes in command before passing the script to osascript (injection blocked)', async () => {
    // Attempt to break out of the AppleScript double-quoted string.
    await terminalApp({ cwd: '/x', command: 'echo "; rm -rf /' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // The unescaped `"` would terminate the AppleScript string; we expect it
    // to appear as `\"` inside the do-script argument.
    expect(script).toContain('echo \\"; rm -rf /');
    // Sanity: the literal `"; rm -rf /` must NOT appear unescaped.
    expect(script).not.toContain('echo "; rm -rf /');
  });

  it('escapes shell metacharacters in cwd (single-quote wrapping protects & | ; $ etc.)', async () => {
    await terminalApp({
      cwd: '/Users/My Name/foo & bar | baz',
      command: 'ls',
    });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // Whole cwd is wrapped in single quotes by buildTerminalAppScript.
    expect(script).toContain(`cd '/Users/My Name/foo & bar | baz' && ls`);
  });

  it('rejects when osascript fails (propagates the error to the caller)', async () => {
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) =>
        cb(
          Object.assign(new Error('Not authorized to send Apple events'), { code: 1 }),
          '',
          ''
        )
      )
    );

    await expect(terminalApp({ cwd: '/x', command: 'ls' })).rejects.toThrow(/Apple events|Not authorized/);
  });
});