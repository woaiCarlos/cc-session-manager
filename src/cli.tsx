// 注意：shebang 由 tsup banner (tsup.config.ts) 在 bundle 后注入；源文件不重复声明
import { fileURLToPath, pathToFileURL } from 'node:url';
import React, { type ReactElement } from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { loadState } from './state/store.js';
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { groupSessions } from './grouping/group.js';
import { tryAcquire, release } from './state/lock.js';
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
  render: typeof render;
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

  // 临时路径，无可用根则返回
  let projects: Project[] = [];
  const seenMetas: SessionMeta[] = [];
  let renderInstance: ReturnType<BootstrapDeps['render']> | null = null;

  const createAppElement = (nextProjects: Project[]): ReactElement =>
    React.createElement(App, {
      bootstrapState: appState,
      projects: nextProjects,
      onSession: (cb: (meta: SessionMeta) => void) => {
        // 在 onMeta 内部已经处理；这里 hook 仅用于记录通知
        void cb;
      },
      onScanComplete: () => {
        /* 占位 */
      },
    });

  const onMeta = (meta: SessionMeta): void => {
    seenMetas.push(meta);
    const grouped = _groupSessions(seenMetas, appState);
    grouped.sort((a, b) => {
      if (a.manual !== b.manual) return a.manual ? -1 : 1;
      const at = a.sessions[0]?.lastTimestamp ?? '';
      const bt = b.sessions[0]?.lastTimestamp ?? '';
      return bt.localeCompare(at);
    });
    const nextProjects: Project[] = [];
    nextProjects.push(...grouped);
    projects = nextProjects;
    renderInstance?.rerender(createAppElement(projects));
  };

  renderInstance = _render(createAppElement(projects));
  const { unmount } = renderInstance;

  // 启动扫描（不 await）—— UI 抢先渲染
  void (async (): Promise<void> => {
    if (!root) return;
    await _runDiscovery(root, onMeta);
  })();

  process.on('SIGINT', () => {
    unmount();
    void _release();
    _exit(0);
  });
}

// Auto-invoke only when this file is run as the main entry. In ESM we
// distinguish entry vs. import by comparing `import.meta.url` against the
// path passed to `node` / `tsx` / the tsup-bundled `dist/cli.js`. Tests
// import `bootstrap` directly and never trigger this branch.
const isEntry =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === fileURLToPath(import.meta.url);
if (isEntry) {
  void bootstrap();
}

