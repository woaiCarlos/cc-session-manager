import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// useKeybindings 当前只负责 Tab → TOGGLE_FOCUS。
// 其它键（↑/↓/Enter/字母/q）由 App.tsx 的 useInput 通过
// keyActionRouter.routeKey 派发，相关测试在 tests/tui/keyActionRouter.test.ts。
// ---------------------------------------------------------------------------

type Handler = (input: string, key: any) => void;

const handlerRef = vi.hoisted(() => ({
  current: null as Handler | null,
}));

vi.mock('ink', () => ({
  useInput: (h: Handler) => {
    handlerRef.current = h;
  },
}));

import { useKeybindings } from '../../src/tui/hooks/useKeybindings.js';
import type { Dispatch } from 'react';

function makeDispatch() {
  return vi.fn() as unknown as Dispatch<any>;
}

beforeEach(() => {
  handlerRef.current = null;
});

describe('useKeybindings — Tab', () => {
  it('dispatches TOGGLE_FOCUS when Tab is pressed', () => {
    const dispatch = makeDispatch();
    useKeybindings(dispatch);
    expect(handlerRef.current).not.toBeNull();

    handlerRef.current!('ignored', { tab: true } as any);

    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_FOCUS' });
  });

  it('does not dispatch on other keys', () => {
    const dispatch = makeDispatch();
    useKeybindings(dispatch);

    handlerRef.current!('q', { tab: false, ctrl: false } as any);
    handlerRef.current!('ignored', { tab: false, upArrow: true } as any);
    handlerRef.current!('ignored', { tab: false, downArrow: true } as any);
    handlerRef.current!('ignored', { tab: false, return: true } as any);

    expect(dispatch).not.toHaveBeenCalled();
  });
});
