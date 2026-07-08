## Why

在 `fix-tui-exit-handling` 收尾（Bugs 1–4d 已修）之后，ccsm 还残留两处直接影响日常使用的体验性 bug：

1. **退出 Claude Code 后 session 名/数据不刷新**。在 `current` 后端下按 Enter 恢复一个 Session，claude 接管终端跑完后回到 TUI —— 列表里那一行的名字仍是进入前的旧名（典型场景：在 Claude Code 里执行了 `/rename "新名"`、或在交互中产生了新的 `last-prompt` 事件）。根因：`src/cli.tsx` 的 `runDiscovery` 只在 `bootstrap` 时跑了一次，`'current'` backend 在 child 退出后调用 `deps.render(deps.createAppElement())` 走的是 `latestProjects` 闭包，里面装的是**首次扫描的快照**，再无任何机制把 JSONL 的最新内容读回内存。即便 `cli.tsx` 把同一份 `projects` 引用透传给新 App 实例，**也只是同一份旧数据被重新渲染**，屏幕上始终看不到新名字/新时间戳。

2. **Session 列表里没有大小信息**。`SessionMeta` 在 `parse.ts:115` 已经采集了 `sizeBytes: stat.size` 和 `lineCount`，但 `Session` 类型（`src/state/types.ts:22-28`）和 `SessionPane` 渲染都没暴露它。用户在 600+ sessions 的列表里挑不出「磁盘占用大的会话」，只能盲选。

两处都属于「已有数据未渲染」/「已有副作用未触发」的修复，不引入新 capability、不改 public API、不触 schema、不跨模块协调。

## What Changes

- **修复 Bug A — 退出后重新扫描**：在 `cli.tsx` 把 `runDiscovery` 暴露成一个可在 `'current'` child 退出后重新调用的能力。`current.ts` 的 `child.on('exit')` 路径上，**重新跑一次 discovery 并把更新过的 meta 通过 `onMeta` 推回 App reducer**。App reducer 的 `SESSION_DISCOVERED` 已具备「同 id 已存在 + 不同 displayName → patch」的合并逻辑（`App.tsx:137-148`），无需改 reducer。
  - 触发条件：只在 `'current'` backend 路径触发（其他 backend 不会 unmount Ink，自然不需要刷新）。
  - 范围：仅重扫 `--resume` 命中的那一个 sessionId 对应的 JSONL 文件，**不全量重扫**，避免再次 600+ 文件 IO 引发的 flicker。
  - 失败模式：单文件重扫失败（如文件被删）静默忽略，保留现有 session 行不变。
- **修复 Bug B — 显示 session 大小**：
  - 在 `Session` 类型增加 `sizeBytes: number` 字段（已存在 `SessionMeta.sizeBytes`）。
  - `grouping/group.ts:54-61` 把 `m.sizeBytes` 透传到 `Session`。
  - `App.tsx` 的 `SESSION_DISCOVERED` reducer 同步把 `meta.sizeBytes` 写入 `Session`。
  - 新建 `src/util/formatBytes.ts`：把字节数格式化为 `1.2 KB` / `3.4 MB` / `5.6 GB` 的紧凑字符串。
  - `SessionPane` 渲染每个 row 时，在 `lastActiveRelative` 之后加一段 `· 1.2 KB`（compact 模式省略，避免窄列双行）。
  - delta spec 增补 Scenario「Session 列表每个 row 末尾展示 session JSONL 的可读化大小」。

## Capabilities

### New Capabilities

无

### Modified Capabilities

- `tui-interface`：在 `Sessions Pane` REQUIREMENT 下新增 Scenario「Session 列表每个 row 末尾展示该 session JSONL 的大小（人类可读）」；在 `terminal-integration` 的 `Open Action Result Notification` REQUIREMENT 追加 " `current` backend 会话退出后 TUI 必须重新读取该 session 的 JSONL 并刷新其 displayName / sizeBytes / lastPrompt / lastTimestamp" 的 Scenario。

## Impact

- 源码：
  - `src/cli.tsx` — `bootstrap` 增加 `rescanSingle(jsonlPath, sessionId)` 闭包，注册到 `setCurrentTerminalDeps` 的可选字段；`runDiscovery` 完成后这个闭包已可用。
  - `src/terminal/current.ts` — `CurrentDeps` 增补 `rescanSession?: (jsonlPath: string, sessionId: string) => void`；`child.on('exit')` 在 resolve 之前（`deps.render` 调用前后皆可，**渲染前**为佳让 reducer 收到的是新数据）按 child 退出码调用 `rescanSession`。
  - `src/actions/resumeSession.ts` — 不改（dispatcher 不需要知道 session 的 jsonl 路径，cli 闭包持有就行）。
  - `src/state/types.ts` — `Session.sizeBytes: number`。
  - `src/grouping/group.ts` — `groupSessions` 把 `m.sizeBytes` 透传。
  - `src/tui/App.tsx` — `SESSION_DISCOVERED` reducer 把 `meta.sizeBytes` 写入新 Session；`Session` 副本更新逻辑同步 patch `sizeBytes`（与 displayName 一致）。
  - `src/tui/panes/SessionPane.tsx` — 渲染时调用 `formatBytes(s.sizeBytes)` 加在 `· lastActiveRelative` 之后（compact 模式省略）。
  - 新增 `src/util/formatBytes.ts` —— 纯函数，无副作用。
- 测试：
  - `tests/util/formatBytes.test.ts` — 边界值（0 B、999 B、1023 B、1.0 KB、1.5 MB、2.0 GB 等）。
  - `tests/grouping/group.test.ts` — `groupSessions` 输出 `sizeBytes`。
  - `tests/tui/panes/SessionPane.test.tsx` — 渲染断言：row 末尾出现格式化的 size 字符串。
  - `tests/cli/cli.test.ts` — `setCurrentTerminalDeps` 注册的 `rescanSession` 在 `child.on('exit')` 路径被调用；该回调调用 `parseJsonlFile` 后通过 `onMeta` 推回 `_onSession`。
  - `tests/terminal/current.test.ts` — 模拟 `child.exit` 触发 `deps.rescanSession` 调用。
- API / 依赖 / 部署：均无变化。