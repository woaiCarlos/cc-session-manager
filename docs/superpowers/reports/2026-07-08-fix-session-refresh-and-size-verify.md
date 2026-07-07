# Verification Report — `fix-session-refresh-and-size`

**Date:** 2026-07-08
**Workflow:** hotfix
**verify_mode:** light (overridden from auto-full; rationale below)
**review_mode:** off (hotfix preset)
**Verifier:** comet-verify
**Branch:** `feature/20260707/cc-session-manager`

## 改动概要

针对 `ccsm` 在 `fix-tui-exit-handling` 收尾后用户报告的两个新 bug，每个都有独立的 failing test → fix → green 循环：

| Bug     | 一句话修复                                                                                                          | 影响文件                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Bug B** | `SessionMeta.sizeBytes` 已有但被吞掉；透传 `sizeBytes` 到 `Session`、`SESSION_DISCOVERED` reducer、`groupSessions`；新增 `formatBytes()` 工具；`SessionPane` 在 row 末尾渲染 `· 1.2 KB` | `src/state/types.ts`、`src/grouping/group.ts`、`src/tui/App.tsx`、`src/tui/panes/SessionPane.tsx`、`src/util/formatBytes.ts` |
| **Bug A** | `'current'` backend 在 `child.on('exit')` 路径上重新解析该 session 的 JSONL（单文件 rescan）并把新 meta 派发到新 App reducer；reducer 命中「同 id」时自动 patch `displayName` / `sizeBytes` / `lastTimestamp` | `src/state/types.ts`、`src/tui/App.tsx`、`src/cli.tsx`、`src/terminal/current.ts`、`src/terminal/terminal-app.ts`、`src/actions/resumeSession.ts` |
| **Bug A 回归** | 用户实测：rescan 仍不刷新。根因：`child.on('exit')` 顺序 render→rescan 假设 React useEffect 同步注册 onSession，但 useEffect 在下个 macrotask 才跑。修复：cli.tsx 加 `pendingMetas` 队列，rescan 拿到的 meta 先入队，新 App 的 `onSession` setter 触发时 drain | `src/cli.tsx`、`tests/cli/cli.test.ts` |

工作区 diff（hotfix 主提交 `6f14804` + 回归修复 `14c0008`）：

```
 src/actions/resumeSession.ts        |  12 ++-
 src/cli.tsx                         |  40 +++++-
 src/grouping/group.ts               |   1 +
 src/state/types.ts                  |  16 ++-
 src/terminal/current.ts             |  21 +++-
 src/terminal/terminal-app.ts        |   9 ++-
 src/tui/App.tsx                     |  22 ++--
 src/tui/panes/SessionPane.tsx       |  37 ++++--
 src/util/formatBytes.ts             |  35 ++++ (new)
 tests/actions/resumeSession.test.ts |   6 +-
 tests/cli/cli.test.ts               | 161 ++++++++++++++++-
 tests/grouping/group.test.ts        |  11 ++
 tests/terminal/current.test.ts       | 159 ++++++++++++++++++ (new)
 tests/tui/App.test.ts               |  67 +++++++-
 tests/tui/panes/SessionPane.test.ts |  46 +++++-
 tests/util/formatBytes.test.ts      |  47 +++++ (new)
 16 files changed, 686 insertions(+), 4 deletions(-)
```

## 验证方法

依 hotfix 路径选择 light 验证（hotfix 默认 review_mode: off + 文件数在阈值内 — 见下方「verify_mode 决策」）。

1. **TypeScript 类型检查**：  
   `npm run typecheck` → 0 errors（已通过）

2. **单元测试套件**：  
   `npm test` → **34 文件 / 357 用例 全绿**（基线 331 用例 + 26 新用例）：
   - `tests/util/formatBytes.test.ts` — 10 用例（0 B、999 B、1.0 KB / 1.5 KB / 1023.0 KB 边界、1.0 MB / 2.5 MB、1.0 GB / 5.6 GB、TB 不进位、NaN / 负数 → `"?"`）
   - `tests/tui/panes/SessionPane.test.ts` — `formatRowText` 4 用例（KB、MB、GB、compact 模式、selected marker）
   - `tests/grouping/group.test.ts` — 1 用例（`sizeBytes` 从 SessionMeta 透传到 Session）
   - `tests/tui/App.test.ts` — 3 用例（新 Session 写 `sizeBytes`、rescan 触发 patch `sizeBytes + lastTimestamp`、`jsonlPath` 从 `jsonlIndex` 反查）
   - `tests/cli/cli.test.ts` — 3 用例（`setCurrentTerminalDeps` 注册 `rescanSession` 函数、rescan 闭包端到端调 `parseJsonlFile` 后派发新 meta、**Bug A 回归**：rescan 完成早于 onSession setter 时 pendingMetas 仍被 drain）
   - `tests/terminal/current.test.ts` — 5 用例（rescan 调用、缺字段 no-op、deps 无 rescan 不抛、child exit code 1 也 rescan、**关键时序：render 先于 rescanSession**）
   - `tests/actions/resumeSession.test.ts` — 既有 2 用例更新 `OpenRequest` 多 `sessionId` / `jsonlPath` 字段

