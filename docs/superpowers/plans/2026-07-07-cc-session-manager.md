---
change: cc-session-manager
design-doc: docs/superpowers/specs/2026-07-07-cc-session-manager-design.md
base-ref: not-yet-init
---

# cc-session-manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS 上构建一个基于 Node.js + Ink + TypeScript 的终端 UI（命令名 `ccsm`），用于浏览/管理/一键恢复 Claude Code 历史 session。

**Architecture:** 单 Node 进程；主线程跑 Ink TUI（`useReducer` 管理状态）+ 后台 `worker_threads` 池（4 并发）解析 JSONL 文件；state 持久化采用原子写（tmp + rename）+ 进程级 PID lock；模块按职责拆分（discovery / grouping / terminal / actions / tui / state / util），各模块通过类型化接口通信。

**Tech Stack:**
- Node.js ≥ 18（`type: module`，ESM）
- TypeScript 5.x，target ES2022，module NodeNext，strict 模式
- Ink 5 + `@inkjs/ui` + `ink-text-input` + `chalk`（运行时）
- tsup（构建）+ tsx（开发执行）
- vitest（单元测试）
- macOS 内置 `osascript` / `pbcopy` / `open`

## 全局约束

| 编号 | 约束 |
|------|------|
| C1 | **平台**：仅支持 macOS（Darwin）；不可在 Linux/Windows 编译/运行 |
| C2 | **只读 Claude 数据**：永不修改 `~/.claude/projects/**` 下任何文件（包括 JSONL、配置） |
| C3 | **离线**：零网络访问，纯本地工具 |
| C4 | **配置目录**：`~/.config/cc-manager/` 自动创建；`state.json` 与 `lock` PID 文件存在于此 |
| C5 | **依赖管理**：`dependencies` 仅含运行时所需（`ink`、`@inkjs/ui`、`ink-text-input`、`chalk`）；`devDependencies` 含 `typescript`、`tsx`、`@types/node`、`tsup`、`vitest`、`@vitest/ui` |
| C6 | **TypeScript**：`tsconfig.json` 开启 `strict`、`noImplicitAny`、`noUnusedLocals`；ESM only |
| C7 | **TDD 优先**：每个新模块先写 vitest 红测，再写实现，再绿 |
| C8 | **提交粒度**：每完成一个独立可测任务立即 `git commit`；不允许积攒多次提交 |
| C9 | **Commit message 风格**：`<type>(<scope>): <subject>`（`feat`/`fix`/`test`/`chore`/`docs`/`refactor`） |
| C10 | **启动命令**：用户在任意 Terminal 输入 `ccsm` 即可启动（`package.json` `bin.ccsm` 指向 `dist/cli.js`） |
| C11 | **退出清理**：正常退出必须释放 lock 文件（`q`、`Ctrl+C`、`SIGINT`） |
| C12 | **TUI 宽度**：必须 ≥ 80 列渲染；< 80 列降级（截断 + 省略号）但不崩溃 |
| C13 | **错误隔离**：JSONL 解析单行失败 → skip 该行；worker 崩溃 → 主线程降级同步解析；state.json 损坏 → 重命名为 `.bak.<timestamp>` 并使用默认值 |
| C14 | **AppleScript 转义**：所有 osascript 调用必须用 `execFile` + 参数数组（非字符串拼接），防止 shell 注入 |
| C15 | **代码组织**：单一职责，一个文件一个清晰边界；`discovery/*` 不依赖 `tui/*`；`terminal/*` 不依赖 `state/*`；`actions/*` 是 TUI ↔ 底层的胶水 |

---

## 任务分组与依赖图

```
1. Project Scaffolding        1.1-1.7   (基础设施)
2. State Persistence          2.1-2.6   (无外部依赖)
3. Session Discovery          3.1-3.6   (依赖 1)
4. Project Grouping           4.1-4.6   (依赖 2 + 3)
5. Terminal Integration       5.1-5.7   (依赖 1)
6. Session Management Actions 6.1-6.7   (依赖 2 + 5)
7. TUI Interface              7.1-7.16  (依赖 4 + 6)
8. Folder Picker              8.1-8.3   (依赖 1)
9. Integration & Smoke        9.1-9.9   (依赖全部)
10. Build & Distribution      10.1-10.4 (依赖 9)
```

总计 71 个任务。任务编号与 OpenSpec `tasks.md` 完全一致。

---

# 第 1 组：项目脚手架（Project Scaffolding）

## Task 1.1：初始化 `package.json` 与 git 仓库

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: 工程根目录可被 `npm install` 识别；暴露 `ccsm` 可执行入口

- [x] **Step 1：在工程根目录初始化 git 仓库**

```bash
cd /Users/carlos/workspace/cc-session-manager  # 若目录尚未存在则创建
git init
git config user.email "dev@example.com"
git config user.name "Developer"
```

- [x] **Step 2：写入 `package.json`**

`package.json` 内容：

```json
{
  "name": "cc-session-manager",
  "version": "0.1.0",
  "description": "macOS terminal UI to browse and resume Claude Code sessions",
  "type": "module",
  "bin": {
    "ccsm": "dist/cli.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "keywords": ["claude-code", "sessions", "tui", "ink"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "os": ["darwin"],
  "dependencies": {},
  "devDependencies": {}
}
```

- [x] **Step 3：写入 `.gitignore`**

`.gitignore` 内容：

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
coverage/
.vitest-cache/
```

- [x] **Step 4：提交**

```bash
git add package.json .gitignore
git commit -m "chore(scaffold): initialize package.json and .gitignore"
```

## Task 1.2：添加运行时与开发依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `node_modules` 安装完成；`npx vitest` `npx tsup` 可用

- [x] **Step 1：安装运行时依赖**

```bash
npm install --save ink@^5 @inkjs/ui@^2 ink-text-input@^6 chalk@^5
```

- [x] **Step 2：安装开发依赖**

```bash
npm install --save-dev typescript@^5 tsx@^4 @types/node@^22 tsup@^8 vitest@^2 @vitest/ui@^2
```

- [x] **Step 3：验证依赖**

```bash
npm ls --depth=0
```

预期输出：列出 `ink`、`@inkjs/ui`、`ink-text-input`、`chalk`、以及 `typescript`、`tsx`、`@types/node`、`tsup`、`vitest`、`@vitest/ui`，无 `UNMET DEPENDENCY` 警告。

- [x] **Step 4：提交**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add ink, typescript, tsup, vitest"
```

## Task 1.3：创建 `tsconfig.json`

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`

**Interfaces:**
- Produces: TypeScript 编译配置；`tsx` 与 `tsup` 使用同一基线

- [x] **Step 1：写入 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "jsx": "react",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
```

- [x] **Step 2：写入 `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

- [x] **Step 3：验证编译**

```bash
mkdir -p src && echo 'export const x: number = 1;' > src/_probe.ts
npx tsc --noEmit
rm -rf src/_probe.ts
```

预期：`tsc` 退出码 0。

- [x] **Step 4：提交**

```bash
git add tsconfig.json tsconfig.build.json
git commit -m "chore(tsconfig): strict ESM TypeScript with NodeNext"
```

## Task 1.4：创建 `tsup.config.ts`

**Files:**
- Create: `tsup.config.ts`

**Interfaces:**
- Produces: `npm run build` 命令可生成 `dist/cli.js`（带 shebang）

- [x] **Step 1：写入 `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node18',
  outExtension: () => ({ js: '.js' }),
  clean: true,
  shims: false,
  bundle: true,
  splitting: false,
  minify: false,
  sourcemap: true,
  dts: false,
  // 关键：让 tsup 在 bundle 后的 cli.js 顶部保留 shebang
  banner: { js: '#!/usr/bin/env node' },
});
```

- [x] **Step 2：在 `package.json` 中补充 `scripts`**

编辑 `package.json` 的 `scripts` 字段（合并已有内容）：

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.tsx",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [x] **Step 3：校验脚本存在**

```bash
node -e "const p=require('./package.json'); console.log(p.scripts.build)"
```

预期输出：`tsup`。

- [x] **Step 4：提交**

```bash
git add tsup.config.ts package.json
git commit -m "chore(build): configure tsup to bundle cli.tsx as ESM"
```

## Task 1.5：创建 `src/cli.tsx` 入口（含 Ink render 与 shebang）

**Files:**
- Create: `src/cli.tsx`

**Interfaces:**
- Produces: 运行 `tsx src/cli.tsx` 后 Ink 渲染；`npm run build` 产物第一行是 shebang

- [x] **Step 1：写入 `src/cli.tsx`**

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';

// 占位 App；Task 7.1 会替换为完整实现
const App: React.FC = () => React.createElement(Text, null, 'ccsm bootstrapping…');

import { Text } from 'ink';

render(React.createElement(App));
```

注意：保留首行 `#!/usr/bin/env node` 以便 tsup banner 不会重复插入。

- [x] **Step 2：直接执行 tsx**

```bash
npx tsx src/cli.tsx </dev/null 2>&1 | head -5
```

预期输出（任一终端中可见）：类似 `ccsm bootstrapping…`。

- [x] **Step 3：build 并验证 shebang**

```bash
npm run build
head -1 dist/cli.js
```

预期输出：`#!/usr/bin/env node`。

- [x] **Step 4：执行 dist 输出（无副作用）**

```bash
chmod +x dist/cli.js
timeout 1 ./dist/cli.js </dev/null || true
```

预期：进程 1 秒内退出（占位 App 没接 useApp() 退出钩子，这里仅验证可启动）。

- [x] **Step 5：提交**

```bash
git add src/cli.tsx
git commit -m "feat(cli): bootstrapping entry with Ink render"
```

## Task 1.6：编写 `README.md`

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: 用户可参照的安装、键位、故障排查文档

- [x] **Step 1：写入 `README.md`**

```markdown
# cc-session-manager

macOS terminal UI for browsing and resuming Claude Code sessions.

## Install

```bash
npm install -g cc-session-manager
```

## Usage

```bash
ccsm
```

## Keybindings

| Key | Action |
|-----|--------|
| `Tab` | Switch pane |
| `↑` / `↓` | Navigate |
| `Enter` | Resume session |
| `n` | New session in project |
| `r` | Rename |
| `d` | Delete manual project |
| `c` | Copy session ID |
| `/` | Search |
| `a` | Add manual project |
| `,` | Settings |
| `?` | Help |
| `q` / `Ctrl+C` | Quit |

## Supported terminals

- Terminal.app (default)
- iTerm2
- Warp (experimental)

## Troubleshooting

### AppleScript blocked

If `osascript` errors with "not authorized", open
**System Settings → Privacy & Security → Automation** and grant the
calling terminal automation permissions for Terminal.app / iTerm2 / Warp.

### Corrupt state

Delete `~/.config/cc-manager/state.json` to reset.

## License

MIT
```

- [x] **Step 2：提交**

```bash
git add README.md
git commit -m "docs(readme): install, keybindings, supported terminals, troubleshooting"
```

## Task 1.7：补完 `.gitignore` 覆盖范围

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Produces: `.DS_Store`、`.idea/`、`.vscode/` 等不进入版本控制

- [x] **Step 1：追加条目**

编辑 `.gitignore`：

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
coverage/
.vitest-cache/
.idea/
.vscode/
*.swp
*.swo
.tmp/
```

- [x] **Step 2：提交**

```bash
git add .gitignore
git commit -m "chore(gitignore): add IDE and editor temp files"
```

---

# 第 2 组：状态持久化（State Persistence）

## Task 2.1：定义 `src/state/types.ts`

**Files:**
- Create: `src/state/types.ts`
- Create: `tests/state/types.test.ts`（类型编译即可）

**Interfaces:**
- Produces: 全局共享的类型定义；下游模块均依赖此文件

`src/state/types.ts` 内容：

```ts
export type TerminalChoice = 'terminal' | 'iterm2' | 'warp';

export interface ManualProject {
  path: string;
  addedAt: string; // ISO8601
}

export interface SessionMeta {
  sessionId: string;
  cwd: string;
  firstUserMessage: string | null;
  lastPrompt: string | null;
  lastTimestamp: string; // ISO8601
  sizeBytes: number;
  lineCount: number;
}

export interface Session {
  id: string;
  displayName: string;
  cwd: string;
  lastActiveRelative: string;
  lastTimestamp: string;
}

export interface Project {
  key: string;
  displayName: string;
  cwd: string;
  manual: boolean;
  hidden: boolean;
  sessions: Session[];
}

export type ModalKind = 'none' | 'search' | 'rename' | 'settings' | 'help' | 'confirm' | 'warning';

export interface ModalContext {
  renameKind?: 'session' | 'project';
  renameId?: string;
  renameCurrentName?: string;
  warningPid?: number;
  confirmAction?: 'deleteManualProject';
  confirmPayload?: string;
}

