# Brainstorm Summary

- Change: cc-session-manager
- Date: 2026-07-07
- Phase: design
- Status: in-progress (brainstorming)

## 上下文（已确认）

- 全新项目，工作目录 `/Users/carlos/workspace/cc-manager`
- 技术栈：Node.js + Ink + TypeScript（明确不用 Rust）
- 范围 v4：项目（目录）一级 + session 二级；支持手动添加项目 + 新建 session；多终端支持；TUI 键位驱动
- 6 个 capability spec 已写入
- OpenSpec delta spec 包含验收场景（WHEN/THEN 格式）

## 已确认的技术决策

### 决策 4：Session 显示名优先级 = lastPrompt 优先
- **优先级链**：用户别名 → `lastPrompt`（前 60 字符）→ `firstUserMessage`（剥 XML + 截 60）→ cwd basename
- **关键发现**：Claude Code 内部存了 `type: "last-prompt"` 记录，含 `lastPrompt` 字段；这是它解析完用户输入后保存的纯文本，**不需要 XML 剥离**
- **取舍**：99% 场景显示的就是 session 真实主题；早期主题需用 `r` 改别名才能看到
- **风险**：`lastPrompt` 偶尔为空（新 session 未交互）；自动降级到 `firstUserMessage`
- **Spec Patch**：`session-management` spec 中的"First-user-message is a slash command"场景需改写为 lastPrompt 优先；`session-discovery` spec 的 SessionMeta 应增加 `lastPrompt` 字段

## 已确认的技术决策

### 决策 3：AppleScript 注入 = osascript -e 内联字符串
- `child_process.exec("osascript -e '...escaped...'")`
- **转义策略**：cwd 中 `'` 替换为 `'\''`（POSIX shell 标准）；命令本身用单引号包裹防注入
- **风险**：极长命令触发 ARG_MAX 限制（macOS 默认 256KB，足够）
- **缓解**：执行前在 Node 侧用 jest-like 单元测试覆盖 escape 函数

### 决策 2：TUI 状态管理 = 单 useReducer
- App 组件持 useReducer；通过 props 传 state 和 dispatch 给子组件
- 模态框用 `state.modal: 'none' | 'search' | 'rename' | 'settings' | 'help' | 'confirm'` 表达
- 子组件用 `useInput` 监听按键并 dispatch action
- **取舍**：组件嵌套浅（App → Pane → Item 两层），无需 Context 或第三方 store
- **风险**：状态规模超 100 个字段时 reducer 会变胖（目前预计 ~15 个字段，不构成问题）

## 已确认的技术决策

### 决策 1：JSONL 解析并发模型 = worker_threads 池
- 主 TUI 进程启动时立即渲染一帧（< 500ms 目标）
- 解析任务派发到 worker_threads 池（默认 4 worker）
- 主进程通过 `MessagePort` 接收增量结果，更新 `AppState.sessions`
- 引入 `node:worker_threads`（Node 内置），不增加外部依赖
- **取舍**：增加 IPC 序列化样板和测试复杂度；换来主线程零阻塞
- **风险**：worker pool 启动开销 ~50ms；worker 崩溃需 fallback 到主线程解析
- **缓解**：主进程保留主线程解析回退；pool 大小用 `Math.min(4, cpus.length - 1)`

## 待确认问题（待问）

- TUI 状态管理：`useReducer` 内联 vs `useReducer + Context` vs `zustand` 第三方？
- AppleScript 注入方式：`osascript -e` 内联字符串 vs 写入临时 .applescript 文件后 `osascript <file>`？
- 首条 user 消息作为显示名时的清理策略：纯截断 vs 剥离 `<command-message>` 等 XML 标签？
- 测试策略：单元测试（vitest）+ TUI 组件测试（ink-testing-library）+ 端到端（手动）？
- 多 ccsm 实例并发运行时的 state.json 竞态：文件锁 vs 进程内 mutex vs 接受 last-write-wins？

### 决策 7：TUI 首帧渲染 = 已有项目先渲染 + 后台扫
- 启动时：读 state.json → 渲染 manualProjects 骨架（每个项目 session 计数 0，显示 "Scanning…"） → 立即可交互
- 后台 worker_threads 扫到 session 后，逐条 dispatch `SESSION_DISCOVERED` action；UI 数字动态增长
- **取舍**：用户可立即操作（按 n 新建 session、按 r 改名）；session 数字短暂变化可接受
- **Spec Patch**：`tui-interface` spec 增加 "Initial render with skeleton projects" 场景

## 已确认的技术决策

### 决策 6：state.json 并发安全 = 进程锁 + 警告
- 启动时在 `~/.config/cc-manager/lock` 写 PID
- 检测到 lock 已存在 + PID 在跑 → 警告用户并询问：接管 / 退出
- lock 文件超过 24 小时未更新 → 视为僵尸，自动清理
- 实现：30 行 TypeScript，零依赖
- **Spec Patch**：`state-persistence` spec 增加 "Concurrent instance detection" 场景

## 候选 Spec Patch

- `session-management` spec 的 "First-user-message is a slash command" 场景需改写为 lastPrompt 优先
- `session-discovery` spec 的 SessionMeta 类型需增加 `lastPrompt: string` 字段
- `session-management` spec 的 "List sessions sorted by recency" 场景需明确以 `lastTimestamp` 排序

## 测试策略（轻量）

### 单元测试（vitest）
- `src/terminal/escape.ts`：cwd 含 `'` / `\` / 空格 / Unicode 的转义正确性
- `src/discovery/parse.ts`：合成 JSONL 夹具（正常 / 损坏 / 空 / 大文件）
- `src/grouping/group.ts`：cwd 归组、用户别名、隐藏项目过滤、合并手动项目
- `src/state/store.ts`：原子写入、损坏恢复、默认值合并

### TUI 组件测试
- 跳过（手工冒烟替代）

### 端到端
- `scripts/smoke.sh`：手工运行 `ccsm`、按真实 `~/.claude/projects/` 验证列表、按 Enter 验证 Terminal 打开

### 不测
- AppleScript 执行结果（依赖 GUI 程序，CI 无法验证）
- Warp 路径（实验性）