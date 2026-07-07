/**
 * Task 8.1 — `folder-picker.ts` (macOS `osascript choose folder`).
 *
 * Contract verified here:
 *
 *   - `pickFolder(prompt)` invokes `osascript` via `execFile` (NEVER `exec`),
 *     first arg is the binary name string `'osascript'`, second arg is an
 *     array `['-e', <script>]` (the script is a single AppleScript string
 *     delivered via `-e`, not a shell-string concatenation).
 *   - When the user picks a folder, AppleScript prints its POSIX path;
 *     `pickFolder` returns the trimmed path string.
 *   - When the user CANCELS, osascript exits with code 1 and prints no
 *     path. Some AppleScript snippets also explicitly `return false` —
 *     both cancellation shapes must resolve to `null`, NOT reject.
 *   - Any non-cancellation osascript failure (e.g. permission denied,
 *     AppleScript compile error, Automation rejected) must PROPAGATE so
 *     the caller can surface the diagnostic; we never swallow it as a
 *     silent cancel.
 *
 * The `node:child_process` module is mocked so the test never spawns a
 * real osascript. execFile is bound via `promisify`, so the mock must
 * invoke its callback as the LAST positional argument — that is the
 * `execFile(file, args[], options?, cb?)` shape Node uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { pickFolder } from '../../src/util/folder-picker.js';

const mockedExecFile = vi.mocked(execFile);

// promisify(execFile) calls the underlying function as execFile(...args, cb),
// so the LAST positional arg is the callback. Our mock fires the callback
// asynchronously to mirror Node's real (cp = ChildProcess, returns Promise
// via promisify) semantics.
function makeExecFileMock(
  impl: (cb: (err: Error | null, stdout: string, stderr: string) => void) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') {
      throw new Error('mock execFile: expected callback as last argument');
    }
    queueMicrotask(() =>
      impl(cb as (err: Error | null, stdout: string, stderr: string) => void),
    );
    return undefined;
  };
}

/**
 * Build an Error-shaped object that matches what Node's `promisify(execFile)`
 * produces on a non-zero exit: `err.code === exitCode` (the numeric exit
 * status), and `err.stdout` / `err.stderr` set to the captured I/O.
 */
function spawnError(
  code: number,
  message: string,
  stdout = '',
  stderr = '',
): Error {
  const err = new Error(message) as Error & {
    code?: number;
    stdout?: string;
    stderr?: string;
  };
  err.code = code;
  err.stdout = stdout;
  err.stderr = stderr;
  return err;
}

beforeEach(() => {
  mockedExecFile.mockReset();
});

describe('pickFolder', () => {
  it('returns the trimmed POSIX path on a successful pick', async () => {
    // Default happy path: osascript exits 0 with the POSIX path on stdout.
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) =>
        cb(null, '/Users/alice/Projects/my-app\n', ''),
      ),
    );

    const result = await pickFolder('Select a project directory');

    expect(result).toBe('/Users/alice/Projects/my-app');
  });

  it('returns null when the script prints the literal "false" (explicit AppleScript cancel return)', async () => {
    // Some AppleScript snippets explicitly `return false` to signal cancel.
    // pickFolder must treat that as a user-cancel, NOT a successful pick.
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) => cb(null, 'false\n', '')),
    );

    const result = await pickFolder('Select a project directory');

    expect(result).toBeNull();
  });

  it('returns null when osascript exits with code 1 and empty stdout (user clicked Cancel)', async () => {
    // This is the canonical osascript cancellation: exit code 1, no stdout,
    // stderr may or may not carry AppleScript's "User canceled. (-128)"
    // message. pickFolder must NOT propagate the rejection — the action
    // layer treats a null return as a quiet cancel.
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) => cb(spawnError(1, 'User canceled.'), '', '')),
    );

    const result = await pickFolder('Select a project directory');

    expect(result).toBeNull();
  });

  it('rethrows non-cancellation osascript failures (permission denied, compile error, etc.)', async () => {
    // Any exit code OTHER than 1 means the dialog never reached the user
    // (or AppleScript itself failed to compile / Automation was rejected).
    // Silently mapping those to null would hide a real misconfiguration;
    // the caller UI relies on the rejection to surface a diagnostic.
    const err = spawnError(
      2,
      'execution error: Not authorized to send Apple events to Finder. (-1743)',
      '',
      'execution error: Not authorized to send Apple events to Finder. (-1743)',
    );
    mockedExecFile.mockImplementation(makeExecFileMock((cb) => cb(err, '', '')));

    await expect(pickFolder('Select a project directory')).rejects.toBe(err);
  });

  it('invokes execFile with the binary name as a bare string (execFile-only contract)', async () => {
    // The first argument MUST be the literal binary name 'osascript', never
    // a concatenated command string. This is the static + dynamic half of
    // the C14 / execFile-only policy that the terminal backends also honor
    // (see tests/terminal/execFile-contract.test.ts).
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) => cb(null, '/tmp\n', '')),
    );

    await pickFolder('Select a project directory');

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const call = mockedExecFile.mock.calls[0]!;
    expect(call[0]).toBe('osascript');
    // Second arg must be an ARRAY (the `execFile`-style API), not a string.
    expect(Array.isArray(call[1])).toBe(true);
    const args = call[1] as string[];
    expect(args[0]).toBe('-e');
    expect(typeof args[1]).toBe('string');
    expect((args[1] as string).length).toBeGreaterThan(0);
  });

  it('embeds the prompt into the AppleScript snippet with double-quote escaping', async () => {
    // The dialog title comes from `choose folder with prompt "…"`. A naive
    // string concatenation would break the AppleScript quoting as soon as
    // the prompt contained a literal `"`. We escape `"` -> `\"` so the
    // resulting snippet is always well-formed AppleScript.
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) => cb(null, '/tmp\n', '')),
    );

    await pickFolder('Pick "your" dir');

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1] as string;
    expect(script).toContain('Pick \\"your\\" dir');
    // The escape must be applied uniformly inside the choose folder body —
    // i.e., the surrounding AppleScript syntax (`choose folder with prompt`,
    // `POSIX path of theFolder`) must remain intact.
    expect(script).toMatch(/choose folder with prompt "Pick \\"your\\" dir"/);
  });

  it('uses `choose folder` (not `choose file`) so the user sees a directory chooser', async () => {
    // Spec (openspec/.../specs/project-grouping/spec.md): "the operating
    // system's native folder picker". A file chooser would be a contract
    // regression even if it happens to also work.
    mockedExecFile.mockImplementation(
      makeExecFileMock((cb) => cb(null, '/tmp\n', '')),
    );

    await pickFolder('Pick a folder');

    const args = mockedExecFile.mock.calls[0]![1] as string[];
    const script = args[1] as string;
    expect(script).toContain('choose folder');
    expect(script).not.toMatch(/\bchoose file\b/);
  });
});
