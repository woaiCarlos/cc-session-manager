# tui-interface Specification

## Purpose
TBD - created by archiving change cc-session-manager. Update Purpose after archive.
## Requirements
### Requirement: Two-Pane Layout
The system SHALL render a two-pane TUI: project list on the left, session list on the right. The currently focused pane SHALL be visually highlighted.

#### Scenario: Initial render
- **WHEN** the user starts `ccsm`
- **THEN** the TUI renders with the project pane focused (or session pane if there is exactly one project)

### Requirement: Keyboard Navigation
The system SHALL support the following keybindings globally (unless overridden by an open modal):

| Key | Action |
|-----|--------|
| `Tab` | Switch focus between project pane and session pane |
| `↑` / `↓` | Move selection within the focused pane |
| `Enter` | Resume the focused session |
| `n` | Create a new session in the focused project |
| `a` | Add a manual project (open folder picker) |
| `r` | Rename the selected session |
| `d` | Delete the focused manual project (with confirmation) |
| `c` | Copy the focused session ID to clipboard |
| `/` | Open the search box |
| `,` | Open Settings |
| `?` | Open Help overlay |
| `q` / `Ctrl+C` | Quit the TUI and terminate the Node process (release `state.json#lock` first) |

#### Scenario: Navigate with arrow keys
- **WHEN** the user presses `↓` repeatedly
- **THEN** the selection moves down one item at a time within the focused pane

#### Scenario: Switch panes
- **WHEN** the user presses `Tab`
- **THEN** focus alternates between the project pane and the session pane, with visual indication

#### Scenario: Ctrl+C exits the Node process
- **WHEN** the user presses `Ctrl+C` from any view (main or modal)
- **THEN** the TUI releases the process lock, raw mode is restored, and the Node process exits with status 0 — no orphan `ccsm` PID remains in the process table

#### Scenario: `r` opens the rename modal only when a session is selected
- **WHEN** the focused pane is `sessions` and a session is selected
- **THEN** pressing `r` opens the rename modal pre-filled with the current session alias (or empty if no alias yet)

#### Scenario: `r` in the projects pane is a no-op
- **WHEN** the focused pane is `projects`
- **THEN** pressing `r` performs no action — no modal opens, no project side effect is triggered

#### Scenario: Renaming a session is reflected in the list immediately after submit
- **WHEN** the user opens the rename modal with a session selected, types a new name and presses Enter
- **THEN** the modal closes; the in-memory session list shows the new name at the renamed session's row; the alias is persisted to `state.json` so subsequent restarts also see the new name

### Requirement: Modal Dialogs
The system SHALL support modal dialogs for: search, rename, settings, help, and delete confirmation. While a modal is open, the keybindings above SHALL NOT fire; only the modal's own keys (e.g., typing into the input, Escape to cancel, Enter to confirm) SHALL be active.

#### Scenario: Open rename modal
- **WHEN** the user presses `r`
- **THEN** a modal appears with a text input pre-filled with the current name; pressing Enter saves, Escape cancels

#### Scenario: Settings modal
- **WHEN** the user presses `,`
- **THEN** a settings modal appears showing: Session Root path (with a `Change…` button), Terminal selection (radio buttons); changes are saved on confirm

### Requirement: Loading and Empty States
The system SHALL display appropriate visual feedback during scanning and when no projects exist.

#### Scenario: Initial render with skeleton projects
- **WHEN** the user starts `ccsm` and the state file contains manually added projects but the background scan has not yet completed
- **THEN** the project pane renders those manual projects immediately with each project showing a session count of `0 (Scanning…)`; the TUI is interactive and the user can perform actions (rename, new session, open settings); session counts update in real time as the background scan discovers sessions

#### Scenario: Loading indicator during scan
- **WHEN** the background scanner is still running
- **THEN** a spinner or "Scanning…" indicator is visible in the relevant pane

#### Scenario: Empty state guidance
- **WHEN** no projects are found (neither auto-derived nor manual)
- **THEN** the project pane shows guidance text: "No projects found. Press `a` to add a directory, or `,` to configure the session root."

### Requirement: Help Overlay
The system SHALL display a keybinding reference when the user presses `?`.

#### Scenario: Show help
- **WHEN** the user presses `?`
- **THEN** a scrollable overlay appears listing all keybindings; pressing `?` or Escape closes it

### Requirement: Terminal Width Adaptability
The system SHALL render correctly in terminals of width ≥ 80 columns. Below 80 columns, the layout SHALL degrade gracefully (e.g., abbreviate fields, wrap text) without crashing.

#### Scenario: Narrow terminal
- **WHEN** the user's terminal is 80 columns wide
- **THEN** both panes are visible side-by-side without overflow