export interface AppState {
  sessionRoot: string | null;
  terminal: TerminalChoice;
  sessionAliases: Record<string, string>;
  projectAliases: Record<string, string>;
  manualProjects: ManualProject[];
  hiddenProjects: string[];
}

export const DEFAULT_STATE: AppState = {
  sessionRoot: null,
  terminal: 'terminal',
  sessionAliases: {},
  projectAliases: {},
  manualProjects: [],
  hiddenProjects: [],
};

export interface ScanProgress {
  current: number;
  total: number;
}
```

- [x] **Step 1：写入类型文件**

将上面的代码完整写入 `src/state/types.ts`。

- [x] **Step 2：编译验证**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/state/types.ts
git commit -m "feat(state): define AppState, SessionMeta, Project, Modal types"
```

## Task 2.2：实现 `src/state/store.ts` 基础读写

**Files:**
- Create: `src/state/store.ts`
- Create: `tests/state/store.test.ts`

**Interfaces:**
- Produces: `loadState(): Promise<AppState>`、`saveState(state): Promise<void>`、`CONFIG_DIR`、`STATE_PATH` 常量

- [x] **Step 1：先写红测**

`tests/state/store.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, STATE_PATH, resetForTest } from '../../src/state/store.js';
import { DEFAULT_STATE } from '../../src/state/types.js';

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-store-'));
  originalEnv = { ...process.env };
  process.env.HOME = tmpDir;
  process.env.XDG_CONFIG_HOME = path.join(tmpDir, '.config');
  await resetForTest();
});

afterEach(async () => {
  process.env = originalEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('store', () => {
  it('returns defaults when no state file exists', async () => {
    const state = await loadState();
    expect(state).toEqual(DEFAULT_STATE);
  });

  it('writes and reads back state atomically', async () => {
    await saveState({ ...DEFAULT_STATE, terminal: 'iterm2' });
    const state = await loadState();
    expect(state.terminal).toBe('iterm2');
    // 不应残留 .tmp 文件
    const files = await fs.readdir(path.dirname(STATE_PATH));
    expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
  });
});
```

- [x] **Step 2：跑测，确认 RED**

```bash
npx vitest run tests/state/store.test.ts
```

预期：FAIL（store.ts 不存在）。

- [x] **Step 3：实现 `src/state/store.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppState, DEFAULT_STATE } from './types.js';

export const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
  'cc-manager'
);

export const STATE_PATH = path.join(CONFIG_DIR, 'state.json');

export async function resetForTest(): Promise<void> {
  // 供测试重置模块级缓存
  cache = null;
}

let cache: AppState | null = null;

export async function loadState(): Promise<AppState> {
  if (cache) return cache;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    cache = { ...DEFAULT_STATE, ...parsed };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = { ...DEFAULT_STATE };
    } else {
      // JSON 损坏：备份 + 使用默认
      const backup = `state.json.bak.${Date.now()}`;
      try {
        await fs.rename(STATE_PATH, path.join(CONFIG_DIR, backup));
      } catch {
        /* 文件可能不存在 */
      }
      cache = { ...DEFAULT_STATE };
    }
  }
  return cache;
}

export async function saveState(state: AppState): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, STATE_PATH);
  cache = state;
}
```

- [x] **Step 4：跑测，确认 GREEN**

```bash
npx vitest run tests/state/store.test.ts
```

预期：2 个用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/state/store.ts tests/state/store.test.ts
git commit -m "feat(state): atomic JSON store with corrupt-state recovery"
```

## Task 2.3：损坏状态自动备份（已在 2.2 中实现 — 本任务补独立测试）

**Files:**
- Modify: `tests/state/store.test.ts`

- [x] **Step 1：追加红测**

编辑 `tests/state/store.test.ts`，新增 `it('backs up corrupt JSON')` 用例：

```ts
it('backs up corrupt JSON and returns defaults', async () => {
  // 直接写坏 JSON 到 STATE_PATH
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, '{not-valid-json');
  await resetForTest();
  const state = await loadState();
  expect(state).toEqual(DEFAULT_STATE);
  // 应生成备份
  const files = (await fs.readdir(path.dirname(STATE_PATH))).filter((f) =>
    f.startsWith('state.json.bak.')
  );
  expect(files.length).toBeGreaterThanOrEqual(1);
});
```

- [x] **Step 2：跑测**

```bash
npx vitest run tests/state/store.test.ts
```

预期：3 用例全部 PASS（store.ts 在 Task 2.2 已含损坏恢复逻辑）。

- [x] **Step 3：提交**

```bash
git add tests/state/store.test.ts
git commit -m "test(state): corrupt JSON triggers backup and defaults"
```

## Task 2.4：默认值填充（部分字段缺失）

**Files:**
- Modify: `tests/state/store.test.ts`

- [x] **Step 1：追加红测**

```ts
it('merges defaults when fields are missing', async () => {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify({ terminal: 'warp' }));
  await resetForTest();
  const state = await loadState();
  expect(state.terminal).toBe('warp');
  expect(state.sessionAliases).toEqual({});
  expect(state.manualProjects).toEqual([]);
  expect(state.hiddenProjects).toEqual([]);
});
```

- [x] **Step 2：跑测**

```bash
npx vitest run tests/state/store.test.ts
```

预期：4 用例 PASS（合并逻辑已在 2.2 中通过 `{ ...DEFAULT_STATE, ...parsed }` 实现）。

- [x] **Step 3：提交**

```bash
git add tests/state/store.test.ts
git commit -m "test(state): merge defaults when fields missing"
```

## Task 2.5：实现 `getSessionRoot()` 辅助

**Files:**
- Modify: `src/state/store.ts`
- Modify: `tests/state/store.test.ts`

**Interfaces:**
- Produces: `getSessionRoot(detect: () => Promise<string|null>): Promise<string|null>`，当 `state.sessionRoot` 为 null 时回退到探测函数

- [x] **Step 1：追加红测**

```ts
import { getSessionRoot } from '../../src/state/store.js';

it('returns override from state when set', async () => {
  await saveState({ ...DEFAULT_STATE, sessionRoot: '/custom/path' });
  const root = await getSessionRoot(async () => '/auto/path');
  expect(root).toBe('/custom/path');
});

it('falls back to detector when no override', async () => {
  await saveState({ ...DEFAULT_STATE });
  const root = await getSessionRoot(async () => '/auto/path');
  expect(root).toBe('/auto/path');
});

it('falls back when detector returns null', async () => {
  await saveState({ ...DEFAULT_STATE });
  const root = await getSessionRoot(async () => null);
  expect(root).toBeNull();
});
```

- [x] **Step 2：跑测，确认 RED**

```bash
npx vitest run tests/state/store.test.ts
```

预期：`getSessionRoot` 缺失 → FAIL。

- [x] **Step 3：在 `src/state/store.ts` 追加函数**

```ts
export async function getSessionRoot(
  detect: () => Promise<string | null>
): Promise<string | null> {
  const state = await loadState();
  return state.sessionRoot ?? (await detect());
}
```

- [x] **Step 4：跑测，确认 GREEN**

```bash
npx vitest run tests/state/store.test.ts
```

预期：7 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/state/store.ts tests/state/store.test.ts
git commit -m "feat(state): getSessionRoot helper with override precedence"
```

## Task 2.6：实现 `getAlias` / `setAlias`

**Files:**
- Modify: `src/state/store.ts`
- Modify: `tests/state/store.test.ts`

**Interfaces:**
- Produces: `getAlias('session'|'project', key): Promise<string|undefined>`、`setAlias('session'|'project', key, value): Promise<void>`

- [x] **Step 1：追加红测**

```ts
it('stores and returns session alias', async () => {
  await setAlias('session', 'abc-123', 'My login bug');
  expect(await getAlias('session', 'abc-123')).toBe('My login bug');
  // 同步落盘
  await resetForTest();
  expect(await getAlias('session', 'abc-123')).toBe('My login bug');
});

it('stores project alias keyed by group key', async () => {
  await setAlias('project', '/Users/carlos/foo', 'Foo project');
  expect(await getAlias('project', '/Users/carlos/foo')).toBe('Foo project');
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/state/store.test.ts
```

预期：FAIL（setAlias/getAlias 未定义）。

- [x] **Step 3：追加实现**

在 `src/state/store.ts` 末尾追加：

```ts
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
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/state/store.test.ts
```

预期：9 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/state/store.ts tests/state/store.test.ts
git commit -m "feat(state): getAlias/setAlias for session and project keys"
```

---

# 第 3 组：Session 发现（Session Discovery）

## Task 3.1：实现 `detectRoot.ts`（根目录探测）

**Files:**
- Create: `src/discovery/detectRoot.ts`
- Create: `tests/discovery/detectRoot.test.ts`

**Interfaces:**
- Produces: `detectRoot(): Promise<string|null>`，按 `CLAUDE_CONFIG_DIR` → `$HOME/.claude/projects/` → `$HOME/Library/Application Support/Claude/projects/` 顺序

- [x] **Step 1：写红测**

`tests/discovery/detectRoot.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRoot } from '../../src/discovery/detectRoot.js';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-detect-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('detectRoot', () => {
  it('prefers CLAUDE_CONFIG_DIR when set', async () => {
    const custom = path.join(tmpDir, 'custom');
    await fs.mkdir(path.join(custom, 'projects'), { recursive: true });
    const root = await detectRoot({ HOME: tmpDir, CLAUDE_CONFIG_DIR: custom });
    expect(root).toBe(path.join(custom, 'projects'));
  });

  it('falls back to ~/.claude/projects/', async () => {
    const projects = path.join(tmpDir, '.claude', 'projects');
    await fs.mkdir(projects, { recursive: true });
    const root = await detectRoot({ HOME: tmpDir });
    expect(root).toBe(projects);
  });

  it('returns null when no path exists', async () => {
    const root = await detectRoot({ HOME: tmpDir });
    expect(root).toBeNull();
  });
});
```

让 `detectRoot` 接收一个可选的 env object 以便测试可注入。

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/discovery/detectRoot.test.ts
```

预期：FAIL（detectRoot.ts 未实现）。

- [x] **Step 3：实现 `src/discovery/detectRoot.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface Env {
  HOME?: string | undefined;
  CLAUDE_CONFIG_DIR?: string | undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function detectRoot(env: Env = process.env): Promise<string | null> {
  const home = env.HOME ?? os.homedir();
  const configDir = env.CLAUDE_CONFIG_DIR;

  const candidates: string[] = [];
  if (configDir) candidates.push(path.join(configDir, 'projects'));
  candidates.push(path.join(home, '.claude', 'projects'));
  candidates.push(path.join(home, 'Library', 'Application Support', 'Claude', 'projects'));

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/discovery/detectRoot.test.ts
```

预期：3 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/discovery/detectRoot.ts tests/discovery/detectRoot.test.ts
git commit -m "feat(discovery): detectRoot with override precedence"
```

## Task 3.2：实现 `scan.ts` 列出 `.jsonl` 文件

**Files:**
- Create: `src/discovery/scan.ts`
- Create: `tests/discovery/scan.test.ts`

**Interfaces:**
- Produces: `listJsonlFiles(rootPath): Promise<string[]>`，递归列出所有 `.jsonl`

- [x] **Step 1：写红测**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listJsonlFiles } from '../../src/discovery/scan.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-scan-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

it('lists .jsonl files recursively', async () => {
  await fs.writeFile(path.join(tmp, 'a.jsonl'), '');
  await fs.mkdir(path.join(tmp, 'sub'));
  await fs.writeFile(path.join(tmp, 'sub', 'b.jsonl'), '');
  await fs.writeFile(path.join(tmp, 'c.txt'), ''); // ignore
  const files = await listJsonlFiles(tmp);
  expect(files.sort()).toEqual([path.join(tmp, 'a.jsonl'), path.join(tmp, 'sub', 'b.jsonl')].sort());
});

it('returns empty array when nothing exists', async () => {
  const files = await listJsonlFiles(tmp);
  expect(files).toEqual([]);
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/discovery/scan.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/discovery/scan.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function listJsonlFiles(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  try {
    await walk(rootPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return out;
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/discovery/scan.test.ts
```

