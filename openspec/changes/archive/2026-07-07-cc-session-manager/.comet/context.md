# Comet Design Handoff

- Change: cc-session-manager
- Phase: design
- Mode: compact
- Context hash: e837c2e630324711597cb7b20ca1e8dd206989e72ab49a0c9d9c740e48b88792

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/cc-session-manager/proposal.md

- Source: openspec/changes/cc-session-manager/proposal.md
- Lines: 1-37
- SHA256: eaa7638efc4162e33319f6aa6edb2188a16ad02ff33e0bed05d60a5c0ac29865

```md
## Why

Claude Code 的会话（session）以 JSONL 文件形式散落在 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`，数量增长后无法快速定位历史 session；当前恢复某个 session 需要记住 UUID 并手动在 Terminal 执行 `claude --resume <id>`，效率低、易出错。我们需要一个 macOS 终端工具，把所有项目与 session 聚合成可浏览、可搜索、可一键恢复的列表。

## What Changes

- 新增 macOS 终端 UI 应用（Node.js + Ink + TypeScript），用于浏览与管理 Claude Code session
- 自动探测 Claude Code session 存储根目录（默认 `~/.claude/projects/`），允许用户在设置中覆盖
- 自动按 `cwd` 把 session 归组为「项目」；允许用户手动添加任意目录作为项目
- 双击（Enter）session：在该 session 的 cwd 下打开新 Terminal 窗口并执行 `claude --resume <sessionId>`
- 在项目上执行「新建 session」（快捷键 `n`）：在该目录打开新 Terminal 窗口并执行 `claude`
- 支持重命名 session 与项目（独立别名文件，不修改 Claude 内部 JSONL）
- 支持搜索/筛选（按名称、cwd 子串，首条 user 消息）
- 支持在 Terminal.app（默认）/ iTerm2 / Warp 之间切换作为打开动作的目标终端
- 提供键位驱动的 TUI 交互：方向键导航、Enter 打开、`n` 新建、`r` 重命名、`/` 搜索、`q` 退出、`?` 帮助

## Capabilities

### New Capabilities

- `session-discovery`：扫描磁盘上的 Claude Code session JSONL，提取 session 元数据（sessionId、cwd、首条 user 消息、最后活跃时间）；探测 session 根目录并允许用户覆盖
- `project-grouping`：按 cwd 自动归组为项目；支持手动添加任意目录作为项目；项目可重命名、删除（手动项目）；项目下可触发新建 session
- `session-management`：列出、恢复（双击）、新建、重命名、筛选 session
- `terminal-integration`：通过 AppleScript 或对应终端的 CLI，在指定 cwd 下打开新终端窗口并执行任意命令（Terminal.app / iTerm2 / Warp 三选一）
- `tui-interface`：基于 Ink 的终端 UI，提供键位驱动的导航、列表渲染、搜索框、模态框（重命名 / 设置）
- `state-persistence`：将项目别名、session 别名、用户偏好（终端选择、session 根目录覆盖）持久化到 `~/.config/cc-manager/state.json`

### Modified Capabilities

（无 — 这是全新项目，无既有 spec）

## Impact

- **新增依赖**：`ink`、`ink-text-input`、`chalk`、`ink-select-input`、`@inkjs/ui` 等 Ink 生态；`typescript`、`tsx`、`@types/node`；构建/打包：`tsup` 或 `esbuild`
- **新增 CLI 入口**：注册全局命令 `ccsm`（或 `cc-session-manager`），用户安装后可在任意 Terminal 执行
- **新增配置文件**：`~/.config/cc-manager/state.json`（首次使用自动创建）
- **影响系统**：调用 `osascript`（macOS 内置）注入 Terminal.app 命令；调用 iTerm2 / Warp 的 CLI（如已安装）
- **不影响**：Claude Code 本身、其他项目、不修改 `~/.claude/` 下任何文件
```

## openspec/changes/cc-session-manager/design.md

- Source: openspec/changes/cc-session-manager/design.md
- Lines: 1-132
- SHA256: cb04bc4d4c1959be2bde4d61b176d7f2f187102ac5a7ebc01c57818652df23c1

[TRUNCATED]

```md
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

