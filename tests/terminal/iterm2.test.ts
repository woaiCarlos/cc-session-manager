import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process so we never actually spawn osascript during unit tests.
// The factory must return a function whose `.length` matches the real execFile (4)
// so that `util.promisify` correctly places its callback as the last argument.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { iterm2 } from '../../src/terminal/iterm2.js';

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

describe('iterm2', () => {
  it('spawns osascript with -e and the built iTerm2 AppleScript snippet (basic execution)', async () => {
    await iterm2({ cwd: '/Users/foo/bar', command: 'claude --resume abc' });

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0]!;
    // Arg 0: command name
    expect(call[0]).toBe('osascript');
    // Arg 1: array containing the script via -e
    const args = call[1] as string[];
    expect(args).toEqual([
      '-e',
      '\ntell application "iTerm2"\n' +
        '  activate\n' +
        '  create window with default profile command "cd \'/Users/foo/bar\' && claude --resume abc"\n' +
        'end tell\n',
    ]);
  });

  it('targets the iTerm2 application dictionary (not Terminal.app)', async () => {
    // Sanity check that we are dispatching to iTerm2's AppleScript dictionary,
    // not to Terminal.app. The two backends share escape utilities but differ
    // in their target application and command verb.
    await iterm2({ cwd: '/tmp', command: 'pwd' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    expect(script).toContain('tell application "iTerm2"');
    expect(script).toContain('create window with default profile command');
    expect(script).not.toContain('tell application "Terminal"');
    expect(script).not.toContain('do script');
  });

  it('does not concatenate cwd/command into a shell string (C14: execFile + args array)', async () => {
    // Belt-and-braces: ensure execFile was called with an args array, not a single
    // string that would imply shell interpretation. If a refactor ever reintroduces
    // a shell-string path (e.g. by switching to exec), this test breaks loudly.
    await iterm2({ cwd: '/tmp', command: 'echo hi' });

    const call = mockedExecFile.mock.calls[0]!;
    expect(typeof call[0]).toBe('string');
    expect(Array.isArray(call[1])).toBe(true);
    // And the first arg must NOT be a single concatenated "-e tell application ..." string.
    const args = call[1] as string[];
    expect(args[0]).toBe('-e');
    // The AppleScript template starts with a leading newline; trim before
    // asserting the prefix so we are not coupled to template-literal
    // whitespace choices.
    expect(args[1]!.trimStart().startsWith('tell application "iTerm2"')).toBe(true);
  });

  it('escapes single quotes in cwd before passing the script to osascript (injection blocked)', async () => {
    // O'Brien-style cwd — single quote must be POSIX-escaped to '\''.
    await iterm2({ cwd: "/Users/O'Brien", command: 'ls' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    expect(script).toContain(`cd '/Users/O'\\''Brien' && ls`);
  });

  it('escapes double quotes in command before passing the script to osascript (injection blocked)', async () => {
    // Attempt to break out of the AppleScript double-quoted string.
    await iterm2({ cwd: '/x', command: 'echo "; rm -rf /' });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // The unescaped `"` would terminate the AppleScript string; we expect it
    // to appear as `\"` inside the create-window command argument.
    expect(script).toContain('echo \\"; rm -rf /');
    // Sanity: the literal `"; rm -rf /` must NOT appear unescaped.
    expect(script).not.toContain('echo "; rm -rf /');
  });

  it('escapes shell metacharacters in cwd (single-quote wrapping protects & | ; $ etc.)', async () => {
    await iterm2({
      cwd: '/Users/My Name/foo & bar | baz',
      command: 'ls',
    });

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1]!;
    // Whole cwd is wrapped in single quotes by the inline script template.
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

    await expect(iterm2({ cwd: '/x', command: 'ls' })).rejects.toThrow(/Apple events|Not authorized/);
  });
});