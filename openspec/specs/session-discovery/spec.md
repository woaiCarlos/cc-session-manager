# session-discovery Specification

## Purpose
TBD - created by archiving change cc-session-manager. Update Purpose after archive.
## Requirements
### Requirement: Session Root Auto-Detection
The system SHALL automatically detect the Claude Code session storage root directory on startup.

The detection priority SHALL be:
1. The `CLAUDE_CONFIG_DIR` environment variable (joined with `/projects`)
2. `$HOME/.claude/projects/` (default)
3. `$HOME/Library/Application Support/Claude/projects/` (fallback for system-wide installs)

If none of these paths exist, the system SHALL signal detection failure to the UI layer so the user can manually specify a path.

#### Scenario: Default detection succeeds
- **WHEN** the user starts `ccsm` with no prior configuration and `~/.claude/projects/` exists
- **THEN** the system uses `~/.claude/projects/` as the session root and proceeds to scanning

#### Scenario: CLAUDE_CONFIG_DIR overrides default
- **WHEN** the user has set `CLAUDE_CONFIG_DIR=/custom/path` and `/custom/path/projects` exists
- **THEN** the system uses `/custom/path/projects` as the session root

#### Scenario: No session directory found
- **WHEN** none of the detection paths exist
- **THEN** the system enters the configuration UI prompting the user to specify a custom session root

### Requirement: Session Metadata Extraction
The system SHALL extract the following metadata from each `*.jsonl` file under the session root:

- `sessionId` (from any record's `sessionId` field, or from the filename UUID)
- `cwd` (from the first record that has a `cwd` field)
- `firstUserMessage` (from the first record where `type === "user"` and `message.content` is a non-empty string)
- `lastPrompt` (from the most recent `type === "last-prompt"` record's `lastPrompt` field, or `null` if no such record exists)
- `lastTimestamp` (from the maximum `timestamp` value across all records)

The system SHALL tolerate malformed records by skipping them without aborting the scan.

#### Scenario: Extract metadata from a well-formed session
- **WHEN** the scanner encounters a JSONL file with valid records
- **THEN** it produces a `SessionMeta` object with `sessionId`, `cwd`, `firstUserMessage`, `lastPrompt`, and `lastTimestamp`

#### Scenario: lastPrompt is the most recent prompt
- **WHEN** the JSONL contains multiple `type === "last-prompt"` records
- **THEN** `SessionMeta.lastPrompt` is the value from the most recent such record

#### Scenario: No last-prompt record exists
- **WHEN** the JSONL has no `type === "last-prompt"` record (e.g., a session that was created but immediately closed)
- **THEN** `SessionMeta.lastPrompt` is `null` and the UI falls back to `firstUserMessage`

#### Scenario: Tolerate malformed JSONL
- **WHEN** the scanner encounters a JSONL line that fails to parse
- **THEN** it skips that line and continues scanning the rest of the file

#### Scenario: Handle empty JSONL
- **WHEN** the scanner encounters an empty JSONL file
- **THEN** it skips the file without throwing

### Requirement: Background Scanning
The system SHALL scan the session root asynchronously after TUI render, so the UI is interactive within 500ms even when scanning thousands of sessions.

#### Scenario: Scan completes after UI render
- **WHEN** the user starts `ccsm` and the session root contains 1000 sessions
- **THEN** the main TUI renders within 500ms and the session list populates as scanning completes (with a loading indicator visible during the scan)

### Requirement: Manual Session Root Override
The system SHALL allow the user to override the session root directory via a setting that persists across restarts.

#### Scenario: Override via settings
- **WHEN** the user opens Settings and specifies `/custom/sessions`
- **THEN** the system saves this value to `state.json#sessionRoot` and immediately rescans from the new path

