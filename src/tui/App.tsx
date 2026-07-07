import React, { useCallback, useEffect, useReducer } from 'react';
import { Box, useInput } from 'ink';
import type {
  AppState,
  ModalContext,
  ModalKind,
  Project,
  Session,
  SessionMeta,
  TerminalChoice,
} from '../state/types.js';
import { DEFAULT_STATE } from '../state/types.js';
import { ProjectPane } from './panes/ProjectPane.js';
import { SessionPane } from './panes/SessionPane.js';
import { StatusBar } from './components/StatusBar.js';
import { useKeybindings } from './hooks/useKeybindings.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { SearchModal } from './modals/SearchModal.js';
import { RenameModal } from './modals/RenameModal.js';
import { SettingsModal } from './modals/SettingsModal.js';
import { HelpModal } from './modals/HelpModal.js';
import { ConfirmModal } from './modals/ConfirmModal.js';
import { routeKey } from './keyActionRouter.js';
import { addManualProject } from '../actions/addManualProject.js';
import { copySessionId } from '../actions/copySessionId.js';
import { deleteManualProject } from '../actions/deleteManualProject.js';
import { resumeSession } from '../actions/resumeSession.js';
import { newSession } from '../actions/newSession.js';
import { release as releaseLock } from '../state/lock.js';

// ---------------------------------------------------------------------------
// Action 类型
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'BOOTSTRAP'; state: AppState; projects: Project[] }
  | { type: 'SESSION_DISCOVERED'; meta: SessionMeta }
  | { type: 'SET_PROJECTS'; projects: Project[] }
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
      // App 外围按当前 SessionMeta 集合整体重建 projects，再通过 props
      // 变更触发 SET_PROJECTS 替换引用。
      return state;
    case 'SET_PROJECTS':
      if (state.projects === action.projects) return state;
      return { ...state, projects: action.projects };
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

  // 终端尺寸：监听 stdout 'resize'，cols < 100 视为窄列，进入 compact 模式
  // 让 Pane 省略次要字段（计数 / 时间戳），避免双 pane 布局在窄终端下错位。
  const { cols } = useTerminalSize();
  const compact = cols < 100;

  useEffect(() => {
    // 启动时挂上扫描回调：发现新 session 派发 SESSION_DISCOVERED；
    // 扫描完成派发 SCAN_COMPLETE。监听器由 cli.tsx 提供的对外闭包挂入，
    // 卸载由 Ink 在进程退出时统一清理。
    onSession((meta) => dispatch({ type: 'SESSION_DISCOVERED', meta }));
    onScanComplete(() => dispatch({ type: 'SCAN_COMPLETE' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dispatch({ type: 'SET_PROJECTS', projects });
  }, [projects]);

  // Tab / 方向键 / Enter / Esc 由 useKeybindings 处理（onTab/箭头等副作用
  // 这里仍是 no-op，真正派发只在 useKeybindings 内部的 dispatch——避免与
  // routeKey 双派发）。所有字母键 / quit 改走下方 useInput + routeKey：
  // 字母键需要 state.selectedProjectKey 等上下文做条件派发，集中到一个纯
  // 函数路由更便于单测（tests/tui/keyActionRouter.test.ts）。
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

  // Quit 副作用：释放进程级 lock 后退出。release 来自 src/state/lock.ts，
  // 当前是 no-op 占位（acquire 侧尚未实装），幂等即可。
  const onQuit = useCallback(() => {
    void releaseLock().finally(() => {
      process.exit(0);
    });
  }, []);

  // 复制 / 添加 / 删除的副作用：包成稳定 callback，避免 useInput 反复 re-subscribe。
  const onCopySession = useCallback((id: string) => {
    void copySessionId(id).catch(() => {
      /* copy 失败的 UI 提示由后续 task 接入；此处不抛 */
    });
  }, []);
  const onAddProject = useCallback(() => {
    void addManualProject().catch(() => {
      /* 失败提示同样推迟 */
    });
  }, []);
  const onDeleteProject = useCallback((groupKey: string) => {
    void deleteManualProject(groupKey).catch(() => {
      /* confirm 模态由 useEscapeToCancel 等其它钩子处理 */
    });
  }, []);

  // Enter 副作用：在 session 上恢复；terminal 取自当前 state，故随 terminal 变化
  // 重建 callback（settings 改终端后立即生效）。错误提示（TerminalNotInstalled 等）
  // 由后续 status-bar task 接入；此处 catch 吞掉避免未处理 rejection。
  const onResumeSession = useCallback(
    (session: Session) => {
      void resumeSession(session, state.terminal).catch(() => {
        /* 终端派发失败的 UI 提示由后续 task 接入 */
      });
    },
    [state.terminal]
  );
  // `n` 副作用：在选中 project 上新建 session（`claude`）。同样依赖当前 terminal。
  const onNewSession = useCallback(
    (project: Project) => {
      void newSession(project, state.terminal).catch(() => {
        /* 终端派发失败的 UI 提示由后续 task 接入 */
      });
    },
    [state.terminal]
  );

  // 模态感知的总入口（main view + confirm 分支）。所有字母键均经
  // keyActionRouter.routeKey 派发；router 内部已经做了 modal !== 'none'
  // 的短路以避免穿透模态。
  useInput((input, key) => {
    routeKey(state, dispatch, input, key, {
      onCopySession,
      onAddProject,
      onDeleteProject,
      onResumeSession,
      onNewSession,
      onQuit,
    });
  });

  // 选中的 project / 派生 session 列表
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
            compact={compact}
          />
        </Box>
        <Box width="60%">
          <SessionPane
            sessions={visibleSessions}
            selectedId={state.selectedSessionId}
            focused={state.focusedPane === 'sessions'}
            onSelect={(id) => dispatch({ type: 'SELECT_SESSION', id })}
            searchQuery={state.searchQuery}
            compact={compact}
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
      {state.modal === 'rename' && (
        <RenameModal
          initial={state.modalContext.renameCurrentName ?? ''}
          kind={state.modalContext.renameKind ?? 'session'}
          onSubmit={() => {
            /* 真正写 alias 的派发由 renameProject / renameSession action
               在后续 task 内联；本任务仅挂 UI 与 keybinding 接线。 */
            dispatch({ type: 'CLOSE_MODAL' });
          }}
          onCancel={() => dispatch({ type: 'CLOSE_MODAL' })}
        />
      )}
      {state.modal === 'settings' && (
        <SettingsModal
          state={state}
          onSubmit={(next) => {
            // SET_TERMINAL/SESSION_ROOT 等 reducer 路径已有；settings 只
            // 提交合并视图，App 端逐字段 dispatch 一次 SET_TERMINAL
            // 和 SCAN_COMPLETE 之外不必再走的分支交给后续 task 7.14+。
            if (next.terminal) {
              dispatch({ type: 'SET_TERMINAL', terminal: next.terminal });
            }
            dispatch({ type: 'CLOSE_MODAL' });
          }}
          onCancel={() => dispatch({ type: 'CLOSE_MODAL' })}
        />
      )}
      {state.modal === 'help' && (
        <HelpModal onClose={() => dispatch({ type: 'CLOSE_MODAL' })} />
      )}
      {state.modal === 'confirm' && (
        <ConfirmModal
          prompt={
            'Delete manual project ' +
            (state.modalContext.confirmPayload ?? '?') +
            ' ?'
          }
          onConfirm={() => {
            /* y 键已由 useInput + routeKey 处理；此处仅供 UI 渲染 */
          }}
          onCancel={() => dispatch({ type: 'CLOSE_MODAL' })}
        />
      )}
    </Box>
  );
};

export default App;
