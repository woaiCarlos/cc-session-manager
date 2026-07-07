# cc-session-manager

> macOS 终端 UI：浏览、搜索、一键恢复 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 历史 session。

`ccsm` 会扫描 `~/.claude/projects/` 下的所有 JSONL session，按 `cwd` 自动归组为「项目」，并在所选终端（Terminal.app / iTerm2 / Warp）的新窗口中执行 `claude --resume <sessionId>` 恢复任意 session。纯本地运行，不联网，不修改任何 Claude 内部文件。

---

## 目录

- [功能特性](#功能特性)
- [系统要求](#系统要求)
- [安装](#安装)
- [使用](#使用)
- [首次启动](#首次启动)
- [键位](#键位)
- [支持的终端](#支持的终端)
- [状态与配置](#状态与配置)
- [故障排查](#故障排查)
- [开发](#开发)
- [路线图](#路线图)
- [License](#license)

---

## 功能特性

- **按项目浏览**：自动按 `cwd` 把所有 session 归组为项目列表；支持手动添加任意目录作为「项目」提前准备。
- **一键恢复**：在 session 上按 `Enter`，自动在新终端窗口的对应 `cwd` 下执行 `claude --resume <sessionId>`。
- **新建 session**：在项目上按 `n`，在该目录打开新终端窗口并执行 `claude`。
- **重命名**：session 与项目均支持自定义显示名（独立别名，不修改 Claude JSONL）。
- **搜索**：按名称、`cwd` 子串、首条 user 消息模糊过滤 session。
- **多终端**：Terminal.app（默认）/ iTerm2 / Warp 之间自由切换。
- **跨重启保留**：别名、终端偏好、session 根目录覆盖、手动项目均自动持久化。
- **零配置启动**：自动探测 `~/.claude/projects/`；探测失败时引导用户在设置中指定。

---

## 系统要求

| 维度 | 要求 |
|------|------|
| 操作系统 | **macOS**（Darwin；依赖 `osascript` 注入 AppleScript） |
| Node.js | ≥ 18（推荐 20+） |
| Claude Code CLI | 已安装并至少运行过一次（用于生成 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`） |
| 终端 | 见 [支持的终端](#支持的终端) |
| 权限 | 首次调用 `osascript` 时需要在「系统设置 → 隐私与安全 → 自动化」中授权终端控制 Terminal.app / iTerm2 / Warp |

> 本工具**仅在 macOS 上运行**。Linux / Windows 用户请等待官方跨平台支持（参见 [路线图](#路线图)）。

---

## 安装

### 方式一：全局安装（推荐）

```bash
npm install -g cc-session-manager
```

安装完成后即可在任何 Terminal 会话中调用 `ccsm`。

### 方式二：使用 `npx`（无需全局安装）

```bash
npx cc-session-manager
```

适合试用或不想污染全局 PATH 的场景。

### 验证安装

```bash
ccsm --version
# 或
which ccsm
```

预期：`which ccsm` 输出形如 `/usr/local/bin/ccsm`（或你 npm 全局 bin 路径下）。

### 卸载

```bash
npm uninstall -g cc-session-manager
```

卸载**不影响** `~/.claude/` 下的任何 Claude Code 数据。如需清空 `ccsm` 的状态文件，参见 [重置状态](#重置状态)。

---

## 使用

### 启动 TUI

```bash
ccsm
```

启动后界面如下：

```
┌─ Projects (12) ─────────────┐ ┌─ Sessions (38) ──────────────────────────┐
│ › cc-manager            (5) │ │ › fix: typecheck error in cli.tsx  2h ago │
│   dinotty                (2) │ │   bootstrap Ink entry point        1d ago │
│   superpowers-spec       (8) │ │   docs: update README              3d ago │
│   (manual) scratchpad    (0) │ │   chore: bump deps                 5d ago │
└─────────────────────────────┘ └──────────────────────────────────────────┘
 Projects: 12 · Sessions: 38 · Scan: complete
```

### 核心交互流程

1. **浏览项目**：用 `↑` / `↓` 在左侧项目列表移动（光标在「项目」pane 时）。
2. **浏览 session**：按 `Tab` 切换到「session」pane，用 `↑` / `↓` 选择具体 session。
3. **恢复 session**：在 session 上按 `Enter`，新 Terminal 窗口自动打开并执行 `claude --resume <id>`。
4. **新建 session**：把焦点切回项目（`Tab`），按 `n`，新终端窗口在该项目目录打开并执行 `claude`。
5. **搜索**：按 `/` 打开搜索框，输入关键字按 `Enter` 过滤 session；`Esc` 清除过滤。
6. **退出**：按 `q` 或 `Ctrl+C`（干净退出并恢复终端光标）。

---

## 首次启动

首次执行 `ccsm` 时，应用会按以下顺序自动探测 session 根目录：

1. 环境变量 `CLAUDE_CONFIG_DIR`（若已设置）
2. `~/.claude/projects/`（默认）
3. `~/Library/Application Support/Claude/projects/`（兜底）

探测成功 → 直接渲染项目/session 列表。
探测失败 → 引导用户按 `,` 打开设置、手动指定路径。

---

## 键位

> 在任意界面按 `?` 弹出键位速查浮层。

### 全局导航

| 键位 | 动作 |
|------|------|
| `Tab` | 在「项目」与「session」pane 之间切换焦点 |
| `↑` / `↓` | 在当前 pane 中上下移动光标 |
| `Enter` | session 上：恢复该 session；项目上：切换到 session pane |
| `Esc` | 关闭当前模态框 / 清除搜索 |
| `?` | 显示/关闭键位帮助 |

### 操作

| 键位 | 动作 |
|------|------|
| `n` | 在当前项目目录新建 session（`claude`） |
| `r` | 重命名当前选中的 session 或项目 |
| `c` | 复制当前 session 的 UUID 到剪贴板（`pbcopy`） |
| `d` | 删除当前手动项目（需确认） |
| `a` | 添加手动项目（弹出 macOS 原生文件夹选择器） |
| `/` | 打开搜索框，按名称 / cwd / 首条消息过滤 |
| `,` | 打开设置（修改 session 根目录 / 切换默认终端） |

### 退出

| 键位 | 动作 |
|------|------|
| `q` | 干净退出，恢复终端光标 |
| `Ctrl+C` | 立即终止（保留最近输出） |

### 模态框

| 键位 | 动作 |
|------|------|
| `Y` / `N` | 确认框：确认 / 取消 |
| `Enter` | 文本输入框：提交 |
| `Esc` | 任意模态：取消并关闭 |

---

## 支持的终端

| 终端 | 状态 | 集成方式 |
|------|------|----------|
| **Terminal.app** | 默认 / 完全支持 | 通过 `osascript` 调用 AppleScript `do script` 注入 `cd <cwd> && <cmd>` |
| **iTerm2** | 完全支持 | 通过 `osascript` 调用 iTerm2 自带 AppleScript 字典的 `create window with default profile command` |
| **Warp** | 实验性支持 | 通过 `open -a Warp` 后尝试 keystroke 注入；不优雅时回退到剪贴板写入 |

### 切换默认终端

按 `,` 打开设置 → 在 Terminal / iTerm2 / Warp 三者中单选 → `Enter` 保存。配置写入 `~/.config/cc-manager/state.json`。

### 终端支持说明

- **Terminal.app**：macOS 自带，开箱即用；零依赖。
- **iTerm2**：需从 [iterm2.com](https://iterm2.com/) 下载安装；启用 AppleScript 字典后控制能力最佳。
- **Warp**：从 [warp.dev](https://www.warp.dev/) 安装；AppleScript 注入受限于 Warp 自身的安全策略，可能出现「键入过快」「焦点丢失」等问题——**推荐作为回退方案**，主用场景建议切到 Terminal.app 或 iTerm2。

---

## 状态与配置

所有用户偏好与别名都持久化在一个 JSON 文件中：

```
~/.config/cc-manager/state.json
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionRoot` | `string \| null` | session 根目录覆盖；`null` 表示走默认探测 |
| `terminal` | `"terminal" \| "iterm2" \| "warp"` | 默认打开动作的目标终端 |
| `sessionAliases` | `Record<sessionId, displayName>` | session 自定义显示名 |
| `projectAliases` | `Record<groupKey, displayName>` | 项目自定义显示名 |
| `manualProjects` | `Array<{ path, addedAt }>` | 用户手动添加的项目目录列表 |
| `hiddenProjects` | `string[]` | 隐藏的 groupKey 列表 |

> **不会**写入或修改 `~/.claude/` 下任何 Claude Code 数据。

### 重置状态

```bash
rm ~/.config/cc-manager/state.json
```

下次启动 `ccsm` 时会以默认值重新创建；不影响 Claude Code 任何 session 数据。

---

## 故障排查

### 1. 首次启动弹出「想要控制 Terminal.app」等权限请求

这是 macOS TCC（透明度、同意与控制）机制的正常提示。**点击「好」**授权即可。

如果一不小心点了「拒绝」：

1. 打开 **系统设置** → **隐私与安全** → **自动化**
2. 找到你正在使用的终端（如「Terminal.app」「iTerm2」）
3. 勾选下方的「Terminal.app」「iTerm2」「Warp」等子项
4. 重新启动 `ccsm`

### 2. `osascript` 报「not authorized」或「不允许辅助访问」

按上一条修复 TCC 授权即可。

若授权后仍报错，尝试在 Terminal 手动验证 AppleScript：

```bash
osascript -e 'tell application "Terminal" to do script "echo hello"'
```

若此命令也失败 → 系统级 AppleScript 被禁用，需检查家长控制或 MDM 配置。

### 3. 项目列表为空 / 看不到任何 session

按以下顺序排查：

```bash
# 1. 确认 Claude Code 已运行过、且生成了 JSONL
ls ~/.claude/projects/
# 预期：输出若干形如 -Users-carlos-workspace-cc-manager 的目录

# 2. 在 ccsm 中按 , 打开设置，确认 session root 路径
#    若 ~/.claude/projects/ 不存在 → 在设置中手动指定你的实际路径

# 3. 检查 JSONL 是否可读
ls ~/.claude/projects/-Users-carlos-workspace-cc-manager/*.jsonl | head -5
```

### 4. 按 `Enter` 后新终端窗口没出现

- **Warp 用户**：优先切到 Terminal.app 或 iTerm2（参见 [终端支持说明](#终端支持说明)）。
- **iTerm2 用户**：确认 iTerm2 的「Preferences → Profiles → Default → Advanced → Allow sessions to be created from AppleScript」已勾选。
- **终端焦点被抢占**：尝试把 `ccsm` 所在的窗口手动前置，再按一次 `Enter`。

### 5. 状态文件损坏导致启动失败

应用启动时会先尝试解析 `state.json`；失败则把当前文件重命名为：

```
~/.config/cc-manager/state.json.bak.<timestamp>
```

并以默认值重启，**不会**影响 Claude Code 任何数据。可在排查后手动从 `.bak` 恢复。

### 6. 终端宽度 < 80 列时 UI 显示错位

TUI 设计支持 ≥ 80 列窄屏；< 80 列时部分边框可能截断。建议把终端窗口拉宽，或在 Terminal.app / iTerm2 设置中调大字体后缩小窗口列数。

### 7. 报错 `Cannot find module 'ink'` 等

```bash
npm install -g cc-session-manager --force
# 或本地：
rm -rf node_modules && npm install
```

### 8. 其他问题

提交 issue 时附上：

```bash
ccsm --version
node --version
sw_vers                     # macOS 版本
ls ~/.claude/projects/ | wc -l
```

---

## 开发

```bash
git clone https://github.com/<your-org>/cc-session-manager.git
cd cc-session-manager
npm install
npm run dev          # 用 tsx 直接运行 src/cli.tsx
npm run typecheck    # 严格 TS 检查
npm test             # 跑 vitest
npm run build        # 产出 dist/cli.js（带 shebang）
```

### 目录结构

```
src/
├── cli.tsx                  # Ink 入口 + render
├── actions/                 # session 管理动作（resume / new / rename / delete / copy）
├── discovery/               # session 根目录探测 + JSONL 扫描解析
├── grouping/                # 按 cwd 归组项目
├── state/                   # state.json 读写、类型、别名辅助
├── terminal/                # Terminal.app / iTerm2 / Warp 集成
├── tui/                     # Ink 组件（App、Panes、Modals、Hooks）
└── util/                    # folder-picker 等工具
```

### 设计文档

- 提案：[openspec/changes/cc-session-manager/proposal.md](openspec/changes/cc-session-manager/proposal.md)
- 设计：[openspec/changes/cc-session-manager/design.md](openspec/changes/cc-session-manager/design.md)
- 任务清单：[openspec/changes/cc-session-manager/tasks.md](openspec/changes/cc-session-manager/tasks.md)

---

## 路线图

- **v0.2**：自定义主题、session 首条消息摘要侧栏、复制完整 `claude --resume` 命令
- **v0.3**：跨平台实验（Linux 需替换 AppleScript；优先级视反馈而定）
- **v1.0**：稳定 API、发布到 homebrew、自动更新提示

---

## License

[MIT](LICENSE) © 2026 Carlos

---

<p align="center">
  用 ❤️ 和 ☕ 在 macOS 上构建 · 与 Claude Code 配套使用
</p>