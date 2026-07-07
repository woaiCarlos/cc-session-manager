# terminal-integration Specification

## Purpose
TBD - created by archiving change cc-session-manager. Update Purpose after archive.
## Requirements
### Requirement: Terminal Selection
The system SHALL support three terminal emulators as the target for open/new actions: `terminal` (Terminal.app, default), `iterm2`, and `warp`. The selected terminal SHALL persist in `state.json#terminal`.

#### Scenario: Default to Terminal.app
- **WHEN** the user has never changed the terminal setting
- **THEN** all open/new actions target Terminal.app

#### Scenario: Switch to iTerm2
- **WHEN** the user selects iTerm2 in Settings
- **THEN** subsequent open/new actions target iTerm2 and the setting is persisted

### Requirement: Terminal.app Integration via AppleScript
The system SHALL open Terminal.app, activate it, and execute the requested command in a new window using AppleScript via `osascript`.

The AppleScript invocation SHALL:
1. Open Terminal.app if not running (`tell application "Terminal" to activate`)
2. Create a new window with the given command (`do script "cd '<cwd>' && <command>"`)
3. Properly escape single quotes and backslashes in the `cwd` and command strings

#### Scenario: Open in Terminal.app
- **WHEN** the user resumes a session with cwd `/Users/foo/proj` and id `abc-123`
- **THEN** Terminal.app is brought to front and a new window opens executing `cd '/Users/foo/proj' && claude --resume abc-123`

#### Scenario: Path with special characters
- **WHEN** the cwd contains a single quote (e.g., `/Users/foo/O'Brien`)
- **THEN** the AppleScript command is properly escaped so that the path resolves correctly

### Requirement: iTerm2 Integration
The system SHALL open iTerm2 and execute the requested command in a new window using iTerm2's AppleScript dictionary.

#### Scenario: Open in iTerm2
- **WHEN** the user resumes a session and the configured terminal is `iterm2`
- **THEN** iTerm2 is activated and a new window opens with the command executed

### Requirement: Warp Integration (Best Effort)
The system SHALL open Warp and attempt to inject the command via `osascript` keystroke events. The system SHALL document Warp's limitations in the README.

#### Scenario: Open in Warp
- **WHEN** the user resumes a session and the configured terminal is `warp`
- **THEN** Warp opens and the system attempts keystroke injection; if the user reports it fails, the system falls back to copying the command to the clipboard and notifying the user

### Requirement: Open Action Result Notification

The system SHALL always keep the TUI running in the original terminal after dispatching an open action, so the user can continue browsing without losing state. When the chosen terminal backend is `current`, after the spawned child exits the system SHALL re-read the resumed session's JSONL file and update its display name, size, and last-active timestamp in the TUI.

#### Scenario: TUI remains interactive after open

- **WHEN** the user resumes a session
- **THEN** the original TUI stays interactive in the current terminal; the new terminal window is created separately

#### Scenario: current backend exit refreshes session metadata

- **WHEN** the user resumes a session via the `current` backend and the `claude` child exits
- **THEN** ccsm re-reads that session's JSONL file and any change to its `custom-title`, `lastPrompt`, `sizeBytes`, or `lastTimestamp` is reflected in the sessions list without requiring a manual restart

#### Scenario: Other backends do not trigger rescan

- **WHEN** the user resumes a session via a non-`current` backend (Terminal.app / iTerm2 / Warp)
- **THEN** no rescan is triggered for the ccsm TUI; the existing snapshot remains until next launch

### Requirement: Sessions Pane

The system SHALL render a sessions list for the currently focused project. Each session row SHALL display, at minimum:

- The session's display name (derived from the JSONL `custom-title` if present, otherwise `lastPrompt` / `firstUserMessage` / cwd basename, in that priority order — see `fix-tui-exit-handling` change).
- The session's last-active relative timestamp.
- The session's JSONL file size in human-readable form (e.g. `1.2 KB`, `3.4 MB`, `5.6 GB`).

In compact mode (terminal width < 100 columns), the size MAY be omitted to keep each row single-line.

#### Scenario: Session row shows size

- **WHEN** the session pane renders a session whose underlying JSONL file is 2048 bytes
- **THEN** the session row contains the substring `· 2.0 KB` (with the dot separator and a single decimal place for non-byte units)

#### Scenario: Compact mode omits size

- **WHEN** the terminal width is < 100 columns
- **THEN** the session row does NOT contain a byte-size segment; only `displayName` is rendered

