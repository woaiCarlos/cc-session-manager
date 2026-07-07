## ADDED Requirements

### Requirement: State File Location
The system SHALL persist user state in `~/.config/cc-manager/state.json`. The directory SHALL be created on first write if it does not exist.

#### Scenario: First-run state creation
- **WHEN** the user performs any action that modifies state (rename, manual project add, settings change)
- **THEN** the system creates `~/.config/cc-manager/` if missing and writes `state.json` with the current values

### Requirement: State Schema
The state file SHALL contain the following fields, all optional (default values apply if missing):

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `sessionRoot` | string \| null | null (auto-detect) | Override for session root directory |
| `terminal` | `"terminal"` \| `"iterm2"` \| `"warp"` | `"terminal"` | Target terminal emulator |
| `sessionAliases` | Record<sessionId, displayName> | {} | User-assigned display names for sessions |
| `projectAliases` | Record<groupKey, displayName> | {} | User-assigned display names for projects |
| `manualProjects` | Array<{ path: string, addedAt: ISO8601 }> | [] | Manually added project directories |
| `hiddenProjects` | Array<groupKey> | [] | Projects hidden from the list |

#### Scenario: Default state on first run
- **WHEN** the user starts `ccsm` for the first time and no `state.json` exists
- **THEN** the system uses defaults: `terminal: "terminal"`, empty aliases/arrays, `sessionRoot: null` (auto-detect)

#### Scenario: Migrate missing fields gracefully
- **WHEN** `state.json` exists but is missing one or more fields (e.g., from an older version)
- **THEN** the system fills in defaults for missing fields without overwriting existing values

### Requirement: Atomic Write
The system SHALL write `state.json` atomically: write to a temp file in the same directory, then `rename` over the target. This SHALL prevent corruption if the process is killed mid-write.

#### Scenario: Write succeeds
- **WHEN** the user renames a session
- **THEN** the system writes `state.json.tmp` and renames it to `state.json`; the file is never observed in a partially-written state by another process

### Requirement: Read Resilience
The system SHALL tolerate a missing or unreadable `state.json` by falling back to defaults. If the file is present but contains invalid JSON, the system SHALL back it up to `state.json.bak.<timestamp>` and start fresh.

#### Scenario: Corrupt state file
- **WHEN** `state.json` contains invalid JSON
- **THEN** the system renames it to `state.json.bak.<timestamp>`, logs a warning, and starts with default state

### Requirement: Concurrent Instance Detection
The system SHALL detect when another `ccsm` instance is running by writing a PID file to `~/.config/cc-manager/lock` on startup.

The system SHALL:
- Write the current PID to the lock file on startup
- On startup, if the lock file exists and the PID inside is still alive (`kill -0` succeeds), display a warning modal asking the user whether to take over the lock or quit
- If the lock file is older than 24 hours (staleness check), the system SHALL treat it as a zombie and overwrite it without warning
- Remove the lock file on clean exit (`q` or `Ctrl+C`)

#### Scenario: Clean start with no other instance
- **WHEN** the user starts `ccsm` and no lock file exists
- **THEN** the system writes its PID to the lock file and proceeds normally

#### Scenario: Another instance is running
- **WHEN** the user starts `ccsm` and the lock file contains a PID that is still alive
- **THEN** the system shows a warning modal: "Another ccsm instance (PID <pid>) is running. Take over? [Y/n]"; on Yes, overwrites the lock and continues; on No, exits cleanly

#### Scenario: Stale lock file
- **WHEN** the user starts `ccsm` and the lock file is older than 24 hours
- **THEN** the system overwrites the lock file with the current PID and proceeds without warning