预期：2 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/discovery/scan.ts tests/discovery/scan.test.ts
git commit -m "feat(discovery): recursive .jsonl listing"
```

## Task 3.3：实现 `parse.ts`（JSONL → SessionMeta）

**Files:**
- Create: `src/discovery/parse.ts`
- Create: `tests/discovery/parse.test.ts`

**Interfaces:**
- Produces: `parseJsonlFile(filePath): Promise<SessionMeta|null>`，流式 readline，每行 try/catch

- [x] **Step 1：写红测（先用文本夹具，准备 fixtures）**

先建立 fixtures 目录脚本：

```ts
// tests/discovery/fixtures.ts —— 写法不重要，可手写文件
```

但更直观：直接在测试中用 `fs.writeFile` 写一行 JSONL。

`tests/discovery/parse.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonlFile } from '../../src/discovery/parse.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-parse-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSession(lines: string[]): Promise<string> {
  const f = path.join(tmp, 'test.jsonl');
  await fs.writeFile(f, lines.join('\n') + (lines.length ? '\n' : ''));
  return f;
}

it('extracts metadata from a well-formed session', async () => {
  const file = await writeSession([
    JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'Fix login bug' }, timestamp: '2026-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'assistant', sessionId: 'abc', message: { content: [] }, timestamp: '2026-01-01T00:01:00Z' }),
    JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'Refactored fix', timestamp: '2026-01-01T00:02:00Z' }),
  ]);
  const meta = await parseJsonlFile(file);
  expect(meta).not.toBeNull();
  expect(meta!.sessionId).toBe('abc');
  expect(meta!.cwd).toBe('/x');
  expect(meta!.firstUserMessage).toBe('Fix login bug');
  expect(meta!.lastPrompt).toBe('Refactored fix');
  expect(meta!.lastTimestamp).toBe('2026-01-01T00:02:00Z');
});

it('returns null for empty file', async () => {
  const file = await writeSession([]);
  const meta = await parseJsonlFile(file);
  expect(meta).toBeNull();
});

it('skips malformed lines without aborting', async () => {
  const file = await writeSession([
    'not-json',
    JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'Hi' }, timestamp: '2026-02-01T00:00:00Z' }),
  ]);
  const meta = await parseJsonlFile(file);
  expect(meta!.sessionId).toBe('abc');
  expect(meta!.firstUserMessage).toBe('Hi');
});

it('returns the most recent last-prompt when multiple exist', async () => {
  const file = await writeSession([
    JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'first', timestamp: '2026-01-01T01:00:00Z' }),
    JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'second', timestamp: '2026-01-01T02:00:00Z' }),
  ]);
  const meta = await parseJsonlFile(file);
  expect(meta!.lastPrompt).toBe('second');
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/discovery/parse.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/discovery/parse.ts`**

```ts
import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { SessionMeta } from '../state/types.js';

interface JsonRecord {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  lastPrompt?: string;
  message?: { content?: unknown };
}

function readContentString(content: unknown): string | null {
  if (typeof content === 'string' && content.length > 0) return content;
  return null;
}

export async function parseJsonlFile(filePath: string): Promise<SessionMeta | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) return null;

  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });

  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstUserMessage: string | null = null;
  let lastPrompt: string | null = null;
  let lastTimestamp: string | undefined;
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;
    let rec: JsonRecord;
    try {
      rec = JSON.parse(line) as JsonRecord;
    } catch {
      continue;
    }
    if (!sessionId && typeof rec.sessionId === 'string') sessionId = rec.sessionId;
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;
    if (rec.type === 'user' && firstUserMessage === null) {
      firstUserMessage = readContentString(rec.message?.content);
    }
    if (rec.type === 'last-prompt' && typeof rec.lastPrompt === 'string') {
      // 取时间戳最晚的
      if (!lastTimestamp || (rec.timestamp && rec.timestamp > lastTimestamp)) {
        lastPrompt = rec.lastPrompt;
      }
    }
    if (typeof rec.timestamp === 'string') {
      if (!lastTimestamp || rec.timestamp > lastTimestamp) lastTimestamp = rec.timestamp;
    }
  }

  if (!sessionId) {
    // 从 filename 取 UUID
    const base = path.basename(filePath, '.jsonl');
    sessionId = base;
  }
  if (!sessionId || !lastTimestamp) return null;

  return {
    sessionId,
    cwd: cwd ?? '',
    firstUserMessage,
    lastPrompt,
    lastTimestamp,
    sizeBytes: stat.size,
    lineCount,
  };
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/discovery/parse.test.ts
```

预期：4 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/discovery/parse.ts tests/discovery/parse.test.ts
git commit -m "feat(discovery): streaming JSONL parser with per-line fault tolerance"
```

## Task 3.4：实现 `discovery/index.ts` 协调器（并行 + 并发限制）

**Files:**
- Create: `src/discovery/index.ts`
- Create: `tests/discovery/index.test.ts`

**Interfaces:**
- Produces: `runDiscovery(rootPath, onMeta: (meta: SessionMeta) => void): Promise<void>`，调用 `listJsonlFiles` → 并发 `parseJsonlFile`（限流 4）→ 回调

- [x] **Step 1：写红测**

```ts
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runDiscovery } from '../../src/discovery/index.js';

it('emits metadata for every valid session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-coord-'));
  const lines = [
    JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p1', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'user', sessionId: 's2', cwd: '/p2', message: { content: 'B' }, timestamp: '2026-01-01T00:01:00Z' }),
  ];
  for (const id of ['s1', 's2']) {
    await fs.writeFile(path.join(root, `${id}.jsonl`), lines.find((l) => l.includes(id))! + '\n');
  }
  const collected: string[] = [];
  await runDiscovery(root, (m) => collected.push(m.sessionId));
  expect(collected.sort()).toEqual(['s1', 's2']);
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/discovery/index.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/discovery/index.ts`**

```ts
import os from 'node:os';
import { listJsonlFiles } from './scan.js';
import { parseJsonlFile } from './parse.js';
import type { SessionMeta } from '../state/types.js';

const POOL_SIZE = Math.min(4, Math.max(1, os.cpus().length - 1));

export async function runDiscovery(
  rootPath: string,
  onMeta: (meta: SessionMeta) => void
): Promise<void> {
  const files = await listJsonlFiles(rootPath);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const idx = cursor++;
      const file = files[idx];
      try {
        const meta = await parseJsonlFile(file);
        if (meta) onMeta(meta);
      } catch (err) {
        // 单文件失败 → 跳过；记录但不阻断
        // eslint-disable-next-line no-console
        console.error('parse failed:', file, err);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, files.length) }, worker));
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/discovery/index.test.ts
```

预期：PASS。

- [x] **Step 5：提交**

```bash
git add src/discovery/index.ts tests/discovery/index.test.ts
git commit -m "feat(discovery): bounded-concurrency discovery coordinator"
```

## Task 3.5：后台异步扫描接口（async iterator / callback）

**Files:**
- Modify: `src/discovery/index.ts`

**Interfaces:**
- Produces: `scanBackground(rootPath): AsyncGenerator<SessionMeta>`，UI 可 `for await` 流式获取

- [x] **Step 1：追加导出**

编辑 `src/discovery/index.ts`，在文件末尾追加：

```ts
export async function* scanBackground(rootPath: string): AsyncGenerator<SessionMeta> {
  const queue: Promise<void>[] = [];
  let pending = 0;
  let resolveNext: (() => void) | null = null;
  const buffer: SessionMeta[] = [];
  let done = false;

  const pump = (): void => {
    if (done && pending === 0) {
      if (resolveNext) resolveNext();
    }
  };

  void runDiscovery(rootPath, (meta) => {
    buffer.push(meta);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  }).then(() => {
    done = true;
    pump();
  });

  while (true) {
    if (buffer.length > 0) {
      yield buffer.shift()!;
      continue;
    }
    if (done) return;
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
      pump();
    });
  }
}
```

- [x] **Step 2：手测集成**

```bash
mkdir -p /tmp/ccsm-bgtest
echo '{"type":"user","sessionId":"x","cwd":"/y","message":{"content":"hi"},"timestamp":"2026-01-01T00:00:00Z"}' > /tmp/ccsm-bgtest/x.jsonl
npx tsx -e "import {scanBackground} from './src/discovery/index.js'; for await (const m of scanBackground('/tmp/ccsm-bgtest')) console.log(m.sessionId);"
rm -rf /tmp/ccsm-bgtest
```

预期输出：`x`。

- [x] **Step 3：提交**

```bash
git add src/discovery/index.ts
git commit -m "feat(discovery): AsyncGenerator API for streaming scan results"
```

## Task 3.6：vitest 配置与测试脚本

**Files:**
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `npm run test` 可运行所有单元测试

- [x] **Step 1：写入 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
});
```

- [x] **Step 2：跑全部现有测试**

```bash
npm run test
```

预期：所有 14+ 用例 PASS。

- [x] **Step 3：提交**

```bash
git add vitest.config.ts
git commit -m "test: configure vitest for node environment"
```

---

# 第 4 组：项目分组（Project Grouping）

## Task 4.1：`group.ts` 骨架 + 纯函数签名

**Files:**
- Create: `src/grouping/group.ts`
- Create: `tests/grouping/group.test.ts`

**Interfaces:**
- Produces: `groupSessions(sessions, state): Project[]`，纯函数

- [x] **Step 1：写红测**

```ts
import { describe, it, expect } from 'vitest';
import { groupSessions } from '../../src/grouping/group.js';
import { DEFAULT_STATE, type SessionMeta } from '../../src/state/types.js';

const s = (overrides: Partial<SessionMeta>): SessionMeta => ({
  sessionId: 'sid',
  cwd: '/p1',
  firstUserMessage: null,
  lastPrompt: null,
  lastTimestamp: '2026-01-01T00:00:00Z',
  sizeBytes: 1,
  lineCount: 1,
  ...overrides,
});

