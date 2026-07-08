# project-grouping Specification

## Purpose
TBD - created by archiving change cc-session-manager. Update Purpose after archive.
## Requirements
### Requirement: Automatic Project Grouping by cwd
The system SHALL group sessions into projects by their `cwd` field, where each unique `cwd` value defines one project.

The group identifier SHALL be the absolute path of `cwd`. The display name SHALL resolve via: user alias → `cwd` basename → full `cwd` path.

#### Scenario: Group sessions by shared cwd
- **WHEN** multiple sessions have the same `cwd` value `/Users/carlos/workspace/dinotty`
- **THEN** they appear under a single project group with that cwd

#### Scenario: Display name falls back to cwd basename
- **WHEN** the user has not set an alias for a project
- **THEN** the project display name is the last path segment of the cwd (e.g., `dinotty`)

### Requirement: Manual Project Addition
The system SHALL allow the user to add an arbitrary directory as a project via the operating system's native folder picker, even if no sessions exist for it yet.

Manually added projects SHALL be persisted in `state.json#manualProjects` and distinguished from auto-derived projects by a `manual: true` flag.

#### Scenario: Add a directory without existing sessions
- **WHEN** the user presses `a` and selects `/Users/carlos/workspace/new-project` via the folder picker
- **THEN** the project appears in the project list with `(empty)` placeholder for sessions and a badge indicating it was manually added

#### Scenario: Folder picker cancel
- **WHEN** the user opens the folder picker and cancels
- **THEN** the project list is unchanged

### Requirement: Project Rename
The system SHALL allow the user to rename a project. Renaming a project SHALL only update the user alias for that group; it SHALL NOT modify any session JSONL or move files.

#### Scenario: Rename a project
- **WHEN** the user selects a project and presses `r`, then types `My Cool Project`
- **THEN** the project list updates immediately to show `My Cool Project` and the alias is persisted in `state.json#projectAliases`

### Requirement: Project Deletion (Manual Only)
The system SHALL allow the user to remove manually added projects from the list. The system SHALL NOT allow deletion of auto-derived projects that still have sessions, but SHALL allow deletion of auto-derived projects whose sessions have all been removed or moved.

Deleting a project SHALL only remove it from the application's tracking; it SHALL NOT delete any files on disk.

#### Scenario: Delete a manually added project
- **WHEN** the user selects a manual project and presses `d`, then confirms
- **THEN** the project is removed from the list and from `state.json#manualProjects`

#### Scenario: Attempt to delete auto-derived project with sessions
- **WHEN** the user selects an auto-derived project that still has sessions
- **THEN** the system displays an error and refuses deletion

### Requirement: New Session Creation in Project
The system SHALL allow the user to create a new Claude Code session in any project's directory by pressing `n`. This SHALL open a new terminal window with `cwd` set to the project's path and execute `claude`.

#### Scenario: Create new session in manual project
- **WHEN** the user selects a manually added project and presses `n`
- **THEN** a new terminal window opens in the project's directory and `claude` is executed

#### Scenario: Create new session in auto-derived project
- **WHEN** the user selects an auto-derived project (with at least one session) and presses `n`
- **THEN** a new terminal window opens in that project's `cwd` and `claude` is executed