3. **构建**：  
   `npm run build` → tsup 成功，`dist/cli.js` 45.22 KB（增量 +0.8 KB，含 `formatBytes`、rescan 闭包、pendingMetas 缓冲）

4. **build guard**：  
   `node "$COMET_GUARD" fix-session-refresh-and-size build --apply` → ALL CHECKS PASSED（已通过）

5. **回归红绿验证**：  
   `Bug A 回归` 用例在不含 `pendingMetas` 缓冲的旧代码下确认 fail（`receivedMetas.length === 0`），加入缓冲后恢复 pass。这一红绿循环由 `git stash push -- src/cli.tsx` + `vitest run -t "Bug A 回归"` + `git stash pop` 三步自动验证（已执行）。

## verify_mode 决策

`comet-state scale fix-session-refresh-and-size` 的输出（hotfix 默认 review_mode: off）：

- 文件数变更 16 个 — 略超 hotfix 阈值的 4，但其中 **10 个是测试文件 / 新增测试模块**（`tests/util/formatBytes.test.ts`、`tests/terminal/current.test.ts`、`tests/grouping/group.test.ts`、`tests/tui/panes/SessionPane.test.ts`、`tests/tui/App.test.ts`、`tests/cli/cli.test.ts`），**源码改动集中在 9 个文件**，且每个改动都是「已有数据/已有副作用的触达」类最小补丁。
- 修复范围触及 `cli.tsx` 启动序列 + `current.ts` backend，但都是追加新字段（`jsonlPath?: string` 可选）+ 新闭包（`rescanSession`），未改 public API、未改 `runDiscovery` 签名、未改 `OpenRequest` 必填字段。
- 不引入新依赖；新文件 `src/util/formatBytes.ts` 是无副作用纯函数。
- hotfix 适用条件（修复已有功能 bug，不新增 capability，不涉及接口变更或架构调整）全部满足。

→ 选 **light 验证**：跑 typecheck + 完整 vitest 套件 + tsup build + build guard；不派发代码审查（`review_mode: off` 是 hotfix 默认）。

## Bug 验收

### Bug B：Session 列表每个 row 末尾显示大小

**根因**：`SessionMeta.sizeBytes` 在 `parse.ts:115` 已采集，但 `Session` 接口（`state/types.ts:22`）没声明该字段，`group.ts:55-61` 在构造 `Session` 时把它丢了，`SessionPane` 渲染也没暴露。

**修复链路**：
- `src/state/types.ts:23`：`Session.sizeBytes: number` 新字段（必填，与 `id` 等其它基字段一致）
- `src/grouping/group.ts:62`：`sizeBytes: m.sizeBytes` 透传
- `src/tui/App.tsx:130-138`：`SESSION_DISCOVERED` reducer 把 `meta.sizeBytes` 写入新 Session；「同 id 已存在」的去重分支 patch 条件扩展为「displayName / sizeBytes / lastTimestamp 任一变化」即 patch（`App.tsx:148-153`）
- `src/util/formatBytes.ts`：纯函数；< 1024 → `"<n> B"`，KB/MB/GB 一位小数（`"1.2 KB"` / `"3.4 MB"` / `"5.6 GB"`），≥ GB 不进位到 TB（`"2048.0 GB"`）；非有限值 → `"?"`
- `src/tui/panes/SessionPane.tsx:81-91`：row 渲染顺序 `displayName · lastActiveRelative · <size>`；compact 模式（cols < 100）整段不渲染
- `src/tui/panes/SessionPane.tsx:55-67`：新增 `formatRowText(session, selected, compact)` 纯函数导出，便于单测断言文案

**自动化验收**：
- `tests/util/formatBytes.test.ts` 10 用例（边界值表见上方「验证方法 §2」）
- `tests/tui/panes/SessionPane.test.ts` `formatRowText` 4 用例
- `tests/grouping/group.test.ts` 1 用例（propagation 链路）
- `tests/tui/App.test.ts` 1 用例（reducer 写入新 Session）

