---
comet_change: cc-session-manager
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-07-cc-session-manager
status: final
---

# cc-session-manager — 技术设计

> OpenSpec delta spec 是规范层事实源（`openspec/changes/cc-session-manager/specs/*/spec.md`）。
> Open 高层方案见 `openspec/changes/cc-session-manager/design.md`。
> 本文档是**实现层深度设计**（模块边界、数据流、并发模型、错误处理、测试策略）。

## 0. 范围与非目标

### 范围

- macOS 终端 UI（Node.js + Ink + TypeScript），浏览/管理/恢复 Claude Code session
- Session 目录自动探测 + 用户可覆盖
- 按 cwd 自动归组项目 + 用户可手动添加目录
- 双击 session 恢复 / `n` 新建 / `r` 重命名 / `d` 删除手动项目 / `c` 复制 sessionId / `/` 搜索
- 多终端支持（Terminal.app / iTerm2 / Warp）
- 状态持久化 + 多实例并发安全
- 轻量测试（vitest 单元 + 手工冒烟脚本）

### 非目标

- 修改 Claude Code 内部 JSONL（只读）
- 跨平台（macOS only）
- Session 内容语义搜索
- GUI 桌面窗口 / 全局快捷键
- 网络同步 / 协作 / 分享

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 1. 架构

### 1.1 进程模型

单 Node 进程 + worker_threads 池。

