## MODIFIED Requirements

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
