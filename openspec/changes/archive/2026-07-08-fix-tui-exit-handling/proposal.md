## Why

`ccsm` 当前存在四处影响日常使用的体验性 bug，前两个与「在同一终端里把控制权交还给 claude、再还回给 Ink」或「干净退出进程」相关，第三个与「重命名按键生效范围」相关，第四个与「重命名数据闭环」相关：

1. **退出已恢复的 Session 后，TUI 显示空白**。当用户在 `current` terminal 后端下通过 `Enter` 恢复一个 Session，claude 接管终端运行完后，回到 TUI 应当看到完整的项目/Session 列表，但目前只看到一个空白界面。
2. **按 `Ctrl+C` 无法真正退出程序**。Node 进程仍然挂在后台（`ps -ef | grep ccsm` 仍可见），需要手动 `kill` 才能继续。
3. **`r` 重命名键在项目侧也生效**。`keyActionRouter` 当前把 `r` 无视 `focusedPane` 直接 dispatch `OPEN_MODAL modal: 'rename'`，项目侧按 R 也会弹出模态。预期：R 仅在 sessions pane 且有选中 session 时才打开模态。
4. **重命名数据不闭环**。`App.tsx` 中 rename modal 的 `onSubmit` 是占位（只 dispatch `CLOSE_MODAL`，从未调用 `renameSession` / `renameProject` action）；同时 reducer 内的 `deriveDisplayName(meta)` 在 `SESSION_DISCOVERED` 路径下只看 `lastPrompt ?? firstUserMessage`，不看 `state.sessionAliases`。结果：用户改了名，模态关掉，磁盘/内存都没写，下次列表仍渲染旧名（来自 `firstUserMessage` 或 `lastPrompt`）。这是用户实际报告「重命名成功了但列表没变」的症状。

五处 bug 都属于「现有行为不符合规格」「既有行为被误用」「重复维护同一份持久化」的修复，不引入新 capability、不改 public API、不触 schema，不涉及跨模块协调。

## What Changes

- **修复 cli bootstrap 中残留的 `projects` 闭包引用**：`src/cli.tsx` 的 `bootstrap` 在 `setCurrentTerminalDeps` 时把 `createAppElement` 闭包里捕获的 `projects: Project[] = []` 传给 `current` 后端。改为把最新 `projects` 暴露给 App（通过 `onProjectsChange` 回调），`createAppElement` 从最新引用中读取。
- **修复 Ctrl+C 不能终止进程**：把 Ink `render(...)` 的 `exitOnCtrlC` 显式设为 `false`，让 Ctrl+C 走 `useInput → keyActionRouter → onQuit → process.exit(0)`。
- **修复 R 键在项目侧生效**：把 `keyActionRouter` 中裸的 `if (input === 'r') { OPEN_MODAL rename }` 替换为「在 `focusedPane === 'sessions'` 且 `selectedSessionId` 非空时才 dispatch」并把 `ctx.renameKind`/`renameCurrentName` 写到 `ctx`。
- **读取 Claude Code 自身的 custom-title（Bug 4d — 单一来源）**：
  - 解析 session JSONL 时，采集最新一条 `{"type":"custom-title","customTitle":...}` 事件，暴露为 `SessionMeta.customTitle`
  - 现有显示链路（`groupSessions` / `SESSION_DISCOVERED` / `deriveDisplayName`）把这个字段作为名字来源
  - 取消 ccsm 维护的 state.json sessionAliases 层：`SET_ALIAS` reducer 删除；`AppState.sessionAliases` 字段保留（向后兼容读旧 state.json 不报错）但不再被读写
  - ccsm 的 R 键（rename modal）保留 UX 入口，但 onSubmit 不再调 `renameSession` 写 state.json，而是**直接 append `{"type":"custom-title",...}` 到对应 session 的 JSONL** —— 与 Claude Code 的 `/rename` slash command 写入同一个文件，达成单一来源
  - 文件路径：scan 阶段同时记录 `<sessionId, jsonlPath>` map，rename onSubmit 用 sessionId 查表
  - 显示优先级链收敛为：`customTitle → lastPrompt → firstUserMessage → sessionId`

  - 给 App reducer 新增 `SET_ALIAS` action：把 alias 写入 `state.sessionAliases` 或 `state.projectAliases`，并同步更新 `state.projects` 中对应 Session / Project 的 `displayName`；
  - `keyActionRouter` 的 R 键 `ctx` 增补 `renameTargetId` 字段，App.tsx 的 rename modal `onSubmit` 用它定位目标；
  - rename modal `onSubmit` 改为**乐观更新**（Bug 4b 二次收紧）：同步 dispatch `SET_ALIAS` + `CLOSE_MODAL` 让 UI 立即呈现新名，**不等 await**；同时异步 `renameSession` / `renameProject` action 落盘；落盘失败时 dispatch `NOTICE` 报告错误（status-bar 显示）。即便 `.then()` 回调因任何原因没触发，UI 也已经更新；
  - **`saveState` 改用同步 fs API**（Bug 4c 三次收紧）：`fs.writeFile` / `fs.rename` / `fs.mkdir` 改 `Sync` 版本。保证 `setAlias` 调用返回前数据已原子落盘 —— 用户按 Enter 后即便立刻 Ctrl+C / 关窗，`state.json` 也已写入；下次启动 `SESSION_DISCOVERED` 读到 alias 优先，列表显示新名。乐观更新解决「同次会话内列表立刻变」；同步落盘解决「下次启动列表也保持」；
  - 同步 `SESSION_DISCOVERED` 内的 `deriveDisplayName`，让它和 `group.ts:53` 的 `sessionDisplayName(meta, alias)` 走一致优先级 —— alias 优先于 prompt / first message / cwd basename。
