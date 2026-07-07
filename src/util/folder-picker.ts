/**
 * Stub: opens a native macOS folder picker and returns the chosen path.
 *
 * Real implementation lands in Task 8.1 (AppleScript-driven chooser via
 * osascript). For now, this stub returns `null` so callers compile and
 * can be unit-tested with a `vi.mock` substitution.
 */
export async function pickFolder(_prompt: string): Promise<string | null> {
  return null;
}