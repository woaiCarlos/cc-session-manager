// 注意：shebang 由 tsup banner (tsup.config.ts) 在 bundle 后注入；源文件不重复声明
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import React, { type ReactElement } from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { loadState } from './state/store.js';
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { groupSessions } from './grouping/group.js';
import { tryAcquire, release } from './state/lock.js';
import { setCurrentTerminalDeps } from './terminal/current.js';
import type { AppState, Project, SessionMeta } from './state/types.js';

/**
 * Optional dependency overrides for `bootstrap`. When a field is omitted,
 * the real module-level import is used. Tests pass spies/stubs here to
 * exercise the integration entry point without touching the real fs /
 * spawning a renderer.
 */
export interface BootstrapDeps {
  tryAcquire: typeof tryAcquire;
  release: typeof release;
  loadState: typeof loadState;
  detectRoot: typeof detectRoot;
  runDiscovery: typeof runDiscovery;
  groupSessions: typeof groupSessions;
  /**
   * Ink render. 第二参数允许传入 `exitOnCtrlC: false` 等 Ink 选项，
   * 用于禁用 Ink 默认 Ctrl+C 短路（避免 Ink 7.x 在 Ctrl+C 时只 unmount
   * 而不调 process.exit 导致 Node 残留）。可选，向后兼容。
   */
  render: (
    el: React.ReactElement,
    options?: { exitOnCtrlC?: boolean },
  ) => ReturnType<typeof render>;
  /**
   * Process-exit hook. Default = `process.exit`. Override in tests to
   * capture the requested code without actually terminating the runner
   * (vitest wraps `process.exit` and reports unhandled rejections).
   */
  exit: (code: number) => void;
  /**
   * stderr-write hook. Default = `process.stderr.write.bind(...)`. Override
   * in tests to capture the takeover prompt without polluting runner output.
   */
  stderrWrite: (chunk: string) => boolean | void;
}

export const DEFAULT_BOOTSTRAP_DEPS: BootstrapDeps = {
  tryAcquire,
  release,
  loadState,
  detectRoot,
  runDiscovery,
  groupSessions,
  render,
  exit: (code: number) => process.exit(code),
  stderrWrite: (chunk: string) => process.stderr.write(chunk),
};

/**
 * End-to-end bootstrap sequence (Task 9.1):
 *   1. Acquire the process-level lock via `tryAcquire`.
 *      On `'taken'`, write the takeover prompt to stderr and `process.exit(1)`.
 *      On `'acquired'` / `'stale'`, proceed.
 *   2. Load persisted state from `~/.config/cc-manager/state.json`.
 *   3. Detect the session root; prefer `state.sessionRoot` when set.
 *   4. Kick off `runDiscovery(root, onMeta)` in the background — UI is
 *      rendered before the scan completes so first paint is never blocked.
 *   5. Render the Ink App with `bootstrapState` and an initially-empty
 *      `projects` array; the App's own reducer will pick up future
 *      SESSION_DISCOVERED dispatches.
 */
