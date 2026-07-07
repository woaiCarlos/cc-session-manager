import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { AppState, TerminalChoice } from '../../state/types.js';

interface Props {
  state: AppState;
  onSubmit: (next: Partial<AppState>) => void;
  onCancel: () => void;
}

const TERMINAL_CHOICES: TerminalChoice[] = ['terminal', 'iterm2', 'warp'];

export const SettingsModal: React.FC<Props> = ({ state, onSubmit, onCancel }) => {
  // onCancel is wired in a follow-up task (Esc handling in useKeybindings / App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  void onCancel;
  const [root, setRoot] = useState(state.sessionRoot ?? '');
  const [term, setTerm] = useState<TerminalChoice>(state.terminal);
  // setTerm is wired in Task 7.14 (T key cycle between terminal / iterm2 / warp).
  // Marked used via void reference so TS noUnusedLocals doesn't flag it.
  void setTerm;

  const save = () => {
    // 空白字符串 → null：触发 store 端的 auto-detect 回退（Task 2.5 实现）。
    const trimmed = root.trim();
    onSubmit({
      sessionRoot: trimmed === '' ? null : trimmed,
      terminal: term,
    });
  };

  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Settings</Text>
      <Text>Session root (leave blank to auto-detect):</Text>
      <TextInput value={root} onChange={setRoot} onSubmit={save} />
      <Text> </Text>
      <Text>Terminal:</Text>
      {TERMINAL_CHOICES.map((t) => (
        <Text key={t}>
          {term === t ? '● ' : '○ '}
          {t}
        </Text>
      ))}
      <Text dimColor>Press T to switch terminal · Enter to save · Esc to cancel</Text>
      {/* 简化版：Enter 保存当前态；后续 Task 7.14 接入 T 键循环 */}
    </Box>
  );
};
