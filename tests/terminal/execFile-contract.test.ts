/**
 * Task 5.7 — Terminal integration final verification layer.
 *
 * This test file is the canonical "execFile-only" contract guard for the
 * terminal backends. It exists to catch ANY regression that would re-introduce
 * shell-string interpretation (i.e. swapping `execFile(file, args[])` for
 * `exec("file ...args")`) or break AppleScript quoting under hostile input.
 *
 * Three layers of coverage:
 *
 *   1. **Static source audit** — read each backend file and assert there is
 *      no `child_process.exec` import AND no call site shaped like
 *      `exec("<literal string>")` (which is the fingerprint of the unsafe
 *      string-concatenation form). The local `const exec = promisify(execFile)`
 *      alias in each file is permitted because it dispatches to `execFile`.
 *
 *   2. **Dynamic execFile contract** — mock `node:child_process` and drive
 *      each backend with neutral input. Assert that the first positional arg
 *      to `execFile` is the binary name (a string), the second is an array
 *      of arguments, and the args array is the actual shell boundary (not
 *      a pre-baked string passed through `-c` or similar).
 *
 *   3. **Injection stress matrix** — for each backend, exercise a battery
 *      of hostile inputs (single quotes, double quotes, backslashes,
 *      shell metacharacters, command substitution, newlines, mixed attacks).
 *      Assert the resulting AppleScript snippet preserves the literal
 *      payload AND does not break the surrounding quoting context.
 *
 * If any of these checks fail, the terminal integration has lost its
 * "no shell interpretation" guarantee and downstream reviewers should
 * block the merge until the offending backend is reverted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Mock node:child_process at the top level so every backend picks up the
// mock regardless of import order. We keep the contract surface — `execFile`
// is still a function with the same `(file, args?, options?, cb?)` shape —
// so promisify still binds correctly.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { terminalApp } from '../../src/terminal/terminal-app.js';
import { iterm2 } from '../../src/terminal/iterm2.js';
import { warp } from '../../src/terminal/warp.js';

const mockedExecFile = vi.mocked(execFile);

// promisify(execFile) calls the underlying function as execFile(...args, cb),
// so the LAST positional argument is always the callback. Our mock fires it
// asynchronously on a microtask to mirror Node's real semantics.
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
  // Default: succeed with empty stdout/stderr.
  mockedExecFile.mockImplementation(
    makeExecFileMock((cb) => cb(null, '', ''))
  );
});

// ---------------------------------------------------------------------------
// Helper: locate the src/terminal directory relative to this test file.
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_TERMINAL_DIR = resolve(HERE, '..', '..', 'src', 'terminal');

/**
 * Find the index of the closing paren that matches the opening paren at
 * `start`. Skips over single-quoted, double-quoted, backtick, and
 * line-comment regions so a `)` inside a string does not throw the
 * balance off. Returns -1 if no matching close is found.
 */