export async function bootstrap(
  deps: Partial<BootstrapDeps> = {},
): Promise<void> {
  const d: BootstrapDeps = { ...DEFAULT_BOOTSTRAP_DEPS, ...deps };
  const {
    tryAcquire: _tryAcquire,
    release: _release,
    loadState: _loadState,
    detectRoot: _detectRoot,
    runDiscovery: _runDiscovery,
    groupSessions: _groupSessions,
    render: _render,
    exit: _exit,
    stderrWrite: _stderrWrite,
  } = d;

  const lockResult = await _tryAcquire();
  if (lockResult === 'taken') {
    // 用户选择接管不在冒烟里处理；显示提示并退出
    _stderrWrite('Another ccsm instance is running.\n');
    _exit(1);
  }

  const appState: AppState = await _loadState();
  const detected = await _detectRoot();
  const root = appState.sessionRoot ?? detected;

  // 临时路径，无可用根则返回。`latestProjects` 是为修复 Bug 1 引入的闭包
  // 单元：App 通过 `onProjectsChange` 上报它最新的 `state.projects`，cli
  // 把最新引用写回这里；'current' backend 的 `createAppElement` 直接读取
  // 该引用，从而在 Ink remount 后立刻呈现完整项目/Session 列表，
  // 不再被困在首次 render 的空数组里。
  let projects: Project[] = [];
  let latestProjects: Project[] = [];
  let renderInstance: ReturnType<BootstrapDeps['render']> | null = null;

  // App 内部的 onSession / onScanComplete setter — 在 App mount 时绑定。
  // _onSession 由 App 通过 onSession prop 注入；onMeta 转发给它。
  // _onScanComplete 同理。这样 React state 路径成为唯一渲染通道，
  // 避免 630 session × 2 render 的 flicker。
  let _onSession: (meta: SessionMeta) => void = () => {};
  let _onScanComplete: () => void = () => {};

  const createAppElement = (nextProjects: Project[]): ReactElement =>
    React.createElement(App, {
      bootstrapState: appState,
      projects: nextProjects,
      onSession: (cb: (meta: SessionMeta) => void) => {
        _onSession = cb;
      },
      onScanComplete: (cb: () => void) => {
        _onScanComplete = cb;
      },
      onProjectsChange: (next: Project[]) => {
        latestProjects = next;
      },
    });

  // 1) App 的 onSession callback 接收 SESSION_DISCOVERED 派发到 React reducer
  // 2) onScanComplete 派发 SCAN_COMPLETE
  // 注：之前 onMeta 手动 rerender + useEffect SET_PROJECTS 导致 2 次 render，
  // 在 630 sessions 时引发屏幕闪烁。修复后只走 React state 一条路径。

  const onMeta = (meta: SessionMeta): void => {
    _onSession(meta);
  };

  // Bug 2 修复：明确传 `exitOnCtrlC: false` 给 Ink。Ink 7.x 默认会短路掉
  // user `useInput` 对 Ctrl+C 的处理，转而调用 `handleAppExit → unmount`，
  // 但 unmount 不会触发 `process.exit`，导致 Node 进程残留。让 Ctrl+C
  // 走完整 useInput → keyActionRouter → onQuit → process.exit(0)。
  renderInstance = _render(createAppElement(projects), { exitOnCtrlC: false });
  const { unmount } = renderInstance;

  // 'current' terminal backend 需要在用户按 Enter 触发 resume 时暂停 TUI
  // 并在原 terminal 跑 `claude --resume <id>`，退出后再恢复 Ink。把 render
  // 句柄注册给 current backend，cli 退出时清空。re-render 也带同样的
  // `exitOnCtrlC: false` 以保持行为一致。
  setCurrentTerminalDeps({
    unmount: () => unmount(),
    createAppElement: () => createAppElement(latestProjects),
    render: (el) => {
      const r = _render(el, { exitOnCtrlC: false });
      return { rerender: r.rerender, unmount: r.unmount };
    },
  });

  // 启动扫描（不 await）—— UI 抢先渲染
  void (async (): Promise<void> => {
    if (!root) return;
    await _runDiscovery(root, onMeta);
    _onScanComplete();
  })();

  // SIGINT / SIGTERM 清理：必须 await release 才能保证 lock 文件被删
  const handleSignal = (sig: NodeJS.Signals): void => {
    void (async (): Promise<void> => {
      try {
        await _release();
      } catch {
        /* 释放失败不影响退出 */
      }
      try {
        unmount();
      } catch {
        /* 卸载失败不影响退出 */
      }
      _exit(sig === 'SIGINT' ? 0 : 0);
    })();
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

// Auto-invoke only when this file is run as the main entry. In ESM we
// distinguish entry vs. import by resolving symlinks on argv[1] and
// comparing it to `import.meta.url`. The symlink resolution is required
// because npm-installed `bin` entries (e.g. /opt/homebrew/bin/ccsm →
// lib/node_modules/cc-session-manager/dist/cli.js) arrive as the symlink
// path in argv[1], not the real file. Tests import `bootstrap` directly
// and never trigger this branch.
async function detectEntry(): Promise<boolean> {
  if (process.argv[1] === undefined) return false;
  try {
    const realArgv = await realpath(process.argv[1]);
    const realModule = await realpath(fileURLToPath(import.meta.url));
    return realArgv === realModule;
  } catch {
    return false;
  }
}

void detectEntry().then((isEntry) => {
  if (isEntry) {
    void bootstrap();
  }
});