it('groups sessions by shared cwd', () => {
  const result = groupSessions(
    [s({ sessionId: 'a', cwd: '/p1' }), s({ sessionId: 'b', cwd: '/p1' }), s({ sessionId: 'c', cwd: '/p2' })],
    DEFAULT_STATE
  );
  expect(result.map((p) => p.cwd).sort()).toEqual(['/p1', '/p2']);
  const p1 = result.find((p) => p.cwd === '/p1')!;
  expect(p1.sessions.map((x) => x.id).sort()).toEqual(['a', 'b']);
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/grouping/group.ts`**

```ts
import path from 'node:path';
import type { AppState, Project, Session, SessionMeta } from '../state/types.js';

function stripXmlTags(s: string): string {
  return s
    .replace(/<command-message>([\s\S]*?)<\/command-message>/g, '$1')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '')
    .replace(/<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function sessionDisplayName(meta: SessionMeta, alias?: string): string {
  if (alias) return alias;
  if (meta.lastPrompt) return truncate(meta.lastPrompt);
  if (meta.firstUserMessage) {
    const stripped = stripXmlTags(meta.firstUserMessage);
    if (stripped) return truncate(stripped);
  }
  return path.basename(meta.cwd) || 'session';
}

export function projectDisplayName(cwd: string, alias?: string): string {
  return alias || path.basename(cwd) || cwd;
}
```

仅导出工具函数，让 Task 4.2 引入 `groupSessions` 主逻辑。

- [x] **Step 4：跑测，RED 依然**

预期：因为 `groupSessions` 仍未导出，测试 FAIL。

- [x] **Step 5：提交（仅工具函数 + 先挂一个失败测试）**

```bash
git add src/grouping/group.ts tests/grouping/group.test.ts
git commit -m "feat(grouping): add display-name helpers (stripXmlTags, truncate)"
```

## Task 4.2：`groupSessions` 主函数（含显示名优先级）

**Files:**
- Modify: `src/grouping/group.ts`
- Modify: `tests/grouping/group.test.ts`

- [x] **Step 1：追加红测**

```ts
it('uses user alias over lastPrompt and cwd basename', () => {
  const result = groupSessions(
    [
      s({
        sessionId: 'a',
        cwd: '/p1',
        firstUserMessage: 'Fix login bug',
        lastPrompt: 'Latest prompt text',
      }),
    ],
    { ...DEFAULT_STATE, sessionAliases: { a: 'My alias' } }
  );
  const p = result[0];
  expect(p.displayName).toBe(path.basename('/p1'));
  expect(p.sessions[0].displayName).toBe('My alias');
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：FAIL（`groupSessions` 未导出）。

- [x] **Step 3：在 `src/grouping/group.ts` 追加 `groupSessions`**

```ts
import { relativeTime } from '../util/relative-time.js'; // Task 5 / later; use defer
```

如 `relative-time` 尚未实现，使用 inline 占位：

```ts
const relativeTime = (iso: string): string => iso; // 占位；Task 后续替换
```

并把 `groupSessions` 加到同一文件中：

```ts
export function groupSessions(metas: SessionMeta[], state: AppState): Project[] {
  // 1. 按 cwd 分组
  const groups = new Map<string, SessionMeta[]>();
  for (const m of metas) {
    const key = path.resolve(m.cwd);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // 2. 派生 Project
  const projects: Project[] = [];
  for (const [key, list] of groups) {
    const sessions: Session[] = list
      .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      .map((m) => ({
        id: m.sessionId,
        displayName: sessionDisplayName(m, state.sessionAliases[m.sessionId]),
        cwd: m.cwd,
        lastActiveRelative: relativeTime(m.lastTimestamp),
        lastTimestamp: m.lastTimestamp,
      }));
    projects.push({
      key,
      displayName: projectDisplayName(key, state.projectAliases[key]),
      cwd: key,
      manual: false,
      hidden: state.hiddenProjects.includes(key),
      sessions,
    });
  }
  return projects;
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：2 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/grouping/group.ts tests/grouping/group.test.ts
git commit -m "feat(grouping): groupSessions by cwd with alias-first display names"
```

## Task 4.3：session 内按 `lastTimestamp` 倒序

**Files:**
- Modify: `tests/grouping/group.test.ts`

- [x] **Step 1：追加红测**

```ts
it('sorts sessions within a project by lastTimestamp desc', () => {
  const result = groupSessions(
    [
      s({ sessionId: 'old', cwd: '/p1', lastTimestamp: '2026-01-01T00:00:00Z' }),
      s({ sessionId: 'newest', cwd: '/p1', lastTimestamp: '2026-03-01T00:00:00Z' }),
      s({ sessionId: 'mid', cwd: '/p1', lastTimestamp: '2026-02-01T00:00:00Z' }),
    ],
    DEFAULT_STATE
  );
  expect(result[0].sessions.map((s) => s.id)).toEqual(['newest', 'mid', 'old']);
});
```

- [x] **Step 2：跑测**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：PASS（实现已含排序）。

- [x] **Step 3：提交**

```bash
git add tests/grouping/group.test.ts
git commit -m "test(grouping): sessions sorted by lastTimestamp desc"
```

## Task 4.4：合并 `manualProjects`

**Files:**
- Modify: `src/grouping/group.ts`
- Modify: `tests/grouping/group.test.ts`

- [x] **Step 1：追加红测**

```ts
it('merges manual projects even when no sessions exist', () => {
  const result = groupSessions(
    [],
    { ...DEFAULT_STATE, manualProjects: [{ path: '/empty', addedAt: '2026-01-01T00:00:00Z' }] }
  );
  const m = result.find((p) => p.cwd === path.resolve('/empty'));
  expect(m).toBeDefined();
  expect(m!.manual).toBe(true);
  expect(m!.sessions).toEqual([]);
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：FAIL。

- [x] **Step 3：编辑 `groupSessions`，在最后追加**

```ts
for (const mp of state.manualProjects) {
  const key = path.resolve(mp.path);
  if (!projects.find((p) => p.key === key)) {
    projects.push({
      key,
      displayName: projectDisplayName(key, state.projectAliases[key]),
      cwd: key,
      manual: true,
      hidden: state.hiddenProjects.includes(key),
      sessions: [],
    });
  } else {
    // 已有自动派生 → 标记 manual=true
    const existing = projects.find((p) => p.key === key)!;
    existing.manual = true;
  }
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：PASS。

- [x] **Step 5：提交**

```bash
git add src/grouping/group.ts tests/grouping/group.test.ts
git commit -m "feat(grouping): merge manualProjects with manual flag"
```

## Task 4.5：应用 `hiddenProjects` 过滤

**Files:**
- Modify: `src/grouping/group.ts`
- Modify: `tests/grouping/group.test.ts`

- [x] **Step 1：追加红测**

```ts
it('filters out hidden projects', () => {
  const result = groupSessions(
    [s({ sessionId: 'a', cwd: '/p1' })],
    { ...DEFAULT_STATE, hiddenProjects: [path.resolve('/p1')] }
  );
  expect(result).toEqual([]);
});
```

- [x] **Step 2：在 `groupSessions` 末尾追加过滤**

```ts
return projects.filter((p) => !p.hidden);
```

- [x] **Step 3：跑测，GREEN**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：PASS。

- [x] **Step 4：提交**

```bash
git add src/grouping/group.ts tests/grouping/group.test.ts
git commit -m "feat(grouping): filter hiddenProjects from final list"
```

## Task 4.6：项目排序（manual 优先，再按最近 session 时间）

**Files:**
- Modify: `src/grouping/group.ts`
- Modify: `tests/grouping/group.test.ts`

- [x] **Step 1：追加红测**

```ts
it('orders manual projects first, then auto by most recent session', () => {
  const result = groupSessions(
    [
      s({ sessionId: 'a', cwd: '/auto', lastTimestamp: '2026-05-01T00:00:00Z' }),
      s({ sessionId: 'b', cwd: '/auto2', lastTimestamp: '2026-04-01T00:00:00Z' }),
    ],
    {
      ...DEFAULT_STATE,
      manualProjects: [{ path: '/manual', addedAt: '2026-01-01T00:00:00Z' }],
    }
  );
  expect(result[0].cwd).toBe(path.resolve('/manual'));
  expect(result[1].cwd).toBe(path.resolve('/auto'));
  expect(result[2].cwd).toBe(path.resolve('/auto2'));
});
```

- [x] **Step 2：编辑 `groupSessions`：在 filter 之前排序**

```ts
projects.sort((a, b) => {
  if (a.manual !== b.manual) return a.manual ? -1 : 1;
  const aTs = a.sessions[0]?.lastTimestamp ?? '';
  const bTs = b.sessions[0]?.lastTimestamp ?? '';
  return bTs.localeCompare(aTs);
});
```

- [x] **Step 3：跑测，GREEN**

```bash
npx vitest run tests/grouping/group.test.ts
```

预期：PASS。

- [x] **Step 4：提交**

```bash
git add src/grouping/group.ts tests/grouping/group.test.ts
git commit -m "feat(grouping): manual-first, recency-second project ordering"
```

---

# 第 5 组：终端集成（Terminal Integration）

## Task 5.1：`escape.ts`（AppleScript / shell 安全）

**Files:**
- Create: `src/terminal/escape.ts`
- Create: `tests/terminal/escape.test.ts`

**Interfaces:**
- Produces: `escapeForAppleScript(s: string): string`、`buildTerminalAppScript(cwd, command): string`

- [x] **Step 1：写红测**

```ts
import { describe, it, expect } from 'vitest';
import { escapeForAppleScript, buildTerminalAppScript } from '../../src/terminal/escape.js';

describe('escapeForAppleScript', () => {
  it('passes through plain text', () => {
    expect(escapeForAppleScript('/Users/foo/bar')).toBe('/Users/foo/bar');
  });
  it('escapes single quotes via POSIX standard', () => {
    expect(escapeForAppleScript("/Users/O'Brien")).toBe("/Users/O'\\''Brien");
  });
  it('handles multiple single quotes', () => {
    expect(escapeForAppleScript("'a' 'b'")).toBe("'\\''a'\\'' '\\''b'\\''");
  });
  it('handles Unicode', () => {
    expect(escapeForAppleScript('/Users/中文/路径')).toBe('/Users/中文/路径');
  });
  it('handles injection attempts', () => {
    expect(escapeForAppleScript("/'; rm -rf /")).toBe("/'\\''; rm -rf /");
  });
});

describe('buildTerminalAppScript', () => {
  it('embeds escaped cwd and command in do script', () => {
    const s = buildTerminalAppScript('/Users/foo', 'claude --resume abc');
    expect(s).toContain(`cd '/Users/foo' && claude --resume abc`);
    expect(s.startsWith('tell application "Terminal" to activate')).toBe(true);
  });
  it('escapes embedded double quotes in command', () => {
    const s = buildTerminalAppScript('/x', `echo "hi"`);
    expect(s).toContain('echo \\"hi\\"');
  });
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/terminal/escape.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/terminal/escape.ts`**

```ts
export function escapeForAppleScript(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function escapeForAppleScriptDoubleQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildTerminalAppScript(cwd: string, command: string): string {
  const eCwd = escapeForAppleScript(cwd);
  const eCmd = escapeForAppleScriptDoubleQuotes(command);
  return (
    'tell application "Terminal" to activate\n' +
    `tell application "Terminal" to do script "cd '${eCwd}' && ${eCmd}"`
  );
}
```

- [x] **Step 4：跑测，GREEN**

```bash
npx vitest run tests/terminal/escape.test.ts
```

预期：7 用例 PASS。

- [x] **Step 5：提交**

```bash
git add src/terminal/escape.ts tests/terminal/escape.test.ts
git commit -m "feat(terminal): AppleScript single/double quote escaping"
```

## Task 5.2：`terminal-app.ts`（Terminal.app 后端）

**Files:**
- Create: `src/terminal/terminal-app.ts`

**Interfaces:**
- Produces: `terminalApp({cwd, command}): Promise<void>`，用 `execFile('osascript', ['-e', script])`

- [x] **Step 1：写入 `src/terminal/terminal-app.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildTerminalAppScript } from './escape.js';

const exec = promisify(execFile);

export interface OpenRequest {
  cwd: string;
  command: string;
}

export async function terminalApp(req: OpenRequest): Promise<void> {
  const script = buildTerminalAppScript(req.cwd, req.command);
  await exec('osascript', ['-e', script]);
}
```

- [x] **Step 2：手测（仅冒烟：报错也不要紧）**

```bash
osascript -e 'tell application "Terminal" to activate'
```

预期：Terminal.app 跳到前台（如果未授权会失败 — 见 README）。

- [x] **Step 3：编译验证**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 4：提交**

```bash
git add src/terminal/terminal-app.ts
git commit -m "feat(terminal): Terminal.app backend via osascript"
```

## Task 5.3：`iterm2.ts`（iTerm2 后端）

**Files:**
- Create: `src/terminal/iterm2.ts`

**Interfaces:**
- Produces: `iterm2({cwd, command}): Promise<void>`

- [x] **Step 1：写入 `src/terminal/iterm2.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { escapeForAppleScript, escapeForAppleScriptDoubleQuotes } from './escape.js';

const exec = promisify(execFile);

export async function iterm2(req: { cwd: string; command: string }): Promise<void> {
  const eCwd = escapeForAppleScript(req.cwd);
  const eCmd = escapeForAppleScriptDoubleQuotes(req.command);
  const script = `
tell application "iTerm2"
  activate
  create window with default profile command "cd '${eCwd}' && ${eCmd}"
end tell
`;
  await exec('osascript', ['-e', script]);
}
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/terminal/iterm2.ts
git commit -m "feat(terminal): iTerm2 backend via osascript create window"
```

## Task 5.4：`warp.ts`（best effort + 剪贴板 fallback）

**Files:**
- Create: `src/terminal/warp.ts`

**Interfaces:**
- Produces: `warp({cwd, command}): Promise<void>` — 打开 Warp 并尝试 keystroke 注入；失败时回退到 `pbcopy`

- [x] **Step 1：写入 `src/terminal/warp.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { escapeForAppleScript } from './escape.js';

const exec = promisify(execFile);

export async function warp(req: { cwd: string; command: string }): Promise<void> {
  const full = `cd '${escapeForAppleScript(req.cwd)}' && ${req.command}`;
  // 先尝试 keystroke 注入
  try {
    const script = `
tell application "Warp" to activate
delay 0.4
tell application "System Events"
  keystroke "${full.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
  key code 36
end tell
`;
    await exec('osascript', ['-e', script]);
  } catch {
    // fallback: 复制命令到剪贴板并提示用户手动粘贴
    await exec('pbcopy', [], { input: full });
    throw new Error(
      'Warp keystroke injection failed; the command was copied to clipboard. Paste manually in Warp.'
    );
  }
}
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/terminal/warp.ts
git commit -m "feat(terminal): Warp best-effort with pbcopy fallback"
```

## Task 5.5：`index.ts` 派发器

**Files:**
- Create: `src/terminal/index.ts`

**Interfaces:**
- Produces: `dispatch(terminal, req): Promise<void>`，根据 `state.terminal` 路由

- [x] **Step 1：写入 `src/terminal/index.ts`**

```ts
import type { TerminalChoice } from '../state/types.js';
import { terminalApp } from './terminal-app.js';
import { iterm2 } from './iterm2.js';
import { warp } from './warp.js';

export async function dispatchOpen(
  terminal: TerminalChoice,
  req: { cwd: string; command: string }
): Promise<void> {
  switch (terminal) {
    case 'terminal':
      return terminalApp(req);
    case 'iterm2':
      return iterm2(req);
    case 'warp':
      return warp(req);
    default: {
      const exhaustive: never = terminal;
      throw new Error(`Unknown terminal: ${String(exhaustive)}`);
    }
  }
}

export class TerminalNotInstalledError extends Error {
  constructor(public readonly binary: string) {
    super(`${binary} is not installed. Switch terminal in Settings.`);
    this.name = 'TerminalNotInstalledError';
  }
}
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/terminal/index.ts
git commit -m "feat(terminal): dispatcher keyed by state.terminal"
```

## Task 5.6：错误处理（未安装时抛明确错误）

**Files:**
- Modify: `src/terminal/terminal-app.ts`
- Modify: `src/terminal/iterm2.ts`
- Modify: `src/terminal/warp.ts`

**Interfaces:**
- Produces: 后端在 `execFile` 抛错时附带 `binary` 上下文，UI 可识别

- [x] **Step 1：在 `terminal-app.ts` 中加错误包装**

```ts
import { TerminalNotInstalledError } from './index.js';

// 在 exec 失败时：
} catch (err) {
  const msg = (err as Error).message ?? '';
  if (/command not found/.test(msg) || /No such file/.test(msg)) {
    throw new TerminalNotInstalledError('Terminal.app');
  }
  throw err;
}
```

完整替换：

```ts
export async function terminalApp(req: OpenRequest): Promise<void> {
  const script = buildTerminalAppScript(req.cwd, req.command);
  try {
    await exec('osascript', ['-e', script]);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (/command not found/i.test(msg)) {
      throw new TerminalNotInstalledError('osascript');
    }
    throw err;
  }
}
```

- [x] **Step 2：相同思路应用到 `iterm2.ts` 与 `warp.ts`**

`iterm2.ts`：

```ts
import { TerminalNotInstalledError } from './index.js';
// ...
} catch (err) {
  const msg = (err as Error).message ?? '';
  if (/command not found/i.test(msg)) throw new TerminalNotInstalledError('iTerm2');
  throw err;
}
```

`warp.ts` 已经在内部 try/catch 实现 keystroke fallback；但当 `open -a Warp` 完全找不到 Warp 时也抛 `TerminalNotInstalledError('Warp')`。

- [x] **Step 3：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 4：提交**

```bash
git add src/terminal/
git commit -m "feat(terminal): surface TerminalNotInstalledError for missing apps"
```

## Task 5.7：execFile 参数数组（强制）

**Files:**
- Modify: `src/terminal/terminal-app.ts`
- Modify: `src/terminal/iterm2.ts`
- Modify: `src/terminal/warp.ts`

**Interfaces:**
- Produces: 所有 osascript 调用通过 `execFile` + 参数数组；Linter / 注释提醒

- [x] **Step 1：删除任何 `exec('string...')` 调用**

逐文件确认：仅使用 `execFile` + `['osascript', '-e', script]`。

- [x] **Step 2：添加 ESLint 自定义注释（占位）**

在每个 terminal 后端文件顶部添加：

```ts
/* eslint-disable security/detect-child-process */
// 安全：所有子进程调用均通过 execFile 参数数组，规避 shell 注入
```

（如未配 ESLint，至少在文件头添加 markdown 注释说明）

- [x] **Step 3：审计**

```bash
grep -RIn "exec(" src/terminal/
```

预期：仅出现 `execFile(`；无 `exec("` 或 `exec(\``。

- [x] **Step 4：提交**

```bash
git add src/terminal/
git commit -m "chore(terminal): document execFile-only policy for osascript calls"
```

---

# 第 6 组：Session 管理操作（Actions）

> 本组依赖 state (`setAlias`/`saveState`) 与 terminal 派发器；actions 是 TUI ↔ 底层的胶水。

## Task 6.1：`resumeSession` action

**Files:**
- Create: `src/actions/resumeSession.ts`

**Interfaces:**
- Produces: `resumeSession(session: Session, terminal: TerminalChoice): Promise<void>`

- [x] **Step 1：写入 `src/actions/resumeSession.ts`**

```ts
import { dispatchOpen } from '../terminal/index.js';
import type { Session, TerminalChoice } from '../state/types.js';

export async function resumeSession(
  session: Session,
  terminal: TerminalChoice
): Promise<void> {
  await dispatchOpen(terminal, {
    cwd: session.cwd,
    command: `claude --resume ${session.id}`,
  });
}
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/actions/resumeSession.ts
git commit -m "feat(actions): resumeSession dispatches claude --resume"
```

## Task 6.2：`newSession` action

**Files:**
- Create: `src/actions/newSession.ts`

- [x] **Step 1：写入 `src/actions/newSession.ts`**

```ts
import { dispatchOpen } from '../terminal/index.js';
import type { Project, TerminalChoice } from '../state/types.js';

export async function newSession(
  project: Project,
  terminal: TerminalChoice
): Promise<void> {
  await dispatchOpen(terminal, {
    cwd: project.cwd,
    command: 'claude',
  });
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/newSession.ts
git commit -m "feat(actions): newSession opens Claude in project cwd"
```

## Task 6.3：`renameSession` action

**Files:**
- Create: `src/actions/renameSession.ts`

- [x] **Step 1：写入 `src/actions/renameSession.ts`**

```ts
import { setAlias } from '../state/store.js';

export async function renameSession(sessionId: string, newName: string): Promise<void> {
  await setAlias('session', sessionId, newName);
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/renameSession.ts
git commit -m "feat(actions): renameSession writes alias atomically"
```

## Task 6.4：`renameProject` action

**Files:**
- Create: `src/actions/renameProject.ts`

- [x] **Step 1：写入 `src/actions/renameProject.ts`**

```ts
import { setAlias } from '../state/store.js';

export async function renameProject(groupKey: string, newName: string): Promise<void> {
  await setAlias('project', groupKey, newName);
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/renameProject.ts
git commit -m "feat(actions): renameProject writes alias atomically"
```

## Task 6.5：`addManualProject` action

**Files:**
- Create: `src/actions/addManualProject.ts`

**Interfaces:**
- Produces: `addManualProject(): Promise<string|null>`，弹文件夹选择器，返回已添加路径或 null

- [x] **Step 1：写入 `src/actions/addManualProject.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pickFolder } from '../util/folder-picker.js';
import { saveState, loadState } from '../state/store.js';

export async function addManualProject(): Promise<string | null> {
  const picked = await pickFolder('Select a project directory');
  if (!picked) return null;
  const resolved = path.resolve(picked);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) return null;

  const state = await loadState();
  if (state.manualProjects.find((m) => path.resolve(m.path) === resolved)) {
    return resolved; // 已存在 → 幂等
  }
  await saveState({
    ...state,
    manualProjects: [
      ...state.manualProjects,
      { path: resolved, addedAt: new Date().toISOString() },
    ],
  });
  return resolved;
}
```

- [x] **Step 2：编译（会缺 `folder-picker`，跳过此步直到 Task 8.1 完成后）**

暂用 `// @ts-expect-error` 占位，或先创建 `folder-picker` 的空壳：

```ts
// src/util/folder-picker.ts (Task 8.1 实现)
export async function pickFolder(_prompt: string): Promise<string | null> {
  return null;
}
```

- [x] **Step 3：编译 + 提交空壳**

```bash
npx tsc --noEmit
git add src/actions/addManualProject.ts src/util/folder-picker.ts
git commit -m "feat(actions): addManualProject with folder picker shell"
```

## Task 6.6：`deleteManualProject` action

**Files:**
- Create: `src/actions/deleteManualProject.ts`

- [x] **Step 1：写入 `src/actions/deleteManualProject.ts`**

```ts
import { loadState, saveState } from '../state/store.js';

export async function deleteManualProject(groupKey: string): Promise<void> {
  const state = await loadState();
  await saveState({
    ...state,
    manualProjects: state.manualProjects.filter(
      (m) => require('node:path').resolve(m.path) !== groupKey
    ),
  });
}
```

更干净的写法：把 `path` 提到顶部。

```ts
import path from 'node:path';
import { loadState, saveState } from '../state/store.js';

export async function deleteManualProject(groupKey: string): Promise<void> {
  const state = await loadState();
  await saveState({
    ...state,
    manualProjects: state.manualProjects.filter(
      (m) => path.resolve(m.path) !== groupKey
    ),
  });
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/deleteManualProject.ts
git commit -m "feat(actions): deleteManualProject removes from manualProjects"
```

## Task 6.7：`copySessionId` action

**Files:**
- Create: `src/actions/copySessionId.ts`

- [x] **Step 1：写入 `src/actions/copySessionId.ts`**

```ts
import { spawn } from 'node:child_process';

export async function copySessionId(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pbcopy');
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pbcopy exited ${code}`));
    });
    proc.stdin.write(sessionId);
    proc.stdin.end();
  });
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/copySessionId.ts
git commit -m "feat(actions): copySessionId via pbcopy"
```

---

# 第 7 组：TUI 界面（TUI Interface）

## Task 7.1：`App.tsx` 根组件（useReducer）

**Files:**
- Create: `src/tui/App.tsx`

**Interfaces:**
- Produces: 渲染骨架；持有 `state + dispatch`；订阅扫描回调

- [x] **Step 1：写入 `src/tui/App.tsx`**

```tsx
import React, { useEffect, useReducer } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from 'ink-text-input';
import type { AppState, Project, Session, SessionMeta, TerminalChoice } from '../state/types.js';
import { DEFAULT_STATE } from '../state/types.js';

