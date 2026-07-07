import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  initial?: string;
  onSubmit: (q: string) => void;
  onCancel: () => void;
}

export const SearchModal: React.FC<Props> = ({ initial = '', onSubmit, onCancel }) => {
  // onCancel is wired in a follow-up task (Esc handling in useKeybindings / App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  void onCancel;
  const [q, setQ] = useState(initial);
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Search sessions</Text>
      <TextInput value={q} onChange={setQ} onSubmit={() => onSubmit(q)} />
      <Text dimColor>Enter to apply · Esc to cancel</Text>
    </Box>
  );
};
