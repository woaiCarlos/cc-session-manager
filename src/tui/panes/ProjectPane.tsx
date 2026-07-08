import React from 'react';
import { Box, Text } from 'ink';
import type { Project } from '../../state/types.js';

interface Props {
  projects: Project[];
  selectedKey: string | null;
  focused: boolean;
  onSelect: (key: string) => void;
  /**
   * Compact mode (窄列布局): omit secondary fields (`(manual)` marker and
   * session-count trailing badge) so each row stays single-line. Driven by
   * `useTerminalSize` in App when `cols < 100`.
   */
  compact?: boolean;
}

export const ProjectPane: React.FC<Props> = ({
  projects,
  selectedKey,
  focused,
  onSelect,
  compact = false,
}) => {
  // onSelect is wired in a follow-up task (keyboard handlers in App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  void onSelect;
  if (projects.length === 0) {
    return (
      <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
        <Text dimColor>No projects found.</Text>
        <Text dimColor>Press `a` to add a directory, or `,` to configure the session root.</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
      <Text bold>Projects ({projects.length})</Text>
      {projects.map((p) => {
        const sel = p.key === selectedKey;
        return (
          <Text
            key={p.key}
            inverse={sel && focused}
            color={sel ? 'cyan' : undefined}
          >
            {sel ? '› ' : '  '}
            {p.displayName}
            {!compact && p.manual ? ' (manual)' : ''}
            {!compact ? ` (${p.sessions.length})` : ''}
          </Text>
        );
      })}
    </Box>
  );
};

export default ProjectPane;