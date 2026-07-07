// 注意：shebang 由 tsup banner (tsup.config.ts) 在 bundle 后注入；源文件不重复声明
import { fileURLToPath } from 'node:url';
import { realpath, stat } from 'node:fs/promises';
import React, { type ReactElement } from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { loadState } from './state/store.js';
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { parseJsonlFile } from './discovery/parse.js';
import { groupSessions } from './grouping/group.js';
import { tryAcquire, release } from './state/lock.js';
import { setCurrentTerminalDeps } from './terminal/current.js';
import type { AppState, Project, SessionMeta } from './state/types.js';

/**
 * Poll a JSONL file's size until it has been stable for `stableMs` (default
 * 200ms) or until `maxWaitMs` elapses (default 2s). Returns silently in both
 * cases — the caller will read whatever the file contains at exit time.
 *
 * Bug A 二次回归：claude 在 child.on('exit') 触发时，async 写入 + 用户态
 * 缓冲可能尚未把最后几条 JSONL event 落盘。如果立刻 parse，rescan 看到
 * 旧内容，UI 不刷新。修复：等文件大小稳定 200ms 后再 parse，确保读到
 * 最终内容。最坏 2s 后超时（用户感知的「退出 → 刷新」延迟从 0 升到 ≤ 2s，
 * 可接受）。
 *
 * 边界：文件不存在（ENOENT）时立即返回（parseJsonlFile 自身会处理 null）。
 */
async function waitForFileStable(
  filePath: string,
  opts: { stableMs?: number; maxWaitMs?: number; pollMs?: number } = {},
): Promise<void> {
  const stableMs = opts.stableMs ?? 200;
  const maxWaitMs = opts.maxWaitMs ?? 2000;
  const pollMs = opts.pollMs ?? 100;
  // 文件不存在（首次 stat ENOENT）时立即返回 —— parseJsonlFile 自身会处理
  // null，rescan 后续自然 no-op。这条快路径也覆盖「用户手动 rm 了文件」
  // 的边缘场景。
  try {
    const initial = await stat(filePath);
    var initialSize = initial.size;
  } catch {
    return;
  }
  const start = Date.now();
  let lastSize: number = initialSize;
  let stableSince = Date.now();
  while (Date.now() - start < maxWaitMs) {
    let currentSize: number | null = null;
    try {
      const s = await stat(filePath);
      currentSize = s.size;
    } catch {
      // 文件被删除/替换中 —— 视为 size 不变，继续等待
      currentSize = lastSize;
    }
    if (currentSize === lastSize) {
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      stableSince = Date.now();
      lastSize = currentSize;
    }
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
}

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
  // NOOP_SESSION 是 _onSession 的初始哨兵；drainPendingMetas 用它检测
  // 「onSession 还没被新 App 注册」的状态，避免把 meta 派发给旧 wrapper。
  const NOOP_SESSION = (): void => {};
  let _onSession: (meta: SessionMeta) => void = NOOP_SESSION;
  let _onScanComplete: () => void = () => {};
  // Bug A 回归：rescanSession 派发的 meta 必须落到**新 App 实例**的 reducer。
  // 之前的实现假设 `child.on('exit')` 内先 render、后 rescanSession 的顺序
  // 就够了 —— 但 React 的 useEffect 是异步的，新 App 的 onSession setter
  // 要在下个 macrotask 才把 _onSession 切到新 wrapper。如果 parseJsonlFile
  // 在这个窗口里 resolve，就会把 meta 派发给旧 wrapper（已 unmount），
  // UI 不刷新。修复：把 rescan 拿到的 meta 先压入 pendingMetas，等 onSession
  // setter 触发时再 drain 到新 wrapper。
  const pendingMetas: SessionMeta[] = [];
  const drainPendingMetas = (): void => {
    if (_onSession === NOOP_SESSION) return;
    while (pendingMetas.length > 0) {
      const meta = pendingMetas.shift()!;
      _onSession(meta);
    }
  };
  // Bug 4d：cli 在 runDiscovery 完成后把 sessionId → jsonlPath 索引交给
  // App，rename modal onSubmit 用 jsonlIndex[sessionId] 定位 JSONL，
  // 把 custom-title 写回到 Claude Code 自己的 session 文件。
  let jsonlIndex: Record<string, string> = {};

  const createAppElement = (nextProjects: Project[]): ReactElement =>
    React.createElement(App, {
      bootstrapState: appState,
      projects: nextProjects,
      jsonlIndex,
      onSession: (cb: (meta: SessionMeta) => void) => {
        _onSession = cb;
        // 新 App mount 时把之前 buffered 的 meta 全部派发给它
        drainPendingMetas();
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
  //
  // Bug A：rescanSession 在 child.on('exit') 路径上调用，重新解析该
  // session 的 JSONL 并通过 _onSession 派发到当前（已 remount）的新 App
  // 实例。rescan 失败时 swallow + console.error，不抛回 current.ts。
  setCurrentTerminalDeps({
    unmount: () => unmount(),
    createAppElement: () => createAppElement(latestProjects),
    render: (el) => {
      const r = _render(el, { exitOnCtrlC: false });
      return { rerender: r.rerender, unmount: r.unmount };
    },
    rescanSession: (jsonlPath: string, sessionId: string) => {
      void (async (): Promise<void> => {
        try {
          // Bug A 二次回归：claude 的 /rename 在 child.on('exit') 触发时
          // 可能还没把 custom-title event 落盘（async 写入 + 缓冲）。如果
          // 立刻读，parseJsonlFile 看到的是旧内容。修复：轮询 file size，
          // 等它稳定 200ms 后再 parse。最长等 2s（典型 < 100ms 即可稳定）。
          await waitForFileStable(jsonlPath);
          const parsed = await parseJsonlFile(jsonlPath);
          if (parsed && parsed.meta.sessionId === sessionId) {
            // Bug A 回归修复：buffer 到 pendingMetas，等新 App 的
            // onSession setter 触发时再 drain。即使 parseJsonlFile 在
            // 新 App mount 之前 resolve，meta 也不会丢失。
            pendingMetas.push(parsed.meta);
            drainPendingMetas();
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[rescan] failed:', jsonlPath, err);
        }
      })();
    },
  });

  // 启动扫描（不 await）—— UI 抢先渲染
  void (async (): Promise<void> => {
    if (!root) return;
    jsonlIndex = await _runDiscovery(root, onMeta);
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

