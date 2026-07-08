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
  it('appends the session to the matching project by cwd, sorted by lastTimestamp desc', () => {
    const before = baseState();
    const meta1 = makeMeta({ sessionId: 's1', cwd: '/p1', lastTimestamp: '2026-01-01T00:00:00Z' });
    const meta2 = makeMeta({ sessionId: 's2', cwd: '/p1', lastTimestamp: '2026-01-02T00:00:00Z' });

    const s1 = reducer(before, { type: 'SESSION_DISCOVERED', meta: meta1 });
    const s2 = reducer(s1, { type: 'SESSION_DISCOVERED', meta: meta2 });

    // 单 project，含 2 个 session，按 lastTimestamp desc
    expect(s2.projects).toHaveLength(1);
    expect(s2.projects[0]!.sessions).toHaveLength(2);
    expect(s2.projects[0]!.sessions[0]!.id).toBe('s2'); // 最新在前
    expect(s2.projects[0]!.sessions[1]!.id).toBe('s1');
  });

  it('creates a new project when cwd is not in the list', () => {
    const before = baseState();
    const meta = makeMeta({ sessionId: 's1', cwd: '/new/proj' });
    const after = reducer(before, { type: 'SESSION_DISCOVERED', meta });
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]!.key).toBe('/new/proj');
    expect(after.projects[0]!.sessions[0]!.id).toBe('s1');
  });

  it('dedupes: same sessionId added twice is a no-op', () => {
    const before = baseState();
    const meta = makeMeta({ sessionId: 's1', cwd: '/p1' });
    const s1 = reducer(before, { type: 'SESSION_DISCOVERED', meta });
    const s2 = reducer(s1, { type: 'SESSION_DISCOVERED', meta });
    // 引用稳定（dedupe 命中）
    expect(s2).toBe(s1);
  });

  it('uses customTitle from meta as displayName when present', () => {
    // Bug 4d：SESSION_DISCOVERED 路径要优先用 meta.customTitle（来自 CC 的
    // custom-title JSONL 事件）。不再读 state.sessionAliases。
    const meta = makeMeta({
      sessionId: 's-alias',
      cwd: '/p1',
      firstUserMessage: '原始 firstUserMessage',
      lastPrompt: '原始 lastPrompt',
      customTitle: '飞牛内网穿透',
    });
    const after = reducer(baseState(), { type: 'SESSION_DISCOVERED', meta });
    expect(after.projects[0]!.sessions[0]!.displayName).toBe('飞牛内网穿透');
  });

  it('falls back to lastPrompt / firstUserMessage when no customTitle is set', () => {
    // 保持旧行为兼容性：customTitle 不存在时仍按 prompt 文本。
    const meta = makeMeta({
      sessionId: 's-no-alias',
      cwd: '/p1',
      firstUserMessage: 'first message',
      lastPrompt: '最新 prompt',
    });
    const after = reducer(baseState(), { type: 'SESSION_DISCOVERED', meta });
    expect(after.projects[0]!.sessions[0]!.displayName).toBe('最新 prompt');
  });

  it('Bug 4d: re-discovering a session with a fresh customTitle patches the existing row in place', () => {
    // rename onSubmit 通过虚拟 meta 触发 SESSION_DISCOVERED 来乐观更新；
    // reducer 命中已有 session 时应当 patch displayName，不创建新条目
    const proj = makeProject({
      key: '/p1',
      sessions: [
        {
          id: 'sess-1',
          displayName: 'old-name',
          cwd: '/p1',
          lastActiveRelative: '1h ago',
          lastTimestamp: '2026-07-07T00:00:00Z',
        } as Session,
      ],
    });
    const seed = { ...baseState(), projects: [proj] };
    const next = reducer(seed, {
      type: 'SESSION_DISCOVERED',
      meta: {
        sessionId: 'sess-1',
        cwd: '/p1',
        firstUserMessage: null,
        lastPrompt: null,
        customTitle: '飞牛内网穿透',
        lastTimestamp: '2026-07-07T00:01:00Z',
        sizeBytes: 0,
        lineCount: 0,
      },
    });
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]!.sessions).toHaveLength(1);
    expect(next.projects[0]!.sessions[0]!.displayName).toBe('飞牛内网穿透');
  });

  it('Bug B: stores meta.sizeBytes on the new Session row', () => {
    const meta = makeMeta({ sessionId: 'sized', cwd: '/p1', sizeBytes: 4096 });
    const after = reducer(baseState(), { type: 'SESSION_DISCOVERED', meta });
    expect(after.projects[0]!.sessions[0]!.sizeBytes).toBe(4096);
  });

  it('Bug A: re-discovering with a fresh sizeBytes / lastTimestamp patches the row in place', () => {
    // 模拟 'current' backend rescan：claude 退出后 JSONL 变大、最后事件
    // 时间更新；reducer 必须 patch 已有 row 的 sizeBytes + lastTimestamp，
    // 让 SessionPane 立刻反映「文件已增长」+「时间已更新」。
    const proj = makeProject({
      key: '/p1',
      sessions: [
        {
          id: 'sess-1',
          displayName: 'something',
          cwd: '/p1',
          lastActiveRelative: '2026-07-07T00:00:00Z',
          lastTimestamp: '2026-07-07T00:00:00Z',
          sizeBytes: 1024,
        } as Session,
      ],
    });
    const seed = { ...baseState(), projects: [proj] };
    const next = reducer(seed, {
      type: 'SESSION_DISCOVERED',
      meta: {
        sessionId: 'sess-1',
        cwd: '/p1',
        firstUserMessage: 'something',
        lastPrompt: null,
        lastTimestamp: '2026-07-07T00:30:00Z',
        sizeBytes: 8192,
        lineCount: 99,
      },
    });
    expect(next.projects[0]!.sessions).toHaveLength(1);
    const row = next.projects[0]!.sessions[0]!;
    expect(row.sizeBytes).toBe(8192);
    expect(row.lastTimestamp).toBe('2026-07-07T00:30:00Z');
  });
});

describe('App reducer — NOTICE', () => {
  it('writes lastAction with the given kind so status-bar can render it', () => {
    const before = baseState();
    const after = reducer(before, { type: 'NOTICE', kind: 'resumed' });
    expect(after.lastAction).not.toBeNull();
    expect(after.lastAction?.kind).toBe('resumed');
  });

  it('surfaces resume errors via lastAction.payload', () => {
    const before = baseState();
    const after = reducer(before, {
      type: 'NOTICE',
      kind: 'error',
      message: 'Resume failed: terminal not found',
    });
    expect(after.lastAction?.kind).toBe('error');
    expect(after.lastAction?.payload).toBe('Resume failed: terminal not found');
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