```

Full source: openspec/changes/cc-session-manager/design.md

## openspec/changes/cc-session-manager/tasks.md

- Source: openspec/changes/cc-session-manager/tasks.md
- Lines: 1-99
- SHA256: f5c5f76467682af9a26043b942e165d7be527c63f29736bb3170f10ef7644431

[TRUNCATED]

```md
## 1. 项目脚手架

- [ ] 1.1 初始化 `package.json`，name=`cc-session-manager`，version=`0.1.0`，type=`module`，bin `{ ccsm: "dist/cli.js" }`
- [ ] 1.2 添加依赖：`ink`、`@inkjs/ui`、`ink-text-input`、`chalk`；开发依赖：`typescript`、`tsx`、`@types/node`、`tsup`
- [ ] 1.3 创建 `tsconfig.json`，target=`ES2022`，module=`NodeNext`，开启 strict 模式
- [ ] 1.4 创建 `tsup.config.ts`，将 `src/cli.tsx` 打包为 `dist/cli.js`（保留 shebang 兼容 CommonJS）
- [ ] 1.5 创建 `src/cli.tsx` 入口，含 Ink render 调用和 `#!/usr/bin/env node` shebang
- [ ] 1.6 编写 `README.md`，说明安装（`npm i -g cc-session-manager`）、使用（`ccsm`）、键位、支持的终端、故障排查（AppleScript 权限）
- [ ] 1.7 添加 `.gitignore`，覆盖 `node_modules/`、`dist/`、`*.log`

## 2. 状态持久化

- [ ] 2.1 实现 `src/state/types.ts`，定义 `AppState`、`ManualProject`、`Terminal` 联合类型
- [ ] 2.2 实现 `src/state/store.ts`，提供 `loadState()` 与 `saveState()`，使用原子写入（临时文件 + rename）
- [ ] 2.3 添加损坏状态恢复：JSON 解析失败时重命名为 `state.json.bak.<timestamp>` 并以默认值重启
- [ ] 2.4 添加默认值填充：合并已加载状态与默认字段以处理缺失字段
- [ ] 2.5 实现 `getSessionRoot()` 辅助函数，优先返回 `state.sessionRoot`，否则返回默认探测结果
- [ ] 2.6 实现 `getAlias(type, key)` 与 `setAlias(type, key, value)` 辅助函数

## 3. Session 发现

- [ ] 3.1 实现 `src/discovery/detectRoot.ts`，探测优先级为 `CLAUDE_CONFIG_DIR` → `~/.claude/projects/` → `~/Library/Application Support/Claude/projects/`
- [ ] 3.2 实现 `src/discovery/scan.ts`，递归列出根目录下所有 `*.jsonl` 文件
- [ ] 3.3 实现 `src/discovery/parse.ts`，从 JSONL 文件提取 `SessionMeta`（sessionId、cwd、firstUserMessage、lastTimestamp），每行 try/catch 隔离
- [ ] 3.4 实现 `src/discovery/index.ts` 协调器：探测根目录 → 列出文件 → 并行解析（限制并发数）
- [ ] 3.5 引入后台扫描：暴露 async generator 或回调 API，使 UI 能在扫描完成前渲染
- [ ] 3.6 使用 vitest 或 node:test 添加基础单元测试，解析合成 JSONL 夹具

## 4. 项目分组

- [ ] 4.1 实现 `src/grouping/group.ts`，接受 `SessionMeta[]` 与 `AppState`，返回 `Project[]`（每个含 `key`、`displayName`、`sessions[]`）
- [ ] 4.2 应用显示名优先级：用户别名 → 首条 user 消息截断 → cwd basename
- [ ] 4.3 每个项目内 session 按 `lastTimestamp` 倒序排列
- [ ] 4.4 将 state 中的 `manualProjects` 合并进项目列表，区分 `manual: true` 与自动派生
- [ ] 4.5 应用 state 中的 `hiddenProjects` 过滤
- [ ] 4.6 项目排序：手动项目优先，再按最近 session 时间戳倒序

## 5. 终端集成