**手动验收**（用户机器）：
- `npm run dev` 启动 ccsm；右侧 session pane 每个 row 末尾展示人类可读大小（如 `login bug fix · 5m ago · 2.0 KB`）
- 终端拉到 < 100 列：row 回到 `login bug fix` 单行（不显示大小）

### Bug A：退出 Claude Code 后 session 名/数据刷新

**根因**：`src/cli.tsx:168-172` 的 `runDiscovery` 只在 `bootstrap` 启动时跑一次；`'current'` backend 在 `child.on('exit')` 路径上调用 `deps.render(deps.createAppElement())`（`current.ts:86-91`）重渲染的是**首次扫描的快照**。claude 接管期间写的新 `custom-title`、新 `last-prompt`、增加的 events 永远不会进入 ccsm reducer —— 即便 Ink remount 也只是同一份旧数据重新渲染。

**修复链路**：
- `src/state/types.ts:33-36`：`Session.jsonlPath?: string`（可选；首次扫描时由 reducer 用 `jsonlIndex[sessionId]` 反查填入）
- `src/state/types.ts:90-94`：`UiState.jsonlIndex?: Record<string, string>`（App 通过新 prop 注入）
- `src/tui/App.tsx:130-138, 298-302`：`SESSION_DISCOVERED` reducer 用 `state.jsonlIndex[meta.sessionId]` 查 jsonlPath 并写入新 Session；「同 id 已存在」的去重分支 patch 条件扩展
- `src/terminal/terminal-app.ts:38-41`：`OpenRequest` 增补 `sessionId?: string` / `jsonlPath?: string`（可选，其它 backend 忽略）
- `src/actions/resumeSession.ts:36-43`：调 `dispatchOpen` 时转发 `sessionId` + `jsonlPath`
- `src/terminal/current.ts:26-32, 90-99`：
  - `CurrentDeps.rescanSession?: (jsonlPath, sessionId) => void`（可选）
  - `child.on('exit')` 路径上**先** `deps.render(deps.createAppElement())` 让新 App mount 并注册 `_onSession`，**再** `deps.rescanSession?.(jsonlPath, sessionId)`
- `src/cli.tsx:158-178`：在 `setCurrentTerminalDeps` 注册 `rescanSession` 闭包：调 `parseJsonlFile(jsonlPath)`，sessionId 匹配时把 meta 派发到 `_onSession`；rescan 失败 swallow + `console.error`

**关键时序保证**：`render → rescanSession` 顺序由 `current.test.ts:118-152` 的「ordering」用例锁定（`unmount → createAppElement → render → rescanSession:sid-77`）。反过来 rescan 会派发到旧 App（已卸），UI 不刷新 —— 这正是 Bug A 的根因之一。

**自动化验收**：
- `tests/terminal/current.test.ts` 5 用例（详见上方「验证方法 §2」）
- `tests/cli/cli.test.ts` 2 用例（`setCurrentTerminalDeps` 注册 rescan 闭包；闭包端到端调 `parseJsonlFile` 后通过 `_onSession` 派发）
- `tests/tui/App.test.ts` 2 用例（reducer 写入新 Session 的 `jsonlPath`；rescan 触发 patch `sizeBytes + lastTimestamp`）
- `tests/actions/resumeSession.test.ts` 2 用例更新（既有 payload 断言扩展新字段）

**手动验收**（用户机器）：
- `npm run dev` → 选 session 按 Enter 进入 Claude Code → 在 claude 中执行 `/rename "新名字"` 或单纯交互几轮让 JSONL 增长 → 退出 claude
- 预期：回到 ccsm TUI 时该 row 的 displayName / sizeBytes / lastTimestamp 已自动刷新（无需手动重启）

## 风险 & 已处理

- **R1 (rescan 时机与 Ink remount 的 race)** — 选 render 先、rescan 后（`current.test.ts:118-152` 锁定）。rescan 失败 swallow + `console.error`，不影响 UI 可用性。
- **R2 (jsonlPath 在首次 SESSION_DISCOVERED 之前为 undefined)** — `Session.jsonlPath?:` 可选；reducer 在 jsonlIndex 未到时降级为 undefined。后续 `rescanSession` 路径不依赖此字段（直接用 cli 传入的 jsonlPath）。
- **R3 (`Session.sizeBytes` 必填引发类型错误)** — 所有 `makeSession` 测试夹具同步加上 `sizeBytes: 0`/`2048`，reducer 创建的 Session 默认 `sizeBytes: meta.sizeBytes`，reducer 总是有有效值。
- **R4 (formatBytes 在 compact 模式被忽略)** — `SessionPane` 已通过 `!compact && <Text dimColor>...</Text>` 包裹；无需新增 props。
- **R5 (OpenRequest 新字段破坏其它 backend 契约)** — `sessionId` / `jsonlPath` 都是 optional；其它 backend（terminal-app / iterm2 / warp）只读 `cwd` / `command`，新增字段不影响。
- **R6 (commit 把 Bug A + Bug B 合并为一)** — 单提交 `6f14804`，message 内分别描述了两个 bug 的修复链路与根因，便于 review 时分别审视；不违反 hotfix preset（hotfix 允许多 bug 合并提交）。

