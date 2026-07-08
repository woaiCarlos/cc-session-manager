## ADDED Requirements

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
The system SHALL always keep the TUI running in the original terminal after dispatching an open action, so the user can continue browsing without losing state.

#### Scenario: TUI remains interactive after open
- **WHEN** the user resumes a session
- **THEN** the original TUI stays interactive in the current terminal; the new terminal window is created separately