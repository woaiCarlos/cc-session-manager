import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  initial: string;
  kind: 'session' | 'project';
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export const RenameModal: React.FC<Props> = ({ initial, kind, onSubmit, onCancel }) => {
  // onCancel is wired in a follow-up task (Esc handling in useKeybindings / App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  void onCancel;
  const [v, setV] = useState(initial);
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Rename {kind}</Text>
      <TextInput value={v} onChange={setV} onSubmit={() => onSubmit(v)} />
      <Text dimColor>Enter to save · Esc to cancel</Text>
    </Box>
  );
};
