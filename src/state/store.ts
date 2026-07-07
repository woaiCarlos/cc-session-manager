import { promises as fs } from 'node:fs';
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
  const configDir = resolveConfigDir();
  const statePath = resolveStatePath();
  await fs.mkdir(configDir, { recursive: true });
  const tmp = `${statePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, statePath);
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