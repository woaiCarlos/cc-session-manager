## MODIFIED Requirements

### Requirement: Sessions Pane (modified)

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

### Requirement: Terminal Integration — Open Action Result Notification (modified)

The system SHALL notify the user of the result of an open action. When the chosen terminal backend is `current`, after the spawned child exits the system SHALL re-read the resumed session's JSONL file and update its display name, size, and last-active timestamp in the TUI.

#### Scenario: current backend exit refreshes session metadata

- **WHEN** the user resumes a session via the `current` backend and the `claude` child exits
- **THEN** ccsm re-reads that session's JSONL file and any change to its `custom-title`, `lastPrompt`, `sizeBytes`, or `lastTimestamp` is reflected in the sessions list without requiring a manual restart

#### Scenario: Other backends do not trigger rescan

- **WHEN** the user resumes a session via a non-`current` backend (Terminal.app / iTerm2 / Warp)
- **THEN** no rescan is triggered for the ccsm TUI; the existing snapshot remains until next launch