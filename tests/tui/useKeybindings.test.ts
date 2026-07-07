import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 关键技巧：用 vi.hoisted 把"input handler 句柄"提升到 vi.mock 之前定义，
// 这样 mock 工厂闭包里能写入句柄，外层 beforeEach 又能清空。
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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeCbs() {
  return {
    onResume: vi.fn(),
    onNew: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onAdd: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onSearch: vi.fn(),
    onQuit: vi.fn(),
    onTab: vi.fn(),
    onUp: vi.fn(),
    onDown: vi.fn(),
    onEnter: vi.fn(),
    onClearSearch: vi.fn(),
  };
}

function makeDispatch() {
  return vi.fn() as unknown as Dispatch<any>;
}

beforeEach(() => {
  handlerRef.current = null;
});

// ---------------------------------------------------------------------------
// Tab -> dispatch FOCUS_PANE projects + onTab
// ---------------------------------------------------------------------------

describe('useKeybindings — Tab', () => {
  it('dispatches FOCUS_PANE projects and invokes onTab', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);
    expect(handlerRef.current).not.toBeNull();

    handlerRef.current!('   ', { tab: true } as any);

    expect(dispatch).toHaveBeenCalledWith({ type: 'FOCUS_PANE', pane: 'projects' });
    expect(cbs.onTab).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ↑/↓/Enter → onUp / onDown / onEnter
// ---------------------------------------------------------------------------

describe('useKeybindings — arrow / enter', () => {
  it('onUp fires only for up arrow', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('ignored', {
      upArrow: true,
      downArrow: false,
      return: false,
    } as any);

    expect(cbs.onUp).toHaveBeenCalledTimes(1);
    expect(cbs.onDown).not.toHaveBeenCalled();
    expect(cbs.onEnter).not.toHaveBeenCalled();
  });

  it('onDown fires only for down arrow', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('ignored', {
      upArrow: false,
      downArrow: true,
    } as any);

    expect(cbs.onDown).toHaveBeenCalledTimes(1);
    expect(cbs.onUp).not.toHaveBeenCalled();
  });

  it('onEnter fires only for return', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('', {
      return: true,
    } as any);

    expect(cbs.onEnter).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 字母键映射：每个键只触发对应的 callback，dispatch 只在需要时发生
// ---------------------------------------------------------------------------

describe('useKeybindings — letter keys', () => {
  it.each<[string, keyof ReturnType<typeof makeCbs>]>([
    ['q', 'onQuit'],
    ['/', 'onSearch'],
    ['r', 'onRename'],
    ['n', 'onNew'],
    ['d', 'onDelete'],
    ['c', 'onCopy'],
    ['a', 'onAdd'],
    [',', 'onSettings'],
    ['?', 'onHelp'],
  ])('"%s" triggers %s', (input, method) => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!(input, {
      ctrl: false,
      escape: false,
      tab: false,
      upArrow: false,
      downArrow: false,
      return: false,
    } as any);

    // q 键会通过 "q" 触发 onQuit（独立测试中确认 Ctrl+C 也能触发退出）
    expect((cbs as any)[method]).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ctrl+C → onQuit（独立断言，避免和 "q" 键冲突）
// ---------------------------------------------------------------------------

describe('useKeybindings — Ctrl+C', () => {
  it('triggers onQuit when ctrl+c is pressed (and does not require input "q")', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('c', {
      ctrl: true,
    } as any);

    expect(cbs.onQuit).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Esc → onClearSearch
// ---------------------------------------------------------------------------

describe('useKeybindings — Escape', () => {
  it('triggers onClearSearch on Escape', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('', {
      escape: true,
    } as any);

    expect(cbs.onClearSearch).toHaveBeenCalledTimes(1);
    // Escape 不应当意外派发 reducer action
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 优先级：Tab 应该先于任何 input/letter 判断（避免 Tab 也触发 onTab 之外的）
// ---------------------------------------------------------------------------

describe('useKeybindings — priority', () => {
  it('Tab key does not fall through to the letter-key branch', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('   ', { tab: true } as any);

    expect(cbs.onTab).toHaveBeenCalledTimes(1);
    // Tab 不应当意外触发任何字母 callback
    expect(cbs.onSearch).not.toHaveBeenCalled();
    expect(cbs.onHelp).not.toHaveBeenCalled();
    expect(cbs.onQuit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 顺序：单个 keypress 不会派发重复 action
// ---------------------------------------------------------------------------

describe('useKeybindings — idempotence', () => {
  it('single keypress only triggers one callback and dispatches FOCUS_PANE at most once', () => {
    const cbs = makeCbs();
    const dispatch = makeDispatch();
    useKeybindings(dispatch, cbs);

    handlerRef.current!('   ', { tab: true } as any);

    // FOCUS_PANE 只能派发一次（return 不应被穿透）
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(cbs.onTab).toHaveBeenCalledTimes(1);
  });
});

// 注释：测试通过 vi.mock 注入 useInput 并直接调用捕获的 handler，
// 不依赖 ink 渲染环境（ink-testing-library 未安装），分发表可在 CI 稳定运行。