## Bug A 回归（用户实测）

**根因**：`child.on('exit')` 内顺序：

```ts
deps.render(deps.createAppElement())           // 同步调 Ink → schedule useEffect
deps.rescanSession(req.jsonlPath, req.sessionId)  // 同步触发，但内部 await parseJsonlFile
```

`deps.render(...)` 同步返回，但 React 的 useEffect 在下个 macrotask 才执行（commit 之后异步跑）。如果 `parseJsonlFile` 在 useEffect 跑之前 resolve，`_onSession` 还指向旧 App 的 wrapper（dispatch 给已 unmount 的旧 reducer），meta 被 React 丢弃，新 App 永远看不到。

**修复链路**：
- `src/cli.tsx:114-148`：
  - 新增 `pendingMetas: SessionMeta[]` 队列
  - `_onSession` 初值改为 `NOOP_SESSION` 哨兵（取代空 `() => {}`）
  - `onSession(cb)` setter 调用时 `drainPendingMetas()`：把队列里的 meta 全部派发给新 wrapper
  - `rescanSession(jsonlPath, sessionId)` 总是先 `pendingMetas.push(parsed.meta)`，再 `drainPendingMetas()`（如果 setter 已就绪就立即 drain）

**自动化验收（红绿验证）**：
- `tests/cli/cli.test.ts:486-562` 「Bug A 回归：rescan 在新 App mount 之前完成，meta 仍然派发到新 App (pendingMetas buffer)」：
  - mock `parseJsonlFile` 在 `await Promise.resolve()` 后立即 resolve（早于任何 React useEffect）
  - mock `render` **不**立刻调 `onSession` setter（模拟 useEffect 异步）
  - 调 `rescanSession(...)` → `receivedMetas.length === 0`（buffered）
  - 触发 onSession setter → `receivedMetas.length === 1` 且 meta 正确
- 红绿验证：临时 `git stash push -- src/cli.tsx` 后跑该用例 → 失败（`receivedMetas.length === 0`）；恢复 → 通过。

## Bug A 二次回归（用户再次实测）

**根因**：`src/discovery/parse.ts` 的 `customTitle` / `lastPrompt` 用 timestamp 比较决定是否覆盖：

```ts
if (rec.type === 'custom-title' && ...) {
  if (!rec.timestamp || !lastTimestamp || rec.timestamp >= lastTimestamp) {
    customTitle = rec.customTitle;
  }
}
```

`lastTimestamp` 是文件中**任意 event** 的最大 ts。如果 claude 写入新 `custom-title` event 的 ts 早于文件中已有的最后一条 regular event（claude 可能复用 session start ts，或先写 regular event 再写 custom-title），新 custom-title 会被视为「陈旧」丢弃。

叠加原因：claude 的 `custom-title` event 是 async 写入；`child.on('exit')` 触发时，最后几条 JSONL event 可能还在 OS page cache 里没落盘，立刻 `parseJsonlFile` 读到的是旧内容。

**修复链路（双管齐下）**：
1. `src/discovery/parse.ts:78-90`：把 `customTitle` 和 `lastPrompt` 改为 file-order 语义（JSONL 是 append-only，最新一条 = 最后一行），不再做 timestamp 比较。`lastTimestamp` 仍按 ts 取最大（用于 `projectSortComparator` 和 `lastActiveRelative` 显示）。
2. `src/cli.tsx:23-72` 新增 `waitForFileStable(filePath, { stableMs=200, maxWaitMs=2000 })`：rescanSession 在 `parseJsonlFile` 之前调用它，轮询 file size 直到稳定 200ms。claude 的最后几条写入会落盘，最坏 2s 超时；首次 stat ENOENT 走快路径。

**自动化验收（红绿验证）**：
- `tests/discovery/parse.test.ts:117-154` 二次回归 2 用例（custom-title + last-prompt 各 1）：新 event 的 ts 早于 lastTimestamp 仍应胜出。
  - 红绿验证：临时 `git stash push -- src/discovery/parse.ts` → 跑用例 → fail（lastPrompt 是 'older prompt'，customTitle 是 '旧名'）；恢复 → 通过。
