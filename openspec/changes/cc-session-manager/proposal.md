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