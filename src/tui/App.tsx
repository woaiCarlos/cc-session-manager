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
import { writeSessionCustomTitle } from '../actions/writeSessionCustomTitle.js';
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
  | { type: 'NOTICE'; kind: string; payload?: unknown; message?: string }
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
    case 'SESSION_DISCOVERED': {
      // SESSION_DISCOVERED 现在在 reducer 内追加 meta 到对应 project。
      // 之前是 no-op，依赖 cli 外部的累积 projects 重建；那种方式在
      // 单一 React state 路径下不再适用，会导致 630 sessions 闪烁。
      //
      // 算法：按 meta.cwd 找/建 project → project.sessions 中按 lastTimestamp
      // 倒序插入新 session → 若新 project 不在列表则追加 → 列表按 manual
      // 优先 + 最近时间倒序。
      //
      // Bug 4d：displayName 优先级与 `group.ts:23` 的 `sessionDisplayName`
      // 一致：customTitle → lastPrompt → firstUserMessage → sessionId。
      // 不再读 `state.sessionAliases`（ccsm 自维护的 alias 层已删）。
      const meta = action.meta;
      const projects = state.projects.slice();
      const displayName = deriveDisplayName(meta);
      // Bug A 修复 3：jsonlPath 不再由 App 维护 —— cli.tsx 在自己闭包内
      // 持有 sessionId → jsonlPath 索引，rescan 路径走那边。这里只关心
      // Session 的展示字段（displayName / sizeBytes / lastTimestamp）。
      const newSession: Session = {
        id: meta.sessionId,
        displayName,
        cwd: meta.cwd,
        lastActiveRelative: meta.lastTimestamp,
        lastTimestamp: meta.lastTimestamp,
        sizeBytes: meta.sizeBytes,
      };
      const idx = projects.findIndex((p) => p.key === meta.cwd);
      if (idx >= 0) {
        const proj = projects[idx]!;
        // 去重：同 id 已存在则跳过
        if (proj.sessions.some((s) => s.id === newSession.id)) {
          // 但若这条 meta 携带更新的 displayName / sizeBytes，也要 patch
          // （rename 后重启 ccsm 的场景；以及 Bug A 'current' rescan 路径）
          const existing = proj.sessions.find((s) => s.id === newSession.id)!;
          if (
            newSession.displayName !== existing.displayName ||
            newSession.sizeBytes !== existing.sizeBytes ||
            newSession.lastTimestamp !== existing.lastTimestamp
          ) {
            const nextSessions = proj.sessions.map((s) =>
              s.id === newSession.id ? newSession : s,
            );
            projects[idx] = { ...proj, sessions: nextSessions };
            return { ...state, projects };
          }
          return state;
        }
        const nextSessions = proj.sessions.concat(newSession);
        nextSessions.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
        projects[idx] = { ...proj, sessions: nextSessions };
      } else {
        const newProj: Project = {
          key: meta.cwd,
          displayName: deriveProjectName(meta.cwd),
          cwd: meta.cwd,
          manual: false,
          hidden: false,
          sessions: [newSession],
        };
        projects.push(newProj);
        projects.sort(projectSortComparator);
      }
      return { ...state, projects };
    }
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
      // 写入 lastAction，让 status-bar / notice banner 显示。
      // TODO：可加 timeout 自动清除。当前 next action 覆盖。
      return {
        ...state,
        lastAction: {
          kind: action.kind,
          payload: action.payload ?? action.message,
          at: Date.now(),
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers: derive display names + project sort comparator (used by
// SESSION_DISCOVERED reducer).  These mirror the priority chain in
// design.md §4 and keep the reducer self-contained.
// ---------------------------------------------------------------------------

function deriveDisplayName(meta: SessionMeta): string {
  // Bug 4d：与 `group.ts:23` sessionDisplayName 同优先级。
  // 单一来源 = Claude Code JSONL 的 custom-title（`/rename` 写入）。
  // 不再读 state.sessionAliases（ccsm 自维护的 alias 层已删）。
  if (meta.customTitle) return meta.customTitle;
  const text = meta.lastPrompt ?? meta.firstUserMessage;
  if (typeof text !== 'string' || text.length === 0) {
    return meta.sessionId;
  }
  // 简单截断（不剥 XML：lastPrompt 已是纯文本）
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function deriveProjectName(cwd: string): string {
  // 简单 basename；若以 / 结尾取最后一段
  const trimmed = cwd.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || cwd;
}

function projectSortComparator(a: Project, b: Project): number {
  if (a.manual !== b.manual) return a.manual ? -1 : 1;
  const at = a.sessions[0]?.lastTimestamp ?? '';
  const bt = b.sessions[0]?.lastTimestamp ?? '';
  return bt.localeCompare(at);
}

// ---------------------------------------------------------------------------
// AppProps：解耦 React 组件与外围副作用（扫描 / 完成回调）
// ---------------------------------------------------------------------------

export interface AppProps {
  bootstrapState: AppState;
  projects: Project[];
  onSession: (cb: (meta: SessionMeta) => void) => void;
  onScanComplete: (cb: () => void) => void;
  /**
   * App 上报当前 `state.projects` 的回调。
   *
   * 当前主要由 `src/cli.tsx` 的 bootstrap 装配：当 `terminal` 后端是
   * `current` 时，claude 会接管 TTY 后 Ink 卸载再重渲染，新 App 实例
   * 不再持有原 reducer 状态。cli 借助此回调把最新的项目/Session 列表
   * 同步到 `latestProjects` 闭包，重渲染时由 `createAppElement` 读出，
   * 避免 remount 后界面变成空白。
   *
   * 可选；测试渲染时不提供也安全。
   */
  onProjectsChange?: (projects: Project[]) => void;
  /**
   * Bug A 修复 3：sessionId → jsonlPath 反查回调。由 cli.tsx 在 bootstrap
   * 内基于 runDiscovery 填充的 jsonlIndex 闭包实现。R 键 rename modal
   * 调用它定位要写入 custom-title 的 JSONL 文件；'current' backend
   * rescan 也通过同一个闭包拿到 jsonlPath。提供这个 callback 而不是
   * 直接传 jsonlIndex prop，是因为后者在 App mount 时为空且没有同步
   * 机制，会导致所有查找返回 undefined。
   */
  lookupJsonlPath?: (sessionId: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// App：根 Ink 组件。后续 task 7.2~7.16 会在此基础上加 panes / modals / hooks。
// ---------------------------------------------------------------------------

export const App: React.FC<AppProps> = ({
  bootstrapState,
  projects,
  onSession,
  onScanComplete,
  onProjectsChange,
  lookupJsonlPath,
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

  // 上报当前 `state.projects` 给外部（cli bootstrap）。
  // 闭包 cell 让 'current' backend 在 Ink remount 时能拿到最新列表
  // 而不是首次 render 的空数组。
  useEffect(() => {
    onProjectsChange?.(state.projects);
  }, [state.projects, onProjectsChange]);

  // useKeybindings 专门派发 Tab → TOGGLE_FOCUS（routeKey 不处理 Tab 以保持原测试约定）
  useKeybindings(dispatch as React.Dispatch<any>);

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
  // 重建 callback（settings 改终端后立即生效）。失败时 dispatch NOTICE 让
  // status-bar 显示错误（之前 catch 静默吞掉，用户看不到反馈）。
  const onResumeSession = useCallback(
    (session: Session) => {
      void resumeSession(session, state.terminal).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'NOTICE', kind: 'error', message: `Resume failed: ${msg}` });
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
        lastAction={state.lastAction}
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
          onSubmit={(newName) => {
            // Bug 4d：ccsm 不再自维护 alias；rename modal 的提交直接把
            // `{"type":"custom-title","customTitle":...}` 一行同步
            // append 到 Claude Code 的 session JSONL —— 与 CC 自身的
            // `/rename` slash command 写入同一个文件，达成单一持久化来源。
            //
            //  1. 校验 targetId + safeName（非空）
            //  2. 查找 jsonlIndex[sessionId] 拿到 JSONL 文件路径
            //  3. 同步 dispatch CLOSE_MODAL（用户立刻看到反馈）
            //  4. 同步 appendFileSync custom-title（即便立刻 Ctrl+C 也已落盘）
            //  5. 失败：dispatch NOTICE 报告（status-bar 显示）
            //  6. 用户名优先显示：用户重命名后，下次 SESSION_DISCOVERED 扫描会读到；
            //     但如果用户在同次会话内对当前 session 改名，需要立刻 patch UI
            //     —— 用乐观 SESSION_DISCOVERED-style 派发（dispatch 一条带
            //     customTitle 的虚拟 meta，让 reducer 刷新对应 Session 行）。
            const safeName = newName.trim();
            const kind = state.modalContext.renameKind ?? 'session';
            const targetId =
              state.modalContext.renameTargetId ??
              (kind === 'session'
                ? state.selectedSessionId
                : state.selectedProjectKey);
            if (typeof targetId !== 'string' || safeName.length === 0) {
              dispatch({ type: 'CLOSE_MODAL' });
              return;
            }
            dispatch({ type: 'CLOSE_MODAL' });
            // 把 custom-title 写回 JSONL —— 单一来源
            // Bug A 修复 3：通过 cli 闭包回调反查 jsonlPath，而非依赖
            // state.jsonlIndex（后者在 App mount 后不会被同步更新，永远是空）。
            const jsonlPath = lookupJsonlPath?.(targetId);
            if (!jsonlPath) {
              dispatch({
                type: 'NOTICE',
                kind: 'error',
                message:
                  'Rename failed: JSONL path not found for session; re-scan may be needed',
              });
              return;
            }
            try {
              // writeSessionCustomTitle 在内部 appendFileSync（同步 syscall）
              void writeSessionCustomTitle(jsonlPath, targetId, safeName).catch(
                (err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  dispatch({
                    type: 'NOTICE',
                    kind: 'error',
                    message: `Rename failed: ${msg}`,
                  });
                },
              );
              // 乐观：派发 SESSION_DISCOVERED-style 同步 patch 当前 session
              // 的 displayName（即时刷新，UI 不必等到下次 scan）。reducer 内
              // 会找到匹配 session 并把 displayName 改成 safeName。
              if (kind === 'session') {
                const meta = state.projects
                  .flatMap((p) => p.sessions)
                  .find((s) => s.id === targetId);
                if (meta) {
                  dispatch({
                    type: 'SESSION_DISCOVERED',
                    meta: {
                      sessionId: meta.id,
                      cwd: meta.cwd,
                      firstUserMessage: null,
                      lastPrompt: null,
                      customTitle: safeName,
                      lastTimestamp: meta.lastTimestamp,
                      sizeBytes: 0,
                      lineCount: 0,
                    },
                  });
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              dispatch({
                type: 'NOTICE',
                kind: 'error',
                message: `Rename failed: ${msg}`,
              });
            }
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
