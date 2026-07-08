## MODIFIED Requirements

### Requirement: Open Action Result Notification
The system SHALL always keep the TUI running in the original terminal after dispatching an open action, so the user can continue browsing without losing state. After a `current`-backend session exits, the TUI SHALL restore the full project / session list (not an empty state).

#### Scenario: TUI remains interactive after open
- **WHEN** the user resumes a session using any terminal backend
- **THEN** the original TUI stays interactive in the current terminal; the new terminal window is created separately

#### Scenario: 'current' backend restores project list after session exits
- **WHEN** the user resumes a session using the `current` backend, `claude` runs and then exits
- **THEN** Ink re-mounts and the project pane displays all projects (with their session counts) exactly as they were before the resume — no blank / empty state
