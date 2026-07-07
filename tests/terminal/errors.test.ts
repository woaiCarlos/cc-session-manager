import { describe, it, expect } from 'vitest';
import {
  isOsascriptBinaryMissing,
  isAppleScriptApplicationMissing,
} from '../../src/terminal/errors.js';

describe('isOsascriptBinaryMissing', () => {
  it('returns true for ENOENT errors (binary itself missing)', () => {
    const err = Object.assign(new Error('spawn osascript ENOENT'), {
      code: 'ENOENT',
    });
    expect(isOsascriptBinaryMissing(err)).toBe(true);
  });

  it('returns true for "command not found" errors', () => {
    const err = Object.assign(new Error('/bin/sh: osascript: command not found'), {
      code: 127,
    });
    expect(isOsascriptBinaryMissing(err)).toBe(true);
  });

  it('returns true for "No such file or directory" errors', () => {
    const err = new Error('posix_spawnp failed: No such file or directory');
    expect(isOsascriptBinaryMissing(err)).toBe(true);
  });

  it('returns false for unrelated osascript errors (e.g. permission denied)', () => {
    const err = Object.assign(new Error('Not authorized to send Apple events'), {
      code: 1,
    });
    expect(isOsascriptBinaryMissing(err)).toBe(false);
  });

  it('returns false for AppleScript application-not-found errors', () => {
    const err = Object.assign(
      new Error('execution error: Can\'t get application "iTerm2". (-1728)'),
      { code: 1 }
    );
    expect(isOsascriptBinaryMissing(err)).toBe(false);
  });

  it('returns false for null / non-error inputs', () => {
    expect(isOsascriptBinaryMissing(null)).toBe(false);
    expect(isOsascriptBinaryMissing(undefined)).toBe(false);
    expect(isOsascriptBinaryMissing('a string')).toBe(false);
  });
});

describe('isAppleScriptApplicationMissing', () => {
  it('detects the canonical "Can\'t get application" error for the named app', () => {
    const err = Object.assign(
      new Error('execution error: Can\'t get application "Warp". (-1728)'),
      { code: 1 }
    );
    expect(isAppleScriptApplicationMissing(err, 'Warp')).toBe(true);
  });

  it('does NOT match when the error mentions a different application', () => {
    // The user's selected app is iTerm2, but the error references Terminal —
    // the helper must not misclassify this as "iTerm2 missing".
    const err = new Error('execution error: Can\'t get application "Terminal". (-1728)');
    expect(isAppleScriptApplicationMissing(err, 'iTerm2')).toBe(false);
  });

  it('detects "is not running" errors for the named app', () => {
    const err = new Error('execution error: application "Warp" is not running.');
    expect(isAppleScriptApplicationMissing(err, 'Warp')).toBe(true);
  });

  it('detects "<name> isn\'t running" errors (generic -600 shape)', () => {
    const err = new Error('Warp isn\'t running.');
    expect(isAppleScriptApplicationMissing(err, 'Warp')).toBe(true);
  });

  it('returns false for automation permission errors', () => {
    const err = Object.assign(new Error('Not authorized to send Apple events'), {
      code: 1,
    });
    expect(isAppleScriptApplicationMissing(err, 'Warp')).toBe(false);
  });

  it('escapes regex metacharacters in the app name', () => {
    // Future-proofing: if someone adds an app name with `.` or `+`, the
    // match must still be exact instead of accidentally matching other apps.
    const err = new Error('execution error: Can\'t get application "Foo.bar". (-1728)');
    expect(isAppleScriptApplicationMissing(err, 'Foo.bar')).toBe(true);
    // The dot must NOT cause the matcher to also accept "FooXbar".
    expect(isAppleScriptApplicationMissing(err, 'FooXbar')).toBe(false);
  });

  it('returns false for empty / non-error inputs', () => {
    expect(isAppleScriptApplicationMissing(null, 'Warp')).toBe(false);
    expect(isAppleScriptApplicationMissing(undefined, 'Warp')).toBe(false);
    expect(isAppleScriptApplicationMissing(new Error(''), 'Warp')).toBe(false);
  });
});