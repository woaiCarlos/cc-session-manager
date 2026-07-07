import { describe, it, expect, vi } from 'vitest';
import type { Dispatch } from 'react';
import {
  routeKey,
  type RouterKey,
  type RouterOptions,
} from '../../src/tui/keyActionRouter.js';
import type { Action, UiState } from '../../src/tui/App.js';
import {
  DEFAULT_STATE,
  type ModalKind,
  type ModalContext,
} from '../../src/state/types.js';

// ---------------------------------------------------------------------------
// 夹具：UiState 基线 + dispatch 桩
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<UiState> = {}): UiState {
  return {
    ...DEFAULT_STATE,
    projects: [],
    selectedProjectKey: null,
    selectedSessionId: null,
    focusedPane: 'projects',
    searchQuery: '',
    scanStatus: 'idle',
    scanProgress: undefined,
    modal: 'none',
    modalContext: {},
    lastAction: null,
    bootstrapError: null,
    filteredSessions: [],
    ...overrides,
  };
}

function makeDispatch() {
  return vi.fn() as unknown as Dispatch<Action> & {
    mock: { calls: any[][] };
  };
}

function makeOpts(): RouterOptions & {
  copySessionIdCalls: string[];
  addManualProjectCalls: number;
  deleteManualProjectCalls: string[];
  quitCalls: number;
} {
  return {
    onCopySession: vi.fn((id: string) => {
      // 由测试 wrap 时记录
    }),
    onAddProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onQuit: vi.fn(),
    copySessionIdCalls: [],
    addManualProjectCalls: 0,
    deleteManualProjectCalls: [],
    quitCalls: 0,
  };
}

// 简化 key 对象：把我们要表达的 key 标志集合；routeKey 只读 input.escape
// 等布尔字段，其余未被用到的字段缺失即可。
function key(partial: Partial<RouterKey> = {}): RouterKey {
  return {
    tab: false,
    escape: false,
    ctrl: false,
    upArrow: false,
    downArrow: false,
    return: false,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1) confirm-modal 分支：y / Y 触发 deleteManualProject(payload) + CLOSE_MODAL
// ---------------------------------------------------------------------------

describe('routeKey — confirm modal branch', () => {
  it('"y" in confirm modal invokes deleteManualProject with payload then CLOSE_MODAL', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: {
        confirmAction: 'deleteManualProject',
        confirmPayload: '/Users/alice/work',
      } satisfies ModalContext,
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();

    routeKey(state, dispatch, 'y', key(), opts);

    expect(opts.onDeleteProject).toHaveBeenCalledTimes(1);
    expect(opts.onDeleteProject).toHaveBeenCalledWith('/Users/alice/work');
    // 先 dispatch 副作用再 CLOSE_MODAL（沿用 brief 顺序）
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([{ type: 'CLOSE_MODAL' }]);
  });

  it('"Y" (uppercase) is treated like "y"', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: {
        confirmAction: 'deleteManualProject',
        confirmPayload: '/Users/alice/work',
      },
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();

    routeKey(state, dispatch, 'Y', key(), opts);

    expect(opts.onDeleteProject).toHaveBeenCalledTimes(1);
    expect((dispatch as any).mock.calls[0][0]).toEqual({ type: 'CLOSE_MODAL' });
  });

  it('"n" in confirm modal only closes the modal (no destructive action)', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: {
        confirmAction: 'deleteManualProject',
        confirmPayload: '/p',
      },
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();

    routeKey(state, dispatch, 'n', key(), opts);

    expect(opts.onDeleteProject).not.toHaveBeenCalled();
    expect((dispatch as any).mock.calls[0][0]).toEqual({ type: 'CLOSE_MODAL' });
  });

  it('"N" (uppercase) is treated like "n"', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: { confirmAction: 'deleteManualProject' },
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'N', key(), opts);
    expect(opts.onDeleteProject).not.toHaveBeenCalled();
    expect((dispatch as any).mock.calls[0][0]).toEqual({ type: 'CLOSE_MODAL' });
  });

  it('Escape in confirm modal closes the modal (no action invoked)', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: { confirmAction: 'deleteManualProject' },
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, '', key({ escape: true }), opts);
    expect(opts.onDeleteProject).not.toHaveBeenCalled();
    expect((dispatch as any).mock.calls[0][0]).toEqual({ type: 'CLOSE_MODAL' });
  });

  it('other keys in confirm modal are no-ops (modal context takes precedence)', () => {
    const state = makeState({
      modal: 'confirm',
      modalContext: { confirmAction: 'deleteManualProject' },
    });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'q', key({ ctrl: true }), opts);
    expect(dispatch).not.toHaveBeenCalled();
    expect(opts.onDeleteProject).not.toHaveBeenCalled();
    expect(opts.onQuit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2) main-view 分支：r / n / d / , 各打开对应模态
// ---------------------------------------------------------------------------

describe('routeKey — main view modal opens', () => {
  it('"r" opens rename modal (per brief, ctx omitted; reducer defaults to {})', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'r', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('OPEN_MODAL');
    expect(calls[0].modal).toBe('rename');
    // brief 显式不传 ctx；reducer 端 OPEN_MODAL 会把缺失 ctx 视为 {}。
    expect(calls[0].ctx).toBeUndefined();
  });

  it('"n" opens settings modal (per brief; HelpModal 描述为 "New session"，存在冲突)', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'n', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('OPEN_MODAL');
    expect(calls[0].modal).toBe('settings');
  });

  it('"," opens settings modal', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, ',', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('OPEN_MODAL');
    expect(calls[0].modal).toBe('settings');
  });

  it('"?" opens help modal', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, '?', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ type: 'OPEN_MODAL', modal: 'help' });
  });

  it('"/" opens search modal', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, '/', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ type: 'OPEN_MODAL', modal: 'search' });
  });

  it('"d" opens confirm modal with deleteManualProject ctx carrying selectedProjectKey', () => {
    const state = makeState({ selectedProjectKey: '/Users/alice/work' });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'd', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('OPEN_MODAL');
    expect(calls[0].modal).toBe('confirm');
    expect(calls[0].ctx).toEqual({
      confirmAction: 'deleteManualProject',
      confirmPayload: '/Users/alice/work',
    });
  });

  it('"d" without a selected project still opens confirm (payload undefined, operator is blocked upstream)', () => {
    // 行为契约：进入 confirm 模态总是派发 OPEN_MODAL；缺 selectedProjectKey 时
    // confirmPayload 为 undefined，confirm-y 分支据此跳过 deleteManualProject。
    const state = makeState({ selectedProjectKey: null });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'd', key(), opts);
    const calls = (dispatch as any).mock.calls.map((c) => c[0]);
    expect(calls[0].type).toBe('OPEN_MODAL');
    expect(calls[0].modal).toBe('confirm');
    expect(calls[0].ctx.confirmAction).toBe('deleteManualProject');
    expect(calls[0].ctx.confirmPayload).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3) main-view 分支：a / c / q / Tab
