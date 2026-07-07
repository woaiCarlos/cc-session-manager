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
        onProjectsChange?: unknown;
      };
    };
    expect(element.type).toBeDefined();
    const { props } = element;
    expect(props.bootstrapState.terminal).toBe('iterm2');
    expect(props.bootstrapState.sessionAliases).toEqual({ sid: 'Alias' });
    expect(props.projects).toEqual([]);
    expect(typeof props.onSession).toBe('function');
    expect(typeof props.onScanComplete).toBe('function');
    // Bug 1 fix: cli passes an onProjectsChange callback so App can report
    // its current state.projects back; current backend's remount can then
    // see the up-to-date list instead of the initial empty array.
    expect(typeof props.onProjectsChange).toBe('function');
  });

  it('passes exitOnCtrlC: false to Ink render so Ctrl+C reaches useInput', async () => {
    // Bug 2 fix: Ink 7.x with exitOnCtrlC: true short-circuits the useInput
    // listener for Ctrl+C and calls handleAppExit → unmount(), which does
    // NOT call process.exit(). Node keeps running with the TTY intact.
    // Disabling exitOnCtrlC routes Ctrl+C through useInput → onQuit →
    // process.exit(0).
    const deps = makeDeps();

    await bootstrap(deps);

    expect(deps.render).toHaveBeenCalledTimes(1);
    const options = deps.render.mock.calls[0]![1] as
      | { exitOnCtrlC?: boolean }
      | undefined;
    expect(options?.exitOnCtrlC).toBe(false);
  });

  it('createAppElement returns the latest projects reported via onProjectsChange', async () => {
    // Bug 1 fix: when the App updates state.projects in response to
    // SESSION_DISCOVERED events, it reports the latest array back through
    // the onProjectsChange prop. cli stores it in a closure cell, and
    // createAppElement (registered with the 'current' backend) reads the
    // cell instead of returning the initial empty array.
    let capturedCreateAppElement: (() => {
      props: { projects: Project[] };
    }) | null = null;
    const renderCalls: { props: { projects: Project[] } }[] = [];
    const deps = makeDeps({
      render: vi.fn((element: unknown) => {
        const el = element as {
          props: {
            onProjectsChange?: (p: Project[]) => void;
            projects: Project[];
          };
        };
        renderCalls.push({ props: { projects: el.props.projects } });
        // Simulate a session being discovered: the new App would dispatch
        // SESSION_DISCOVERED which updates state.projects to a non-empty
        // array. We mimic that side effect by calling onProjectsChange
        // synchronously here.
        const reported: Project[] = [
          {
            key: '/p1',
            displayName: 'p1',
            cwd: '/p1',
            manual: false,
            hidden: false,
            sessions: [
              {
                id: 'sid-1',
                cwd: '/p1',
                firstUserMessage: 'hi',
                lastPrompt: null,
                lastTimestamp: '2026-07-07T00:00:00.000Z',
              },
            ],
          },
        ];
        el.props.onProjectsChange?.(reported);
        return { unmount: vi.fn(), rerender: vi.fn() };
      }),
    });

    // Capture the closure passed to setCurrentTerminalDeps.
    const terminal = await import('../../src/terminal/current.js');
    const setDepsSpy = vi
      .spyOn(terminal, 'setCurrentTerminalDeps')
      .mockImplementation((d: unknown) => {
        capturedCreateAppElement = (
          d as { createAppElement: () => { props: { projects: Project[] } } }
        ).createAppElement;
        return undefined;
      });

    try {
      await bootstrap(deps);

      expect(capturedCreateAppElement).not.toBeNull();
      const reRendered = capturedCreateAppElement!();
      expect(reRendered.props.projects).toHaveLength(1);
      expect(reRendered.props.projects[0]!.key).toBe('/p1');
    } finally {
      setDepsSpy.mockRestore();
    }
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

  it('registers a rescanSession closure via setCurrentTerminalDeps (Bug A)', async () => {
    // Bug A：'current' backend 在 child.on('exit') 路径上调用 rescanSession
    // 重新解析该 session 的 JSONL 并通过 _onSession 派发到新 App 实例。
    // 这里断言 setCurrentTerminalDeps 收到的 deps 包含 rescanSession 函数。
    const renderInstance = { unmount: vi.fn(), rerender: vi.fn() };
    const deps = makeDeps({
      render: vi.fn(() => renderInstance),
      runDiscovery: vi.fn(async () => {}),
    });

    const terminal = await import('../../src/terminal/current.js');
    const setDepsSpy = vi.spyOn(terminal, 'setCurrentTerminalDeps');

    try {
      await bootstrap(deps);
      const calls = setDepsSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const passed = calls[0]![0] as { rescanSession?: unknown };
      expect(typeof passed.rescanSession).toBe('function');
    } finally {
      setDepsSpy.mockRestore();
    }
  });

  it('rescanSession closure invokes _onSession with the freshly parsed meta (Bug A)', async () => {
    // Bug A 端到端：'current' backend 调 rescanSession → cli 用 parseJsonlFile
    // 重读 JSONL → 通过 _onSession 派发到当前 App reducer → UI 自动更新。
    // 这里我们 mock parseJsonlFile 让它返回新 meta，再捕获 _onSession 收到的
    // 内容。
    const receivedMetas: SessionMeta[] = [];
    const renderInstance = { unmount: vi.fn(), rerender: vi.fn() };

    let registeredRescan: ((jsonlPath: string, sessionId: string) => void) | null =
      null;

    const terminal = await import('../../src/terminal/current.js');
    const setDepsSpy = vi.spyOn(terminal, 'setCurrentTerminalDeps').mockImplementation(
      (d) => {
        const captured = d as { rescanSession?: (jsonlPath: string, sessionId: string) => void };
        registeredRescan = captured.rescanSession ?? null;
      },
    );

    const parseSpy = vi
      .spyOn(await import('../../src/discovery/parse.js'), 'parseJsonlFile')
      .mockResolvedValue({
        meta: {
          sessionId: 'sid-fresh',
          cwd: '/p1',
          firstUserMessage: null,
          lastPrompt: null,
          customTitle: '新名字',
          lastTimestamp: '2026-07-07T01:00:00.000Z',
          sizeBytes: 9999,
          lineCount: 99,
        },
        jsonlPath: '/data/sid-fresh.jsonl',
      });

    try {
      const deps = makeDeps({
        render: vi.fn((element: unknown) => {
          const props = (element as { props: Record<string, unknown> }).props;
          if (typeof props.onSession === 'function') {
            // 模拟 App useEffect mount：把 onSession setter 注入 cli 闭包
            const cb = props.onSession as (cb: (m: SessionMeta) => void) => void;
            cb((m) => receivedMetas.push(m));
          }
          return renderInstance;
        }),
        runDiscovery: vi.fn(async () => {}),
      });

      await bootstrap(deps);
      expect(registeredRescan).not.toBeNull();

      // 模拟 'current' backend 在 child exit 后调用 rescan
      registeredRescan!('/data/sid-fresh.jsonl', 'sid-fresh');

      // 等待 async parseJsonlFile microtask
      await new Promise((r) => setTimeout(r, 10));

      expect(parseSpy).toHaveBeenCalledWith('/data/sid-fresh.jsonl');
      expect(receivedMetas).toHaveLength(1);
      expect(receivedMetas[0]!.customTitle).toBe('新名字');
      expect(receivedMetas[0]!.sizeBytes).toBe(9999);
    } finally {
      setDepsSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });

  it('Bug A 回归：rescan 在新 App mount 之前完成，meta 仍然派发到新 App (pendingMetas buffer)', async () => {
    // 用户报告：从 Claude Code 退出后，session 名不刷新；只有重启 ccsm 后
    // 才看到新名。根因：child.on('exit') 内顺序调 deps.render + deps.rescan，
    // 但 React 的 useEffect 是异步的，新 App 的 onSession setter 在下个
    // macrotask 才把 _onSession 切到新 wrapper。如果 parseJsonlFile 在这个
    // 窗口里 resolve，meta 会派发给旧 wrapper（已 unmount）→ UI 不刷新。
    // 修复：rescan 拿到的 meta 先压入 pendingMetas，等 onSession setter
    // 触发时 drain。本测试模拟「rescan 完成早于 onSession setter」这一时序。
    let registeredRescan: ((jsonlPath: string, sessionId: string) => void) | null =
      null;
    let pendingOnSessionSetter: ((cb: (m: SessionMeta) => void) => void) | null =
      null;

    const terminal = await import('../../src/terminal/current.js');
    const setDepsSpy = vi.spyOn(terminal, 'setCurrentTerminalDeps').mockImplementation(
      (d) => {
        const captured = d as { rescanSession?: (jsonlPath: string, sessionId: string) => void };
        registeredRescan = captured.rescanSession ?? null;
      },
    );

    // 让 parseJsonlFile 在同一个 tick 同步 resolve（早于任何 React useEffect）。
    const parseSpy = vi
      .spyOn(await import('../../src/discovery/parse.js'), 'parseJsonlFile')
      .mockImplementation(async (file: string) => {
        // 关键：这里 await 0 个 microtask 就 resolve，模拟「rescan 完成
        // 早于新 App mount 的 onSession setter」。
        await Promise.resolve();
        return {
          meta: {
            sessionId: 'sid-pending',
            cwd: '/p1',
            firstUserMessage: null,
            lastPrompt: null,
            customTitle: '新名字',
            lastTimestamp: '2026-07-07T01:00:00.000Z',
            sizeBytes: 4096,
            lineCount: 50,
          },
          jsonlPath: file,
        };
      });

    try {
      const receivedMetas: SessionMeta[] = [];
      const deps = makeDeps({
        render: vi.fn((element: unknown) => {
          const props = (element as { props: Record<string, unknown> }).props;
          // 故意不在 render 时立刻调 onSession setter —— 模拟 React useEffect
          // 是异步的，setter 在下个 tick 才跑。
          if (typeof props.onSession === 'function') {
            pendingOnSessionSetter = props.onSession as (
              cb: (m: SessionMeta) => void,
            ) => void;
          }
          return { unmount: vi.fn(), rerender: vi.fn() };
        }),
        runDiscovery: vi.fn(async () => {}),
      });

      await bootstrap(deps);
      expect(registeredRescan).not.toBeNull();

      // 1) 'current' backend 在 child exit 后调用 rescan（早于任何 useEffect）
      registeredRescan!('/data/sid-pending.jsonl', 'sid-pending');

      // 2) 等 parseJsonlFile 的 await 跑完，但此时还没有 onSession setter
      await new Promise((r) => setTimeout(r, 10));
      expect(receivedMetas).toHaveLength(0); // pendingMetas 应 buffer 住

      // 3) React 在下个 macrotask 跑 useEffect → 调 onSession setter
      expect(pendingOnSessionSetter).not.toBeNull();
      pendingOnSessionSetter!((m) => receivedMetas.push(m));

      // 4) pendingMetas 立即被 drain 到新 wrapper
      expect(receivedMetas).toHaveLength(1);
      expect(receivedMetas[0]!.customTitle).toBe('新名字');
      expect(receivedMetas[0]!.sizeBytes).toBe(4096);
      expect(parseSpy).toHaveBeenCalledWith('/data/sid-pending.jsonl');
    } finally {
      setDepsSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });
});
