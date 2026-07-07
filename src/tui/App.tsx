import React, { useEffect, useReducer } from 'react';
import { Box, useInput } from 'ink';
import type {
  AppState,
  ModalContext,
  ModalKind,
  Project,
  SessionMeta,
  TerminalChoice,
} from '../state/types.js';
import { DEFAULT_STATE } from '../state/types.js';
import { ProjectPane } from './panes/ProjectPane.js';
import { SessionPane } from './panes/SessionPane.js';
import { StatusBar } from './components/StatusBar.js';
import { useKeybindings } from './hooks/useKeybindings.js';
import { SearchModal } from './modals/SearchModal.js';

// ---------------------------------------------------------------------------
// Action 类型
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'BOOTSTRAP'; state: AppState; projects: Project[] }
  | { type: 'SESSION_DISCOVERED'; meta: SessionMeta }
  | { type: 'SET_TERMINAL'; terminal: TerminalChoice }
  | { type: 'SET_SEARCH'; q: string }
  | { type: 'OPEN_MODAL'; modal: ModalKind; ctx?: ModalContext }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SELECT_PROJECT'; key: string | null }
  | { type: 'SELECT_SESSION'; id: string | null }
  | { type: 'FOCUS_PANE'; pane: 'projects' | 'sessions' }
  | { type: 'TOGGLE_FOCUS' }
  | { type: 'NOTICE'; kind: string; payload?: unknown }
  | { type: 'SCAN_COMPLETE' };

// ---------------------------------------------------------------------------
// UiState = 持久化 AppState + 纯 UI 字段
//
// 设计：AppState 只承担持久化字段（terminal、sessionAliases ...），UI 状态
// （modal、selectedProjectKey、focusedPane ...）由 UiState 单独承载。两者
// 通过 reducer 在内存中合并，持久化字段通过 effect 同步回 state.json。
// ---------------------------------------------------------------------------

export interface UiState extends AppState {
  // 渲染数据
  projects: Project[];
  selectedProjectKey: string | null;
  selectedSessionId: string | null;
  focusedPane: 'projects' | 'sessions';
  searchQuery: string;
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
  scanProgress?: { current: number; total: number };
  // 模态
  modal: ModalKind;
  modalContext: ModalContext;
  // 提示
  lastAction: { kind: string; payload?: unknown; at: number } | null;
  // 启动
  bootstrapError: string | null;
  // 派生：搜索过滤后的 session（由后续 task 填充计算逻辑；当前占位保留）
  filteredSessions: import('../state/types.js').Session[];
}

export const initialState: UiState = {
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
};

// ---------------------------------------------------------------------------
// reducer：纯函数，便于单测覆盖整个状态机。
// 暴露 reducer 而非把 Action/UiState 隐藏在 App.tsx 里，因为：
//  1. 测试可直接对 state transitions 断言；
//  2. 后续 task 7.4 (useKeybindings) / 7.12 (TOGGLE_FOCUS) 复用同一 Action。
// ---------------------------------------------------------------------------

export function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'BOOTSTRAP':
      return {
        ...state,
        ...action.state,
        projects: action.projects,
        scanStatus: 'scanning',
      };
    case 'SESSION_DISCOVERED':
      // 设计选择：发现新 session 不在 reducer 内追加；
      // App 内 effect 调 groupSessions 整体重建 projects。
      // 此处返回同一引用即可，避免无谓 re-render。
      return state;
    case 'SET_TERMINAL':
      return { ...state, terminal: action.terminal };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.q };
    case 'OPEN_MODAL':
      return { ...state, modal: action.modal, modalContext: action.ctx ?? {} };
    case 'CLOSE_MODAL':
      return { ...state, modal: 'none', modalContext: {} };
    case 'SELECT_PROJECT':
      return { ...state, selectedProjectKey: action.key };
    case 'SELECT_SESSION':
      return { ...state, selectedSessionId: action.id };
    case 'FOCUS_PANE':
      return { ...state, focusedPane: action.pane };
    case 'TOGGLE_FOCUS':
      return {
        ...state,
        focusedPane: state.focusedPane === 'projects' ? 'sessions' : 'projects',
      };
    case 'SCAN_COMPLETE':
      return { ...state, scanStatus: 'complete' };
    case 'NOTICE':
      // TODO：后续可基于 kind 写入 lastAction。当前 pure no-op 以便走
      // effect 路径（写入 notification banner），避免 reducer 副作用溢出。
      return state;
  }
}

