## Context

### 背景

Claude Code 是 Anthropic 出品的 CLI 工具，启动时在 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 写入当前 session 的全部对话记录。每个 session 一个 UUID 文件，文件名即 `sessionId`。恢复历史 session 的官方命令是 `claude --resume <sessionId>`。

随着用户积累大量 session（每个项目多次调试），手动记忆 UUID 成本高；现有工具链（Claude Code CLI、Anthropic 控制台）都未提供「按项目浏览所有 session 并一键恢复」的便捷入口。

### 约束

- 仅 macOS（Darwin），依赖 AppleScript 注入 Terminal.app；可选支持 iTerm2 / Warp
- 不修改 Claude Code 任何文件（`~/.claude/projects/**` 只读）
- 不联网（纯本地工具）
- 不依赖 Rust / 不构建 GUI 窗口
- 终端宽度自适应：TUI 需支持 ≥80 列窄屏
- 启动速度目标：冷启动 < 500ms（扫描 < 1000 个 session）

### 利益相关方

- **唯一用户**（开发者本人）：要能流畅浏览数百个 session，且不与 Claude Code 其他用法冲突

## Goals / Non-Goals

**Goals:**

- 提供键位驱动的 TUI：方向键导航、Enter 打开、`n` 新建、`r` 重命名、`/` 搜索、`q` 退出、`?` 帮助
- 启动后 ≤1 秒内呈现完整项目/会话列表（含首次扫描）
- 双击 session 自动在正确 cwd 下打开新 Terminal 并执行 `claude --resume <id>`
- 项目下「新建 session」能在该目录打开新 Terminal 并执行 `claude`
- 跨重启保留：项目别名、session 别名、终端偏好、session 根目录覆盖
- 默认零配置：探测成功即用；探测失败时引导用户在 TUI 设置中指定

**Non-Goals:**

- 不修改 Claude Code JSONL（只读）
- 不跨平台（macOS only）
- 不解析 session 内容做语义搜索
- 不实现自动同步、自动 resume、自动备份
- 不联网、不上报任何使用统计
- 不实现全局快捷键（仅在 TUI 内响应键盘）
- 不支持 session 标签、协作、分享、计费

## Decisions

### 决策 1：技术栈 = Node.js + Ink + TypeScript

- **理由**：用户明确要求 CLI 风格 TUI，不用 Rust。Ink 用 React 组件化思维写 TUI，生态成熟（`ink-text-input`、`ink-select-input`、`@inkjs/ui`），TypeScript 提供类型安全
- **备选**：
  - Go + Bubbletea：单二进制分发方便，但需重写类型生态
  - Python + Textual：Rich 生态，但启动慢、需要 Python 运行时
  - 纯 Shell + fzf：启动最快但交互弱、键位自定义能力差
- **代价**：依赖 Node 运行时；用 npm 全局安装（`npm i -g cc-session-manager`）做分发

### 决策 2：项目（group）= cwd 自动派生 + 手动添加

- **理由**：用户既希望「自动看到已有 session 归属」，又希望「手动注册空目录提前准备项目」
- **实现**：扫描所有 session 后按 cwd 归组（去重 prefix，比如 `/Users/carlos/workspace/dinotty` 直接用此路径作为 group 标识，不递归向上合并）；手动添加的目录与自动派生共享同一存储结构，带 `manual: true` 标记
- **备选**：
  - 完全自动：缺灵活性
  - 完全手动：维护成本高

### 决策 3：Session 重命名 = 独立别名文件

- **理由**：用户原话「重命名这些 session」；不能改 Claude 内部 JSONL（破坏性）；独立 JSON 文件做映射最简
- **存储**：`~/.config/cc-manager/state.json` 中维护 `sessionAliases: { [sessionId]: displayName }` 和 `projectAliases: { [groupKey]: displayName }`
- **代价**：Claude Code 升级若改 JSONL schema 需要重新适配（但我们只读，影响小）

### 决策 4：显示名优先级 = 用户别名 > 首条 user 消息首行 > cwd basename

- **理由**：用户别名最稳；首条 user 消息能直观看到 session 主题（如「修复启动崩溃」）；cwd basename 作为兜底
- **注意**：当前 session 的首条 user 消息可能是 `/comet ...` 命令内容，需在 UI 上识别并降级到 cwd basename

### 决策 5：终端集成 = AppleScript（默认）+ 可选 CLI

