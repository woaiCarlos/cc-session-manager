import { useInput } from 'ink';
import type { Dispatch } from 'react';

/**
 * useKeybindings 现在专门处理 keyActionRouter 不便覆盖的快捷键：
 *  - Tab：派发 TOGGLE_FOCUS（切换 projects/sessions 焦点）
 *
 * 其它键（字母 / 上下 / Enter / q）由 App.tsx 的 useInput 通过
 * keyActionRouter.routeKey 派发，那里有 state 上下文能正确处理上下键
 * 选择等条件派发。
 */
export type KeyAction = { type: 'TOGGLE_FOCUS' };

export function useKeybindings(dispatch: Dispatch<KeyAction>): void {
  useInput((_input, key) => {
    if (key.tab) {
      dispatch({ type: 'TOGGLE_FOCUS' });
    }
  });
}
