import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// useTerminalSize — 监听 stdout 'resize' 事件，实时返回 cols / rows。
//
// 设计：
//  - useState 初值直接读 stdout，省掉"挂载后再 set 一次"造成的肉眼抖动。
//  - 监听 attach/detach 拆成 trackTerminalSize 纯函数，独立导出便于单测
//    不需要真的渲染 React 组件（hook 本身太轻，独立渲染器会很重）。
//  - 缺省 80x24 与历史 TTY 习惯对齐；当 stdout 被重定向（管道 / CI）导致
//    columns/rows 是 undefined 时也能给出可用的初始尺寸。
// ---------------------------------------------------------------------------

export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Read the current terminal size. Falls back to 80x24 when stdout is not
 * attached to a TTY (piped output, CI runners, vitest reporter, etc.).
 *
 * Exported separately from the hook so unit tests can verify the read
 * semantics without a React renderer.
 */
export function readTerminalSize(): TerminalSize {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/**
 * Subscribe to `process.stdout` 'resize' events. The provided handler is
 * called once per event with the latest size. Returns an unsubscribe
 * function that detaches the listener.
 *
 * Exported separately from the hook so unit tests can verify attach /
 * detach semantics (e.g., independent unsubscribe, no leak after
 * unsubscribe) without spinning up a React renderer.
 */
export function trackTerminalSize(
  onResize: (size: TerminalSize) => void
): () => void {
  const handler = (): void => onResize(readTerminalSize());
  process.stdout.on('resize', handler);
  return () => {
    process.stdout.off('resize', handler);
  };
}

/**
 * React/Ink hook: returns `{ cols, rows }` and updates whenever the
 * terminal is resized. Safe to call from any Ink component.
 *
 * Initial value is read synchronously from `process.stdout`; subsequent
 * updates are driven by stdout's `resize` event. The listener is torn
 * down when the host component unmounts.
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(readTerminalSize);
  useEffect(() => trackTerminalSize(setSize), []);
  return size;
}