// ---------------------------------------------------------------------------
// AppProps：解耦 React 组件与外围副作用（扫描 / 完成回调）
// ---------------------------------------------------------------------------

export interface AppProps {
  bootstrapState: AppState;
  projects: Project[];
  onSession: (cb: (meta: SessionMeta) => void) => void;
  onScanComplete: (cb: () => void) => void;
}

// ---------------------------------------------------------------------------
// App：根 Ink 组件。后续 task 7.2~7.16 会在此基础上加 panes / modals / hooks。
// ---------------------------------------------------------------------------

export const App: React.FC<AppProps> = ({
  bootstrapState,
  projects,
  onSession,
  onScanComplete,
}) => {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    ...bootstrapState,
    projects,
  });

  useEffect(() => {
    // 启动时挂上扫描回调：发现新 session 派发 SESSION_DISCOVERED；
    // 扫描完成派发 SCAN_COMPLETE。监听器由 cli.tsx 提供的对外闭包挂入，
    // 卸载由 Ink 在进程退出时统一清理。
    onSession((meta) => dispatch({ type: 'SESSION_DISCOVERED', meta }));
    onScanComplete(() => dispatch({ type: 'SCAN_COMPLETE' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab / 字母键 / 方向键 / Enter / Esc / Ctrl+C 全部走 useKeybindings。
  // 当前 onTab / onUp / onDown / onEnter 等副作用由后续 task (7.14~7.16)
  // 接 selection 与 modal 上下文；此处先传空 no-op 占位以保持 strict 编译。
  // 注意：useKeybindings 也会响应 `/` 和 `?`，但本组件在下方单独注册了一个
  // 模态感知的 useInput 来分发 OPEN_MODAL —— useKeybindings 的同名 callback
  // 保持 no-op，避免重复触发。
  useKeybindings(dispatch as React.Dispatch<any>, {
    onResume: () => {},
    onNew: () => {},
    onRename: () => {},
    onDelete: () => {},
    onCopy: () => {},
    onAdd: () => {},
    onSettings: () => {},
    onHelp: () => {},
    onSearch: () => {},
    onQuit: () => {},
    onTab: () => {},
    onUp: () => {},
    onDown: () => {},
    onEnter: () => {},
    onClearSearch: () => {},
  });

  // 模态感知的快捷键入口：仅在 main view（modal === 'none'）生效。
  // `/` 打开 SearchModal；`?` 打开 HelpModal（HelpModal 在后续 task 接入，
  // 这里先把派发连上，避免遗漏 OPEN_MODAL 'help' 的覆盖）。
  // Ink 允许多个 useInput 并存；useKeybindings 内部的 useInput 也会触发，
  // 但其 onSearch / onHelp 回调已是 no-op，因此不会重复 dispatch。
  useInput((input) => {
    if (state.modal !== 'none') return;
    if (input === '/') dispatch({ type: 'OPEN_MODAL', modal: 'search' });
    if (input === '?') dispatch({ type: 'OPEN_MODAL', modal: 'help' });
  });

  const selectedProject =
    state.projects.find((p) => p.key === state.selectedProjectKey) ?? null;
  const visibleSessions = selectedProject ? selectedProject.sessions : [];
  const totalSessionCount = state.projects.reduce(
    (n, p) => n + p.sessions.length,
    0
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Box width="40%">
          <ProjectPane
            projects={state.projects}
            selectedKey={state.selectedProjectKey}
            focused={state.focusedPane === 'projects'}
            onSelect={(k) => dispatch({ type: 'SELECT_PROJECT', key: k })}
          />
        </Box>
        <Box width="60%">
          <SessionPane
            sessions={visibleSessions}
            selectedId={state.selectedSessionId}
            focused={state.focusedPane === 'sessions'}
            onSelect={(id) => dispatch({ type: 'SELECT_SESSION', id })}
            searchQuery={state.searchQuery}
          />
        </Box>
      </Box>
      <StatusBar
        projectCount={state.projects.length}
        sessionCount={totalSessionCount}
        scanStatus={state.scanStatus}
        lastAction={null}
      />
      {state.modal === 'search' && (
        <SearchModal
          initial={state.searchQuery}
          onSubmit={(q) => {
            dispatch({ type: 'SET_SEARCH', q });
            dispatch({ type: 'CLOSE_MODAL' });
          }}
          onCancel={() => dispatch({ type: 'CLOSE_MODAL' })}
        />
      )}
    </Box>
  );
};

export default App;
