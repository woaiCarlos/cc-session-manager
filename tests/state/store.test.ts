import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STATE } from '../../src/state/types.js';
import type {
  loadState as LoadStateFn,
  saveState as SaveStateFn,
  resetForTest as ResetForTestFn,
  getSessionRoot as GetSessionRootFn,
  STATE_PATH as StatePathConst,
} from '../../src/state/store.js';

type StoreModule = {
  loadState: typeof LoadStateFn;
  saveState: typeof SaveStateFn;
  resetForTest: typeof ResetForTestFn;
  getSessionRoot: typeof GetSessionRootFn;
  STATE_PATH: typeof StatePathConst;
};

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let store: StoreModule;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-store-'));
  originalEnv = { ...process.env };
  process.env.HOME = tmpDir;
  process.env.XDG_CONFIG_HOME = path.join(tmpDir, '.config');
  // Re-import store module so CONFIG_DIR/STATE_PATH resolve against
  // the test-controlled env vars (module-level consts capture env at load time).
  vi.resetModules();
  store = (await import('../../src/state/store.js')) as unknown as StoreModule;
  await store.resetForTest();
});

afterEach(async () => {
  process.env = originalEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('store', () => {
  it('returns defaults when no state file exists', async () => {
    const state = await store.loadState();
    expect(state).toEqual(DEFAULT_STATE);
  });

  it('writes and reads back state atomically', async () => {
    await store.saveState({ ...DEFAULT_STATE, terminal: 'iterm2' });
    const state = await store.loadState();
    expect(state.terminal).toBe('iterm2');
    // 不应残留 .tmp 文件
    const files = await fs.readdir(path.dirname(store.STATE_PATH));
    expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  it('merges defaults when fields are missing (Task 2.4)', async () => {
    await fs.mkdir(path.dirname(store.STATE_PATH), { recursive: true });
    await fs.writeFile(store.STATE_PATH, JSON.stringify({ terminal: 'warp' }));
    await store.resetForTest();
    const state = await store.loadState();
    expect(state.terminal).toBe('warp');
    expect(state.sessionAliases).toEqual({});
    expect(state.manualProjects).toEqual([]);
    expect(state.hiddenProjects).toEqual([]);
  });

  it('backs up corrupt state.json and falls back to defaults (Task 2.3)', async () => {
    // 1. 准备：模拟上次进程留下的损坏文件（config 目录 + state.json 已存在）
    await fs.mkdir(path.dirname(store.STATE_PATH), { recursive: true });
    const corruptPayload = '{ this is :: not valid json, "terminal": ';
    await fs.writeFile(store.STATE_PATH, corruptPayload, 'utf8');
    expect(await fs.readdir(path.dirname(store.STATE_PATH))).toContain('state.json');

    // 2. 执行：本进程首次 loadState（cache 为 null），必须捕获 JSON 解析错误
    const state = await store.loadState();
    expect(state).toEqual(DEFAULT_STATE);

    // 3. 验证：原 state.json 必须被重命名为 state.json.bak.<timestamp>
    const configDir = path.dirname(store.STATE_PATH);
    const filesAfter = await fs.readdir(configDir);
    expect(filesAfter).not.toContain('state.json');
    const backups = filesAfter.filter((f) => f.startsWith('state.json.bak.'));
    expect(backups).toHaveLength(1);
    // 备份内容必须是导致解析失败的原始字节
    const backupContent = await fs.readFile(path.join(configDir, backups[0]!), 'utf8');
    expect(backupContent).toBe(corruptPayload);

    // 4. 验证：loadState 之后进程能以默认值继续工作（写新值 → 读回）
    await store.saveState({ ...DEFAULT_STATE, terminal: 'warp' });
    const reloaded = await store.loadState();
    expect(reloaded.terminal).toBe('warp');
  });

  it('getSessionRoot returns override from state when set (Task 2.5)', async () => {
    await store.saveState({ ...DEFAULT_STATE, sessionRoot: '/custom/path' });
    const root = await store.getSessionRoot(async () => '/auto/path');
    expect(root).toBe('/custom/path');
  });

  it('getSessionRoot falls back to detector when no override (Task 2.5)', async () => {
    await store.saveState({ ...DEFAULT_STATE });
    const root = await store.getSessionRoot(async () => '/auto/path');
    expect(root).toBe('/auto/path');
  });

  it('getSessionRoot falls back when detector returns null (Task 2.5)', async () => {
    await store.saveState({ ...DEFAULT_STATE });
    const root = await store.getSessionRoot(async () => null);
    expect(root).toBeNull();
  });
});