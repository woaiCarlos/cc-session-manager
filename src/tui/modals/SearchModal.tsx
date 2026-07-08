import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useEscapeToCancel } from '../hooks/useEscapeToCancel.js';

interface Props {
  initial?: string;
  onSubmit: (q: string) => void;
  onCancel: () => void;
}

export const SearchModal: React.FC<Props> = ({ initial = '', onSubmit, onCancel }) => {
  // Esc 关闭：注册一个独立的 useInput 监听 escape（见 useEscapeToCancel）。
  // 这与 useKeybindings 的 onClearSearch 并存 —— useKeybindings 是全局键表，
  // 这里是为本模态单独声明的取消语义，App 通过 onCancel 闭包派发 CLOSE_MODAL。
  useEscapeToCancel(onCancel);
  const [q, setQ] = useState(initial);
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Search sessions</Text>
      <TextInput value={q} onChange={setQ} onSubmit={() => onSubmit(q)} />
      <Text dimColor>Enter to apply · Esc to cancel</Text>
    </Box>
  );
};