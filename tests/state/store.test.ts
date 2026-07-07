import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STATE } from '../../src/state/types.js';
import type {
  loadState as LoadStateFn,
  saveState as SaveStateFn,
  resetForTest as ResetForTestFn,
  getSessionRoot as GetSessionRootFn,
  getAlias as GetAliasFn,
  setAlias as SetAliasFn,
  STATE_PATH as StatePathConst,
} from '../../src/state/store.js';

type StoreModule = {
  loadState: typeof LoadStateFn;
  saveState: typeof SaveStateFn;
  resetForTest: typeof ResetForTestFn;
  getSessionRoot: typeof GetSessionRootFn;
  getAlias: typeof GetAliasFn;
  setAlias: typeof SetAliasFn;
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

  it('getAlias returns undefined for missing key (Task 2.6)', async () => {
    expect(await store.getAlias('session', 'nope')).toBeUndefined();
    expect(await store.getAlias('project', '/missing/path')).toBeUndefined();
  });

  it('setAlias/getAlias stores and reads back session alias (Task 2.6)', async () => {
    await store.setAlias('session', 'abc-123', 'My login bug');
    expect(await store.getAlias('session', 'abc-123')).toBe('My login bug');
    // 同步落盘
    await store.resetForTest();
    expect(await store.getAlias('session', 'abc-123')).toBe('My login bug');
  });

  it('setAlias/getAlias stores project alias keyed by group key (Task 2.6)', async () => {
    await store.setAlias('project', '/Users/carlos/foo', 'Foo project');
    expect(await store.getAlias('project', '/Users/carlos/foo')).toBe('Foo project');
  });

  // Bug 4c：saveState 必须同步落盘，保证用户在 App.tsx 的 onSubmit 里
  // 触发 setAlias 之后立刻 Ctrl+C（process.exit 同步执行）也不会丢失
  // 写入。如果 saveState 是 async（fs.writeFile + fs.rename 未 await），
  // 进程退出时 write/rename 仍在 libuv 队列里、未真正写到磁盘；
  // 下次启动读到的就是旧（或空）state.json，列表渲染旧名。
  it('Bug 4c: saveState writes to disk synchronously — file exists before saveState resolves', async () => {
    expect(existsSync(store.STATE_PATH)).toBe(false);

    // 发起 saveState，让 microtask 跑一圈；调用返回前同步写盘应当已发生
    const promise = store.saveState({
      ...DEFAULT_STATE,
      sessionAliases: { 'sync-test': '同步落盘名' },
    });

    // microtask 后立刻验盘（同步版应已落盘；async 版会失败 —— 文件尚不存在）
    await Promise.resolve();
    expect(existsSync(store.STATE_PATH)).toBe(true);

    await promise; // 仍满足 Promise contract
    const content = await fs.readFile(store.STATE_PATH, 'utf8');
    expect(content).toContain('"sync-test"');
    expect(content).toContain('"同步落盘名"');
  });

  // Bug 4c：setAlias（被 renameSession 调用）写完 disk 后立即模拟「quit
  // + 重启」，从新进程实例 loadState 必须能读到 alias
  it('Bug 4c: setAlias + immediate quit simulation — re-imported store reads the alias', async () => {
    // 1) 在本测试的 store 实例上调用 setAlias（内部同步落盘）
    await store.setAlias('session', 'quit-survive', '飞牛内网穿透');

    // 2) 不在 await 任何进一步工作 —— 模拟 ccsm 进程立刻被 SIGKILL
    // 3) 新进程的 store 模块（reset cache）从磁盘重新加载
    vi.resetModules();
    const freshStore = (await import('../../src/state/store.js')) as unknown as StoreModule;
    await freshStore.resetForTest();
    expect(await freshStore.getAlias('session', 'quit-survive')).toBe('飞牛内网穿透');
  });
});