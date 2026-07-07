import { describe, it, expect } from 'vitest';
import {
  reducer,
  initialState,
  type Action,
  type UiState,
} from '../../src/tui/App.js';
import type {
  AppState,
  Project,
  SessionMeta,
  TerminalChoice,
  ModalContext,
} from '../../src/state/types.js';
import { DEFAULT_STATE } from '../../src/state/types.js';

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    key: '/Users/alice/work',
    displayName: 'work',
    cwd: '/Users/alice/work',
    manual: false,
    hidden: false,
    sessions: [],
    ...overrides,
  };
}

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: 'sess-1',
    cwd: '/Users/alice/work',
    firstUserMessage: 'hello',
    lastPrompt: null,
    lastTimestamp: '2026-07-07T00:00:00.000Z',
    sizeBytes: 1024,
    lineCount: 12,
    ...overrides,
  };
}

const baseState = (): UiState => initialState;

// ---------------------------------------------------------------------------
// initialState 默认值
// ---------------------------------------------------------------------------

describe('App initial state', () => {
  it('merges DEFAULT_STATE for persistence fields', () => {
    // 前置 AppState 字段都从 DEFAULT_STATE 透传到 UiState
    expect(initialState.sessionRoot).toBe(DEFAULT_STATE.sessionRoot);
    expect(initialState.terminal).toBe(DEFAULT_STATE.terminal);
    expect(initialState.sessionAliases).toEqual(DEFAULT_STATE.sessionAliases);
    expect(initialState.projectAliases).toEqual(DEFAULT_STATE.projectAliases);
    expect(initialState.manualProjects).toEqual(DEFAULT_STATE.manualProjects);
    expect(initialState.hiddenProjects).toEqual(DEFAULT_STATE.hiddenProjects);
  });

  it('starts with no UI selection / modal / search', () => {
    expect(initialState.projects).toEqual([]);
    expect(initialState.selectedProjectKey).toBeNull();
    expect(initialState.selectedSessionId).toBeNull();
    expect(initialState.focusedPane).toBe('projects');
    expect(initialState.searchQuery).toBe('');
    expect(initialState.scanStatus).toBe('idle');
    expect(initialState.modal).toBe('none');
    expect(initialState.modalContext).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// BOOTSTRAP — 启动时一次性喂入持久化状态和首批项目；扫描进入 "scanning"
// ---------------------------------------------------------------------------

describe('App reducer — BOOTSTRAP', () => {
  it('merges provided bootstrap state and projects, sets scanStatus=scanning', () => {
    const projects: Project[] = [makeProject()];
    const boot: AppState = {
      ...DEFAULT_STATE,
      terminal: 'iterm2',
      sessionRoot: '/custom/root',
    };
    const next = reducer(baseState(), { type: 'BOOTSTRAP', state: boot, projects });
    expect(next.projects).toEqual(projects);
    expect(next.terminal).toBe('iterm2');
    expect(next.sessionRoot).toBe('/custom/root');
    expect(next.scanStatus).toBe('scanning');
  });

  it('preserves UI fields not present in AppState (focusedPane, searchQuery, etc.)', () => {
    // UI-only 字段（selectedProjectKey、focusedPane、modal ...）不应被 BOOTSTRAP 清掉
    const seed = reducer(baseState(), { type: 'FOCUS_PANE', pane: 'sessions' });
    const next = reducer(seed, {
      type: 'BOOTSTRAP',
      state: DEFAULT_STATE,
      projects: [],
    });
    expect(next.focusedPane).toBe('sessions');
  });
});

// ---------------------------------------------------------------------------
// SET_TERMINAL / SET_SEARCH — 用户偏好 + 搜索
// ---------------------------------------------------------------------------

describe('App reducer — SET_TERMINAL', () => {
  it.each<TerminalChoice>(['terminal', 'iterm2', 'warp'])(
    'updates terminal to %s',
    (terminal) => {
      const next = reducer(baseState(), { type: 'SET_TERMINAL', terminal });
      expect(next.terminal).toBe(terminal);
    }
  );
});

describe('App reducer — SET_SEARCH', () => {
  it('updates searchQuery with the new string', () => {
    const next = reducer(baseState(), { type: 'SET_SEARCH', q: 'login bug' });
    expect(next.searchQuery).toBe('login bug');
  });

  it('accepts empty string (clears filter)', () => {
    const seed = reducer(baseState(), { type: 'SET_SEARCH', q: 'foo' });
    const cleared = reducer(seed, { type: 'SET_SEARCH', q: '' });
    expect(cleared.searchQuery).toBe('');
  });
});

// ---------------------------------------------------------------------------
// OPEN_MODAL / CLOSE_MODAL — 模态堆叠切换
// ---------------------------------------------------------------------------

describe('App reducer — OPEN_MODAL', () => {
  it('opens a modal and stores context when ctx is provided', () => {
    const ctx: ModalContext = {
      renameKind: 'session',
      renameId: 'sess-1',
      renameCurrentName: 'old name',
    };
    const next = reducer(baseState(), { type: 'OPEN_MODAL', modal: 'rename', ctx });
    expect(next.modal).toBe('rename');
    expect(next.modalContext).toEqual(ctx);
  });

  it('defaults modalContext to {} when ctx is omitted', () => {
    const next = reducer(baseState(), { type: 'OPEN_MODAL', modal: 'help' });
    expect(next.modal).toBe('help');
    expect(next.modalContext).toEqual({});
  });

  it('replaces any prior modal/context atomically', () => {
    const seed = reducer(baseState(), {
      type: 'OPEN_MODAL',
      modal: 'rename',
      ctx: { renameKind: 'session', renameId: 'old' },
    });
    const next = reducer(seed, { type: 'OPEN_MODAL', modal: 'help' });
    expect(next.modal).toBe('help');
    expect(next.modalContext).toEqual({});
  });
});

describe('App reducer — CLOSE_MODAL', () => {
  it('resets modal to none and modalContext to {}', () => {
    const seed = reducer(baseState(), {
      type: 'OPEN_MODAL',
      modal: 'search',
      ctx: {},
    });
    const next = reducer(seed, { type: 'CLOSE_MODAL' });
    expect(next.modal).toBe('none');
    expect(next.modalContext).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// SELECT_PROJECT / SELECT_SESSION / FOCUS_PANE — 焦点与选中
// ---------------------------------------------------------------------------

describe('App reducer — SELECT_PROJECT', () => {
  it('updates selectedProjectKey', () => {
    const next = reducer(baseState(), { type: 'SELECT_PROJECT', key: 'proj-a' });
    expect(next.selectedProjectKey).toBe('proj-a');
  });

  it('can clear selection back to null', () => {
    const seed = reducer(baseState(), { type: 'SELECT_PROJECT', key: 'proj-a' });
    const next = reducer(seed, { type: 'SELECT_PROJECT', key: null });
    expect(next.selectedProjectKey).toBeNull();
  });

  it('does not touch selectedSessionId (independent axis)', () => {
    const seed = reducer(baseState(), { type: 'SELECT_SESSION', id: 'sess-x' });
    const next = reducer(seed, { type: 'SELECT_PROJECT', key: 'proj-a' });
    expect(next.selectedSessionId).toBe('sess-x');
  });
});

describe('App reducer — SELECT_SESSION', () => {
  it('updates selectedSessionId', () => {
    const next = reducer(baseState(), { type: 'SELECT_SESSION', id: 'sess-1' });
    expect(next.selectedSessionId).toBe('sess-1');
  });
});

describe('App reducer — FOCUS_PANE', () => {
  it('switches focusedPane to sessions', () => {
    const next = reducer(baseState(), { type: 'FOCUS_PANE', pane: 'sessions' });
    expect(next.focusedPane).toBe('sessions');
  });

  it('switches back to projects', () => {
    const seed = reducer(baseState(), { type: 'FOCUS_PANE', pane: 'sessions' });
    const next = reducer(seed, { type: 'FOCUS_PANE', pane: 'projects' });
    expect(next.focusedPane).toBe('projects');
  });
});

// ---------------------------------------------------------------------------
// TOGGLE_FOCUS — Tab 键在两个 pane 之间往返切换
// ---------------------------------------------------------------------------

describe('App reducer — TOGGLE_FOCUS', () => {
  it('flips focusedPane from projects to sessions', () => {
    const seed = baseState();
    expect(seed.focusedPane).toBe('projects');
    const next = reducer(seed, { type: 'TOGGLE_FOCUS' });
    expect(next.focusedPane).toBe('sessions');
  });

  it('flips focusedPane from sessions back to projects', () => {
    const seed = reducer(baseState(), { type: 'TOGGLE_FOCUS' });
    expect(seed.focusedPane).toBe('sessions');
    const next = reducer(seed, { type: 'TOGGLE_FOCUS' });
    expect(next.focusedPane).toBe('projects');
  });

  it('does not touch selection or modal state (independent axes)', () => {
    const seed = reducer(baseState(), {
      type: 'OPEN_MODAL',
      modal: 'rename',
      ctx: { renameKind: 'session', renameId: 's1' },
    });
    seed.selectedProjectKey = 'proj-a';
    const next = reducer(seed, { type: 'TOGGLE_FOCUS' });
    expect(next.focusedPane).toBe('sessions');
    expect(next.selectedProjectKey).toBe('proj-a');
    expect(next.modal).toBe('rename');
  });
});

// ---------------------------------------------------------------------------
// 搜索流（/ 键 → SearchModal → 提交）：OPEN_MODAL → SET_SEARCH → CLOSE_MODAL
// ---------------------------------------------------------------------------

describe('App reducer — search flow sequence', () => {
  it('OPEN_MODAL search → SET_SEARCH → CLOSE_MODAL drives UI consistently', () => {
    // 1. / 键触发 OPEN_MODAL 'search'：modal === 'search'，searchQuery 不变
    let s = reducer(baseState(), { type: 'OPEN_MODAL', modal: 'search' });
    expect(s.modal).toBe('search');
    expect(s.searchQuery).toBe('');

    // 2. 用户在 SearchModal 输入并 Enter：派发 SET_SEARCH('login')，然后 CLOSE_MODAL
    s = reducer(s, { type: 'SET_SEARCH', q: 'login' });
    s = reducer(s, { type: 'CLOSE_MODAL' });
    expect(s.searchQuery).toBe('login');
    expect(s.modal).toBe('none');
    expect(s.modalContext).toEqual({});
  });

  it('OPEN_MODAL search → CLOSE_MODAL (cancel via Esc) keeps searchQuery intact', () => {
    // 用户已有一个查询，再次按 /，在 SearchModal 里按 Esc 取消 —— searchQuery 不变
    let s = reducer(baseState(), { type: 'SET_SEARCH', q: 'work' });
    s = reducer(s, { type: 'OPEN_MODAL', modal: 'search' });
    expect(s.modal).toBe('search');
    expect(s.searchQuery).toBe('work');

    s = reducer(s, { type: 'CLOSE_MODAL' });
    expect(s.modal).toBe('none');
    // 取消 ≠ 清空；保持原 query（行为契约：Esc 只关模态）
    expect(s.searchQuery).toBe('work');
  });

  it('OPEN_MODAL search replaces any prior modal/context (search takes over from help)', () => {
    let s = reducer(baseState(), { type: 'OPEN_MODAL', modal: 'help' });
    expect(s.modal).toBe('help');
    s = reducer(s, { type: 'OPEN_MODAL', modal: 'search' });
    expect(s.modal).toBe('search');
    expect(s.modalContext).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// SCAN_COMPLETE / SESSION_DISCOVERED / NOTICE — 扫描生命周期
// ---------------------------------------------------------------------------

describe('App reducer — SET_PROJECTS', () => {
  it('replaces projects from an immutable update without resetting UI-only state', () => {
    const originalProjects: Project[] = [makeProject({ key: '/old' })];
    const nextProjects: Project[] = [makeProject({ key: '/new' })];
    const seed = reducer(
      {
        ...baseState(),
        projects: originalProjects,
        selectedProjectKey: '/old',
        focusedPane: 'sessions',
        searchQuery: 'needle',
      },
      { type: 'SET_PROJECTS', projects: nextProjects },
    );

    expect(seed.projects).toBe(nextProjects);
    expect(seed.projects).not.toBe(originalProjects);
    expect(seed.selectedProjectKey).toBe('/old');
    expect(seed.focusedPane).toBe('sessions');
    expect(seed.searchQuery).toBe('needle');
  });
});

describe('App reducer — SCAN_COMPLETE', () => {
  it('transitions scanStatus from scanning to complete', () => {
    const boot = reducer(baseState(), {
      type: 'BOOTSTRAP',
      state: DEFAULT_STATE,
      projects: [],
    });
    expect(boot.scanStatus).toBe('scanning');
    const done = reducer(boot, { type: 'SCAN_COMPLETE' });
    expect(done.scanStatus).toBe('complete');
  });
});

describe('App reducer — SESSION_DISCOVERED', () => {
  it('is a no-op (UI rebuilds sessions via groupSessions)', () => {
    // 设计选择：发现新 session 不在 reducer 内追加；上层调用 groupSessions 重建
    // 单一测试目的：reducer 必须不抛错，且 state 引用稳定（避免无谓 re-render）
    const before = baseState();
    const after = reducer(before, {
      type: 'SESSION_DISCOVERED',
      meta: makeMeta(),
    });
    expect(after).toBe(before);
  });
});

describe('App reducer — NOTICE', () => {
  it('is a no-op placeholder (lastAction 走 effect 路径)', () => {
    const before = baseState();
    const after = reducer(before, { type: 'NOTICE', kind: 'resumed' });
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Action union exhaustiveness — 防止以后加新 action 时 reducer 漏写 case
// ---------------------------------------------------------------------------

describe('App reducer — exhaustiveness', () => {
  it('handles every Action kind without throwing', () => {
    const allActions: Action[] = [
      { type: 'BOOTSTRAP', state: DEFAULT_STATE, projects: [] },
      { type: 'SESSION_DISCOVERED', meta: makeMeta() },
      { type: 'SET_PROJECTS', projects: [] },
      { type: 'SET_TERMINAL', terminal: 'warp' },
      { type: 'SET_SEARCH', q: 'x' },
      { type: 'OPEN_MODAL', modal: 'help' },
      { type: 'CLOSE_MODAL' },
      { type: 'SELECT_PROJECT', key: null },
      { type: 'SELECT_SESSION', id: null },
      { type: 'FOCUS_PANE', pane: 'sessions' },
      { type: 'TOGGLE_FOCUS' },
      { type: 'NOTICE', kind: 'test' },
      { type: 'SCAN_COMPLETE' },
    ];
    for (const action of allActions) {
      // 不抛错 + 返回 UiState；都满足 = 穷尽
      const next = reducer(baseState(), action);
      expect(next).toBeDefined();
      expect(typeof next).toBe('object');
    }
  });
});