- [ ] 5.1 实现 `src/terminal/escape.ts`，提供 AppleScript 字符串插值所需的 shell 安全转义
- [ ] 5.2 实现 `src/terminal/terminal-app.ts`，使用 `osascript` 打开 Terminal.app 并执行 `cd <cwd> && <cmd>`
- [ ] 5.3 实现 `src/terminal/iterm2.ts`，使用 iTerm2 的 AppleScript 字典打开新窗口执行命令
- [ ] 5.4 实现 `src/terminal/warp.ts` 尽力而为实现（打开 Warp，尝试 keystroke 注入，回退到剪贴板）
- [ ] 5.5 实现 `src/terminal/index.ts` 派发器，读取 `state.terminal` 并调用对应后端
- [ ] 5.6 错误处理：若所选终端未安装，向 TUI 抛出明确错误
- [ ] 5.7 通过 `child_process.exec` 调用 `osascript -e '...'`，并对输入做消毒

## 6. Session 管理操作

- [ ] 6.1 实现 `src/actions/resumeSession(session)`，调用终端派发器执行 `claude --resume <id>`
- [ ] 6.2 实现 `src/actions/newSession(project)`，调用终端派发器在该项目目录下执行 `claude`
- [ ] 6.3 实现 `src/actions/renameSession(sessionId, newName)`，更新 state 并持久化
- [ ] 6.4 实现 `src/actions/renameProject(groupKey, newName)`，更新 state 并持久化
- [ ] 6.5 实现 `src/actions/addManualProject(path)`，打开文件夹选择器、校验路径、加入 state
- [ ] 6.6 实现 `src/actions/deleteManualProject(groupKey)`，带确认地从 state 移除
- [ ] 6.7 实现 `src/actions/copySessionId(sessionId)`，使用 `pbcopy` 写入剪贴板并显示瞬态确认

## 7. TUI 界面

- [ ] 7.1 实现 `src/tui/App.tsx` 根 Ink 组件，使用 `useReducer` 管理状态
- [ ] 7.2 实现 `src/tui/panes/ProjectPane.tsx`，含垂直列表、当前选中高亮、滚动处理
- [ ] 7.3 实现 `src/tui/panes/SessionPane.tsx`，结构与 ProjectPane 对称
- [ ] 7.4 实现 `src/tui/hooks/useKeybindings.ts`，将键位表映射为派发的 action
- [ ] 7.5 实现 `src/tui/modals/SearchModal.tsx`，使用 `ink-text-input`
- [ ] 7.6 实现 `src/tui/modals/RenameModal.tsx`，预填当前名称
- [ ] 7.7 实现 `src/tui/modals/SettingsModal.tsx`，含 session 根目录路径与终端单选按钮
- [ ] 7.8 实现 `src/tui/modals/HelpModal.tsx`，列出所有键位
- [ ] 7.9 实现 `src/tui/modals/ConfirmModal.tsx`，用于删除确认
- [ ] 7.10 实现 `src/tui/components/StatusBar.tsx`，显示当前选择、扫描进度、最近操作通知
- [ ] 7.11 实现 `src/tui/components/EmptyState.tsx`，含引导文案
- [ ] 7.12 绑定 `Tab` 在两个 pane 间切换焦点并更新视觉高亮
- [ ] 7.13 绑定 `/` 打开 SearchModal 并按查询过滤 session
- [ ] 7.14 绑定 `r`、`n`、`a`、`d`、`c`、`,`、`?`、`q`、`Ctrl+C` 到对应 action/modal
- [ ] 7.15 绑定 `Enter`：在 session 上调 `resumeSession`，在 project 上聚焦 session pane
- [ ] 7.16 处理终端 resize：监听 stdout `resize` 事件并触发 Ink 重渲染

## 8. 文件夹选择器集成

- [ ] 8.1 实现 `src/util/folder-picker.ts`，使用 `osascript` 调用 macOS 原生文件夹选择器（`choose folder`）
- [ ] 8.2 返回所选 POSIX 路径，若用户取消则返回 `null`

```

Full source: openspec/changes/cc-session-manager/tasks.md

## openspec/changes/cc-session-manager/specs/project-grouping/spec.md

- Source: openspec/changes/cc-session-manager/specs/project-grouping/spec.md
- Lines: 1-57
- SHA256: 6e5bf231714e62c27d0dc2ff9f1943096c5a5ab79a3ba2f216342783d39412ee

```md
## ADDED Requirements

### Requirement: Automatic Project Grouping by cwd
The system SHALL group sessions into projects by their `cwd` field, where each unique `cwd` value defines one project.

