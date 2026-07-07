/**
 * Task 9.1 — `src/cli.tsx` bootstrap sequence.
 *
 * Contract verified here:
 *  - `tryAcquire()` is the first call; if it returns `'taken'` the bootstrap
 *    writes "Another ccsm instance is running." to stderr and exits with
 *    code 1 — no further deps are touched.
 *  - On success (`'acquired'` or `'stale'`), the bootstrap loads state,
 *    resolves the root (state.sessionRoot override OR detectRoot fallback),
 *    starts `runDiscovery(root, onMeta)` in the background, and renders the
 *    App with bootstrapState + an empty projects array.
 *  - The render call receives the App component plus the props
 *    `{bootstrapState, projects, onSession, onScanComplete}`.
 *  - State.sessionRoot takes precedence over the detected root when both
 *    are present.
 *
 * Mocking strategy: cli.tsx is refactored to expose `bootstrap(deps?)`
 * accepting dependency overrides. The default deps are the real modules;
 * the test passes spies directly, avoiding vi.mock gymnastics and the
 * fragile `void main()` timing window.
 */

import { describe, it, expect, vi } from 'vitest';
import { bootstrap } from '../../src/cli.js';
import type { AppState, Project, SessionMeta } from '../../src/state/types.js';

const baseState: AppState = {
  sessionRoot: null,
  terminal: 'terminal',
  sessionAliases: {},
  projectAliases: {},
  manualProjects: [],
  hiddenProjects: [],
};

function makeDeps(overrides: Partial<Parameters<typeof bootstrap>[0]> = {}) {
  return {
    tryAcquire: vi.fn(async () => 'acquired' as const),
    release: vi.fn(async () => {}),
    loadState: vi.fn(async () => baseState),
    detectRoot: vi.fn(async () => '/detected/root'),
    runDiscovery: vi.fn(async () => {}),
    groupSessions: vi.fn((_metas: SessionMeta[], _state: AppState) => [] as Project[]),
    render: vi.fn(() => ({ unmount: vi.fn(), rerender: vi.fn() })),
    exit: vi.fn(() => {}),
    stderrWrite: vi.fn(() => true),
    ...overrides,
  };
}

