import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ink：捕获 useInput 句柄，让其他组件用到的 Box/Text 成为透明转发器。
// 关键技巧：用 vi.hoisted 把 handler 句柄提升到 mock 工厂之前定义，
// 这样 mock 工厂闭包里能写入句柄，外层 beforeEach 又能清空。
// ---------------------------------------------------------------------------

type Handler = (input: string, key: any) => void;

const handlerRef = vi.hoisted(() => ({
  current: null as Handler | null,
}));

vi.mock('ink', () => ({
  Box: ({ children }: any) => children,
  Text: ({ children }: any) => children,
  useInput: (h: Handler) => {
    handlerRef.current = h;
  },
}));

import { useEscapeToCancel } from '../../../src/tui/hooks/useEscapeToCancel.js';

beforeEach(() => {
  handlerRef.current = null;
});

describe('useEscapeToCancel', () => {
  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    useEscapeToCancel(onCancel);
    expect(handlerRef.current).not.toBeNull();

    handlerRef.current!('', { escape: true } as any);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel for non-Escape keys', () => {
    const onCancel = vi.fn();
    useEscapeToCancel(onCancel);

    handlerRef.current!('a', { escape: false } as any);
    handlerRef.current!('', { return: true } as any);
    handlerRef.current!('', { tab: true } as any);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel for the literal character input that looks like "escape"', () => {
    // 防御性测试：仅当 key.escape === true 时才触发，
    // 不要把 input === "escape"（用户输入的字符）当作按键处理
    const onCancel = vi.fn();
    useEscapeToCancel(onCancel);

    handlerRef.current!('escape', { escape: false } as any);
    expect(onCancel).not.toHaveBeenCalled();
  });
});