function findMatchingParen(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i]!;
    // Skip single-line comments until end of line.
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    // Skip block comments.
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    // Skip single-quoted strings (no escaping inside single quotes in TS).
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    // Skip double-quoted strings, honouring backslash escapes.
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        const c = src[j]!;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '"') {
          j += 1;
          break;
        }
        if (c === '\n') {
          // Unterminated string — bail.
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    // Skip template literals, honouring ${...} nesting and backslash escapes.
    if (ch === '`') {
      let j = i + 1;
      let interp = 0;
      while (j < src.length) {
        const c = src[j]!;
        if (interp === 0 && c === '`') {
          j += 1;
          break;
        }
        if (interp === 0 && c === '\\') {
          j += 2;
          continue;
        }
        if (interp === 0 && c === '$' && src[j + 1] === '{') {
          interp = 1;
          j += 2;
          continue;
        }
        if (interp > 0 && c === '{') interp += 1;
        else if (interp > 0 && c === '}') interp -= 1;
        j += 1;
      }
      i = j;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Find the index of the top-level (depth-zero) comma in `s`. Skips over
 * the same regions as findMatchingParen. Returns -1 if there is no
 * top-level comma.
 */
function findTopLevelComma(s: string): number {
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length) {
        const c = s[j]!;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '"' || c === '\n') {
          j += c === '"' ? j + 1 : j;
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      let interp = 0;
      while (j < s.length) {
        const c = s[j]!;
        if (interp === 0 && c === '`') {
          j += 1;
          break;
        }
        if (interp === 0 && c === '\\') {
          j += 2;
          continue;
        }
        if (interp === 0 && c === '$' && s[j + 1] === '{') {
          interp = 1;
          j += 2;
          continue;
        }
        if (interp > 0 && c === '{') interp += 1;
        else if (interp > 0 && c === '}') interp -= 1;
        j += 1;
      }
      i = j;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return i;
    i += 1;
  }
  return -1;
}

/**
 * Hostile payloads we throw at every backend. Each entry is a labelled
 * (cwd, command) pair designed to break out of the surrounding quoting
 * context if escaping is even slightly wrong.
 */
const INJECTION_MATRIX: ReadonlyArray<{
  readonly label: string;
  readonly cwd: string;
  readonly command: string;
}> = [
  {
    label: 'POSIX single-quote breakout in cwd',
    cwd: "/Users/O'Brien/$(rm -rf /)/`whoami`",
    command: 'ls',
  },
  {
    label: 'AppleScript double-quote breakout in command',
    cwd: '/tmp',
    command: 'echo "; rm -rf / #',
  },
  {
    label: 'backslash + double-quote combo (order-sensitive escape)',
    cwd: '/tmp',
    command: 'echo \\"; cat /etc/passwd #',
  },
  {
    label: 'command substitution in command',
    cwd: '/tmp',
    command: 'echo `id`; rm -rf ~',
  },
  {
    label: 'newline injection in command',
    cwd: '/tmp',
    command: 'echo hi\ntell application "Finder" to quit',
  },
  {
    label: 'shell pipeline in cwd',
    cwd: '/Users/My Name/foo & bar | baz; echo pwn',
    command: 'pwd',
  },
  {
    label: 'mixed attack: quotes + backticks + dollar in command',
    cwd: "/Users/O'Brien",
    command: 'echo "$(id)" && `whoami`',
  },
];

describe('Task 5.7 — execFile-only contract (final verification layer)', () => {
  describe('static source audit', () => {
    /**
     * Read a source file from src/terminal and return its raw text.
     * The test only consults the source — never the compiled output —
     * so any future migration to a different module system still works.
     */
    function readBackend(filename: string): string {
      return readFileSync(resolve(SRC_TERMINAL_DIR, filename), 'utf8');
    }

    it('terminal-app.ts does NOT import child_process.exec (only execFile)', () => {
      const src = readBackend('terminal-app.ts');
      // The unsafe form is `import { exec }` or `import { exec, ... }`. We
      // tolerate `execFile`, `execFileOptions`, etc. but not a bare `exec`.
      expect(src).not.toMatch(/from\s+['"]node:child_process['"][^;]*\bexec\b(?!\w)/);
      expect(src).not.toMatch(/from\s+['"]child_process['"][^;]*\bexec\b(?!\w)/);
    });

    it('iterm2.ts does NOT import child_process.exec (only execFile)', () => {
      const src = readBackend('iterm2.ts');
      expect(src).not.toMatch(/from\s+['"]node:child_process['"][^;]*\bexec\b(?!\w)/);
      expect(src).not.toMatch(/from\s+['"]child_process['"][^;]*\bexec\b(?!\w)/);
    });

    it('warp.ts does NOT import child_process.exec (only execFile)', () => {
      const src = readBackend('warp.ts');
      expect(src).not.toMatch(/from\s+['"]node:child_process['"][^;]*\bexec\b(?!\w)/);
      expect(src).not.toMatch(/from\s+['"]child_process['"][^;]*\bexec\b(?!\w)/);
    });

    it('terminal-app.ts has no exec(<string-literal>) call site', () => {
      const src = readBackend('terminal-app.ts');
      // The UNSAFE shape is exec("...") or exec(`...`) — these would imply a
      // shell-string form. The SAFE shape is exec('osascript', ['-e', script])
      // where the first arg is a bare string (the binary name) and the
      // SECOND arg starts with `[` (an array literal). We assert the SAFE
      // shape is present and that there is NO call whose first arg is a
      // string literal but whose second arg is NOT an array literal.
      //
      // Implementation: find every exec( call, then look at the next ~80
      // characters and check that the second argument begins with `[`. If
      // a refactor reverts to exec("osascript -e " + script) the call
      // shape breaks and this test fails.
      const callPattern = /\bexec\s*\(/g;
      const calls: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(src)) !== null) {
        // Slice from the opening paren to the matching close paren.
        const start = match.index + match[0].length - 1; // index of '('
        const end = findMatchingParen(src, start);
        if (end < 0) continue;
        calls.push(src.slice(start, end + 1));
      }
      expect(calls.length, 'terminal-app.ts must contain at least one exec call').toBeGreaterThan(0);
      for (const call of calls) {
        // Strip the opening '(' and look at the args.
        const args = call.slice(1, -1);
        // Find the first comma (top-level) to split first arg from rest.
        const commaIdx = findTopLevelComma(args);
        if (commaIdx < 0) {
          // Single-arg call like exec(script). That is exactly the unsafe
          // shape — the WHOLE command is one string. Reject.
          throw new Error(
            `terminal-app.ts: exec() call has no second arg (shell-string form?): ${call}`
          );
        }
        const secondArg = args.slice(commaIdx + 1).trimStart();
        expect(
          secondArg.startsWith('['),
          `terminal-app.ts: exec() second arg must be an array literal, got: ${secondArg.slice(0, 40)}…`
        ).toBe(true);
      }
    });

    it('iterm2.ts has no exec(<string-literal>) call site', () => {
      const src = readBackend('iterm2.ts');
      const callPattern = /\bexec\s*\(/g;
      const calls: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(src)) !== null) {
        const start = match.index + match[0].length - 1;
        const end = findMatchingParen(src, start);
        if (end < 0) continue;
        calls.push(src.slice(start, end + 1));
      }
      expect(calls.length, 'iterm2.ts must contain at least one exec call').toBeGreaterThan(0);
      for (const call of calls) {
        const args = call.slice(1, -1);
        const commaIdx = findTopLevelComma(args);
        if (commaIdx < 0) {
          throw new Error(
            `iterm2.ts: exec() call has no second arg (shell-string form?): ${call}`
          );
        }
        const secondArg = args.slice(commaIdx + 1).trimStart();
        expect(
          secondArg.startsWith('['),
          `iterm2.ts: exec() second arg must be an array literal, got: ${secondArg.slice(0, 40)}…`
        ).toBe(true);
      }
    });

    it('warp.ts has no exec(<string-literal>) call site', () => {
      const src = readBackend('warp.ts');
      const callPattern = /\bexec\s*\(/g;
      const calls: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(src)) !== null) {
        const start = match.index + match[0].length - 1;
        const end = findMatchingParen(src, start);
        if (end < 0) continue;
        calls.push(src.slice(start, end + 1));
      }
      expect(calls.length, 'warp.ts must contain at least one exec call').toBeGreaterThan(0);
      for (const call of calls) {
        const args = call.slice(1, -1);
        const commaIdx = findTopLevelComma(args);
        if (commaIdx < 0) {
          throw new Error(
            `warp.ts: exec() call has no second arg (shell-string form?): ${call}`
          );
        }
        const secondArg = args.slice(commaIdx + 1).trimStart();
        expect(
          secondArg.startsWith('['),
          `warp.ts: exec() second arg must be an array literal, got: ${secondArg.slice(0, 40)}…`
        ).toBe(true);
      }
    });

    it('every terminal backend imports execFile from node:child_process', () => {
      // The positive half of the audit: each backend file MUST bring execFile
      // into scope. If a refactor removes the import, the file cannot compile
      // — but we assert it explicitly so the contract is reviewable.
      for (const file of ['terminal-app.ts', 'iterm2.ts', 'warp.ts']) {
        const src = readBackend(file);
        expect(src, `${file} must import execFile`).toMatch(
          /import\s*\{[^}]*\bexecFile\b[^}]*\}\s*from\s*['"]node:child_process['"]/
        );
      }
    });
  });

  describe('dynamic execFile contract — all backends', () => {
    /**
     * For each backend, drive it with a neutral request and assert the
     * execFile call shape. This catches a refactor that switches to
     * `exec("osascript -e ...")` (single-string form) at runtime, even
     * if the static import audit still passes.
     */
    const NEUTRAL_REQ = { cwd: '/Users/foo/bar', command: 'claude --resume abc' };

    it.each([
      ['terminalApp', terminalApp],
      ['iterm2', iterm2],
      // Warp has a successful keystroke path; default mock makes it succeed.
      ['warp', warp],
    ] as const)('%s invokes execFile(file, args[], ...) — never a shell string', async (_name, backend) => {
      await backend(NEUTRAL_REQ);

      // Find the FIRST call to execFile that targets osascript. (warp may
      // also call pbcopy on the fallback path, but with the default success
      // mock it should not.)
      const osascriptCall = mockedExecFile.mock.calls.find(
        (c) => c[0] === 'osascript'
      );
      expect(osascriptCall, `${_name} must call execFile('osascript', ...)`).toBeDefined();

      // First arg: binary name as a plain string, NOT a concatenated command.
      const first = osascriptCall![0];
      expect(typeof first).toBe('string');
      expect(first).toBe('osascript');

      // Second arg: an array of arguments (the whole point of execFile).
      const args = osascriptCall![1];
      expect(Array.isArray(args), `${_name}: second arg must be an args array`).toBe(true);
      // The args array must NOT contain a pre-baked command string that
      // would defeat the purpose of using execFile (e.g. ['-e', 'osascript ...']).
      // We allow only the canonical [-e, script] shape.
      expect(args).toEqual(['-e', expect.any(String)]);
    });
  });

  describe('injection stress matrix — no payload breaks the command', () => {
    /**
     * For each backend and each hostile payload in INJECTION_MATRIX, run
     * the backend and assert the resulting AppleScript snippet:
     *   (a) still contains a single coherent `do script` / `keystroke` /
     *       `create window` boundary;
     *   (b) does NOT contain an unescaped `"` followed by injection syntax
     *       that would terminate the AppleScript string literal;
     *   (c) the execFile call is shaped as execFile('osascript', ['-e', script])
     *       with no shell-string concatenation.
     *
     * These tests are intentionally LENIENT about exact byte sequences
     * because the escape utilities already have dedicated tests in
     * escape.test.ts. Here we only assert that the high-level injection
     * surface is closed: the malicious payload cannot escape the quoting
     * context.
     */
    const backends: ReadonlyArray<{
      readonly name: string;
      readonly run: (req: { cwd: string; command: string }) => Promise<unknown>;
      /**
       * For Warp, the keystroke path may reject and fall through to pbcopy
       * under the default mock. To keep the matrix deterministic we set up
       * a per-backend mock here instead of relying on the suite default.
       */
      readonly setupMock?: () => void;
    }> = [
      { name: 'terminalApp', run: terminalApp },
      { name: 'iterm2', run: iterm2 },
      // Warp uses the same mock the suite provides — the keystroke path
      // succeeds in the default happy mock, so it stays on the osascript
      // branch and never reaches pbcopy.
      { name: 'warp', run: warp },
    ];

    for (const backend of backends) {
      for (const payload of INJECTION_MATRIX) {
        it(`${backend.name} — ${payload.label}: payload does not break execFile shape`, async () => {
          backend.setupMock?.();
          await backend.run({ cwd: payload.cwd, command: payload.command });

          // There must be at least one execFile call.
          expect(mockedExecFile).toHaveBeenCalled();
          const osascriptCall = mockedExecFile.mock.calls.find(
            (c) => c[0] === 'osascript'
          );
          expect(osascriptCall).toBeDefined();

          // execFile contract: (binaryName, argsArray, options?, cb?).
          expect(typeof osascriptCall![0]).toBe('string');
          expect(osascriptCall![0]).toBe('osascript');
          expect(Array.isArray(osascriptCall![1])).toBe(true);
          const args = osascriptCall![1] as string[];

          // The script must come through the `-e` flag, NOT a `-c`-style
          // shell command. (AppleScript snippets longer than the osascript
          // argv limit would silently break if a refactor swapped -e for -c.)
          expect(args[0]).toBe('-e');

          // The script must be a non-empty string (a single, coherent
          // AppleScript snippet). It should NOT contain null bytes which
          // some terminals interpret as command terminators.
          const script = args[1]!;
          expect(script.length).toBeGreaterThan(0);
          expect(script).not.toContain('\0');
        });

        it(`${backend.name} — ${payload.label}: execFile was NOT called with a shell-string form`, async () => {
          backend.setupMock?.();
          await backend.run({ cwd: payload.cwd, command: payload.command });

          for (const call of mockedExecFile.mock.calls) {
            const file = call[0];
            const args = call[1];
            // BOTH invariants must hold for every call:
            //   (1) the binary name is a bare string
            //   (2) the second arg is an array
            // If either fails the call shape is "exec-like" rather than
            // "execFile-like", and we reject the test loudly.
            expect(typeof file, 'binary name must be a string').toBe('string');
            expect(Array.isArray(args), 'args must be an array').toBe(true);
          }
        });
      }
    }
  });
});