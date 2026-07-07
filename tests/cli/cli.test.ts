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

  it('rerenders with a new projects array when discovery groups change', async () => {
    const discoveredProject: Project = {
      key: '/p1',
      displayName: 'p1',
      cwd: '/p1',
      manual: false,
      hidden: false,
      sessions: [
        {
          id: 's1',
          displayName: 's1',
          cwd: '/p1',
          lastActiveRelative: '2026-01-01T00:00:00Z',
          lastTimestamp: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const renderInstance = {
      unmount: vi.fn(),
      rerender: vi.fn(),
    };
    const deps = makeDeps({
      render: vi.fn(() => renderInstance),
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
      groupSessions: vi.fn(() => [discoveredProject]),
    });

    await bootstrap(deps);

    const initialElement = deps.render.mock.calls[0]![0] as {
      props: { projects: Project[] };
    };
    const rerenderedElement = renderInstance.rerender.mock.calls[0]![0] as {
      props: { projects: Project[] };
    };
    expect(renderInstance.rerender).toHaveBeenCalledTimes(1);
    expect(rerenderedElement.props.projects).toEqual([discoveredProject]);
    expect(rerenderedElement.props.projects).not.toBe(
      initialElement.props.projects,
    );
    expect(initialElement.props.projects).toEqual([]);
  });

  it('fires groupSessions via the runDiscovery onMeta callback', async () => {
    const deps = makeDeps({
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
      groupSessions: vi.fn(
        (metas: SessionMeta[], _state: AppState): Project[] => [
          {
            key: '/p1',
            displayName: 'p1',
            cwd: '/p1',
            manual: false,
            hidden: false,
            sessions: metas.map((m) => ({
              id: m.sessionId,
              displayName: m.sessionId,
              cwd: m.cwd,
              lastActiveRelative: m.lastTimestamp,
              lastTimestamp: m.lastTimestamp,
            })),
          },
        ],
      ),
    });

    await bootstrap(deps);

    expect(deps.groupSessions).toHaveBeenCalled();
    // groupSessions is called at least once with the cumulative metas list.
    const cumulative = (deps.groupSessions.mock.calls[0]![0] as SessionMeta[]).length;
    expect(cumulative).toBeGreaterThanOrEqual(2);
  });
});