- Bug 4d 改写 `deriveDisplayName` / `groupSessions` 的名字优先级为 `customTitle → lastPrompt → firstUserMessage → basename`，不再读 `state.sessionAliases`；移除 `SET_ALIAS` reducer。

## Capabilities

### New Capabilities

无

### Modified Capabilities

- `tui-interface`：在 `Keyboard Navigation` REQUIREMENT 下：
  - 追加 `Ctrl+C` 必须**真实终止 Node 进程**的 Scenario
  - 将键表的 `r` 绑定从 `"Rename the focused item (project or session)"` 改为 `"Rename the selected session"` 并新增「项目侧按 R 不开模态」「sessions pane 选中按 R 开模态预填别名」两个 Scenario
  - 新增 Scenario「重命名会话提交后，Session 列表立即展示新名称」（B4 验收条件 — 不仅指模态关闭，且列表里展示的 `displayName` 必须已经是新值）
- `terminal-integration`：在 `Open Action Result Notification` REQUIREMENT 追加 "`current` backend 会话退出后 TUI 必须恢复完整项目/Session 列表" 的 Scenario

## Impact

- 源码：
  - `src/cli.tsx` — `bootstrap` 增加 `latestProjects` 共享闭包 + 透传给 App 的 `onProjectsChange` 回调；`render(createAppElement(projects))` 增加 `exitOnCtrlC: false` 选项
  - `src/tui/App.tsx` — 接受 `onProjectsChange?` prop；Action 联合类型增补 `SET_ALIAS`；reducer 增补 `SET_ALIAS` case；`SESSION_DISCOVERED` 的 `deriveDisplayName` 接受 alias 参数并先看 alias；rename modal `onSubmit` 改为真正调用 `renameSession` / `renameProject` + 落盘成功后 dispatch `SET_ALIAS`
  - `src/tui/keyActionRouter.ts` — `r` 键 dispatch 的 `ctx` 增补 `renameTargetId`（session 时为 `selectedSessionId`）
  - `src/terminal/current.ts` — 读 `latestProjects`，无需新增导出
- 测试：
  - `tests/cli/cli.test.ts` — 验证 Bug 1 / Bug 2 修复（render 不退化、`onProjectsChange` 路径、`exitOnCtrlC` 透传）
  - `tests/tui/keyActionRouter.test.ts` — 4 个 R 键场景（含「session selected 时 dispatch」「projects pane no-op」「sessions pane 无 selection no-op」「有 alias 时 ctx 预填」），并新增 `renameTargetId` 断言
  - `tests/tui/App.test.ts` — 新增 reducer 测试：SET_ALIAS for session 同时更新 `sessionAliases` 与对应 Session 的 `displayName`；SET_ALIAS for project 同时更新 `projectAliases` 与对应 Project 的 `displayName`；SESSION_DISCOVERED 在 alias 已存在时优先用 alias
- API / 依赖 / 部署：均无变化

