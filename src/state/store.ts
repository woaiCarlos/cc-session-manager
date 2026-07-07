import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppState, DEFAULT_STATE } from './types.js';

function resolveConfigDir(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'cc-manager'
  );
}

function resolveStatePath(): string {
  return path.join(resolveConfigDir(), 'state.json');
}

export const CONFIG_DIR: string = resolveConfigDir();
export const STATE_PATH: string = resolveStatePath();

let cache: AppState | null = null;

export async function resetForTest(): Promise<void> {
  // 供测试重置模块级缓存
  cache = null;
}

export async function loadState(): Promise<AppState> {
  if (cache) return cache;
  const configDir = resolveConfigDir();
  const statePath = resolveStatePath();
  await fs.mkdir(configDir, { recursive: true });
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    cache = { ...DEFAULT_STATE, ...parsed };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = { ...DEFAULT_STATE };
    } else {
      // JSON 损坏：备份 + 使用默认
      const backup = `state.json.bak.${Date.now()}`;
      try {
        await fs.rename(statePath, path.join(configDir, backup));
      } catch {
        /* 文件可能不存在 */
      }
      cache = { ...DEFAULT_STATE };
    }
  }
  return cache;
}

export async function saveState(state: AppState): Promise<void> {
  // Bug 4c：使用 fs.*Sync 同步落盘而不是 fs.promises 的异步版本。
  // renameSession / setAlias 调用 saveState 后，async fs.writeFile +
  // fs.rename 是 libuv 内核队列里未完成的工作；若用户在按 Enter 后
  // 立刻 Ctrl+C 或关闭窗口，cli.tsx 的 handleSignal 会同步调
  // process.exit(0)，未完成的写入被丢弃。
  //
  // 改用同步 API 后，writeFileSync + renameSync 在 saveState 内部同步
  // 完成；resolve 后数据已经在内核 buffer，进程被 SIGKILL 也已持久化。
  // API 兼容：仍返回 Promise<void>，await 立即 fulfilled。
  const configDir = resolveConfigDir();
  const statePath = resolveStatePath();
  fsSync.mkdirSync(configDir, { recursive: true });
  const tmp = `${statePath}.tmp.${process.pid}.${Date.now()}`;
  fsSync.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fsSync.renameSync(tmp, statePath);
  cache = state;
}

/**
 * 返回当前生效的 session root 目录：
 * - 优先返回 `state.sessionRoot`（用户在设置中显式配置的覆盖值）
 * - 否则回退到 `detect()`（由 task 3.1 实现的探测函数）
 *
 * `detect` 作为参数注入，避免本模块依赖 task 3.1；同时允许测试直接 mock。
 */
export async function getSessionRoot(
  detect: () => Promise<string | null>
): Promise<string | null> {
  const state = await loadState();
  return state.sessionRoot ?? (await detect());
}

export async function getAlias(
  type: 'session' | 'project',
  key: string
): Promise<string | undefined> {
  const state = await loadState();
  const map = type === 'session' ? state.sessionAliases : state.projectAliases;
  return map[key];
}

export async function setAlias(
  type: 'session' | 'project',
  key: string,
  value: string
): Promise<void> {
  const state = await loadState();
  const next: AppState =
    type === 'session'
      ? { ...state, sessionAliases: { ...state.sessionAliases, [key]: value } }
      : { ...state, projectAliases: { ...state.projectAliases, [key]: value } };
  await saveState(next);
}