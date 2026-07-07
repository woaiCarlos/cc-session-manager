import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<Props> = ({ prompt, onConfirm, onCancel }) => {
  // onConfirm / onCancel are bound in a follow-up task (Y/N key handling in Task 7.14).
  // Marked used via void references so TS noUnusedParameters doesn't flag them.
  void onConfirm;
  void onCancel;
  return (
    <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
      <Text bold color="red">{prompt}</Text>
      <Text>
        Press <Text color="green">Y</Text> to confirm, <Text color="red">N</Text> or Esc to cancel.
      </Text>
    </Box>
  );
};