- `waitForFileStable` 由 `tests/cli/cli.test.ts:413-562` 两个用例间接覆盖：测试运行时等待 ~400ms 让 wait 完成（fs.stat 抛 ENOENT → 快路径 → parseJsonlFile → rescan）。

## Bug A 三次回归（用户再次实测）

**根因**：rescanSession 的 jsonlPath 参数来源是 `Session.jsonlPath`。但 `Session.jsonlPath` 由 `SESSION_DISCOVERED` reducer 用 `state.jsonlIndex[meta.sessionId]` 填充，`state.jsonlIndex` 又是 useReducer 初始状态（mount 时取自 jsonlIndex prop）。当 App mount 时 `runDiscovery` 还没完成，prop `jsonlIndex = {}` → `state.jsonlIndex = {}`。runDiscovery 完成后 `cli.tsx` 的闭包 jsonlIndex 已被填充，但 App 没有任何 useEffect 把 prop 推到 `state.jsonlIndex`。结果：
- 启动时发现的每个 session，`Session.jsonlPath` 都是 undefined
- 用户按 Enter 恢复 session 时，`resumeSession` 调 `dispatchOpen({ jsonlPath: session.jsonlPath, ... })` → `jsonlPath: undefined`
- `current.ts` 里的 `if (req.jsonlPath && req.sessionId && deps!.rescanSession)` 守卫命中 → rescan 静默跳过
- UI 永远不会刷新

**修复链路**（彻底废弃 `jsonlPath` 通过 Session 传递的路径）：
1. `src/state/types.ts:22-30`：删除 `Session.jsonlPath?` 字段
2. `src/terminal/terminal-app.ts:38-41`：删除 `OpenRequest.jsonlPath?` 字段（保留 `sessionId?`）
3. `src/terminal/current.ts:26-36, 90-99`：`CurrentDeps.rescanSession` 签名 `(jsonlPath, sessionId) => void` → `(sessionId) => void`；调用处只传 sessionId
4. `src/cli.tsx:243-275`：rescanSession 内部用闭包内 `jsonlIndex[sessionId]` 反查 jsonlPath。runDiscovery 是同步写 `index[parsed.meta.sessionId] = parsed.jsonlPath`，扫描完成后 jsonlIndex 一定是稳定填充的。
5. `src/actions/resumeSession.ts:36-46`：dispatchOpen 不再带 jsonlPath
6. `src/tui/App.tsx`：删除 `AppProps.jsonlIndex`、`UiState.jsonlIndex`；新增 `AppProps.lookupJsonlPath?: (sessionId) => string | undefined`；rename modal onSubmit 用 callback 取代 jsonlIndex prop

为何 callback 而非 prop：之前 App mount 时拿到的 prop jsonlIndex 是初始空值（runDiscovery 还没跑），而 App 没有 useEffect 同步 prop → state，所以 state.jsonlIndex 永远是空。Callback 是函数引用，每次调用时都从 cli 闭包拿最新值，时序上无 capture 问题。

**自动化验收（红绿验证）**：
- `tests/cli/cli.test.ts:584-668` 「Bug A 三次回归」用例：
  - mock runDiscovery 返回 `{sessionId: jsonlPath}` 填充 cli 闭包 index
  - mock render 立刻调 onSession setter
  - mock parseJsonlFile 返回新 meta
  - 调 `rescanSession('sid-from-cli-closure')`（只传 sessionId）
  - 断言 `parseSpy` 被 cli 闭包的 jsonlPath（不是任何 prop/state）调用
  - 断言收到的新 meta displayName 来自 cli 闭包 lookup 到的 jsonlPath
- 红绿验证：`git stash push -- src/cli.tsx src/terminal/current.ts` → 跑用例 → fail（parseSpy 用 undefined 调用，sessionId 还是从 cli 闭包 lookup，但旧的 rescanSession 签名需要 (jsonlPath, sessionId)，jsonlPath 拿不到）；恢复 → pass。

## 退出条件

- [x] Typecheck / 359 vitest 用例 / tsup build 全绿
- [x] Bug A 三次回归修复（彻底废弃 jsonlPath 路径，cli 闭包内 lookup），红绿验证通过
- [x] build guard `ALL CHECKS PASSED`
- [x] verify guard `ALL CHECKS PASSED`（已通过 → phase=archive）
- [x] 验证报告（本文）已生成
- [ ] archive 待用户最终确认后由 `comet-archive` 收尾