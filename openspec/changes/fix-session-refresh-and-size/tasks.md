## 1. 探查与最小失败测试

- [x] 1.1 确认现状：`src/cli.tsx:168-172` 的 `runDiscovery` 只跑一次；`src/terminal/current.ts:83-97` 的 `child.on('exit')` 没有 rescan 钩子；`SessionMeta.sizeBytes` 已采集但 `Session` 类型未透传。
- [x] 1.2 在 `tests/cli/cli.test.ts` 增加测试：模拟 `'current'` 后端 exit 流程，断言 `setCurrentTerminalDeps` 注册的 `rescanSession` 被调用，且该回调在 Ink remount 之后被调用。
- [x] 1.3 在 `tests/terminal/current.test.ts`（新建）增加测试：mock `child.on('exit')` 触发 → 断言 `deps.rescanSession` 被以 `(jsonlPath, sessionId)` 形式调用。
- [x] 1.4 在 `tests/util/formatBytes.test.ts`（新建）覆盖 0 B、999 B、1024 B、1.5 MB、2.0 GB 等边界。
- [x] 1.5 在 `tests/tui/panes/SessionPane.test.tsx` 增加 `formatRowText` 测试：每个 session row 末尾展示 `formatBytes(s.sizeBytes)`；compact 模式下不展示。

## 2. Bug B 修复（最小且独立：透传 sizeBytes）

- [x] 2.1 修改 `src/state/types.ts` 的 `Session` 接口：`sizeBytes: number`。
- [x] 2.2 修改 `src/grouping/group.ts:53-61`：`groupSessions` 在构造 `Session` 时透传 `sizeBytes: m.sizeBytes`。
- [x] 2.3 修改 `src/tui/App.tsx:111-165` 的 `SESSION_DISCOVERED` reducer：
  - 新构造 `Session` 时写入 `sizeBytes: meta.sizeBytes`
  - 「同 id 已存在」的去重分支同步 patch `sizeBytes`（与 displayName 一起）
- [x] 2.4 创建 `src/util/formatBytes.ts` —— 纯函数，导出 `formatBytes(n: number): string`。
- [x] 2.5 修改 `src/tui/panes/SessionPane.tsx`：
  - imports 加 `formatBytes` from `../../util/formatBytes.js`
  - 在 `lastActiveRelative` 之后加一段：`{' · '}<Text dimColor>{formatBytes(s.sizeBytes)}</Text>`
  - compact 模式下整段不渲染（已有 `!compact &&` 块内嵌即可）
  - 导出 `formatRowText(session, selected, compact)` 纯函数给单测断言 row 文案
- [x] 2.6 `npm run typecheck && npx vitest run tests/grouping/group.test.ts tests/tui/panes/SessionPane.test.tsx tests/util/formatBytes.test.ts` 全绿。
- [x] 2.7 `npm test` 全量不退化（356 通过，新增 25 用例）。
- [x] 2.8 commit: `feat(tui): display session JSONL size in sessions list`（并入 hotfix 主提交）

## 3. Bug A 修复（退出后重新扫描该 session）

- [x] 3.1 修改 `src/terminal/current.ts`：
  - `CurrentDeps` 增补 `rescanSession?: (jsonlPath: string, sessionId: string) => void`
  - `child.on('exit')` 路径上：**先** `deps.render(deps.createAppElement())` 重新 mount 新 App，**再**调用 `deps.rescanSession?.(jsonlPath, sessionId)`
  - 由 OpenRequest 透传 `jsonlPath` / `sessionId`
- [x] 3.2 修改 `src/terminal/terminal-app.ts` 等：让 `OpenRequest` 增补可选 `jsonlPath?: string` / `sessionId?: string`，各 backend 转发（current 用，其它 backend 可忽略）。
- [x] 3.3 修改 `src/actions/resumeSession.ts`：调用 `dispatchOpen` 时把 `jsonlPath` / `sessionId` 一并带上。
- [x] 3.4 修改 `src/state/types.ts` 的 `Session` 接口：`jsonlPath?: string`。
- [x] 3.5 修改 `src/tui/App.tsx` 的 reducer：
  - `Session` 写入 `jsonlPath = state.jsonlIndex?.[meta.sessionId]`
  - 「同 id 已存在」的去重分支 patch 条件扩展为 displayName / sizeBytes / lastTimestamp 任一不同 → patch
- [x] 3.6 修改 `src/cli.tsx` 的 `bootstrap`：
  - `jsonlIndex` 通过 `createAppElement` 透传给 App（已存在，新增 reducer 内部使用）
  - 定义 `rescanSession` 闭包：调 `parseJsonlFile(jsonlPath)` 并把 meta 派发到 `_onSession`；rescan 失败 swallow + `console.error`
  - 在 `setCurrentTerminalDeps({ ... })` 注册 `rescanSession`
- [x] 3.7 `npm run typecheck && npm test` 全绿；tsup build 成功。
- [x] 3.8 commit: `fix(tui): rescan session JSONL after Claude Code exit`（并入 hotfix 主提交）

## 4. 验证 + 报告

- [x] 4.1 `node "$COMET_GUARD" fix-session-refresh-and-size build --apply` 通过
- [x] 4.2 `npm run typecheck && npm test && npm run build` 全绿
- [x] 4.3 把验证报告写到 `docs/superpowers/reports/2026-07-08-fix-session-refresh-and-size-verify.md`

## 5. delta spec

- [x] 5.1 修改 `openspec/changes/fix-session-refresh-and-size/specs/tui-interface/spec.md` 的 `MODIFIED Requirements`：
  - `Sessions Pane` REQUIREMENT 增补 Scenario：Session 列表每个 row 末尾展示该 session JSONL 的大小（人类可读，compact 模式可省略）。
  - `Open Action Result Notification` REQUIREMENT 增补 Scenario：`current` backend 会话退出后，ccsm 重新读取该 session 的 JSONL 并刷新 displayName / sizeBytes / lastTimestamp。