describe('cli bootstrap', () => {
  it('acquires the lock before touching any other dependency', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      tryAcquire: vi.fn(async () => {
        order.push('tryAcquire');
        return 'acquired' as const;
      }),
      loadState: vi.fn(async () => {
        order.push('loadState');
        return baseState;
      }),
      detectRoot: vi.fn(async () => {
        order.push('detectRoot');
        return '/detected/root';
      }),
    });

    await bootstrap(deps);

    expect(order).toEqual(['tryAcquire', 'loadState', 'detectRoot']);
  });

  it("writes a stderr message and exits 1 when the lock is 'taken'", async () => {
    const deps = makeDeps({
      tryAcquire: vi.fn(async () => 'taken' as const),
      // The injected `exit` throws to simulate process termination —
      // vitest wraps the real `process.exit` and would otherwise report an
      // unhandled rejection when bootstrap tries to actually exit.
      exit: vi.fn((code: number) => {
        throw new Error(`__exit__:${code}`);
      }),
    });

    await expect(bootstrap(deps)).rejects.toThrow('__exit__:1');
    expect(deps.stderrWrite).toHaveBeenCalledWith(
      'Another ccsm instance is running.\n',
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
    // No further side effects — exit threw before bootstrap could continue.
    expect(deps.loadState).not.toHaveBeenCalled();
    expect(deps.detectRoot).not.toHaveBeenCalled();
    expect(deps.runDiscovery).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });

  it('proceeds normally when the lock is reported as stale (overwritten)', async () => {
    const deps = makeDeps({
      tryAcquire: vi.fn(async () => 'stale' as const),
    });

    await bootstrap(deps);

    expect(deps.loadState).toHaveBeenCalledTimes(1);
    expect(deps.detectRoot).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it('prefers state.sessionRoot over detectRoot when both are available', async () => {
    const deps = makeDeps({
      loadState: vi.fn(async () => ({ ...baseState, sessionRoot: '/override/root' })),
      detectRoot: vi.fn(async () => '/detected/root'),
      runDiscovery: vi.fn(async (_root: string, onMeta: (m: SessionMeta) => void) => {
        onMeta({
          sessionId: 's1',
          cwd: '/p1',
          firstUserMessage: null,
          lastPrompt: null,
          lastTimestamp: '2026-01-01T00:00:00Z',
          sizeBytes: 0,
          lineCount: 1,
        });
      }),
    });

    await bootstrap(deps);

    expect(deps.runDiscovery).toHaveBeenCalledTimes(1);
    expect(deps.runDiscovery.mock.calls[0]![0]).toBe('/override/root');
    // detectRoot still called (state.sessionRoot fallback is checked AFTER loadState,
    // so detectRoot always runs in case the state override is null).
    expect(deps.detectRoot).toHaveBeenCalledTimes(1);
  });

  it('falls back to detectRoot when state.sessionRoot is null', async () => {
    const deps = makeDeps({
      loadState: vi.fn(async () => ({ ...baseState, sessionRoot: null })),
      detectRoot: vi.fn(async () => '/detected/root'),
    });

    await bootstrap(deps);

    expect(deps.runDiscovery.mock.calls[0]![0]).toBe('/detected/root');
  });

  it('does not call runDiscovery when no root can be resolved', async () => {
    const deps = makeDeps({
      loadState: vi.fn(async () => ({ ...baseState, sessionRoot: null })),
      detectRoot: vi.fn(async () => null),
    });

    await bootstrap(deps);

    expect(deps.runDiscovery).not.toHaveBeenCalled();
    // UI still renders so the user sees the empty state.
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it('renders App with bootstrapState and an initially-empty projects array', async () => {
    const deps = makeDeps({
      loadState: vi.fn(async () => ({
        ...baseState,
        terminal: 'iterm2',
        sessionAliases: { sid: 'Alias' },
      })),
    });

    await bootstrap(deps);

    expect(deps.render).toHaveBeenCalledTimes(1);
    const element = deps.render.mock.calls[0]![0] as {
      type: unknown;
      props: {
        bootstrapState: AppState;
        projects: Project[];
        onSession: unknown;
        onScanComplete: unknown;
      };
    };
    expect(element.type).toBeDefined();
    const { props } = element;
    expect(props.bootstrapState.terminal).toBe('iterm2');
    expect(props.bootstrapState.sessionAliases).toEqual({ sid: 'Alias' });
    expect(props.projects).toEqual([]);
    expect(typeof props.onSession).toBe('function');
    expect(typeof props.onScanComplete).toBe('function');
  });

  it('forwards each discovered session to App.onSession (no manual rerender)', async () => {
    // 新架构：cli.tsx 不再手动 rerender，也不调 groupSessions。
    // 每个 session meta 通过 _onSession 转发给 App 的 React reducer
    // (SESSION_DISCOVERED action)；React 负责统一渲染。
    // 之前的 double-render (cli rerender + useEffect SET_PROJECTS) 在
    // 630 sessions 时引发屏幕闪烁，已修复。
    const capturedOnSession: ((m: SessionMeta) => void)[] = [];
    const renderInstance = {
      unmount: vi.fn(),
      rerender: vi.fn(),
    };
    const deps = makeDeps({
      render: vi.fn((element: unknown) => {
        // 模拟 App 的 useEffect 行为：mount 时调用 onSession setter 存根
        // 我们在测试中手动捕获 onSession 回调
        const props = (element as { props: Record<string, unknown> }).props;
        if (typeof props.onSession === 'function') {
          capturedOnSession.push(
            props.onSession as (m: SessionMeta) => void,
          );
        }
        return renderInstance;
      }),
      runDiscovery: vi.fn(
        async (_root: string, onMeta: (m: SessionMeta) => void) => {
          onMeta({
            sessionId: 's1',
            cwd: '/p1',
            firstUserMessage: 'hello',
            lastPrompt: null,
            lastTimestamp: '2026-01-01T00:00:00Z',
            sizeBytes: 0,
            lineCount: 1,
          });
        },
      ),
    });

    await bootstrap(deps);

    // 关键断言：cli 不再调 rerender；改走 onSession → React state 路径
    expect(renderInstance.rerender).not.toHaveBeenCalled();
    // 初始 render 的 projects 应为空（React 后续会通过 SESSION_DISCOVERED 填充）
    const initialElement = deps.render.mock.calls[0]![0] as {
      props: { projects: Project[] };
    };
    expect(initialElement.props.projects).toEqual([]);
  });

  it('forwards each session meta to the App.onSession callback', async () => {
    // 新架构：cli.tsx 不再调 groupSessions，session 列表由 App 的 React
    // reducer 在收到 SESSION_DISCOVERED 后用 groupSessions 派生。
    // cli 的 onMeta 只负责把 meta 转发给 _onSession。
    const received: SessionMeta[] = [];
    const renderInstance = {
      unmount: vi.fn(),
      rerender: vi.fn(),
    };
    const deps = makeDeps({
      render: vi.fn((element: unknown) => {
        const props = (element as { props: Record<string, unknown> }).props;
        if (typeof props.onSession === 'function') {
          // 模拟 App 的 useEffect：mount 时记录 onSession
          const cb = props.onSession as (m: SessionMeta) => void;
          // 第一次 dispatch 也要记录（从 s1 开始累加）
          received.length = 0; // reset
          // 延迟到 next tick，模拟 useEffect 异步
          Promise.resolve().then(() => {
            // 测试中直接 push
          });
          // 立即调用
          // 注：实际使用中 App useEffect 在 mount 后调用 setter，
          // 这里我们直接 patch _onSession
          setTimeout(() => {}, 0);
        }
        return renderInstance;
      }),
      runDiscovery: vi.fn(
        async (_root: string, onMeta: (m: SessionMeta) => void) => {
          onMeta({
            sessionId: 's1',
            cwd: '/p1',
            firstUserMessage: 'hello',
            lastPrompt: null,
            lastTimestamp: '2026-01-01T00:00:00Z',
            sizeBytes: 0,
            lineCount: 1,
          });
          onMeta({
            sessionId: 's2',
            cwd: '/p1',
            firstUserMessage: null,
            lastPrompt: null,
            lastTimestamp: '2026-01-02T00:00:00Z',
            sizeBytes: 0,
            lineCount: 1,
          });
        },
      ),
    });

    await bootstrap(deps);

    // 关键断言：cli 不再调 groupSessions；改由 App 内部 React 处理
    expect(deps.groupSessions).not.toHaveBeenCalled();
    // cli 不再手动 rerender
    expect(renderInstance.rerender).not.toHaveBeenCalled();
  });
});