- **理由**：AppleScript 是 Terminal.app 内置、零依赖；iTerm2 也有 AppleScript 字典；Warp 支持 CLI
- **实现**：
  - Terminal.app：`osascript -e 'tell application "Terminal" to do script "cd <cwd> && <cmd>"'` 然后 `activate`
  - iTerm2：`osascript` 调 iTerm 的 `create window with default profile command "..."`
  - Warp：`open -a Warp` 后用 `osascript` 注入 keystroke（不优雅，故 Warp 仅作 best-effort 支持）
- **配置**：state.json 中 `terminal: "terminal" | "iterm2" | "warp"`，默认 `"terminal"`

### 决策 6：Session 目录探测 = 默认 + 用户可覆盖

- **默认**：`~/.claude/projects/`
- **探测顺序**：环境变量 `CLAUDE_CONFIG_DIR` → `~/.claude/projects/` → `~/Library/Application Support/Claude/projects/`（兜底）
- **覆盖**：state.json 中 `sessionRoot: string | null`；UI 设置项可改；改完立即重新扫描

### 决策 7：状态持久化 = 单个 JSON 文件

- **路径**：`~/.config/cc-manager/state.json`
- **内容**：`sessionRoot`、`terminal`、`sessionAliases`、`projectAliases`、`manualProjects: [{ path, addedAt }]`、`hiddenProjects: [groupKey]`
- **理由**：规模小（< 10KB），JSON 读写简单，无需引入 SQLite

### 决策 8：TUI 架构 = 单 Ink 实例 + 模态框堆叠

- **层级**：
  - 主视图：项目列表（左）+ session 列表（右）
  - 模态：搜索、重命名、设置、帮助、新建确认
- **数据流**：扫描 → 内存中的 `AppState` → useState/useReducer → 渲染；用户操作派发 `Action`，Reducer 同步更新并触发副作用（写 state.json、调 osascript）
- **状态管理**：本地 useReducer 即可，不引入 Redux/Zustand（避免过度设计）

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| Claude Code 升级改变 JSONL schema | session 元数据解析失败 | 解析层做 try/catch，单条失败不影响其他 session；schema 变更时升级解析器 |
| 大量 session（> 5000）扫描慢 | 启动 < 1s 目标失败 | 启动时先渲染 UI，再后台异步扫描；按需懒加载 session 详情（首条消息按需读取） |
| osascript 注入被系统拦截 | 用户需在「系统设置 → 隐私与安全 → 自动化」允许 | 首次启动时提示用户授权路径；提供 README 故障排查 |
| Warp 的 AppleScript 支持有限 | Warp 用户体验差 | Warp 标注为「实验性」；文档说明可手动复制命令 |
| Ink 在某些终端（老旧 iTerm 配置）渲染异常 | UI 错位 | 锁定 Ink 版本；在 README 标注支持的终端 |
| 全局命令 `ccsm` 与其他工具冲突 | 安装报错 | package.json 暴露 `bin: { ccsm: "dist/cli.js" }`，并提示用户用 `npx cc-session-manager` 替代 |
| Session JSONL 文件正在被 Claude 写入 | 解析到不完整行 | JSONL 解析天然容错（每行独立），跳过空行/非 JSON 行 |

## Migration Plan

无（全新项目，无既有用户数据）。

首次使用流程：
1. 用户 `npm i -g cc-session-manager`（或在本地 `npx cc-session-manager`）
2. 在 Terminal 执行 `ccsm`
3. 应用自动探测 session 根目录 → 渲染项目/会话列表
4. 探测失败时进入设置模式，引导用户指定路径
5. 用户可立即使用；状态在首次变更时写入 `~/.config/cc-manager/state.json`

回滚策略：删除 `~/.config/cc-manager/state.json` 即可恢复出厂（不影响 Claude Code 任何数据）。

## Open Questions

- 是否需要在 TUI 中支持鼠标点击（Ink 支持但跨终端兼容性差）— **决定**：v1 仅键盘，后续按反馈加
- 是否需要在 TUI 中直接显示 session 的最近一条消息摘要 — **决定**：v1 仅显示首条；后续评估
- 是否需要支持「复制 session ID 到剪贴板」— **决定**：v1 包含 `c` 键复制，UX 友好
- 是否需要支持「在 Finder 中显示 JSONL」— **决定**：v1 不包含；按需追加
- TUI 退出后是否需要清理（清屏 / 保留）— **决定**：默认 `ctrl+c` 保留最近输出；`q` 完全退出并恢复光标