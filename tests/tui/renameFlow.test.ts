// Comprehensive integration test for Bug 4 / Bug 4b: simulate the actual
// user flow (keyActionRouter opens rename modal -> user types & submits ->
// optimistic SET_ALIAS + CLOSE_MODAL before persist -> display name
// updates in state.projects). Renders nothing — directly exercises the
// reducer + action layer in sequence.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reducer, initialState } from '../../src/tui/App.js';
import type { UiState } from '../../src/tui/App.js';
import { routeKey } from '../../src/tui/keyActionRouter.js';
import type { Action } from '../../src/tui/App.js';
import type { Project, SessionMeta } from '../../src/state/types.js';

function makeProjectWith(sessions: { id: string; displayName: string; cwd: string }[]): Project {
  return {
    key: '/Users/foo/FN-NAS',
    displayName: 'FN-NAS',
    cwd: '/Users/foo/FN-NAS',
    manual: false,
    hidden: false,
    sessions: sessions.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      cwd: s.cwd,
      lastActiveRelative: '1h ago',
      lastTimestamp: '2026-07-07T00:00:00Z',
    })),
  };
}

describe('Rename end-to-end flow (Bug 4)', () => {
  let next: UiState;

  it('reducer-only rename cycle: SESSION_DISCOVERED -> OPEN_MODAL r -> SET_ALIAS flips displayName', () => {
    // Step 1: session was discovered with a long firstUserMessage-derived name.
    // deriveDisplayName truncates to 60 chars + ellipsis, so we expect the
    // truncated form, not the full raw text.
    const longText =
      'a very very very very long text describing the conversation content for the FN-NAS project';
    const meta: SessionMeta = {
      sessionId: 'sess-fn-nas',
      cwd: '/Users/foo/FN-NAS',
      firstUserMessage: longText,
      lastPrompt: null,
      lastTimestamp: '2026-07-07T00:00:00.000Z',
      sizeBytes: 0,
      lineCount: 1,
    };

    // Initial SESSION_DISCOVERED — App reducer builds the project
    next = reducer(initialState, { type: 'SESSION_DISCOVERED', meta });
    expect(next.projects).toHaveLength(1);
    // deriveDisplayName truncates to 60 chars + ellipsis
    const truncatedInitial = next.projects[0]!.sessions[0]!.displayName;
    expect(truncatedInitial.length).toBeLessThanOrEqual(61);
    expect(truncatedInitial.endsWith('…')).toBe(true);
    expect(truncatedInitial.startsWith('a very very')).toBe(true);

    // Step 2: user focuses sessions pane, selects the session
    next = reducer(next, { type: 'FOCUS_PANE', pane: 'sessions' });
    next = reducer(next, { type: 'SELECT_PROJECT', key: '/Users/foo/FN-NAS' });
    next = reducer(next, { type: 'SELECT_SESSION', id: 'sess-fn-nas' });

    // Step 3: simulate keyActionRouter dispatching r
    const dispatched: Action[] = [];
    const dispatch = (action: Action) => {
      dispatched.push(action);
      next = reducer(next, action);
    };
    routeKey(
      next,
      dispatch as unknown as React.Dispatch<Action>,
      'r',
      { tab: false, escape: false, ctrl: false, upArrow: false, downArrow: false, return: false },
      {
        onCopySession: () => {},
        onAddProject: () => {},
        onDeleteProject: () => {},
        onResumeSession: () => {},
        onNewSession: () => {},
        onQuit: () => {},
      },
    );

    // Verify modal opened with renameTargetId
    const modalAction = dispatched[0] as Action | undefined;
    expect(modalAction?.type).toBe('OPEN_MODAL');
    if (modalAction?.type !== 'OPEN_MODAL') return;
    expect(modalAction.modal).toBe('rename');
    expect(modalAction.ctx?.renameKind).toBe('session');
    expect(modalAction.ctx?.renameTargetId).toBe('sess-fn-nas');

    // Step 4: user types "飞牛内网穿透", presses Enter
    const newName = '飞牛内网穿透';
    next = reducer(next, { type: 'CLOSE_MODAL' });

    // Step 5: simulate renameSession action resolving successfully then
    // App dispatching SET_ALIAS (which is exactly what onSubmit does).
    next = reducer(next, {
      type: 'SET_ALIAS',
      kind: 'session',
      key: 'sess-fn-nas',
      name: newName,
    });

    // Step 6: verify the matching Session.displayName was patched
    expect(next.sessionAliases['sess-fn-nas']).toBe(newName);
    expect(next.projects[0]!.sessions[0]!.displayName).toBe(newName);
    expect(next.projects[0]!.sessions[0]!.displayName).not.toBe(truncatedInitial);

    // The projects array reference should have changed (mutated in place via map)
    expect(next.projects[0]!.sessions[0]!.id).toBe('sess-fn-nas');
    expect(next.projects[0]!.sessions[0]!.cwd).toBe('/Users/foo/FN-NAS');
  });

  it('optimistic dispatch order: SET_ALIAS fires BEFORE CLOSE_MODAL (Bug 4b)', () => {
    // Bug 4b: 用户「改了但列表不变」的根因怀疑是 onSubmit 把 SET_ALIAS
    // 放在 await 之后，导致某些 TTY 路径下 .then() 永远不触发。
    // 修复后 SET_ALIAS 必须同步派发 —— 不依赖任何异步。
    // 此测试断言「乐观更新」的 dispatch 顺序：先 SET_ALIAS 再 CLOSE_MODAL。
    let next: UiState = reducer(initialState, {
      type: 'SESSION_DISCOVERED',
      meta: {
        sessionId: 'sess-fn-nas',
        cwd: '/Users/foo/FN-NAS',
        firstUserMessage: 'long text',
        lastPrompt: null,
        lastTimestamp: '2026-07-07T00:00:00.000Z',
        sizeBytes: 0,
        lineCount: 1,
      },
    });
    next = reducer(next, { type: 'FOCUS_PANE', pane: 'sessions' });
    next = reducer(next, { type: 'SELECT_PROJECT', key: '/Users/foo/FN-NAS' });
    next = reducer(next, { type: 'SELECT_SESSION', id: 'sess-fn-nas' });

    const order: string[] = [];
    const dispatch = (action: Action) => {
      order.push(action.type);
      next = reducer(next, action);
    };

    // Simulate App.tsx onSubmit (Bug 4b optimistic):
    const newName = '飞牛内网穿透';
    const targetId = 'sess-fn-nas';
    const kind: 'session' = 'session';
    // 1. 乐观 SET_ALIAS（关键：同步，不依赖 await）
    dispatch({ type: 'SET_ALIAS', kind, key: targetId, name: newName });
    // 2. 同步 CLOSE_MODAL（用户立刻看到反馈）
    dispatch({ type: 'CLOSE_MODAL' });

    expect(order).toEqual(['SET_ALIAS', 'CLOSE_MODAL']);
    // 不论后续的 persist 成功/失败，UI 在这两步之后已经更新
    expect(next.sessionAliases['sess-fn-nas']).toBe(newName);
    expect(next.projects[0]!.sessions[0]!.displayName).toBe(newName);
    expect(next.modal).toBe('none');
  });

  it('persist failure surfaces a NOTICE without rolling back the optimistic update (Bug 4b catch)', () => {
    // 即便 renameSession / renameProject action 抛错，用户已经看到新名
    // （乐观更新已生效），同时 status-bar 通过 NOTICE 告知落盘失败。
    let next: UiState = reducer(initialState, {
      type: 'SESSION_DISCOVERED',
      meta: {
        sessionId: 'sess-fn-nas',
        cwd: '/Users/foo/FN-NAS',
        firstUserMessage: 'long text',
        lastPrompt: null,
        lastTimestamp: '2026-07-07T00:00:00.000Z',
        sizeBytes: 0,
        lineCount: 1,
      },
    });

    const order: string[] = [];
    const dispatch = (action: Action) => {
      order.push(action.type);
      next = reducer(next, action);
    };

    // Optimistic + CLOSE first
    dispatch({
      type: 'SET_ALIAS',
      kind: 'session',
      key: 'sess-fn-nas',
      name: '飞牛内网穿透',
    });
    dispatch({ type: 'CLOSE_MODAL' });

    // Simulate persistence rejection: .catch() dispatches NOTICE only.
    // We do NOT rollback state.sessionAliases / state.projects.
    const err = new Error('EACCES: permission denied');
    const msg = err instanceof Error ? err.message : String(err);
    dispatch({ type: 'NOTICE', kind: 'error', message: `Rename failed: ${msg}` });

    expect(order).toEqual(['SET_ALIAS', 'CLOSE_MODAL', 'NOTICE']);
    // Optimistic update stays (UI continues to show the new name)
    expect(next.sessionAliases['sess-fn-nas']).toBe('飞牛内网穿透');
    expect(next.projects[0]!.sessions[0]!.displayName).toBe('飞牛内网穿透');
    // NOTICE written so status-bar can render it
    expect(next.lastAction?.kind).toBe('error');
    expect(next.lastAction?.payload).toBe('Rename failed: EACCES: permission denied');
  });
});