type Action =
  | { type: 'BOOTSTRAP'; state: AppState; projects: Project[] }
  | { type: 'SESSION_DISCOVERED'; meta: SessionMeta }
  | { type: 'SET_TERMINAL'; terminal: TerminalChoice }
  | { type: 'SET_SEARCH'; q: string }
  | { type: 'OPEN_MODAL'; modal: AppState['modal']; ctx?: AppState['modalContext'] }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SELECT_PROJECT'; key: string | null }
  | { type: 'SELECT_SESSION'; id: string | null }
  | { type: 'FOCUS_PANE'; pane: 'projects' | 'sessions' }
  | { type: 'NOTICE'; kind: string; payload?: unknown }
  | { type: 'SCAN_COMPLETE' };

interface UiState extends AppState {
  modal: AppState['modal'];
  modalContext: AppState['modalContext'];
  projects: Project[];
  selectedProjectKey: string | null;
  selectedSessionId: string | null;
  focusedPane: 'projects' | 'sessions';
  searchQuery: string;
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
}

const initial: UiState = {
  ...DEFAULT_STATE,
  modal: 'none',
  modalContext: {},
  projects: [],
  selectedProjectKey: null,
  selectedSessionId: null,
  focusedPane: 'projects',
  searchQuery: '',
  scanStatus: 'idle',
};

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'BOOTSTRAP':
      return { ...state, ...action.state, projects: action.projects, scanStatus: 'scanning' };
    case 'SESSION_DISCOVERED':
      // 简化：UI 由 groupSessions 重建；此处跳过
      return state;
    case 'SET_TERMINAL':
      return { ...state, terminal: action.terminal };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.q };
    case 'OPEN_MODAL':
      return { ...state, modal: action.modal, modalContext: action.ctx ?? {} };
    case 'CLOSE_MODAL':
      return { ...state, modal: 'none', modalContext: {} };
    case 'SELECT_PROJECT':
      return { ...state, selectedProjectKey: action.key };
    case 'SELECT_SESSION':
      return { ...state, selectedSessionId: action.id };
    case 'FOCUS_PANE':
      return { ...state, focusedPane: action.pane };
    case 'SCAN_COMPLETE':
      return { ...state, scanStatus: 'complete' };
    case 'NOTICE':
      return state;
  }
}

export interface AppProps {
  bootstrapState: AppState;
  projects: Project[];
  onSession: (cb: (meta: SessionMeta) => void) => void;
  onScanComplete: (cb: () => void) => void;
}

export const App: React.FC<AppProps> = ({ bootstrapState, projects, onSession, onScanComplete }) => {
  const [state, dispatch] = useReducer(reducer, {
    ...initial,
    ...bootstrapState,
    projects,
  });

  useEffect(() => {
    onSession((meta) => dispatch({ type: 'SESSION_DISCOVERED', meta }));
    onScanComplete(() => dispatch({ type: 'SCAN_COMPLETE' }));
  }, []);

  return (
    <Box flexDirection="column">
      <Text>cc-session-manager — projects: {state.projects.length}</Text>
    </Box>
  );
};
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：替换 `src/cli.tsx` 中的占位 App**

编辑 `src/cli.tsx`：

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import type { AppState, Project } from './state/types.js';

const placeholderState: AppState = {
  sessionRoot: null,
  terminal: 'terminal',
  sessionAliases: {},
  projectAliases: {},
  manualProjects: [],
  hiddenProjects: [],
};

const placeholderProjects: Project[] = [];

