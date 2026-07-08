/**
 * AppleScript-safe escaping for shell strings.
 *
 * AppleScript's `do script` accepts a single shell command string. Two quoting
 * contexts are in play:
 *
 *   - The cwd is wrapped in single quotes so spaces, `&`, `|`, `;`, `$`, etc.
 *     are inert to the shell. Inside a POSIX single-quoted string the only
 *     special character is the single quote itself; we escape it via the
 *     canonical `'\''` sequence (end-qq, escaped-q, open-qq).
 *
 *   - The command itself is embedded inside AppleScript's double-quoted
 *     string (`do script "..."`). Inside an AppleScript double-quoted
 *     string, the only metacharacters are `\` (backslash) and `"` (double
 *     quote). We escape backslashes first, then double quotes — order
 *     matters; reversing it would double-escape backslashes that were
 *     meant as escape characters for quotes.
 *
 * These helpers exist so that callers can build AppleScript snippets
 * without ever concatenating user-controlled strings into a shell or
 * AppleScript context. Downstream code (tasks 5.2/5.3/5.4) should
 * always route cwd/command through these functions and use
 * `child_process.execFile` (never `exec`) to spawn `osascript`.
 */

/**
 * Escape a string for use inside a POSIX single-quoted shell context.
 *
 * Pass-through for everything except `'`. The shell metacharacters
 * `&`, `|`, `;`, `$`, `(`, `)`, `<`, `>`, `\`, ` `, etc. are inert
 * inside single quotes and require no escaping.
 */
export function escapeForAppleScript(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/**
 * Escape a string for use inside an AppleScript double-quoted string.
 *
 * Order matters: backslashes must be doubled first, otherwise the
 * backslash we use to escape a `"` would itself be re-escaped.
 */
export function escapeForAppleScriptDoubleQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a two-line AppleScript snippet that opens (or focuses) Terminal.app
 * and runs `cd <cwd> && <command>` in a new shell window/tab.
 *
 * `cwd` is single-quote-escaped (POSIX) and `command` is double-quote-escaped
 * (AppleScript) so that neither the shell nor AppleScript will interpret
 * metacharacters from either argument.
 */
export function buildTerminalAppScript(cwd: string, command: string): string {
  const eCwd = escapeForAppleScript(cwd);
  const eCmd = escapeForAppleScriptDoubleQuotes(command);
  return (
    'tell application "Terminal" to activate\n' +
    `tell application "Terminal" to do script "cd '${eCwd}' && ${eCmd}"`
  );
}