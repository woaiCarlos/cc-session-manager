import type { Dispatch } from 'react';
import type { Action, UiState } from './App.js';
import type { Project, Session } from '../state/types.js';

// ---------------------------------------------------------------------------
// keyActionRouter：把 useInput 收到的按键事件映射到 reducer action /
// action callback。抽成纯函数以便单测，避免依赖 React 渲染环境。
//
// 设计选择：App.tsx 直接挂 useInput 调用此函数即可；不通过 useKeybindings
// 的 callback 间接转发，因为我们需要在 main-view 分支里同时读
// state.selectedSessionId / state.selectedProjectKey 做条件派发，使用
// 注入式 callback 即可让所有副作用集中在一处，单元可测。
//
// 行为契约：
//  - 在 confirm 模态里只接受 y/Y/N/Esc，其它键一律吞掉（不在 confirm 里
//    再派发 Tab 或字母）；
//  - 在任何其它模态（search/rename/settings/help）里，所有字母键均短路，
//    因为模态自身已挂自己的 useInput（useEscapeToCancel 等）；
//  - main view (modal === 'none') 中按 brief 把 r/n/d/,/?/a/c/q 全部接出。
// ---------------------------------------------------------------------------

/** useInput 第二个参数 key 的子集：仅声明路由函数实际读取的字段 */
export interface RouterKey {
  tab: boolean;
  escape: boolean;
  ctrl: boolean;
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
}

/** 路由所需的副作用回调集合（由 App.tsx 注入具体实现） */
export interface RouterOptions {
  /** 复制当前选中 session id 到剪贴板（copySessionId 包装） */
  onCopySession: (sessionId: string) => void;
  /** 通过原生 picker 添加一个 manual project（addManualProject 包装） */
  onAddProject: () => void;
  /** 实际执行 deleteManualProject 的副作用（参数为 groupKey 路径） */
  onDeleteProject: (groupKey: string) => void;
  /** 在 session 上按 Enter：恢复该 session（resumeSession 包装，terminal 已注入） */
  onResumeSession: (session: Session) => void;
  /** 在 project 上按 n：新建 session（newSession 包装，terminal 已注入） */
  onNewSession: (project: Project) => void;
  /** 释放 lock 并退出进程（释放由调用方负责，路由器只调度） */
  onQuit: () => void;
}

/**
 * 把单个按键事件映射成 reducer action 或 action 副作用。
 *
 * 设计为幂等：单次按键要么 dispatch 1 个 action，要么调用 1 个 callback，
 * 不会既 dispatch 又 callback（confirm 分支例外：先 onDeleteProject 副作用
 * 再 dispatch CLOSE_MODAL，符合 brief 的顺序）。
 */
