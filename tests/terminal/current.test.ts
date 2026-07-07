import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';

// Mock child_process.spawn BEFORE importing the module under test so the
// module captures the mock. We need to control when 'exit' fires so we
// can assert the rescanSession side-effect ordering.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { setCurrentTerminalDeps, current } from '../../src/terminal/current.js';

interface MockChild extends EventEmitter {
  on: (event: string, cb: (...args: unknown[]) => void) => MockChild;
}

function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  // EventEmitter already implements on(); cast for readability in tests.
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  // Default: child emits 'exit' with code 0 immediately. Individual tests
  // can override to drive timing of the rescan callback.
  spawnMock.mockImplementation(() => {
    const child = makeChild();
    setImmediate(() => child.emit('exit', 0));
    return child;
  });

  // Default deps: render is a no-op, createAppElement returns a placeholder.
  setCurrentTerminalDeps({
    unmount: () => {},
    createAppElement: (): ReactElement =>
      ({ type: 'div', props: {} } as unknown as ReactElement),
    render: (_el: ReactElement) => ({
      rerender: () => {},
      unmount: () => {},
    }),
  });
});

describe("current backend — Bug A rescanSession on child exit", () => {
  it('calls rescanSession with (jsonlPath, sessionId) after the child exits', async () => {
    const rescanSession = vi.fn();
    setCurrentTerminalDeps({
      unmount: () => {},
      createAppElement: (): ReactElement =>
        ({ type: 'div', props: {} } as unknown as ReactElement),
      render: (_el: ReactElement) => ({
        rerender: () => {},
        unmount: () => {},
      }),
      rescanSession,
    });

    const p = current({
      cwd: '/Users/alice/work',
      command: 'claude --resume sid-1',
      sessionId: 'sid-1',
      jsonlPath: '/data/sid-1.jsonl',
    });
    await p;

    expect(rescanSession).toHaveBeenCalledTimes(1);
    expect(rescanSession).toHaveBeenCalledWith('/data/sid-1.jsonl', 'sid-1');
  });

  it('does NOT call rescanSession when jsonlPath / sessionId are missing', async () => {
    const rescanSession = vi.fn();
    setCurrentTerminalDeps({
      unmount: () => {},
      createAppElement: (): ReactElement =>
        ({ type: 'div', props: {} } as unknown as ReactElement),
      render: (_el: ReactElement) => ({
        rerender: () => {},
        unmount: () => {},
      }),
      rescanSession,
    });

    // OpenRequest without session context — e.g. manual `claude` from `n` key.
    const p = current({
      cwd: '/Users/alice/work',
      command: 'claude',
    });
    await p;

    expect(rescanSession).not.toHaveBeenCalled();
  });

  it('does NOT throw when rescanSession is not registered (deps optional)', async () => {
    // 注册无 rescanSession 的 deps —— 验证 current.ts 在 deps.rescanSession
    // 为 undefined 时不抛错（向后兼容 + 测试环境友好）。
    setCurrentTerminalDeps({
      unmount: () => {},
      createAppElement: (): ReactElement =>
        ({ type: 'div', props: {} } as unknown as ReactElement),
      render: (_el: ReactElement) => ({
        rerender: () => {},
        unmount: () => {},
      }),
      // rescanSession omitted on purpose
    });

    const p = current({
      cwd: '/Users/alice/work',
      command: 'claude --resume sid-1',
      sessionId: 'sid-1',
      jsonlPath: '/data/sid-1.jsonl',
    });
    await expect(p).resolves.toBeUndefined();
  });

  it('still resolves when the child exits with non-zero code', async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      setImmediate(() => child.emit('exit', 1));
      return child;
    });
    const rescanSession = vi.fn();
    setCurrentTerminalDeps({
      unmount: () => {},
      createAppElement: (): ReactElement =>
        ({ type: 'div', props: {} } as unknown as ReactElement),
      render: (_el: ReactElement) => ({
        rerender: () => {},
        unmount: () => {},
      }),
      rescanSession,
    });

    await expect(
      current({
        cwd: '/tmp',
        command: 'false',
        sessionId: 'sid-1',
        jsonlPath: '/data/sid-1.jsonl',
      }),
    ).rejects.toThrow(/exited with code/);

    // rescanSession 仍然被调用 —— Bug A 的刷新语义不依赖于 claude 退出码
    expect(rescanSession).toHaveBeenCalledTimes(1);
  });

  it('calls render then rescanSession on child exit (ordering for Bug A reducer freshness)', async () => {
    // Bug A 关键时序：必须先 render 新 App（让新 useEffect 注册 _onSession
    // 监听），再 rescanSession（把新 meta 派发到新 App）。如果反过来，
    // meta 会派发到旧 App（已卸），reducer 收不到 —— UI 不刷新。
    const order: string[] = [];
    setCurrentTerminalDeps({
      unmount: () => {
        order.push('unmount');
      },
      createAppElement: (): ReactElement => {
        order.push('createAppElement');
        return { type: 'div', props: {} } as unknown as ReactElement;
      },
      render: (_el: ReactElement) => {
        order.push('render');
        return { rerender: () => {}, unmount: () => {} };
      },
      rescanSession: (_jsonlPath: string, sessionId: string) => {
        order.push(`rescanSession:${sessionId}`);
      },
    });

    await current({
      cwd: '/Users/alice/work',
      command: 'claude --resume sid-77',
      sessionId: 'sid-77',
      jsonlPath: '/data/sid-77.jsonl',
    });

    // unmount → render(createAppElement) → rescanSession
    expect(order).toEqual([
      'unmount',
      'createAppElement',
      'render',
      'rescanSession:sid-77',
    ]);
  });
});