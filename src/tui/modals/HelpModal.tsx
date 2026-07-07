import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  onClose: () => void;
}

const LINES: Array<[string, string]> = [
  ['Tab', 'Switch pane'],
  ['↑ / ↓', 'Navigate'],
  ['Enter', 'Resume session'],
  ['n', 'New session in project'],
  ['r', 'Rename focused item'],
  ['d', 'Delete manual project'],
  ['c', 'Copy session ID'],
  ['/', 'Search sessions'],
  ['a', 'Add manual project'],
  [',', 'Open settings'],
  ['?', 'Show this help'],
  ['q / Ctrl+C', 'Quit'],
];

export const HelpModal: React.FC<Props> = ({ onClose }) => {
  // onClose is wired in a follow-up task (Esc handling in useKeybindings / App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  void onClose;
  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      {LINES.map(([k, v]) => (
        <Text key={k}>
          <Text color="cyan">{k.padEnd(12)}</Text> {v}
        </Text>
      ))}
      <Text dimColor>Press ? or Esc to close</Text>
    </Box>
  );
};