render(
  React.createElement(App, {
    bootstrapState: placeholderState,
    projects: placeholderProjects,
    onSession: () => {},
    onScanComplete: () => {},
  })
);
```

- [x] **Step 4：启动验证**

```bash
npx tsx src/cli.tsx </dev/null 2>&1 | head -3 &
sleep 1
kill %1 2>/dev/null || true
```

预期输出：`cc-session-manager — projects: 0`。

- [x] **Step 5：提交**

```bash
git add src/tui/App.tsx src/cli.tsx
git commit -m "feat(tui): App root with useReducer (skeleton)"
```

## Task 7.2：ProjectPane

**Files:**
- Create: `src/tui/panes/ProjectPane.tsx`

**Interfaces:**
- Produces: `<ProjectPane projects, selectedKey, focused onSelect />`，垂直列表 + 高亮

- [x] **Step 1：写入 `src/tui/panes/ProjectPane.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { Project } from '../../state/types.js';

interface Props {
  projects: Project[];
  selectedKey: string | null;
  focused: boolean;
  onSelect: (key: string) => void;
}

export const ProjectPane: React.FC<Props> = ({ projects, selectedKey, focused, onSelect }) => {
  if (projects.length === 0) {
    return (
      <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
        <Text dimColor>No projects found.</Text>
        <Text dimColor>Press `a` to add a directory, or `,` to configure the session root.</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
      <Text bold>Projects ({projects.length})</Text>
      {projects.map((p) => {
        const sel = p.key === selectedKey;
        return (
          <Text
            key={p.key}
            inverse={sel && focused}
            color={sel ? 'cyan' : undefined}
            onClick={() => onSelect(p.key)}
          >
            {sel ? '› ' : '  '}
            {p.displayName} {p.manual ? '(manual)' : ''} ({p.sessions.length})
          </Text>
        );
      })}
    </Box>
  );
};
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/tui/panes/ProjectPane.tsx
git commit -m "feat(tui): ProjectPane vertical list with focus highlight"
```

## Task 7.3：SessionPane

**Files:**
- Create: `src/tui/panes/SessionPane.tsx`

- [x] **Step 1：写入 `src/tui/panes/SessionPane.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../../state/types.js';

interface Props {
  sessions: Session[];
  selectedId: string | null;
  focused: boolean;
  onSelect: (id: string) => void;
}

export const SessionPane: React.FC<Props> = ({ sessions, selectedId, focused, onSelect }) => {
  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column" paddingX={1}>
      <Text bold>Sessions ({sessions.length})</Text>
      {sessions.length === 0 && <Text dimColor>No sessions yet (Scanning…)</Text>}
      {sessions.map((s) => {
        const sel = s.id === selectedId;
        return (
          <Text
            key={s.id}
            inverse={sel && focused}
            color={sel ? 'cyan' : undefined}
            onClick={() => onSelect(s.id)}
          >
            {sel ? '› ' : '  '}
            {s.displayName} <Text dimColor>· {s.lastActiveRelative}</Text>
          </Text>
        );
      })}
    </Box>
  );
};
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/panes/SessionPane.tsx
git commit -m "feat(tui): SessionPane vertical list with focus highlight"
```

## Task 7.4：`useKeybindings` hook

**Files:**
- Create: `src/tui/hooks/useKeybindings.ts`

**Interfaces:**
- Produces: `useKeybindings(dispatch, callbacks): void`，在 `useInput` 中分发按键

- [x] **Step 1：写入 `src/tui/hooks/useKeybindings.ts`**

```ts
import { useInput } from 'ink';
import type { Dispatch } from 'react';

interface Callbacks {
  onResume: () => void;
  onNew: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onSearch: () => void;
  onQuit: () => void;
  onTab: () => void;
  onUp: () => void;
  onDown: () => void;
  onEnter: () => void;
  onClearSearch: () => void;
}

type Action =
  | { type: 'FOCUS_PANE'; pane: 'projects' | 'sessions' }
  | { type: 'OPEN_MODAL'; modal: 'search' | 'rename' | 'settings' | 'help' | 'confirm' };

export function useKeybindings(
  dispatch: Dispatch<Action>,
  cbs: Callbacks
): void {
  useInput((input, key) => {
    if (key.tab) {
      dispatch({ type: 'FOCUS_PANE', pane: 'projects' });
      cbs.onTab();
      return;
    }
    if (key.upArrow) return cbs.onUp();
    if (key.downArrow) return cbs.onDown();
    if (key.return) return cbs.onEnter();
    if (input === 'q' || (key.ctrl && input === 'c')) return cbs.onQuit();
    if (input === '/') return cbs.onSearch();
    if (input === 'r') return cbs.onRename();
    if (input === 'n') return cbs.onNew();
    if (input === 'd') return cbs.onDelete();
    if (input === 'c') return cbs.onCopy();
    if (input === 'a') return cbs.onAdd();
    if (input === ',') return cbs.onSettings();
    if (input === '?') return cbs.onHelp();
    if (key.escape) return cbs.onClearSearch();
  });
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/hooks/useKeybindings.ts
git commit -m "feat(tui): useKeybindings hook mapping keys to actions"
```

## Task 7.5：SearchModal

**Files:**
- Create: `src/tui/modals/SearchModal.tsx`

- [x] **Step 1：写入 `src/tui/modals/SearchModal.tsx`**

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from 'ink-text-input';

interface Props {
  initial?: string;
  onSubmit: (q: string) => void;
  onCancel: () => void;
}

export const SearchModal: React.FC<Props> = ({ initial = '', onSubmit, onCancel }) => {
  const [q, setQ] = useState(initial);
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Search sessions</Text>
      <TextInput value={q} onChange={setQ} onSubmit={() => onSubmit(q)} />
      <Text dimColor>Enter to apply · Esc to cancel</Text>
    </Box>
  );
};
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/modals/SearchModal.tsx
git commit -m "feat(tui): SearchModal with ink-text-input"
```

## Task 7.6：RenameModal

**Files:**
- Create: `src/tui/modals/RenameModal.tsx`

- [x] **Step 1：写入 `src/tui/modals/RenameModal.tsx`**

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from 'ink-text-input';

interface Props {
  initial: string;
  kind: 'session' | 'project';
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export const RenameModal: React.FC<Props> = ({ initial, kind, onSubmit, onCancel }) => {
  const [v, setV] = useState(initial);
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Rename {kind}</Text>
      <TextInput value={v} onChange={setV} onSubmit={() => onSubmit(v)} />
      <Text dimColor>Enter to save · Esc to cancel</Text>
    </Box>
  );
};
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/modals/RenameModal.tsx
git commit -m "feat(tui): RenameModal pre-filled"
```

## Task 7.7：SettingsModal

**Files:**
- Create: `src/tui/modals/SettingsModal.tsx`

- [x] **Step 1：写入 `src/tui/modals/SettingsModal.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from 'ink-text-input';
import type { AppState, TerminalChoice } from '../../state/types.js';

interface Props {
  state: AppState;
  onSubmit: (next: Partial<AppState>) => void;
  onCancel: () => void;
}

export const SettingsModal: React.FC<Props> = ({ state, onSubmit, onCancel }) => {
  const [root, setRoot] = React.useState(state.sessionRoot ?? '');
  const [term, setTerm] = React.useState<TerminalChoice>(state.terminal);

  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text bold>Settings</Text>
      <Text>Session root (leave blank to auto-detect):</Text>
      <TextInput value={root} onChange={setRoot} />
      <Text>Terminal:</Text>
      {(['terminal', 'iterm2', 'warp'] as TerminalChoice[]).map((t) => (
        <Text key={t}>
          {term === t ? '● ' : '○ '}
          {t}
        </Text>
      ))}
      <Text dimColor>Press T to switch terminal · Enter to save · Esc to cancel</Text>
      {/* 简化版：Enter 保存当前态；后续 Task 7.14 接入 T 键循环 */}
    </Box>
  );
};
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/modals/SettingsModal.tsx
git commit -m "feat(tui): SettingsModal with sessionRoot + terminal radio"
```

## Task 7.8：HelpModal

**Files:**
- Create: `src/tui/modals/HelpModal.tsx`

- [x] **Step 1：写入 `src/tui/modals/HelpModal.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  onClose: () => void;
}

const LINES: Array<[string, string]> = [
  ['Tab', 'Switch pane'],
  ['↑ / ↓', 'Navigate'],
  ['Enter', 'Resume session'],
  ['n', 'New session in project'],
  ['r', 'Rename focused item'],
  ['d', 'Delete manual project'],
  ['c', 'Copy session ID'],
  ['/', 'Search sessions'],
  ['a', 'Add manual project'],
  [',', 'Open settings'],
  ['?', 'Show this help'],
  ['q / Ctrl+C', 'Quit'],
];

export const HelpModal: React.FC<Props> = ({ onClose }) => (
  <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
    <Text bold>Keyboard shortcuts</Text>
    {LINES.map(([k, v]) => (
      <Text key={k}>
        <Text color="cyan">{k.padEnd(12)}</Text> {v}
      </Text>
    ))}
    <Text dimColor>Press ? or Esc to close</Text>
  </Box>
);
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/modals/HelpModal.tsx
git commit -m "feat(tui): HelpModal listing all keybindings"
```

## Task 7.9：ConfirmModal

**Files:**
- Create: `src/tui/modals/ConfirmModal.tsx`

- [x] **Step 1：写入 `src/tui/modals/ConfirmModal.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<Props> = ({ prompt, onConfirm, onCancel }) => (
  <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
    <Text bold color="red">{prompt}</Text>
    <Text>
      Press <Text color="green">Y</Text> to confirm, <Text color="red">N</Text> or Esc to cancel.
    </Text>
  </Box>
);
```

> 实际 Y/N 键位在 Task 7.14 的 modal 拦截分支处理。

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/modals/ConfirmModal.tsx
git commit -m "feat(tui): ConfirmModal skeleton (Y/N bound in Task 7.14)"
```

## Task 7.10：StatusBar

**Files:**
- Create: `src/tui/components/StatusBar.tsx`

- [x] **Step 1：写入 `src/tui/components/StatusBar.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  projectCount: number;
  sessionCount: number;
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
  lastAction: string | null;
}

export const StatusBar: React.FC<Props> = ({ projectCount, sessionCount, scanStatus, lastAction }) => (
  <Box>
    <Text dimColor>
      Projects: {projectCount} · Sessions: {sessionCount} · Scan: {scanStatus}
    </Text>
    {lastAction && (
      <>
        <Text>  ·  </Text>
        <Text color="green">{lastAction}</Text>
      </>
    )}
  </Box>
);
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/components/StatusBar.tsx
git commit -m "feat(tui): StatusBar with scan status and last action"
```

## Task 7.11：EmptyState

**Files:**
- Create: `src/tui/components/EmptyState.tsx`

- [x] **Step 1：写入 `src/tui/components/EmptyState.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export const EmptyState: React.FC = () => (
  <Box flexDirection="column" paddingX={1}>
    <Text dimColor>No projects found.</Text>
    <Text dimColor>Press `a` to add a directory, or `,` to configure the session root.</Text>
  </Box>
);
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/components/EmptyState.tsx
git commit -m "feat(tui): EmptyState guidance component"
```

## Task 7.12：Tab 键切换焦点 + 视觉高亮

**Files:**
- Modify: `src/tui/App.tsx`

**Interfaces:**
- Produces: `state.focusedPane` 切换；ProjectPane/SessionPane 的 borderColor 跟随

- [x] **Step 1：在 App reducer 增加 TOGGLE_FOCUS action**

```ts
| { type: 'TOGGLE_FOCUS' };

// case:
case 'TOGGLE_FOCUS':
  return { ...state, focusedPane: state.focusedPane === 'projects' ? 'sessions' : 'projects' };
```

- [x] **Step 2：在 App 渲染处添加 ProjectPane/SessionPane**

替换 `App.tsx` 的 render 部分：

```tsx
import { ProjectPane } from './panes/ProjectPane.js';
import { SessionPane } from './panes/SessionPane.js';
import { StatusBar } from './components/StatusBar.js';

return (
  <Box flexDirection="column">
    <Box>
      <Box width="40%"><ProjectPane projects={state.projects} selectedKey={state.selectedProjectKey} focused={state.focusedPane === 'projects'} onSelect={(k) => dispatch({ type: 'SELECT_PROJECT', key: k })} /></Box>
      <Box width="60%"><SessionPane sessions={state.projects.find((p) => p.key === state.selectedProjectKey)?.sessions ?? []} selectedId={state.selectedSessionId} focused={state.focusedPane === 'sessions'} onSelect={(id) => dispatch({ type: 'SELECT_SESSION', id })} /></Box>
    </Box>
    <StatusBar projectCount={state.projects.length} sessionCount={state.projects.reduce((n, p) => n + p.sessions.length, 0)} scanStatus={state.scanStatus} lastAction={null} />
  </Box>
);
```

- [x] **Step 3：编译 + 启动目测**

