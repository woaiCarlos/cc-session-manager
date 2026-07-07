## 1. 项目脚手架

- [x] 1.1 初始化 `package.json`，name=`cc-session-manager`，version=`0.1.0`，type=`module`，bin `{ ccsm: "dist/cli.js" }`
- [x] 1.2 添加依赖：`ink`、`@inkjs/ui`、`ink-text-input`、`chalk`；开发依赖：`typescript`、`tsx`、`@types/node`、`tsup`
- [x] 1.3 创建 `tsconfig.json`，target=`ES2022`，module=`NodeNext`，开启 strict 模式
- [x] 1.4 创建 `tsup.config.ts`，将 `src/cli.tsx` 打包为 `dist/cli.js`（保留 shebang 兼容 CommonJS）
- [x] 1.5 创建 `src/cli.tsx` 入口，含 Ink render 调用和 `#!/usr/bin/env node` shebang
- [x] 1.6 编写 `README.md`，说明安装（`npm i -g cc-session-manager`）、使用（`ccsm`）、键位、支持的终端、故障排查（AppleScript 权限）
- [x] 1.7 添加 `.gitignore`，覆盖 `node_modules/`、`dist/`、`*.log`

## 2. 状态持久化

- [x] 2.1 实现 `src/state/types.ts`，定义 `AppState`、`ManualProject`、`Terminal` 联合类型
- [x] 2.2 实现 `src/state/store.ts`，提供 `loadState()` 与 `saveState()`，使用原子写入（临时文件 + rename）
- [x] 2.3 添加损坏状态恢复：JSON 解析失败时重命名为 `state.json.bak.<timestamp>` 并以默认值重启
- [x] 2.4 添加默认值填充：合并已加载状态与默认字段以处理缺失字段
- [x] 2.5 实现 `getSessionRoot()` 辅助函数，优先返回 `state.sessionRoot`，否则返回默认探测结果
- [x] 2.6 实现 `getAlias(type, key)` 与 `setAlias(type, key, value)` 辅助函数

## 3. Session 发现

- [x] 3.1 实现 `src/discovery/detectRoot.ts`，探测优先级为 `CLAUDE_CONFIG_DIR` → `~/.claude/projects/` → `~/Library/Application Support/Claude/projects/`
- [x] 3.2 实现 `src/discovery/scan.ts`，递归列出根目录下所有 `*.jsonl` 文件
- [x] 3.3 实现 `src/discovery/parse.ts`，从 JSONL 文件提取 `SessionMeta`（sessionId、cwd、firstUserMessage、lastTimestamp），每行 try/catch 隔离
- [x] 3.4 实现 `src/discovery/index.ts` 协调器：探测根目录 → 列出文件 → 并行解析（限制并发数）
- [x] 3.5 引入后台扫描：暴露 async generator 或回调 API，使 UI 能在扫描完成前渲染
- [x] 3.6 使用 vitest 或 node:test 添加基础单元测试，解析合成 JSONL 夹具

## 4. 项目分组

- [x] 4.1 实现 `src/grouping/group.ts`，接受 `SessionMeta[]` 与 `AppState`，返回 `Project[]`（每个含 `key`、`displayName`、`sessions[]`）
- [x] 4.2 应用显示名优先级：用户别名 → 首条 user 消息截断 → cwd basename
- [x] 4.3 每个项目内 session 按 `lastTimestamp` 倒序排列
- [x] 4.4 将 state 中的 `manualProjects` 合并进项目列表，区分 `manual: true` 与自动派生
- [x] 4.5 应用 state 中的 `hiddenProjects` 过滤
- [x] 4.6 项目排序：手动项目优先，再按最近 session 时间戳倒序

## 5. 终端集成

- [x] 5.1 实现 `src/terminal/escape.ts`，提供 AppleScript 字符串插值所需的 shell 安全转义
- [x] 5.2 实现 `src/terminal/terminal-app.ts`，使用 `osascript` 打开 Terminal.app 并执行 `cd <cwd> && <cmd>`
- [x] 5.3 实现 `src/terminal/iterm2.ts`，使用 iTerm2 的 AppleScript 字典打开新窗口执行命令
- [x] 5.4 实现 `src/terminal/warp.ts` 尽力而为实现（打开 Warp，尝试 keystroke 注入，回退到剪贴板）
- [x] 5.5 实现 `src/terminal/index.ts` 派发器，读取 `state.terminal` 并调用对应后端
- [x] 5.6 错误处理：若所选终端未安装，向 TUI 抛出明确错误
- [x] 5.7 通过 `child_process.execFile` 调用 `osascript -e '...'`，并对输入做消毒（最终验证层）

## 6. Session 管理操作

- [x] 6.1 实现 `src/actions/resumeSession(session)`，调用终端派发器执行 `claude --resume <id>`
- [x] 6.2 实现 `src/actions/newSession(project)`，调用终端派发器在该项目目录下执行 `claude`
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
- [ ] 8.3 校验所选路径存在且为目录，再作为手动项目添加

## 9. 集成与冒烟测试

- [ ] 9.1 在 `src/cli.tsx` 中串联：加载 state → 探测根目录 → 启动后台扫描 → 渲染 TUI
- [ ] 9.2 手动冒烟测试：针对用户真实的 `~/.claude/projects/` 启动 `ccsm`，确认项目/session 出现
- [ ] 9.3 验证在 session 上按 Enter 打开的 Terminal 窗口具有正确的 cwd 与命令
- [ ] 9.4 验证在 project 上按 `n` 打开的 Terminal.app 工作目录正确
- [ ] 9.5 验证 `r`、`d`、`c` 工作正常且重启后保留
- [ ] 9.6 验证 `/` 过滤生效，Escape 恢复完整列表
- [ ] 9.7 验证 `,` 允许更改 session 根目录与终端选择
- [ ] 9.8 验证 `?` 显示帮助浮层
- [ ] 9.9 验证 `q` 干净退出并恢复终端光标

## 10. 构建与分发

- [ ] 10.1 验证 `npm run build` 产出可工作的 `dist/cli.js` 且 shebang 正确
- [ ] 10.2 运行 `npm link` 并验证从新 Terminal 会话可调用 `ccsm`
- [ ] 10.3 确认 README 安装指引端到端可用
- [ ] 10.4 添加冒烟测试脚本（`scripts/smoke.sh`），覆盖完整 happy path