import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../../state/types.js';

interface Props {
  sessions: Session[];
  selectedId: string | null;
  focused: boolean;
  onSelect: (id: string) => void;
  // searchQuery 非空时只渲染匹配的 session（displayName / cwd / id）。
  // 空串表示不过滤；App 通过 prop drilling 把 state.searchQuery 透传进来。
  searchQuery?: string;
  /**
   * Compact mode (窄列布局): omit the `· lastActiveRelative` trailing
   * timestamp so each row stays single-line. Driven by `useTerminalSize`
   * in App when `cols < 100`.
   */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// filterSessions：纯函数，独立导出以便单测。
// 匹配规则（与 brief Step 2 一致）：
//   - displayName.toLowerCase().includes(needle)
//   - cwd.toLowerCase().includes(needle)
//   - id.toLowerCase().startsWith(needle)
// needle = q.toLowerCase()；q 为空时直接返回原数组引用（避免无谓拷贝）。
// ---------------------------------------------------------------------------

export function filterSessions(sessions: Session[], q: string): Session[] {
  if (!q) return sessions;
  const needle = q.toLowerCase();
  return sessions.filter(
    (s) =>
      s.displayName.toLowerCase().includes(needle) ||
      s.cwd.toLowerCase().includes(needle) ||
      s.id.toLowerCase().startsWith(needle)
  );
}

export const SessionPane: React.FC<Props> = ({
  sessions,
  selectedId,
  focused,
  onSelect,
  searchQuery = '',
  compact = false,
}) => {
  // onSelect is wired in a follow-up task (keyboard handlers in App).
  // Marked used via void reference so TS noUnusedParameters doesn't flag it.
  // Ink 7.1.0 Text/Box do not accept an `onClick` prop, so the click handler
  // will be introduced alongside keyboard navigation in that follow-up task.
  void onSelect;

  const filtered = filterSessions(sessions, searchQuery);
  const headerCount = filtered.length === sessions.length
    ? sessions.length
    : `${filtered.length}/${sessions.length}`;

  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
      <Text bold>Sessions ({headerCount})</Text>
      {sessions.length === 0 && <Text dimColor>No sessions yet (Scanning…)</Text>}
      {sessions.length > 0 && filtered.length === 0 && (
        <Text dimColor>No sessions match &quot;{searchQuery}&quot;</Text>
      )}
      {filtered.map((s) => {
        const sel = s.id === selectedId;
        return (
          <Text
            key={s.id}
            inverse={sel && focused}
            color={sel ? 'cyan' : undefined}
          >
            {sel ? '› ' : '  '}
            {s.displayName}
            {!compact && (
              <>
                {' '}
                <Text dimColor>· {s.lastActiveRelative}</Text>
              </>
            )}
          </Text>
        );
      })}
    </Box>
  );
};