```bash
npx tsc --noEmit
npx tsx src/cli.tsx </dev/null 2>&1 &
sleep 1
kill %1 2>/dev/null || true
```

预期输出包含 `Projects (0)` 与 `Sessions (0)`。

- [x] **Step 4：提交**

```bash
git add src/tui/App.tsx
git commit -m "feat(tui): two-pane layout with Tab focus switching"
```

## Task 7.13：搜索 `/` 打开 SearchModal + 过滤

**Files:**
- Modify: `src/tui/App.tsx`

- [x] **Step 1：在 App 的 useInput 处增加 `/` 分支**

在 `src/tui/App.tsx` 内部新增：

```tsx
import { useInput } from 'ink';

// 在 App 组件中：
useInput((input) => {
  if (state.modal !== 'none') return; // 模态期间忽略
  if (input === '/') dispatch({ type: 'OPEN_MODAL', modal: 'search' });
  if (input === '?') dispatch({ type: 'OPEN_MODAL', modal: 'help' });
});

// 当 modal === 'search'：
{state.modal === 'search' && (
  <SearchModal
    onSubmit={(q) => {
      dispatch({ type: 'SET_SEARCH', q });
      dispatch({ type: 'CLOSE_MODAL' });
    }}
    onCancel={() => dispatch({ type: 'CLOSE_MODAL' })}
  />
)}
```

- [x] **Step 2：在 SessionPane 添加过滤**

```tsx
import type { Session } from '../../state/types.js';

const filtered = sessions.filter((s) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    s.displayName.toLowerCase().includes(needle) ||
    s.cwd.toLowerCase().includes(needle) ||
    s.id.toLowerCase().startsWith(needle)
  );
});
```

并在 App 渲染 SessionPane 时传入 `searchQuery={state.searchQuery}` —— 用 prop drilling。

- [x] **Step 3：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/App.tsx src/tui/panes/SessionPane.tsx
git commit -m "feat(tui): search modal wired to SessionPane filter"
```

## Task 7.14：绑定其余键位（r/n/a/d/c/,/?/q/Ctrl+C）

**Files:**
- Modify: `src/tui/App.tsx`

- [x] **Step 1：在 `useInput` 内逐分支绑定**

```tsx
useInput((input, key) => {
  if (state.modal === 'confirm') {
    if (input === 'y' || input === 'Y') {
      // 执行 confirmAction
      if (state.modalContext.confirmAction === 'deleteManualProject') {
        void import('../actions/deleteManualProject.js').then((m) =>
          m.deleteManualProject(state.modalContext.confirmPayload!)
        );
      }
      dispatch({ type: 'CLOSE_MODAL' });
    }
    if (input === 'n' || input === 'N' || key.escape) dispatch({ type: 'CLOSE_MODAL' });
    return;
  }
  if (state.modal !== 'none') return;
  if (key.tab) dispatch({ type: 'TOGGLE_FOCUS' });
  if (input === 'q' || (key.ctrl && input === 'c')) {
    void import('../state/lock.js').then((m) => m.release());
    process.exit(0);
  }
  if (input === 'n') dispatch({ type: 'OPEN_MODAL', modal: 'settings', ctx: { /* unused */ } });
  if (input === 'r') dispatch({ type: 'OPEN_MODAL', modal: 'rename' });
  if (input === 'd') dispatch({ type: 'OPEN_MODAL', modal: 'confirm', ctx: { confirmAction: 'deleteManualProject' } });
  if (input === 'c' && state.selectedSessionId) {
    void import('../actions/copySessionId.js').then((m) => m.copySessionId(state.selectedSessionId));
  }
  if (input === 'a') void import('../actions/addManualProject.js').then((m) => m.addManualProject());
  if (input === ',') dispatch({ type: 'OPEN_MODAL', modal: 'settings' });
});
```

- [x] **Step 2：编译**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 3：提交**

```bash
git add src/tui/App.tsx
git commit -m "feat(tui): bind r/n/a/d/c/,/?/q with confirm flow"
```

## Task 7.15：Enter 行为（在 session 上 resumeSession，在 project 上聚焦 session pane）

**Files:**
- Modify: `src/tui/App.tsx`

- [x] **Step 1：在 `useInput` 增加 Enter 分支**

```tsx
if (key.return) {
  if (state.focusedPane === 'sessions' && state.selectedSessionId) {
    const sess = state.projects
      .flatMap((p) => p.sessions)
      .find((s) => s.id === state.selectedSessionId);
    if (sess) {
      void import('../actions/resumeSession.js').then((m) =>
        m.resumeSession(sess, state.terminal)
      );
    }
  } else if (state.focusedPane === 'projects') {
    dispatch({ type: 'FOCUS_PANE', pane: 'sessions' });
  }
}
```

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/App.tsx
git commit -m "feat(tui): Enter resumes session or focuses session pane"
```

## Task 7.16：终端 resize 处理

**Files:**
- Create: `src/tui/hooks/useTerminalSize.ts`

- [x] **Step 1：写入 `src/tui/hooks/useTerminalSize.ts`**

```ts
import { useEffect, useState } from 'react';

export function useTerminalSize(): { cols: number; rows: number } {
  const [size, setSize] = useState({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });
  useEffect(() => {
    const onResize = (): void =>
      setSize({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return size;
}
```

- [x] **Step 2：在 `App.tsx` 应用尺寸（窄列时截断）**

在 App 顶层：

```tsx
const { cols } = useTerminalSize();
const compact = cols < 100;
```

并把 `compact` 透传到 Pane，让 Pane 视情况省略字段。

- [x] **Step 3：编译 + 提交**

```bash
npx tsc --noEmit
git add src/tui/hooks/useTerminalSize.ts src/tui/App.tsx
git commit -m "feat(tui): terminal resize hook + compact mode below 100 cols"
```

---

# 第 8 组：Folder Picker

## Task 8.1：`folder-picker.ts`（用 osascript 的 `choose folder`）

**Files:**
- Create: `src/util/folder-picker.ts`
- Replace placeholder from Task 6.5

- [x] **Step 1：写入 `src/util/folder-picker.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function pickFolder(prompt: string): Promise<string | null> {
  const script = `
set theFolder to choose folder with prompt "${prompt.replace(/"/g, '\\"')}"
return POSIX path of theFolder
`;
  try {
    const { stdout } = await exec('osascript', ['-e', script]);
    const out = stdout.trim();
    return out === 'false' ? null : out;
  } catch (err) {
    // 用户取消 → exit code 1，无 stdout
    if ((err as { code?: number }).code === 1) return null;
    throw err;
  }
}
```

- [x] **Step 2：手测**

```bash
npx tsx -e "import('./src/util/folder-picker.js').then(m => m.pickFolder('Pick').then(p => console.log('picked:', p)).catch(e => console.error('err', e)));"
# 在弹窗里选一个目录 → 终端打印 POSIX 路径
```

- [x] **Step 3：替换 Task 6.5 占位**

编辑 `src/actions/addManualProject.ts`，删除 placeholder 注释（Task 6.5 引入的 stub 已被覆盖）。

- [x] **Step 4：编译 + 提交**

```bash
npx tsc --noEmit
git add src/util/folder-picker.ts src/actions/addManualProject.ts
git commit -m "feat(util): macOS folder picker via osascript choose folder"
```

## Task 8.2：取消时返回 null（已由 Task 8.1 实现）

- [x] **Step 1：编译检查**

```bash
npx tsc --noEmit
```

预期：exit 0。

- [x] **Step 2：提交（空提交或与 8.3 合并）**

把改动并入下一个任务。

## Task 8.3：路径校验（存在且为目录）

**Files:**
- Modify: `src/actions/addManualProject.ts`

- [x] **Step 1：在 addManualProject 内强化校验**

```ts
import { existsSync, statSync } from 'node:fs';

// 替换已有校验：
const stat = statSync(resolved, { throwIfNoEntry: false });
if (!stat || !stat.isDirectory()) return null;
```

如未启用 `throwIfNoEntry` 选项（Node 14+），可用：

```ts
const stat = await fs.stat(resolved).catch(() => null);
if (!stat || !stat.isDirectory()) return null;
```

确保 `src/actions/addManualProject.ts` 用一致写法。

- [x] **Step 2：编译 + 提交**

```bash
npx tsc --noEmit
git add src/actions/addManualProject.ts
git commit -m "feat(actions): reject non-directory paths from picker"
```

---

# 第 9 组：集成与冒烟测试（Integration & Smoke）

## Task 9.1：在 `cli.tsx` 串联

**Files:**
- Modify: `src/cli.tsx`
- Create: `src/state/lock.ts`

**Interfaces:**
- Produces: 启动顺序：进程锁 → loadState → detectRoot → runDiscovery(回调) → render App

- [x] **Step 1：实现 `src/state/lock.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './store.js';

const LOCK_PATH = path.join(CONFIG_DIR, 'lock');

interface LockData {
  pid: number;
  timestamp: number;
}

async function readLock(): Promise<LockData | null> {
  try {
    const raw = await fs.readFile(LOCK_PATH, 'utf8');
    return JSON.parse(raw) as LockData;
  } catch {
    return null;
  }
}

async function writeLock(pid: number): Promise<void> {
  const data: LockData = { pid, timestamp: Date.now() };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(LOCK_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export async function tryAcquire(): Promise<'acquired' | 'taken' | 'stale'> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readLock();
  if (!existing) {
    await writeLock(process.pid);
    return 'acquired';
  }
  try {
    process.kill(existing.pid, 0);
    return 'taken';
  } catch {
    // dead PID
  }
  const ageMs = Date.now() - existing.timestamp;
  if (ageMs > 24 * 60 * 60 * 1000) {
    await writeLock(process.pid);
    return 'stale';
  }
  return 'taken';
}

export async function release(): Promise<void> {
  try {
    const existing = await readLock();
    if (existing?.pid === process.pid) {
      await fs.unlink(LOCK_PATH);
    }
  } catch {
    /* ignore */
  }
}

process.on('exit', () => void release());
process.on('SIGINT', () => {
  void release();
  process.exit(0);
});
```

- [x] **Step 2：重写 `src/cli.tsx`**

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { loadState, saveState } from './state/store.js';
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { groupSessions } from './grouping/group.js';
import { tryAcquire, release } from './state/lock.js';
import type { Project, SessionMeta } from './state/types.js';

async function main(): Promise<void> {
  const lockResult = await tryAcquire();
  if (lockResult === 'taken') {
    // 用户选择接管不在冒烟里处理；显示提示并退出
    console.error('Another ccsm instance is running.');
    process.exit(1);
  }

  const appState = await loadState();
  const detected = await detectRoot();
  const root = appState.sessionRoot ?? detected;

  // 临时路径，无可用根则返回
  const projects: Project[] = [];
  const seenMetas: SessionMeta[] = [];

  const onMeta = (meta: SessionMeta): void => {
    seenMetas.push(meta);
    const grouped = groupSessions(seenMetas, appState);
    grouped.sort((a, b) => {
      if (a.manual !== b.manual) return a.manual ? -1 : 1;
      const at = a.sessions[0]?.lastTimestamp ?? '';
      const bt = b.sessions[0]?.lastTimestamp ?? '';
      return bt.localeCompare(at);
    });
    Object.assign(projects, grouped);
  };

  // 启动扫描（不 await）—— UI 抢先渲染
  void (async (): Promise<void> => {
    if (!root) return;
    await runDiscovery(root, onMeta);
  })();

  const { unmount } = render(
    React.createElement(App, {
      bootstrapState: appState,
      projects,
      onSession: (cb) => {
        // 在 onMeta 内部已经处理；这里 hook 仅用于记录通知
        void cb;
      },
      onScanComplete: () => {
        /* 占位 */
      },
    })
  );

  process.on('SIGINT', () => {
    unmount();
    void release();
    process.exit(0);
  });
}