// ---------------------------------------------------------------------------

describe('routeKey — main view actions', () => {
  it('"a" triggers onAddProject without dispatching reducer', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'a', key(), opts);
    expect(opts.onAddProject).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('"c" with selectedSessionId triggers onCopySession(id)', () => {
    const state = makeState({ selectedSessionId: 'sess-99' });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'c', key(), opts);
    expect(opts.onCopySession).toHaveBeenCalledWith('sess-99');
    expect(opts.onCopySession).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('"c" without selectedSessionId is a no-op (do not call onCopySession)', () => {
    const state = makeState({ selectedSessionId: null });
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'c', key(), opts);
    expect(opts.onCopySession).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('"q" triggers onQuit and does not dispatch reducer directly', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'q', key(), opts);
    expect(opts.onQuit).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Ctrl+C triggers onQuit', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'c', key({ ctrl: true }), opts);
    expect(opts.onQuit).toHaveBeenCalledTimes(1);
    expect(opts.onCopySession).not.toHaveBeenCalled();
  });

  it('Tab is intentionally NOT routed here (useKeybindings owns it)', () => {
    // 行为契约：Tab 由 useKeybindings 派发 TOGGLE_FOCUS；routeKey 不应再
    // 派发以避免双 dispatch。这也验证 Tab 不会落入 onQuit/onCopy 等回调。
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, '   ', key({ tab: true }), opts);
    expect(dispatch).not.toHaveBeenCalled();
    expect(opts.onCopySession).not.toHaveBeenCalled();
    expect(opts.onAddProject).not.toHaveBeenCalled();
    expect(opts.onQuit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4) 其他模态期间（非 confirm、非 none）字母键应当被吞掉
// ---------------------------------------------------------------------------

describe('routeKey — non-confirm modals short-circuit letter keys', () => {
  it.each<ModalKind>(['search', 'rename', 'settings', 'help'])(
    'modal === "%s" swallows "r" / "n" / "a" / "c" without dispatch',
    (modal) => {
      const state = makeState({ modal });
      const dispatch = makeDispatch();
      const opts = makeOpts();
      routeKey(state, dispatch, 'r', key(), opts);
      routeKey(state, dispatch, 'n', key(), opts);
      routeKey(state, dispatch, 'a', key(), opts);
      routeKey(state, dispatch, 'c', key(), opts);
      // 这些模态里自身有 Esc / 提交逻辑；路由器不该再插一脚
      expect(dispatch).not.toHaveBeenCalled();
      expect(opts.onAddProject).not.toHaveBeenCalled();
      expect(opts.onCopySession).not.toHaveBeenCalled();
    }
  );
});

// ---------------------------------------------------------------------------
// 5) 行为不变：unknown keys 是 no-op
// ---------------------------------------------------------------------------

describe('routeKey — unknown keys', () => {
  it('random input character does not dispatch or invoke callbacks', () => {
    const state = makeState();
    const dispatch = makeDispatch();
    const opts = makeOpts();
    routeKey(state, dispatch, 'z', key(), opts);
    routeKey(state, dispatch, 'x', key(), opts);
    expect(dispatch).not.toHaveBeenCalled();
    expect(opts.onCopySession).not.toHaveBeenCalled();
    expect(opts.onAddProject).not.toHaveBeenCalled();
    expect(opts.onQuit).not.toHaveBeenCalled();
  });
});