The group identifier SHALL be the absolute path of `cwd`. The display name SHALL resolve via: user alias → `cwd` basename → full `cwd` path.

#### Scenario: Group sessions by shared cwd
- **WHEN** multiple sessions have the same `cwd` value `/Users/carlos/workspace/dinotty`
- **THEN** they appear under a single project group with that cwd

#### Scenario: Display name falls back to cwd basename
- **WHEN** the user has not set an alias for a project
- **THEN** the project display name is the last path segment of the cwd (e.g., `dinotty`)

### Requirement: Manual Project Addition
The system SHALL allow the user to add an arbitrary directory as a project via the operating system's native folder picker, even if no sessions exist for it yet.

Manually added projects SHALL be persisted in `state.json#manualProjects` and distinguished from auto-derived projects by a `manual: true` flag.

#### Scenario: Add a directory without existing sessions
- **WHEN** the user presses `a` and selects `/Users/carlos/workspace/new-project` via the folder picker
- **THEN** the project appears in the project list with `(empty)` placeholder for sessions and a badge indicating it was manually added

#### Scenario: Folder picker cancel
- **WHEN** the user opens the folder picker and cancels
- **THEN** the project list is unchanged

### Requirement: Project Rename
The system SHALL allow the user to rename a project. Renaming a project SHALL only update the user alias for that group; it SHALL NOT modify any session JSONL or move files.

#### Scenario: Rename a project
- **WHEN** the user selects a project and presses `r`, then types `My Cool Project`
- **THEN** the project list updates immediately to show `My Cool Project` and the alias is persisted in `state.json#projectAliases`

### Requirement: Project Deletion (Manual Only)
The system SHALL allow the user to remove manually added projects from the list. The system SHALL NOT allow deletion of auto-derived projects that still have sessions, but SHALL allow deletion of auto-derived projects whose sessions have all been removed or moved.

Deleting a project SHALL only remove it from the application's tracking; it SHALL NOT delete any files on disk.

#### Scenario: Delete a manually added project
- **WHEN** the user selects a manual project and presses `d`, then confirms
- **THEN** the project is removed from the list and from `state.json#manualProjects`

#### Scenario: Attempt to delete auto-derived project with sessions
- **WHEN** the user selects an auto-derived project that still has sessions
- **THEN** the system displays an error and refuses deletion

### Requirement: New Session Creation in Project
The system SHALL allow the user to create a new Claude Code session in any project's directory by pressing `n`. This SHALL open a new terminal window with `cwd` set to the project's path and execute `claude`.

#### Scenario: Create new session in manual project
- **WHEN** the user selects a manually added project and presses `n`
- **THEN** a new terminal window opens in the project's directory and `claude` is executed

#### Scenario: Create new session in auto-derived project
- **WHEN** the user selects an auto-derived project (with at least one session) and presses `n`
- **THEN** a new terminal window opens in that project's `cwd` and `claude` is executed
```

## openspec/changes/cc-session-manager/specs/session-discovery/spec.md

- Source: openspec/changes/cc-session-manager/specs/session-discovery/spec.md
- Lines: 1-67
- SHA256: 48cf675ed7913fa96c289ebc1c8222b9ebf81581b67116db0e8e8c4fb49c8551

```md
## ADDED Requirements

### Requirement: Session Root Auto-Detection
The system SHALL automatically detect the Claude Code session storage root directory on startup.

The detection priority SHALL be:
1. The `CLAUDE_CONFIG_DIR` environment variable (joined with `/projects`)
2. `$HOME/.claude/projects/` (default)
3. `$HOME/Library/Application Support/Claude/projects/` (fallback for system-wide installs)

If none of these paths exist, the system SHALL signal detection failure to the UI layer so the user can manually specify a path.

#### Scenario: Default detection succeeds
- **WHEN** the user starts `ccsm` with no prior configuration and `~/.claude/projects/` exists
- **THEN** the system uses `~/.claude/projects/` as the session root and proceeds to scanning

#### Scenario: CLAUDE_CONFIG_DIR overrides default
- **WHEN** the user has set `CLAUDE_CONFIG_DIR=/custom/path` and `/custom/path/projects` exists
- **THEN** the system uses `/custom/path/projects` as the session root