export function routeKey(
  state: UiState,
  dispatch: Dispatch<Action>,
  input: string,
  key: RouterKey,
  opts: RouterOptions,
): void {
  // confirm 模态分支：仅响应 y/Y/N/Esc
  if (state.modal === 'confirm') {
    const y = input === 'y' || input === 'Y';
    const n = input === 'n' || input === 'N';
    if (y) {
      const ctx = state.modalContext;
      if (
        ctx.confirmAction === 'deleteManualProject' &&
        typeof ctx.confirmPayload === 'string'
      ) {
        opts.onDeleteProject(ctx.confirmPayload);
      }
      dispatch({ type: 'CLOSE_MODAL' });
      return;
    }
    if (n || key.escape) {
      dispatch({ type: 'CLOSE_MODAL' });
      return;
    }
    // confirm 模态下吞掉其它按键，避免误触发 quit/copy/Tab 等
    return;
  }

  // 其余模态：所有字母/Tab/quit 由模态自身处理；外部不应再插手
  if (state.modal !== 'none') return;

  // main view：实际接线。
  // 注意：Tab 由 useKeybindings 派发 TOGGLE_FOCUS，这里不重复派发。

  // 上下方向键：在当前 focusedPane 中选择上/下一项。`projects` 列表是顶层
  // 数组；`sessions` 列表取自 selectedProject.sessions。clamp 到边界。
  if (key.upArrow || key.downArrow) {
    const dir = key.downArrow ? 1 : -1;
    if (state.focusedPane === 'projects') {
      const list = state.projects;
      if (list.length === 0) return;
      const idx = list.findIndex((p) => p.key === state.selectedProjectKey);
      const next = clamp(idx + dir, 0, list.length - 1);
      const newKey = list[next]?.key ?? null;
      if (newKey !== state.selectedProjectKey) {
        dispatch({ type: 'SELECT_PROJECT', key: newKey });
      }
    } else {
      const proj = state.projects.find((p) => p.key === state.selectedProjectKey);
      const sessions = proj?.sessions ?? [];
      if (sessions.length === 0) return;
      const idx = sessions.findIndex((s) => s.id === state.selectedSessionId);
      const next = clamp(idx + dir, 0, sessions.length - 1);
      const newId = sessions[next]?.id ?? null;
      if (newId !== state.selectedSessionId) {
        dispatch({ type: 'SELECT_SESSION', id: newId });
      }
    }
    return;
  }

  // Enter：在 session pane 上恢复选中的 session；在 project pane 上把焦点
  // 移到 session pane（design doc §3.2 / §3.5）。Enter 由 routeKey 独占处理，
  // useKeybindings 的 onEnter 在 App 内为 no-op，避免双 dispatch。
  //
  // 关键：若 project pane 上 selectedProjectKey 未设（如刚启动从未按 ↓），
  // Enter 应同时 SELECT 第一个 project 再切焦点，否则 sessions pane 渲染
  // 空列表（visibleSessions = []），用户无法选 session。
  if (key.return) {
    if (
      state.focusedPane === 'sessions' &&
      typeof state.selectedSessionId === 'string'
    ) {
      const sess = state.projects
        .flatMap((p) => p.sessions)
        .find((s) => s.id === state.selectedSessionId);
      if (sess) opts.onResumeSession(sess);
    } else if (state.focusedPane === 'projects') {
      // 若未选 project，先选第一个；同时切焦点
      if (state.selectedProjectKey === null && state.projects.length > 0) {
        dispatch({ type: 'SELECT_PROJECT', key: state.projects[0]!.key });
      }
      dispatch({ type: 'FOCUS_PANE', pane: 'sessions' });
    }
    return;
  }

  if (input === 'q' || (key.ctrl && input === 'c')) {
    opts.onQuit();
    return; // quit 后续不应再继续派发其它 action
  }

  // Esc：模态下关模态；main view 退回 projects pane（不退出）
  if (key.escape) {
    dispatch({ type: 'FOCUS_PANE', pane: 'projects' });
    return;
  }

  if (input === 'r') {
    // 重命名模态仅在 sessions pane + 有选中 session 时打开，并把当前
    // alias 预填到 ctx 让 RenameModal 展示「之前的对话名称」可删可改。
    // 项目侧（groupKey 重命名副作用偏大）保持 no-op。
    if (
      state.focusedPane === 'sessions' &&
      typeof state.selectedSessionId === 'string'
    ) {
      dispatch({
        type: 'OPEN_MODAL',
        modal: 'rename',
        ctx: {
          renameKind: 'session',
          renameTargetId: state.selectedSessionId,
          renameCurrentName:
            state.sessionAliases[state.selectedSessionId] ?? '',
        },
      });
    }
  } else if (input === 'n') {
    // design doc §3.3 权威：`n` 在选中 project 上新建 session（执行 `claude`）。
    // 早前 7.14 把 `n` 误接到 settings 模态（与 HelpModal 文案冲突），此处
    // 校正为调用 newSession；`,` 仍然是 settings 入口。未选中 project 时 no-op。
    const proj = state.projects.find((p) => p.key === state.selectedProjectKey);
    if (proj) opts.onNewSession(proj);
  } else if (input === ',') {
    dispatch({ type: 'OPEN_MODAL', modal: 'settings' });
  } else if (input === '?') {
    dispatch({ type: 'OPEN_MODAL', modal: 'help' });
  } else if (input === '/') {
    dispatch({ type: 'OPEN_MODAL', modal: 'search' });
  } else if (input === 'd') {
    dispatch({
      type: 'OPEN_MODAL',
      modal: 'confirm',
      ctx: {
        confirmAction: 'deleteManualProject',
        confirmPayload: state.selectedProjectKey ?? undefined,
      },
    });
  } else if (input === 'a') {
    opts.onAddProject();
  } else if (input === 'c' && typeof state.selectedSessionId === 'string') {
    opts.onCopySession(state.selectedSessionId);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
