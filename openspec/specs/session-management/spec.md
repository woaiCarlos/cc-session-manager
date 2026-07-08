# session-management Specification

## Purpose
TBD - created by archiving change cc-session-manager. Update Purpose after archive.
## Requirements
### Requirement: Session List Display
The system SHALL display sessions within the currently selected project, sorted by `lastTimestamp` descending (most recently active first).

Each session entry SHALL display, in order of priority:
1. User alias (if set)
2. `lastPrompt` (truncated to 60 characters on first line, with `…` if longer) — this is Claude Code's parsed-and-cleaned last user input and is always plain text
3. `firstUserMessage` with XML tag stripping (e.g., remove `<command-message>...</command-message>` and `<command-name>...</command-name>` wrappers), truncated to 60 characters
4. Cwd basename (final fallback)
5. Last-active relative time (e.g., `2h ago`, `3d ago`)

The system SHALL NOT use `firstUserMessage` directly when it begins with `<` (a slash command wrapper) without first attempting `lastPrompt`.

#### Scenario: List sessions sorted by recency
- **WHEN** the user selects a project containing sessions with varying `lastTimestamp` values
- **THEN** the session list shows the most recent session at the top

#### Scenario: lastPrompt is the preferred display name
- **WHEN** a session has both `lastPrompt` and `firstUserMessage` set
- **THEN** the display name is derived from `lastPrompt` (since it is always clean plain text)

#### Scenario: lastPrompt is null and firstUserMessage is a slash command
- **WHEN** a session's `lastPrompt` is null and `firstUserMessage` starts with `<command-message>`
- **THEN** the system strips the XML tags and uses the remainder; if the remainder is empty, falls back to cwd basename

#### Scenario: Both lastPrompt and firstUserMessage are null
- **WHEN** a session has neither `lastPrompt` nor `firstUserMessage`
- **THEN** the display name is the cwd basename

### Requirement: Session Resume via Enter
The system SHALL resume a session when the user presses Enter on it. Resuming SHALL open a new terminal window with `cwd` set to the session's `cwd` and execute `claude --resume <sessionId>`.

#### Scenario: Resume a session
- **WHEN** the user selects a session and presses Enter
- **THEN** a new terminal window opens in the session's cwd and `claude --resume <sessionId>` is executed; the TUI remains interactive in the original terminal

#### Scenario: Resume fails because terminal cannot be launched
- **WHEN** the configured terminal application is not installed
- **THEN** the system displays an error message in the TUI and offers to switch terminal in Settings

### Requirement: Session Rename
The system SHALL allow the user to rename a session. Renaming a session SHALL only update the user alias; it SHALL NOT modify the session JSONL.

#### Scenario: Rename a session
- **WHEN** the user selects a session and presses `r`, then types `Login bug fix`
- **THEN** the session list updates immediately to show `Login bug fix` and the alias is persisted in `state.json#sessionAliases`

### Requirement: Session Copy ID
The system SHALL allow the user to copy a session's UUID to the system clipboard by pressing `c`.

#### Scenario: Copy session ID
- **WHEN** the user selects a session and presses `c`
- **THEN** the session's UUID is written to the macOS clipboard and a transient confirmation message appears in the TUI

### Requirement: Search and Filter
The system SHALL allow the user to filter sessions by typing a query in a search box opened with `/`. The filter SHALL match case-insensitively against: session alias, first user message, cwd path, and session ID prefix.

#### Scenario: Filter by alias
- **WHEN** the user types `/login` and presses Enter
- **THEN** only sessions whose alias or first-user-message contains `login` are displayed

#### Scenario: Clear filter
- **WHEN** the user presses Escape in the search box
- **THEN** the search box closes and the full session list is restored

