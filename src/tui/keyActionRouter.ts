import type { Dispatch } from 'react';
import type { Action, UiState } from './App.js';

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
  if (input === 'q' || (key.ctrl && input === 'c')) {
    opts.onQuit();
    return; // quit 后续不应再继续派发其它 action
  }

  if (input === 'r') {
    dispatch({ type: 'OPEN_MODAL', modal: 'rename' });
  } else if (input === 'n') {
    // 严格按 brief：`n` 打开 settings 模态（HelpModal 列出的 "New session"
    // 与 brief 不一致，留待后续 task 决定是否换回 newSession 行为）。
    dispatch({ type: 'OPEN_MODAL', modal: 'settings' });
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
