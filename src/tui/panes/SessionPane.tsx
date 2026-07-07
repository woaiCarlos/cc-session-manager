import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../../state/types.js';

interface Props {
  sessions: Session[];
  selectedId: string | null;
  focused: boolean;
  onSelect: (id: string) => void;
}

export const SessionPane: React.FC<Props> = ({ sessions, selectedId, focused, onSelect }) => {
  // onSelect is wired in a follow-up task (keyboard handlers in App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  // Ink 7.1.0 Text/Box do not accept an `onClick` prop, so the click handler
  // will be introduced alongside keyboard navigation in that follow-up task.
  void onSelect;
  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
      <Text bold>Sessions ({sessions.length})</Text>
      {sessions.length === 0 && <Text dimColor>No sessions yet (Scanning…)</Text>}
      {sessions.map((s) => {
        const sel = s.id === selectedId;
        return (
          <Text
            key={s.id}
            inverse={sel && focused}
            color={sel ? 'cyan' : undefined}
          >
            {sel ? '› ' : '  '}
            {s.displayName} <Text dimColor>· {s.lastActiveRelative}</Text>
          </Text>
        );
      })}
    </Box>
  );
};