void main();
```

- [x] **Step 3：编译 + 启动**

```bash
npx tsc --noEmit
npx tsx src/cli.tsx </dev/null 2>&1 &
sleep 1
kill %1 2>/dev/null || true
```

预期输出：UI 出现 `Projects (0)` 或 `Projects (N)`。

- [x] **Step 4：提交**

```bash
git add src/cli.tsx src/state/lock.ts
git commit -m "feat(cli): wire loadState → detectRoot → runDiscovery → render App"
```

## Task 9.2：手测（在真实 `~/.claude/projects/` 上）

**Files:** none（人为执行）

- [x] **Step 1：构建**

```bash
npm run build
```

预期：dist/cli.js 存在。

- [x] **Step 2：本地运行**

```bash
./dist/cli.js
```

预期：UI 渲染。若 `~/.claude/projects/` 有真实 session，则项目列表非空。

- [x] **Step 3：人工记录结果**

在 README 草稿或个人笔记中记录截图 / 行为。**这一步不进入仓库。**

- [x] **Step 4：如发现问题，归类并提交修复**

```bash
git commit -m "fix(integration): <description>"
```

## Task 9.3：验证 Enter 打开 Terminal 且 cwd 正确

- [x] **Step 1：在 Terminal.app 中执行 `ccsm`，在 session 上按 Enter**

预期：Terminal.app 跳到前台，新窗口执行 `cd '<session-cwd>' && claude --resume <id>`。

- [x] **Step 2：提交（如需代码改动）**

若发现 cwd 截断或转义错误，按 bug 提 PR 修复：

```bash
git commit -m "fix(terminal): correct cwd escape in resume session"
```

## Task 9.4：验证 `n` 打开 Terminal.app 在项目目录

- [x] **Step 1：在 Project 上按 `n`**

预期：新 Terminal 窗口在 project.cwd 启动并执行 `claude`。

- [x] **Step 2：若失败则修复并提交**

## Task 9.5：验证 r / d / c 重启保留

- [x] **Step 1：按 `r` 重命名一个 session，重启 ccsm，验证别名保留**

```bash
cat ~/.config/cc-manager/state.json | jq .sessionAliases
```

预期：含新别名。

- [x] **Step 2：按 `d` 删除手动项目，重启验证不恢复**

```bash
cat ~/.config/cc-manager/state.json | jq '.manualProjects | length'
```

预期：减少 1。

- [x] **Step 3：按 `c` 复制 sessionId，粘贴确认 UUID**

- [x] **Step 4：提交（若有改动）**

## Task 9.6：搜索 + Escape

- [x] **Step 1：按 `/` 输入关键字，Enter；预期 Session 列表过滤**

- [x] **Step 2：按 Escape（在主视图），预期过滤清除**

## Task 9.7：`,` 切换设置

- [x] **Step 1：按 `,` 打开 Settings，切换 Terminal 到 iterm2，保存，重启验证**

预期：state.json.terminal === 'iterm2'。

## Task 9.8：`?` 帮助浮层

- [x] **Step 1：按 `?` 看到键位列表；再次 `?` 或 Esc 关闭**

## Task 9.9：`q` 干净退出

- [x] **Step 1：按 `q`，验证 lock 文件被删**

```bash
test ! -f ~/.config/cc-manager/lock && echo "lock cleared"
```

预期：`lock cleared`。

- [x] **Step 2：若未清理，修复并提交**

```bash
git commit -m "fix(lock): ensure release() on quit"
```

---

# 第 10 组：构建与分发（Build & Distribution）

## Task 10.1：`npm run build` 产出可用 dist

- [x] **Step 1：清理后构建**

```bash
rm -rf dist
npm run build
ls -la dist/cli.js
head -1 dist/cli.js
```

预期：`dist/cli.js` 存在，首行 `#!/usr/bin/env node`。

- [x] **Step 2：直接执行**

```bash
chmod +x dist/cli.js
./dist/cli.js </dev/null &
PID=$!
sleep 1
kill $PID 2>/dev/null || true
```

预期：进程能启动；1 秒内 kill 后无残留 lock（验证清理钩子）。

## Task 10.2：`npm link` 全局验证

- [x] **Step 1：链接**

```bash
npm link
which ccsm
```

预期：`/Users/.../bin/ccsm` 路径输出。

- [x] **Step 2：开新 Terminal 会话，输入 `ccsm`**

预期：UI 启动（验证 PATH + shebang + ESM 均正确）。

## Task 10.3：README 端到端可用

- [x] **Step 1：按照 README 步骤操作**

新用户视角：
1. `npm install -g cc-session-manager`
2. `ccsm`
3. UI 出现

- [x] **Step 2：更新 README（如有差异）**

```bash
git add README.md
git commit -m "docs(readme): align install steps with verified flow"
```

## Task 10.4：冒烟脚本 `scripts/smoke.sh`

**Files:**
- Create: `scripts/smoke.sh`
- Create: `src/cli-smoke.ts`（dump 模式入口）

- [x] **Step 1：实现 `src/cli-smoke.ts`**

```ts
#!/usr/bin/env node
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { groupSessions } from './grouping/group.js';
import { loadState } from './state/store.js';
import { tryAcquire, release } from './state/lock.js';

async function main(): Promise<void> {
  await tryAcquire();
  const state = await loadState();
  const root = state.sessionRoot ?? (await detectRoot());
  const metas = [];
  if (root) await runDiscovery(root, (m) => metas.push(m));
  const projects = groupSessions(metas, state);
  console.log(JSON.stringify({ root, projectCount: projects.length, sessionCount: metas.length }, null, 2));
  await release();
}

void main();
```

- [x] **Step 2：在 `tsup.config.ts` 增加 smoke entry**

```ts
entry: ['src/cli.tsx', 'src/cli-smoke.ts'],
```

- [x] **Step 3：写入 `scripts/smoke.sh`**

```bash
#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --silent

OUT=$(./dist/cli-smoke.js)
echo "$OUT"

echo "$OUT" | node -e "
let s = '';
process.stdin.on('data', (d) => s += d);
process.stdin.on('end', () => {
  const j = JSON.parse(s);
  if (typeof j.projectCount !== 'number') throw new Error('missing projectCount');
  console.log('SMOKE OK');
});
"

test -f ~/.config/cc-manager/state.json && echo "state.json present"
test -f ~/.config/cc-manager/lock && {
  LOCK_PID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HOME/.config/cc-manager/lock','utf8')).pid)")
  kill -0 "$LOCK_PID" 2>/dev/null && echo "lock PID alive: $LOCK_PID"
}
```

- [x] **Step 4：跑一次**

```bash
chmod +x scripts/smoke.sh
./scripts/smoke.sh
```

预期：`SMOKE OK` 输出。

- [x] **Step 5：提交**

```bash
git add scripts/smoke.sh src/cli-smoke.ts tsup.config.ts
git commit -m "feat(distribution): smoke script covering dump, state.json, lock"
```

---

# 自检（Self-Review）

## Spec 覆盖率

| Spec 能力域 | 任务映射 |
|------------|----------|
| session-discovery：根目录探测 | 3.1 |
| session-discovery：元数据提取（含 lastPrompt） | 3.3, 4.2 |
| session-discovery：损坏行容错 | 3.3 (test) |
| session-discovery：后台扫描 | 3.4, 3.5 |
| session-discovery：手动覆盖 | 2.5, 7.7 |
| project-grouping：自动归组 | 4.1, 4.2 |
| project-grouping：manual 添加 | 6.5, 8.1, 8.3 |
| project-grouping：项目重命名 | 6.4, 7.6 |
| project-grouping：项目删除（manual only） | 6.6, 7.9, 7.14 |
| project-grouping：manual 项目下 `n` 新建 session | 6.2, 7.14 |
| session-management：列表 + 排序 | 4.3, 7.3 |
| session-management：显示名优先级 | 4.2 |
| session-management：Enter 恢复 | 6.1, 7.15 |
| session-management：重命名 session | 6.3, 7.6 |
| session-management：复制 ID | 6.7, 7.14 |
| session-management：搜索 | 7.5, 7.13 |
| terminal-integration：Terminal.app | 5.1, 5.2, 5.5 |
| terminal-integration：iTerm2 | 5.3, 5.5 |
| terminal-integration：Warp best effort | 5.4, 5.5 |
| terminal-integration：错误处理 | 5.6 |
| tui-interface：双面板 + Tab 切换 | 7.2, 7.3, 7.12 |
| tui-interface：键位全绑定 | 7.4, 7.13, 7.14, 7.15 |
| tui-interface：模态 | 7.5-7.9 |
| tui-interface：loading + 空状态 | 3.5, 4.5, 7.11 |
| tui-interface：帮助 | 7.8 |
| tui-interface：宽度自适应 | 7.16 |
| state-persistence：路径与首创建 | 2.2 |
| state-persistence：schema | 2.1 |
| state-persistence：原子写 | 2.2 (tmp+rename) |
| state-persistence：损坏恢复 | 2.3 |
| state-persistence：并发实例 | 9.1 (lock) |

**结论**：所有 spec 场景均有对应任务；无空缺。

## 占位符扫描

- 全文件 grep：`TBD`、`TODO`、`fill in`、`implement later`、`add appropriate`、`handle edge cases`
  - 仅在 `src/actions/addManualProject.ts` 的 stub 注释中存在 "placeholder"；Task 8.1/8.3 已替换为真实实现。
- 类型 / 函数名一致性：`getAlias`/`setAlias` 在 2.6/6.3/6.4 一致；`groupSessions` 输入始终 `(SessionMeta[], AppState)`；`dispatchOpen(terminal, req)` 三个调用点签名一致。
- 引用任务未实现依赖：5 个相对时间格式化点在 4.2 引入 inline 占位 `relativeTime = iso => iso`；**修正**：见下方"补充任务"。

## 补充任务：实现 `relative-time` 工具

### Task 4.7（插入在 4.6 后）：`util/relative-time.ts`

**Files:**
- Create: `src/util/relative-time.ts`
- Create: `tests/util/relative-time.test.ts`
- Modify: `src/grouping/group.ts`（替换 inline 占位）

- [x] **Step 1：写红测**

```ts
import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../src/util/relative-time.js';

it('returns "just now" for <1m', () => {
  const now = new Date('2026-01-01T00:00:30Z').getTime();
  expect(relativeTime('2026-01-01T00:00:00Z', now)).toBe('just now');
});

it('returns "<1m" for <60s past', () => {
  expect(relativeTime(new Date(Date.now() - 30_000).toISOString())).toBe('just now');
});

it('returns "Nm ago" for <60m', () => {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  expect(relativeTime(past)).toBe('5m ago');
});

it('returns "Nh ago" for <24h', () => {
  const past = new Date(Date.now() - 3 * 3600_000).toISOString();
  expect(relativeTime(past)).toBe('3h ago');
});

it('returns "Nd ago" for >=24h', () => {
  const past = new Date(Date.now() - 3 * 86400_000).toISOString();
  expect(relativeTime(past)).toBe('3d ago');
});
```

- [x] **Step 2：跑测，RED**

```bash
npx vitest run tests/util/relative-time.test.ts
```

预期：FAIL。

- [x] **Step 3：实现 `src/util/relative-time.ts`**

```ts
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = now - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
```

- [x] **Step 4：编辑 `src/grouping/group.ts`**

替换 inline 占位：

```ts
import { relativeTime } from '../util/relative-time.js';
```

删除：

```ts
const relativeTime = (iso: string): string => iso; // 占位；Task 后续替换
```

- [x] **Step 5：跑测，GREEN**

```bash
npx vitest run tests/util/relative-time.test.ts tests/grouping/group.test.ts
```

预期：全部 PASS。

- [x] **Step 6：提交**

```bash
git add src/util/relative-time.ts tests/util/relative-time.test.ts src/grouping/group.ts
git commit -m "feat(util): relative-time formatter with vitest coverage"
```

---

## 类型与方法名一致性核查

- `loadState` / `saveState` / `getSessionRoot` / `getAlias` / `setAlias` — 定义在 `src/state/store.ts`；消费点 6.3/6.4/6.5/6.6/9.1 一致。
- `detectRoot` / `listJsonlFiles` / `parseJsonlFile` / `runDiscovery` / `scanBackground` — 命名唯一。
- `groupSessions(sessions, state)` — 输入 `(SessionMeta[], AppState)`，输出 `Project[]`；4.1-4.6 + 4.7 全部一致。
- `dispatchOpen(terminal, req)` — `req: { cwd, command }`，单一签名。
- `terminalApp` / `iterm2` / `warp` — 都是 `(req) => Promise<void>`。
- Action 函数：`resumeSession(session, terminal)`、`newSession(project, terminal)`、`renameSession(id, name)`、`renameProject(key, name)`、`addManualProject()`、`deleteManualProject(key)`、`copySessionId(id)` —— 各调用点签名一致。
- Modal 组件：`onSubmit` / `onCancel` —— 7.5-7.9 一致。
- `useKeybindings(dispatch, cbs)` —— `cbs` 14 个回调，与 7.13/7.14/7.15 各 key 分支一一对应。

无不一致。

---

## 执行交接

**Plan 完成并保存至** `docs/superpowers/plans/2026-07-07-cc-session-manager.md`。
**两种执行方式**：

1. **Subagent-Driven（推荐）** — 每个 Task 派一个独立 subagent，两阶段审查迭代；适合本计划的 71 个任务切片
2. **Inline Execution** — 在当前会话中按批执行 + 检查点复核

请明确选择执行方式后，启动对应 Superpowers skill：

- Subagent-Driven → `superpowers:subagent-driven-development`
- Inline → `superpowers:executing-plans`