#### Scenario: No session directory found
- **WHEN** none of the detection paths exist
- **THEN** the system enters the configuration UI prompting the user to specify a custom session root

### Requirement: Session Metadata Extraction
The system SHALL extract the following metadata from each `*.jsonl` file under the session root:

- `sessionId` (from any record's `sessionId` field, or from the filename UUID)
- `cwd` (from the first record that has a `cwd` field)
- `firstUserMessage` (from the first record where `type === "user"` and `message.content` is a non-empty string)
- `lastPrompt` (from the most recent `type === "last-prompt"` record's `lastPrompt` field, or `null` if no such record exists)
- `lastTimestamp` (from the maximum `timestamp` value across all records)

The system SHALL tolerate malformed records by skipping them without aborting the scan.

#### Scenario: Extract metadata from a well-formed session
- **WHEN** the scanner encounters a JSONL file with valid records
- **THEN** it produces a `SessionMeta` object with `sessionId`, `cwd`, `firstUserMessage`, `lastPrompt`, and `lastTimestamp`

#### Scenario: lastPrompt is the most recent prompt
- **WHEN** the JSONL contains multiple `type === "last-prompt"` records
- **THEN** `SessionMeta.lastPrompt` is the value from the most recent such record

#### Scenario: No last-prompt record exists
- **WHEN** the JSONL has no `type === "last-prompt"` record (e.g., a session that was created but immediately closed)
- **THEN** `SessionMeta.lastPrompt` is `null` and the UI falls back to `firstUserMessage`

#### Scenario: Tolerate malformed JSONL
- **WHEN** the scanner encounters a JSONL line that fails to parse
- **THEN** it skips that line and continues scanning the rest of the file

#### Scenario: Handle empty JSONL
- **WHEN** the scanner encounters an empty JSONL file
- **THEN** it skips the file without throwing

### Requirement: Background Scanning
The system SHALL scan the session root asynchronously after TUI render, so the UI is interactive within 500ms even when scanning thousands of sessions.

#### Scenario: Scan completes after UI render
- **WHEN** the user starts `ccsm` and the session root contains 1000 sessions
- **THEN** the main TUI renders within 500ms and the session list populates as scanning completes (with a loading indicator visible during the scan)

### Requirement: Manual Session Root Override
The system SHALL allow the user to override the session root directory via a setting that persists across restarts.

#### Scenario: Override via settings
- **WHEN** the user opens Settings and specifies `/custom/sessions`
- **THEN** the system saves this value to `state.json#sessionRoot` and immediately rescans from the new path
```

## openspec/changes/cc-session-manager/specs/session-management/spec.md

- Source: openspec/changes/cc-session-manager/specs/session-management/spec.md
- Lines: 1-64
- SHA256: 25ae5c2cb6ec734712b646b97bd409092073cb7bd8ab38fbd3b5bc896b142af2

```md
## ADDED Requirements

### Requirement: Session List Display
The system SHALL display sessions within the currently selected project, sorted by `lastTimestamp` descending (most recently active first).

Each session entry SHALL display, in order of priority:
1. User alias (if set)
2. `lastPrompt` (truncated to 60 characters on first line, with `…` if longer) — this is Claude Code's parsed-and-cleaned last user input and is always plain text
3. `firstUserMessage` with XML tag stripping (e.g., remove `<command-message>...</command-message>` and `<command-name>...</command-name>` wrappers), truncated to 60 characters
4. Cwd basename (final fallback)
5. Last-active relative time (e.g., `2h ago`, `3d ago`)

The system SHALL NOT use `firstUserMessage` directly when it begins with `<` (a slash command wrapper) without first attempting `lastPrompt`.

#### Scenario: List sessions sorted by recency
- **WHEN** the user selects a project containing sessions with varying `lastTimestamp` values
- **THEN** the session list shows the most recent session at the top

#### Scenario: lastPrompt is the preferred display name
- **WHEN** a session has both `lastPrompt` and `firstUserMessage` set
- **THEN** the display name is derived from `lastPrompt` (since it is always clean plain text)

#### Scenario: lastPrompt is null and firstUserMessage is a slash command
- **WHEN** a session's `lastPrompt` is null and `firstUserMessage` starts with `<command-message>`
- **THEN** the system strips the XML tags and uses the remainder; if the remainder is empty, falls back to cwd basename

#### Scenario: Both lastPrompt and firstUserMessage are null
- **WHEN** a session has neither `lastPrompt` nor `firstUserMessage`
- **THEN** the display name is the cwd basename

### Requirement: Session Resume via Enter
The system SHALL resume a session when the user presses Enter on it. Resuming SHALL open a new terminal window with `cwd` set to the session's `cwd` and execute `claude --resume <sessionId>`.

#### Scenario: Resume a session
- **WHEN** the user selects a session and presses Enter
- **THEN** a new terminal window opens in the session's cwd and `claude --resume <sessionId>` is executed; the TUI remains interactive in the original terminal

#### Scenario: Resume fails because terminal cannot be launched
- **WHEN** the configured terminal application is not installed
- **THEN** the system displays an error message in the TUI and offers to switch terminal in Settings

### Requirement: Session Rename
The system SHALL allow the user to rename a session. Renaming a session SHALL only update the user alias; it SHALL NOT modify the session JSONL.

#### Scenario: Rename a session
- **WHEN** the user selects a session and presses `r`, then types `Login bug fix`
- **THEN** the session list updates immediately to show `Login bug fix` and the alias is persisted in `state.json#sessionAliases`

### Requirement: Session Copy ID
The system SHALL allow the user to copy a session's UUID to the system clipboard by pressing `c`.

#### Scenario: Copy session ID
- **WHEN** the user selects a session and presses `c`
- **THEN** the session's UUID is written to the macOS clipboard and a transient confirmation message appears in the TUI

### Requirement: Search and Filter
The system SHALL allow the user to filter sessions by typing a query in a search box opened with `/`. The filter SHALL match case-insensitively against: session alias, first user message, cwd path, and session ID prefix.

#### Scenario: Filter by alias
- **WHEN** the user types `/login` and presses Enter
- **THEN** only sessions whose alias or first-user-message contains `login` are displayed

#### Scenario: Clear filter
- **WHEN** the user presses Escape in the search box
- **THEN** the search box closes and the full session list is restored
```

## openspec/changes/cc-session-manager/specs/state-persistence/spec.md

- Source: openspec/changes/cc-session-manager/specs/state-persistence/spec.md
- Lines: 1-62
- SHA256: 14efd760f40e01595e391a41b1fe3bf9dd7362b9e182c0cf1ac15f23ecf221a5

```md
## ADDED Requirements

### Requirement: State File Location
The system SHALL persist user state in `~/.config/cc-manager/state.json`. The directory SHALL be created on first write if it does not exist.

#### Scenario: First-run state creation
- **WHEN** the user performs any action that modifies state (rename, manual project add, settings change)
- **THEN** the system creates `~/.config/cc-manager/` if missing and writes `state.json` with the current values

### Requirement: State Schema
The state file SHALL contain the following fields, all optional (default values apply if missing):

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `sessionRoot` | string \| null | null (auto-detect) | Override for session root directory |
| `terminal` | `"terminal"` \| `"iterm2"` \| `"warp"` | `"terminal"` | Target terminal emulator |
| `sessionAliases` | Record<sessionId, displayName> | {} | User-assigned display names for sessions |
| `projectAliases` | Record<groupKey, displayName> | {} | User-assigned display names for projects |
| `manualProjects` | Array<{ path: string, addedAt: ISO8601 }> | [] | Manually added project directories |
| `hiddenProjects` | Array<groupKey> | [] | Projects hidden from the list |

#### Scenario: Default state on first run
- **WHEN** the user starts `ccsm` for the first time and no `state.json` exists
- **THEN** the system uses defaults: `terminal: "terminal"`, empty aliases/arrays, `sessionRoot: null` (auto-detect)

#### Scenario: Migrate missing fields gracefully
- **WHEN** `state.json` exists but is missing one or more fields (e.g., from an older version)
- **THEN** the system fills in defaults for missing fields without overwriting existing values

### Requirement: Atomic Write
The system SHALL write `state.json` atomically: write to a temp file in the same directory, then `rename` over the target. This SHALL prevent corruption if the process is killed mid-write.

#### Scenario: Write succeeds
- **WHEN** the user renames a session
- **THEN** the system writes `state.json.tmp` and renames it to `state.json`; the file is never observed in a partially-written state by another process

### Requirement: Read Resilience
The system SHALL tolerate a missing or unreadable `state.json` by falling back to defaults. If the file is present but contains invalid JSON, the system SHALL back it up to `state.json.bak.<timestamp>` and start fresh.

#### Scenario: Corrupt state file
- **WHEN** `state.json` contains invalid JSON
- **THEN** the system renames it to `state.json.bak.<timestamp>`, logs a warning, and starts with default state

### Requirement: Concurrent Instance Detection
The system SHALL detect when another `ccsm` instance is running by writing a PID file to `~/.config/cc-manager/lock` on startup.

The system SHALL:
- Write the current PID to the lock file on startup
- On startup, if the lock file exists and the PID inside is still alive (`kill -0` succeeds), display a warning modal asking the user whether to take over the lock or quit
- If the lock file is older than 24 hours (staleness check), the system SHALL treat it as a zombie and overwrite it without warning
- Remove the lock file on clean exit (`q` or `Ctrl+C`)

#### Scenario: Clean start with no other instance
- **WHEN** the user starts `ccsm` and no lock file exists
- **THEN** the system writes its PID to the lock file and proceeds normally

#### Scenario: Another instance is running
- **WHEN** the user starts `ccsm` and the lock file contains a PID that is still alive
- **THEN** the system shows a warning modal: "Another ccsm instance (PID <pid>) is running. Take over? [Y/n]"; on Yes, overwrites the lock and continues; on No, exits cleanly

#### Scenario: Stale lock file
- **WHEN** the user starts `ccsm` and the lock file is older than 24 hours
- **THEN** the system overwrites the lock file with the current PID and proceeds without warning
```

## openspec/changes/cc-session-manager/specs/terminal-integration/spec.md

- Source: openspec/changes/cc-session-manager/specs/terminal-integration/spec.md
- Lines: 1-48
- SHA256: dab662c589f0a4ed42906530b45c265650d11514ab990431aafdcf9706edf652

```md
## ADDED Requirements

### Requirement: Terminal Selection
The system SHALL support three terminal emulators as the target for open/new actions: `terminal` (Terminal.app, default), `iterm2`, and `warp`. The selected terminal SHALL persist in `state.json#terminal`.

#### Scenario: Default to Terminal.app
- **WHEN** the user has never changed the terminal setting
- **THEN** all open/new actions target Terminal.app

#### Scenario: Switch to iTerm2
- **WHEN** the user selects iTerm2 in Settings
- **THEN** subsequent open/new actions target iTerm2 and the setting is persisted

### Requirement: Terminal.app Integration via AppleScript
The system SHALL open Terminal.app, activate it, and execute the requested command in a new window using AppleScript via `osascript`.

The AppleScript invocation SHALL:
1. Open Terminal.app if not running (`tell application "Terminal" to activate`)
2. Create a new window with the given command (`do script "cd '<cwd>' && <command>"`)
3. Properly escape single quotes and backslashes in the `cwd` and command strings

#### Scenario: Open in Terminal.app
- **WHEN** the user resumes a session with cwd `/Users/foo/proj` and id `abc-123`
- **THEN** Terminal.app is brought to front and a new window opens executing `cd '/Users/foo/proj' && claude --resume abc-123`

#### Scenario: Path with special characters
- **WHEN** the cwd contains a single quote (e.g., `/Users/foo/O'Brien`)
- **THEN** the AppleScript command is properly escaped so that the path resolves correctly

### Requirement: iTerm2 Integration
The system SHALL open iTerm2 and execute the requested command in a new window using iTerm2's AppleScript dictionary.

#### Scenario: Open in iTerm2
- **WHEN** the user resumes a session and the configured terminal is `iterm2`
- **THEN** iTerm2 is activated and a new window opens with the command executed

### Requirement: Warp Integration (Best Effort)
The system SHALL open Warp and attempt to inject the command via `osascript` keystroke events. The system SHALL document Warp's limitations in the README.

#### Scenario: Open in Warp
- **WHEN** the user resumes a session and the configured terminal is `warp`
- **THEN** Warp opens and the system attempts keystroke injection; if the user reports it fails, the system falls back to copying the command to the clipboard and notifying the user

### Requirement: Open Action Result Notification
The system SHALL always keep the TUI running in the original terminal after dispatching an open action, so the user can continue browsing without losing state.

#### Scenario: TUI remains interactive after open
- **WHEN** the user resumes a session
- **THEN** the original TUI stays interactive in the current terminal; the new terminal window is created separately
```

## openspec/changes/cc-session-manager/specs/tui-interface/spec.md

- Source: openspec/changes/cc-session-manager/specs/tui-interface/spec.md
- Lines: 1-73
- SHA256: 58a4f6e42f1543e404d81c08b1ec6d57fa37cea324052a6b2ed527969178baee

```md
## ADDED Requirements

### Requirement: Two-Pane Layout
The system SHALL render a two-pane TUI: project list on the left, session list on the right. The currently focused pane SHALL be visually highlighted.

#### Scenario: Initial render
- **WHEN** the user starts `ccsm`
- **THEN** the TUI renders with the project pane focused (or session pane if there is exactly one project)

### Requirement: Keyboard Navigation
The system SHALL support the following keybindings globally (unless overridden by an open modal):

| Key | Action |
|-----|--------|
| `Tab` | Switch focus between project pane and session pane |
| `↑` / `↓` | Move selection within the focused pane |
| `Enter` | Resume the focused session |
| `n` | Create a new session in the focused project |
| `a` | Add a manual project (open folder picker) |
| `r` | Rename the focused item (project or session) |
| `d` | Delete the focused manual project (with confirmation) |
| `c` | Copy the focused session ID to clipboard |
| `/` | Open the search box |
| `,` | Open Settings |
| `?` | Open Help overlay |
| `q` / `Ctrl+C` | Quit the TUI |

#### Scenario: Navigate with arrow keys
- **WHEN** the user presses `↓` repeatedly
- **THEN** the selection moves down one item at a time within the focused pane

#### Scenario: Switch panes
- **WHEN** the user presses `Tab`
- **THEN** focus alternates between the project pane and the session pane, with visual indication

### Requirement: Modal Dialogs
The system SHALL support modal dialogs for: search, rename, settings, help, and delete confirmation. While a modal is open, the keybindings above SHALL NOT fire; only the modal's own keys (e.g., typing into the input, Escape to cancel, Enter to confirm) SHALL be active.

#### Scenario: Open rename modal
- **WHEN** the user presses `r`
- **THEN** a modal appears with a text input pre-filled with the current name; pressing Enter saves, Escape cancels

#### Scenario: Settings modal
- **WHEN** the user presses `,`
- **THEN** a settings modal appears showing: Session Root path (with a `Change…` button), Terminal selection (radio buttons); changes are saved on confirm

### Requirement: Loading and Empty States
The system SHALL display appropriate visual feedback during scanning and when no projects exist.

#### Scenario: Initial render with skeleton projects
- **WHEN** the user starts `ccsm` and the state file contains manually added projects but the background scan has not yet completed
- **THEN** the project pane renders those manual projects immediately with each project showing a session count of `0 (Scanning…)`; the TUI is interactive and the user can perform actions (rename, new session, open settings); session counts update in real time as the background scan discovers sessions

#### Scenario: Loading indicator during scan
- **WHEN** the background scanner is still running
- **THEN** a spinner or "Scanning…" indicator is visible in the relevant pane

#### Scenario: Empty state guidance
- **WHEN** no projects are found (neither auto-derived nor manual)
- **THEN** the project pane shows guidance text: "No projects found. Press `a` to add a directory, or `,` to configure the session root."

### Requirement: Help Overlay
The system SHALL display a keybinding reference when the user presses `?`.

#### Scenario: Show help
- **WHEN** the user presses `?`
- **THEN** a scrollable overlay appears listing all keybindings; pressing `?` or Escape closes it

### Requirement: Terminal Width Adaptability
The system SHALL render correctly in terminals of width ≥ 80 columns. Below 80 columns, the layout SHALL degrade gracefully (e.g., abbreviate fields, wrap text) without crashing.

#### Scenario: Narrow terminal
- **WHEN** the user's terminal is 80 columns wide
- **THEN** both panes are visible side-by-side without overflow
```