```
┌─────────────────────────────────────────────────────────────┐
│                   ccsm (单 Node 进程)                       │
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  主线程 (Ink TUI)    │    │  worker_threads 池 (×N)  │   │
│  │                      │    │                          │   │
│  │  App.tsx             │◄──►│  worker.js               │   │
│  │   ├ useReducer       │    │   ├ 读 JSONL 流          │   │
│  │   ├ useInput         │    │   ├ 解析每行             │   │
│  │   ├ ProjectPane      │    │   └ MessagePort 发回     │   │
│  │   ├ SessionPane      │    │                          │   │
│  │   └ Modal 堆叠       │    │  N = min(4, cpus-1)      │   │
│  └──────────────────────┘    └──────────────────────────┘   │
│            │                                                 │
│            ▼                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  action 层           │    │  state 持久化            │   │
│  │  ├ resumeSession     │    │  ~/.config/cc-manager/   │   │
│  │  ├ newSession        │    │  ├ state.json            │   │
│  │  ├ renameSession     │───►│  └ lock (PID)            │   │
│  │  ├ addManualProject  │    │                          │   │
│  │  └ ...               │    │  (原子写 + 进程锁)       │   │
│  └──────────────────────┘    └──────────────────────────┘   │
│            │                                                 │
│            ▼                                                 │
│  ┌──────────────────────┐                                    │
│  │  terminal 派发器     │                                    │
│  │  ├ escape.ts         │──► osascript -e '...'             │
│  │  ├ terminal-app.ts   │                                    │
│  │  ├ iterm2.ts         │                                    │
│  │  └ warp.ts           │                                    │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 模块边界

每个文件单一职责；通过类型化接口通信。

| 文件 | 职责 | 入参 | 出参 | 依赖 |
|------|------|------|------|------|
| `src/cli.tsx` | 入口；顺序：进程锁 → 加载 state → 探测根 → 启动 worker → 渲染 App | argv | process exit code | App, state, discovery, lock |
| `src/tui/App.tsx` | 根 Ink 组件；useReducer + 路由 | (无) | rendered output | 子组件, hooks |
| `src/tui/panes/ProjectPane.tsx` | 项目列表 | projects, selectedKey, focus | rendered | App state |
| `src/tui/panes/SessionPane.tsx` | session 列表 | sessions, selectedId, focus | rendered | App state |
| `src/tui/modals/SearchModal.tsx` | 搜索框 | initialQuery | onSubmit/onCancel | ink-text-input |
| `src/tui/modals/RenameModal.tsx` | 重命名输入 | initialName, kind | onSubmit/onCancel | ink-text-input |
| `src/tui/modals/SettingsModal.tsx` | 设置 UI | state | onSubmit/onCancel | ink-text-input, ink-select-input |
| `src/tui/modals/HelpModal.tsx` | 键位帮助 | (无) | onClose | (无) |
| `src/tui/modals/ConfirmModal.tsx` | 确认弹窗 | prompt | onConfirm/onCancel | (无) |
| `src/tui/hooks/useKeybindings.ts` | 按键 → dispatch | (无) | void | dispatch |
| `src/tui/hooks/useTerminalSize.ts` | 跟踪终端尺寸 | (无) | {cols, rows} | stdout resize event |
| `src/discovery/detectRoot.ts` | 探测 session 根 | (无) | string \| null | os, fs, env |
| `src/discovery/parse.ts` | 单 JSONL → SessionMeta | filePath | SessionMeta \| null | fs, readline |
| `src/discovery/scan.ts` | 扫描目录 + 派发 worker | rootPath, onMeta callback | void | worker_threads, parse |
| `src/discovery/worker.js` | worker 入口 | filePath (via MessagePort) | SessionMeta \| null | parse |
| `src/grouping/group.ts` | SessionMeta[] + state → Project[] | sessions, state | Project[] | 纯函数 |
| `src/actions/resumeSession.ts` | 恢复 session | session | void | terminal, dispatch |
| `src/actions/newSession.ts` | 新建 session | project | void | terminal, dispatch |
| `src/actions/renameSession.ts` | 重命名 session | sessionId, newName | void | state, dispatch |
| `src/actions/renameProject.ts` | 重命名项目 | groupKey, newName | void | state, dispatch |
| `src/actions/addManualProject.ts` | 添加手动项目 | (无) | void | folder-picker, state |
| `src/actions/deleteManualProject.ts` | 删除手动项目 | groupKey | void | state, dispatch |
| `src/actions/copySessionId.ts` | 复制 sessionId | sessionId | void | child_process, dispatch |
| `src/terminal/escape.ts` | AppleScript 转义 | cwd: string | string | 纯函数 |
| `src/terminal/terminal-app.ts` | Terminal.app 后端 | {cwd, command} | Promise<void> | child_process |
| `src/terminal/iterm2.ts` | iTerm2 后端 | {cwd, command} | Promise<void> | child_process |
| `src/terminal/warp.ts` | Warp 后端（best effort） | {cwd, command} | Promise<void> | child_process |
| `src/terminal/index.ts` | 派发器 | {cwd, command, terminal} | Promise<void> | 三个后端 |
| `src/util/folder-picker.ts` | macOS 文件夹选择器 | prompt | Promise<string \| null> | osascript |
| `src/util/relative-time.ts` | 时间格式化为 "2h ago" | ISO8601 | string | 纯函数 |
| `src/state/types.ts` | 类型定义 | (无) | (types) | (无) |
| `src/state/store.ts` | 原子读写 | (无) | AppState | fs |
| `src/state/lock.ts` | 进程锁 | (无) | void | fs, process |

**关键边界规则：**
- `discovery/*` 不依赖 `tui/*`（UI 可替换为 CLI）
- `terminal/*` 不依赖 `state/*`（独立可测试）
- `actions/*` 是 TUI 与底层之间的胶水，依赖 TUI dispatch
- `grouping/*` 是纯函数，无副作用
- `state/*` 只依赖 `fs`，无业务逻辑

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 2. 数据模型

### 2.1 SessionMeta（来自 JSONL 解析）

```typescript
interface SessionMeta {
  sessionId: string;        // UUID
  cwd: string;              // session 工作目录
  firstUserMessage: string | null;  // 首条 user 消息（可能含 XML 标签）
  lastPrompt: string | null;        // Claude Code 内部 last-prompt 记录；纯文本
  lastTimestamp: string;    // ISO8601，最后一条记录时间
  sizeBytes: number;        // JSONL 文件大小（用于显示和跳过判断）
  lineCount: number;        // JSONL 行数
}
```

### 2.2 Project（应用层）

```typescript
interface Project {
  key: string;              // cwd 绝对路径（auto）或 path（manual）
  displayName: string;      // 用户别名 > lastPrompt 截断 > firstUserMessage 剥 XML > cwd basename
  cwd: string;              // 真实路径
  manual: boolean;          // 是否手动添加
  hidden: boolean;          // 是否在 hiddenProjects
  sessions: Session[];      // 排序：lastTimestamp desc
}

interface Session {
  id: string;               // sessionId
  displayName: string;      // 见 §4
  cwd: string;
  lastActiveRelative: string;  // "2h ago"
  lastTimestamp: string;
}
```

### 2.3 AppState

```typescript
type ModalKind = 'none' | 'search' | 'rename' | 'settings' | 'help' | 'confirm' | 'warning';

interface AppState {
  // 数据
  projects: Project[];
  selectedProjectKey: string | null;
  selectedSessionId: string | null;
  focusedPane: 'projects' | 'sessions';
  searchQuery: string;       // 空字符串 = 不过滤
  scanStatus: 'idle' | 'scanning' | 'complete' | 'degraded';
  scanProgress: { current: number; total: number };
  // 模态
  modal: ModalKind;
  modalContext: ModalContext;  // kind-specific payload
  // 派生
  filteredSessions: Session[]; // 根据 searchQuery 实时计算
  // 提示
  lastAction: { kind: string; payload: unknown; at: number } | null;
  // 启动
  bootstrapError: string | null;  // 探测失败时的引导信息
}
```

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 3. 数据流

### 3.1 启动序列

```
T+0ms      cli.tsx 启动
T+10ms     state/lock.tryAcquire() → 若 lock 存在且 PID 活 → 显示 warning modal
T+20ms     state/store.load() → AppState
T+30ms     discovery/detectRoot() → string | null
T+40ms     若 null → 渲染 SettingsModal 让用户指定；用户在 modal 中填入路径
T+50ms     Ink 启动 → 渲染 App
           └─ App.tsx 立即渲染 manualProjects（session 计数 0，标记 "Scanning…"）
           └─ TUI 已可交互（用户可改名、加项目、看帮助）
T+80ms     spawn N 个 worker_threads；初始化 worker pool
T+100ms    主线程 dispatch SCAN_STARTED
T+100ms+   scan() 列出所有 .jsonl，向 pool 派发任务
           每个 worker 处理一个 JSONL：
             ├ 读流式 readline
             ├ 提取 SessionMeta
             └ MessagePort 发送回主线程
           主线程每收到一个：
             dispatch({ type: 'SESSION_DISCOVERED', meta })
             → reducer 找到对应 Project，append session，触发 re-render
T+settle   pool 全 idle
           dispatch({ type: 'SCAN_COMPLETE' })
           → StatusBar 切换为 ready
```

### 3.2 用户操作 — Resume session

```
用户按 Enter
  ↓
useKeybindings 拦截 → dispatch({ type: 'RESUME_SESSION', sessionId })
  ↓
reducer 查 state → 触发 effect（useEffect 监听 action type）
  ↓
action/resumeSession(session):
  ├ terminal.dispatch({ command: `claude --resume ${id}`, cwd: session.cwd })
  │   ├ escape(cwd) → 转义后路径
  │   ├ spawn: `osascript -e 'tell app "Terminal" to do script "cd '\''...'\'' && claude --resume <id>"'`
  │   └ 触发 Terminal.app 打开新窗口
  └ dispatch({ type: 'OPEN_DISPATCHED', sessionId })
       → reducer: state.lastAction = { kind: 'opened', sessionId, at: Date.now() }
       → StatusBar: "Resumed: <displayName>" (2s 淡出)
```

### 3.3 用户操作 — New session

```
用户在 project 上按 n
  ↓
dispatch({ type: 'OPEN_NEW_SESSION', projectKey })
  ↓
action/newSession(project):
  ├ terminal.dispatch({ command: 'claude', cwd: project.cwd })
  └ dispatch({ type: 'NEW_SESSION_DISPATCHED', projectKey })
```

### 3.4 用户操作 — Rename

```
用户在 session 上按 r
  ↓
dispatch({ type: 'OPEN_MODAL', modal: 'rename', context: { kind: 'session', id, name } })
  ↓
reducer: state.modal = 'rename'; state.modalContext = {...}
  ↓
RenameModal 渲染（ink-text-input 预填 current name）
  ↓
用户输入新名 + Enter
  ↓
RenameModal onSubmit(newName)
  ↓
action/renameSession(id, newName):
  ├ state.setAlias('session', id, newName) → 原子写 state.json
  └ dispatch({ type: 'RENAME_APPLIED', kind: 'session', id, newName })
       → reducer: 更新 project.sessions[].displayName + state.sessionAliases
       → dispatch({ type: 'CLOSE_MODAL' })
```

### 3.5 用户操作 — Search

```
用户按 /
  ↓
dispatch({ type: 'OPEN_MODAL', modal: 'search' })
  ↓
SearchModal 渲染
  ↓
用户输入查询串（实时 dispatch SET_SEARCH_QUERY）
  ↓
reducer: state.searchQuery = q; state.filteredSessions = filter(sessions, q)
  ↓
用户按 Enter
  ↓
SearchModal onSubmit(q) → dispatch CLOSE_MODAL（query 已更新）
  ↓
User 按 Escape → dispatch({ type: 'CLEAR_SEARCH' }) → state.searchQuery = ''
```

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 4. 显示名优先级（细化）

`Session.displayName` 解析顺序：

```
1. state.sessionAliases[sessionId]   ← 用户在 TUI 用 r 键改的别名
   ↓ (未设置)
2. session.lastPrompt                ← Claude Code 内部 last-prompt 字段（纯文本）
   truncate(session.lastPrompt, 60)
   ↓ (lastPrompt 为 null)
3. session.firstUserMessage          ← 首条 user 消息
   stripXmlTags(session.firstUserMessage)  // 移除 <...> 标签
   truncate(result, 60)
   ↓ (剥 XML 后为空)
4. path.basename(session.cwd)        ← 兜底
```

`Project.displayName` 解析顺序：

```
1. state.projectAliases[key]
   ↓ (未设置)
2. path.basename(project.cwd)
```

**stripXmlTags 实现（伪代码）：**
```typescript
function stripXmlTags(s: string): string {
  return s
    .replace(/<command-message>([\s\S]*?)<\/command-message>/g, '$1')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '')
    .replace(/<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/g, '')
    .replace(/<[^>]+>/g, '')  // 兜底剥除任意标签
    .replace(/\s+/g, ' ')
    .trim();
}
```

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 5. 并发模型

### 5.1 worker_threads 池

```typescript
// src/discovery/scan.ts (伪代码)
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import PQueue from 'p-queue'; // 替代品：手写 promise pool

const POOL_SIZE = Math.min(4, Math.max(1, os.cpus().length - 1));

export async function scan(rootPath: string, onMeta: (meta: SessionMeta) => void) {
  const files = await listJsonlFiles(rootPath);
  const queue = new PQueue({ concurrency: POOL_SIZE });

  await Promise.all(files.map(file =>
    queue.add(() => runWorker(file).then(meta => meta && onMeta(meta)))
  ));
}

function runWorker(filePath: string): Promise<SessionMeta | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.js', { workerData: { filePath } });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}
```

**性能预算（5000 session）：**
- 文件列表：~50ms（一次 fs.readdir 递归）
- 解析（4 worker × 平均 100KB/文件 × 5000 文件 / 4 ≈ 1250 文件/worker）：~2-3s
- 主线程渲染：每收到 SessionMeta 触发 dispatch；Ink 批量 re-render（每 16ms 一帧）→ 用户感知为"数字持续增长"
- 首帧（仅 manualProjects 骨架）：< 50ms

### 5.2 worker 崩溃降级

```typescript
worker.once('error', (err) => {
  console.error('Worker error:', err);
  // 降级：主线程直接 readFileSync + parse
  const meta = parseFileSync(filePath);
  if (meta) onMeta(meta);
  // dispatch SCAN_DEGRADED 提示用户
});
```

### 5.3 state.json 并发安全

**进程锁实现（`src/state/lock.ts`）：**

```typescript
const LOCK_PATH = path.join(CONFIG_DIR, 'lock');

export async function tryAcquire(): Promise<'acquired' | 'taken' | 'stale'> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readLock();
  if (!existing) {
    await writeLock(process.pid);
    return 'acquired';
  }
  // 检查 PID 是否存活
  try {
    process.kill(existing.pid, 0);
    return 'taken'; // 另一实例在跑
  } catch {
    // PID 不存在，但 lock 文件还在
  }
  // 检查是否僵尸（> 24h）
  const ageMs = Date.now() - existing.timestamp;
  if (ageMs > 24 * 60 * 60 * 1000) {
    await writeLock(process.pid);
    return 'stale';  // 自动接管
  }
  return 'taken';
}

export async function release(): Promise<void> {
  try {
    const existing = await readLock();
    if (existing?.pid === process.pid) {
      await fs.unlink(LOCK_PATH);
    }
  } catch {} // 静默
}

// 注册退出钩子
process.on('exit', () => release());
process.on('SIGINT', () => { release(); process.exit(0); });
```

**原子写实现（`src/state/store.ts`）：**

```typescript
export async function saveState(state: AppState): Promise<void> {
  const tmp = `${STATE_PATH}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, STATE_PATH);  // POSIX rename 原子
}
```

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 6. AppleScript 转义

**核心规则：** AppleScript 字符串内嵌在 `-e '...'` 中，cwd 中需要避开单引号。

```typescript
// src/terminal/escape.ts
export function escapeForAppleScript(cwd: string): string {
  // POSIX 标准：' -> '\''（结束当前单引号字符串 + 转义单引号 + 重开单引号字符串）
  return cwd.replace(/'/g, "'\\''");
}

export function buildTerminalAppScript(cwd: string, command: string): string {
  const escapedCwd = escapeForAppleScript(cwd);
  // 命令本身的引号用 AppleScript 的双引号包裹，内部转义为 \"
  const escapedCmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "Terminal" to activate\ntell application "Terminal" to do script "cd '${escapedCwd}' && ${escapedCmd}"`;
}
```

**调用：**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

await exec('osascript', ['-e', script]);
```

使用 `execFile` + 参数数组而非 `exec` + 字符串拼接，避免 shell 注入。

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 7. 错误处理矩阵

| 失败场景 | 检测点 | 处理 |
|---------|--------|------|
| Session 根目录探测全部失败 | `detectRoot` 返回 null | 启动时进入 SettingsModal；要求用户指定路径 |
| 单个 JSONL 损坏行 | `parse.ts` try/catch per line | skip 该行；session 元数据只取成功的字段 |
| JSONL 为空文件 | `parse.ts` stream end + 0 records | 返回 null；不报错 |
| JSONL 文件正在写入 | readline 读到不完整行 | JSON.parse 失败 → skip；下次扫描会重读 |
| 超大 JSONL（> 100MB） | file size > 100MB | worker 改用 readline 流（默认即如此）；不一次性 readFileSync |
| worker thread 崩溃 | `worker.once('error')` | 主线程降级为同步解析；dispatch SCAN_DEGRADED |
| AppleScript 执行失败 | execFile reject | 解析 stderr；若是 "not authorized" 提示用户在 系统设置 → 隐私与安全 → 自动化 允许；其他错误显示通用错误 |
| iTerm2/Warp 未安装 | execFile 报 "command not found" | 显示错误"X is not installed. Switch to Terminal.app in Settings?"；提供按钮 |
| 文件夹选择器用户取消 | osascript 返回 "false" | 返回 null；项目列表不变 |
| 状态文件写入失败（ENOSPC） | saveState reject | 捕获错误；TUI 显示错误提示；内存中状态保留 |
| lastPrompt/firstUserMessage 都 null | grouping 检测 | 兜底到 cwd basename |
| 路径含 `'` / Unicode | escapeForAppleScript 单元测试覆盖 | 正常处理 |
| 并发实例 | tryAcquire 返回 'taken' | 渲染 warning modal；用户选 Yes 接管 / No 退出 |
| lock 僵尸（> 24h） | tryAcquire 返回 'stale' | 静默接管 |
| state.json 损坏 | loadState JSON.parse 失败 | rename 为 state.json.bak.<timestamp>；以默认 state 启动 |

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 8. 测试策略

### 8.1 单元测试（vitest）

| 模块 | 用例数 | 覆盖 |
|------|--------|------|
| `src/terminal/escape.ts` | 12+ | 正常 / `'` / `\` / 空格 / Unicode / 超长 / 空 / `'; rm -rf /` 注入尝试 / `<script>` / null 字节 / 多重嵌套 / 反斜杠转义 |
| `src/discovery/parse.ts` | 10+ | 正常 JSONL / 损坏行 / 空文件 / 单行 / 多行 / 缺字段 / 超大文件 / slash command 行 / last-prompt 在不同位置 / 多 last-prompt 取最新 |
| `src/grouping/group.ts` | 8+ | 去重 cwd / 用户别名优先 / hiddenProjects 过滤 / manualProjects 合并 / 空状态 / 5000 session 性能 < 100ms / cwd 相同但不同 sessionId / 路径标准化 |
| `src/state/store.ts` | 6+ | 原子写（tmp + rename）/ 损坏恢复（rename to .bak）/ 默认值合并 / 大 state（> 100KB）/ 并发写（文件系统原子 rename 即可） |
| `src/util/relative-time.ts` | 5+ | "just now" / "<1m" / "2h ago" / "3d ago" / 跨年 |

**不测：**
- AppleScript 执行结果（GUI 依赖）
- Warp 路径
- worker_threads 实际启动（用 mock MessagePort）

### 8.2 TUI 组件测试

跳过。手工冒烟覆盖。

### 8.3 端到端（`scripts/smoke.sh`）

```bash
#!/bin/bash
# 1. 探测根目录
ROOT=$(~/.config/cc-manager/state.json 2>/dev/null || echo "$HOME/.claude/projects")

# 2. 渲染 smoke（不打开 TUI，只 dump 项目/session 数量）
ccsm --smoke-dump > /tmp/ccsm-dump.json
test "$(jq '.projects | length' /tmp/ccsm-dump.json)" -gt 0

# 3. 验证 state.json 写入
test -f ~/.config/cc-manager/state.json

# 4. 验证 lock 文件
test -f ~/.config/cc-manager/lock
LOCK_PID=$(cat ~/.config/cc-manager/lock | jq -r .pid)
kill -0 $LOCK_PID
```

`--smoke-dump` 模式：不启动 TUI，仅执行扫描 + 打印 JSON；用于 CI。

### 8.4 手工冒烟清单（写到 README）

- [ ] 启动后项目列表显示与 `ls ~/.claude/projects/` 数量一致
- [ ] 双击 session 打开 Terminal.app 且 cwd 正确
- [ ] `n` 在项目上打开 Terminal.app 且执行 `claude`
- [ ] `r` 改 session 名后跨重启保留
- [ ] `d` 删手动项目后跨重启不恢复
- [ ] `c` 复制 sessionId 后粘贴确认
- [ ] `/` 搜索生效 + Escape 清除
- [ ] `,` 切换 iTerm2 后再操作由 iTerm2 接管
- [ ] `?` 帮助可见
- [ ] `q` 干净退出 + lock 文件被删

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 9. 风险与缓解（已细化的版本）

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Claude Code 升级改变 JSONL schema | 中 | session 元数据解析失败 | 解析层 try/catch per line；单条失败不影响其他；CI 加合成 JSONL 夹具 |
| 5000+ session 扫描慢 | 低 | 首帧 < 500ms 目标 | worker_threads 池 + 4 并发；200ms 后首帧已显示 manualProjects |
| osascript 权限被拦截 | 中 | 用户需在系统设置允许 | 首次启动检测到权限拒绝时打印 README 故障排查；UI 显示明确指引 |
| Warp AppleScript 兼容性差 | 高 | Warp 用户体验差 | 文档标注"实验性"；Warp fallback 到剪贴板复制命令 + 提示用户手动粘贴 |
| Ink 在某些终端渲染异常 | 低 | UI 错位 | 锁定 Ink 版本；README 标注支持的终端（iTerm2 / Terminal.app / WezTerm / Alacritty） |
| 多 ccsm 实例数据丢失 | 低 | 静默覆盖 | 进程锁 + warning modal（见 §5.3） |
| 状态文件损坏 | 极低 | 启动失败 | rename 为 .bak + 默认值；不阻断启动 |
| `escapeForAppleScript` 注入漏洞 | 极低 | 命令执行 | `execFile` 参数数组（非字符串拼接）；单元测试覆盖注入尝试 |

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 10. 任务分组（映射 OpenSpec tasks.md）

OpenSpec `tasks.md` 71 个任务按以下顺序执行：

```
1. Project Scaffolding (1.1-1.7)        — 基础设施
2. State Persistence (2.1-2.6)         — 无依赖
3. Session Discovery (3.1-3.6)         — 无依赖
4. Project Grouping (4.1-4.6)          — 依赖 2 + 3
5. Terminal Integration (5.1-5.7)      — 无依赖
6. Session Management Actions (6.1-6.7) — 依赖 2 + 5
7. TUI Interface (7.1-7.16)            — 依赖 4 + 6
8. Folder Picker (8.1-8.3)             — 无依赖
9. Integration & Smoke (9.1-9.9)       — 依赖全部
10. Build & Distribution (10.1-10.4)   — 依赖全部
```

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 11. Spec Patch 摘要（已应用到 `specs/*/spec.md`）

- `session-discovery/spec.md`：SessionMeta 增加 `lastPrompt: string | null` 字段
- `session-management/spec.md`：显示名优先级改写为 lastPrompt 优先；XML 剥离为兜底
- `tui-interface/spec.md`：新增 "Initial render with skeleton projects" 场景
- `state-persistence/spec.md`：新增 "Concurrent Instance Detection" 需求 + 3 个场景

archived-with: 2026-07-07-cc-session-manager
status: final
---

## 12. 开放问题（v1 范围内不解决）

- TUI 鼠标支持（Ink 支持但跨终端兼容性差）
- TUI 启动后立即显示 session 最近一条消息摘要
- session 标签 / 收藏夹 / 颜色
- Finder "在 Finder 中显示 JSONL" 集成
- 跨平台（Linux/Windows）支持

这些问题在 v1 完成后按用户反馈再评估。

