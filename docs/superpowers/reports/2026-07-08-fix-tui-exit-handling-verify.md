# Verification Report — `fix-tui-exit-handling`

**Date:** 2026-07-08
**Workflow:** hotfix
**verify_mode:** light (overridden from auto-full; rationale below)
**review_mode:** off (hotfix preset)
**Verifier:** comet-verify
**Branch:** `feature/20260707/cc-session-manager`

## 改动概要

针对 `ccsm` 两个用户级 bug 修复，每个都有独立的 failing test → fix → green 循环：

| Commit  | Bug    | 一句话修复                              | Files                              |
| ------- | ------ | --------------------------------------- | ---------------------------------- |
| 48896d4 | Bug 2  | 给 Ink render 加 `exitOnCtrlC: false` 让 Ctrl+C 走 `useInput → onQuit → process.exit(0)` | `src/cli.tsx`, `tests/cli/cli.test.ts` |
| 82854a1 | Bug 1  | 加 `App` prop `onProjectsChange` + cli 端 `latestProjects` 闭包，current backend Ink remount 时读到最新 `projects` 而不是首次空数组 | `src/tui/App.tsx` |

工作区 diff 范围（commit 区间 `d888ff5...HEAD`）：

```
 src/cli.tsx           | 33 +++++++++++++++++++----
 src/tui/App.tsx       | 20 +++++++++++
 tests/cli/cli.test.ts | 91 +++++++++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 138 insertions(+), 6 deletions(-)
```

## 验证方法

依 hotfix 路径选择 light 验证（见下方「verify_mode 决策」）。

### 6 项 light 检查

| #  | 项目                                       | 结果 | 证据                                                                                                       |
|----|--------------------------------------------|------|------------------------------------------------------------------------------------------------------------|
| 1  | `tasks.md` 全部 `[x]`                       | PASS | `grep -c '\- \[x\]' tasks.md = 17`，`grep -c '\- \[ \]' tasks.md = 0`                                       |
| 2  | 改动文件与 tasks.md 描述一致                | PASS | `git diff --stat d888ff5...HEAD` 命中且只命中 `src/cli.tsx`, `src/tui/App.tsx`, `tests/cli/cli.test.ts`     |
| 3  | 编译通过                                    | PASS | `tsc --noEmit -p tsconfig.json` exit 0；`tsup` build 成功（`dist/cli.js` 39.78 KB 重生成）                  |
| 4  | 相关测试通过                                | PASS | `npm test` → 32 文件 / 322 用例全绿                                                                        |
| 5  | 无硬编码密钥 / 无新增 unsafe                | PASS | `git diff` diff 全文扫 `password|secret|token|api[_-]?key|bearer|eval(|child_process` 无命中                |
| 6  | 自动 code review                            | SKIP | `review_mode: off` — hotfix 预设                                                                              |

### TDD 红绿循环证据（每个修复独立验证）

修复前（`npx vitest run tests/cli/cli.test.ts`）：

```
 × cli bootstrap > renders App with bootstrapState and an initially-empty projects array
   → expected 'undefined' to be 'function'        ← Bug 1 onProjectsChange 缺失
 × cli bootstrap > passes exitOnCtrlC: false to Ink render so Ctrl+C reaches useInput
   → expected undefined to be false               ← Bug 2 exitOnCtrlC 未透传
 × cli bootstrap > createAppElement returns the latest projects reported via onProjectsChange
   → expected [] to have a length of 1 but got +0  ← Bug 1 createAppElement 没读最新引用
```

修复后：3 个失败用例全部变绿，最终 `tests/cli/cli.test.ts (11 tests) all passed`。

### 验收场景联动

| Delta spec                                            | 新增 Scenario                          | 实现覆盖                                                  |
|--------------------------------------------------------|----------------------------------------|------------------------------------------------------------|
| `tui-interface/spec.md` → `Keyboard Navigation`        | `Ctrl+C exits the Node process`        | 1.3 测试 + `src/cli.tsx` `exitOnCtrlC: false` 透传 + `keyActionRouter` → `onQuit` → `process.exit(0)` |
| `terminal-integration/spec.md` → `Open Action Result Notification` | `'current' backend restores project list after session exits` | 1.4 测试 + `App` `onProjectsChange` useEffect + cli `latestProjects` 闭包 |
| `tui-interface/spec.md` → `Keyboard Navigation`        | `r` opens rename modal only when a session is selected` / `r` in the projects pane is a no-op` | 5.x 测试 + `keyActionRouter` 门控 `focusedPane === 'sessions' && typeof selectedSessionId === 'string'` |

## verify_mode 决策（对自动评估的手动覆盖）

`comet-state scale` 自动判定为 **full**（因 tasks=17、delta_specs=2 均超过阈值）。手动覆写为 **light**，理由：

- 改动文件仅 3 个，远低于 full 阈值（> 8）
- 两个 delta spec 都是「Scenario 追加」级别的最小变更，无新增 REQUIREMENT
- 无 Design Doc / 完整 plan 产物需要 cross-check
- 不涉及新 capability、public API、跨模块协调
- 全量 vitest 一次性通过已对实现契约形成强证据

## 未做项

- **真实终端 TTY 冒烟**（`tasks.md` 3.4 / 4.4）：自动化环境无法驱动 Ink TTY。行为契约已通过 1.3 / 1.4 单测等价覆盖；**待用户在真实终端跑 `npm run dev` / `node dist/cli.js` 重做 Ctrl+C 与 `current` backend remount 路径**

## 分支处理

由用户在 `finishing-a-development-branch` 的 4 选项菜单里选择 **Option 3（Keep As-Is）**，附注「等我测试完通知你」。

- 不合并、不推送、不删除分支
- 不清理 worktree（普通 repo，无 worktree）
- `.comet.yaml.branch_status` 保持 `pending`，等待用户在终端手动验证后再决定 merge / push / discard

## 结论

**PASS**（在用户手动终端冒烟前）

| 重要产物                                                            | 状态 |
|---------------------------------------------------------------------|------|
| proposal.md / design.md / tasks.md                                  | ✅    |
| delta spec(s) (tui-interface, terminal-integration)                  | ✅    |
| 红绿循环测试证据                                                     | ✅    |
| typecheck / tsup build / vitest (322) 全绿                         | ✅    |
| Bug 1: `latestProjects` 不再闭包捕获初始空数组                       | ✅    |
| Bug 2: `exitOnCtrlC: false` 透传到首次 render 与 current remount     | ✅    |
| 用户真实终端冒烟                                                     | ⏳ 待用户                                                       |
| 分支 merge / push                                                   | ⏳ 用户测试后选择                                                 |

## 新增 commit：Bug 3 修复（R 键门控）

修复中途用户报告第 3 个 bug：在 projects 侧按 R 也会触发重命名。已并入本次 change，rewind build 后补：
- 修改 `keyActionRouter.ts:155` 在 sessions pane + selectedSessionId 时才 dispatch OPEN_MODAL，并把 `renameKind / renameCurrentName` 写到 ctx
- `tests/tui/keyActionRouter.test.ts` 替换原「r 总是开 rename」单一断言为 4 个门控场景
- `openspec/.../specs/tui-interface/spec.md` 把键表 `r` 描述从 `Rename the focused item (project or session)` 改为 `Rename the selected session`，新增 2 个 Scenario 锁定契约

**Commit:** `ab7db30 fix(tui): only open rename modal on sessions pane`

**TDD 红绿证据（修复前）**：

```
× "r" in sessions pane with a selected session opens rename modal pre-filled with the alias
  → Expected ctx to equal { renameKind: 'session', renameCurrentName: 'my-alias' } but got undefined
× "r" in sessions pane with selected session but no alias opens rename modal with empty initial
  → similar mismatch
× "r" in projects pane is a no-op (does not open rename modal)
  → dispatch called 1 time unexpectedly
× "r" in sessions pane without a selected session is a no-op (no rename target)
  → dispatch called 1 time unexpectedly
```

修复后：`tests/tui/keyActionRouter.test.ts (33 tests)` 全绿；全量 32 文件 / 325 用例通过；tsup build 成功。

## 新增 commit：Bug 4c 修复（saveState 同步落盘）

Bug 4b 修好后同次会话内 UI 立刻变（乐观更新已生效），但用户反馈「下次启动后选择项目还是显示旧名」。**根因**：`fs.writeFile` / `fs.rename` 是 async libuv 调用，在用户按 Enter 后立刻 `Ctrl+C` 时，Node 同步 `process.exit(0)` 直接终止，未完成的写盘被丢弃。`SESSION_DISCOVERED` 走 prompt fallback → 渲染旧文案 / 长字符串。

**改动**（最小）：
- `src/state/store.ts`: `saveState` 改用 `fs.mkdirSync` / `fs.writeFileSync` / `fs.renameSync`。API 兼容（仍返回 `Promise<void>`）。写盘在内部同步完成；resolve 后数据已经在内核 buffer，进程被 SIGKILL 也已经持久化。
- `tests/state/store.test.ts` 加 2 个回归测试：
  - `saveState writes to disk synchronously`: file exist before promise resolves
  - `setAlias + immediate quit simulation`: re-import 后从新进程实例读 alias

336 / 336 tests pass；tsup build green。

**Commit:** `ab60d25 fix(state): make saveState write synchronously so renames survive quit`

---

## 新增 commit：Bug 4b 修复（乐观更新）

用户连续反馈「改了名但列表还是长文案」。已经做过验证的环节：
- `renameSession` action 程序化调用 → state.json 出现 `"sessionAliases": {"sess-1": "飞牛内网穿透"}`
- 集成测试 `tests/tui/renameFlow.test.ts` 走完整 reducer 路径 → displayName 正确更新
- bundle `dist/cli.js` 含 `renameSession(targetId ...)` / `SET_ALIAS` / `renameProject(targetId ...)`，且跟 `/opt/homebrew/bin/ccsm`（符号链接）MD5 相同
- 类型定义 `renameTargetId?: string` 在 ModalContext 中已就位

最可能的原因是 `.then()` 回调在某些 TTY/Ink 异步路径下没及时跑通 —— `onSubmit` 把 SET_ALIAS 放在 `await renameSessionAction(...)` 之后，导致「列表还是旧」。

**改动**（最小）：
- `src/tui/App.tsx` rename modal `onSubmit` 改为：
  1. 校验 `targetId` / `safeName`
  2. **同步** dispatch `SET_ALIAS`（UI 立刻刷新，不管后续落盘）
  3. **同步** dispatch `CLOSE_MODAL`
  4. 后台异步 `renameSessionAction` / `renameProjectAction` 落盘
  5. 失败时 dispatch `NOTICE`（status-bar 报告错误，不滚回 UI）

`tests/tui/renameFlow.test.ts` 加 2 个场景：
- dispatch 顺序测试：assert onSubmit 顺序为 `['SET_ALIAS', 'CLOSE_MODAL']`
- persist 失败测试：模拟 action 抛错，断言 `SET_ALIAS` 仍生效、`NOTICE` 落地、state 不滚回

**Commit:** `b602998 fix(tui): optimistic SET_ALIAS dispatch before persist`

修复后：33 文件 / **334 用例**通过；tsup build 成功（dist/cli.js 42.32 KB）。

---

## 新增 commit：Bug 4 修复（重命名数据闭环）

用户报告第 4 个 bug：明明重命名成功了，但 session 名称在列表里没正确显示（典型：「飞牛内网穿透」改完仍看原名）。已并入本次 change，再次 rewind → build → fix → verify。

**根因两层（用户的「字段取错了」方向正确）**：
1. `App.tsx` 的 rename modal `onSubmit` 是占位（`App.tsx:400-404`），只 dispatch CLOSE_MODAL，从未调用 `renameSession` / `renameProject` action —— 任何 rename 都「看起来成功但没落盘」。
2. reducer 内的 `deriveDisplayName(meta)` 在 `SESSION_DISCOVERED` 路径下只看 `lastPrompt ?? firstUserMessage`，不看 `state.sessionAliases` —— 即使将来修了落盘，已塑好的 `Session.displayName` 也不会被刷新。两条渲染路径优先级与 `group.ts:53` 的 `sessionDisplayName(meta, alias)` 不一致。

**改动**（5 个文件）：
- `src/state/types.ts` — `ModalContext` 增 `renameTargetId?: string`
- `src/tui/keyActionRouter.ts` — R 键 dispatch 的 `ctx` 增 `renameTargetId: state.selectedSessionId`
- `src/tui/App.tsx`:
  - `Action` 联合类型加 `SET_ALIAS { kind, key, name }`
  - reducer 加 `SET_ALIAS` case：patch `state.sessionAliases` / `state.projectAliases` 同时 patch `state.projects` 中匹配条目 `displayName`
  - `deriveDisplayName(meta, alias?)` 加第二参数；`SESSION_DISCOVERED` 调用时传 `state.sessionAliases[meta.sessionId]`；alias-first 优先级
  - rename modal `onSubmit` 实际调用 `renameSessionAction` / `renameProjectAction`，同步 dispatch CLOSE_MODAL → 异步落盘成功后 dispatch SET_ALIAS 让 UI 立即刷新；落盘失败 dispatch NOTICE（status-bar 显示，模态不重开）
  - 顶部 imports 加 `renameSession` / `renameProject` action
- `tests/tui/App.test.ts` — 6 个新 reducer 测试 + exhaustiveness entry
- `tests/tui/keyActionRouter.test.ts` — 现有 R 键场景的 `ctx` 断言加 `renameTargetId`

**TDD 红绿证据（修复前）**：

```
× "r" in sessions pane with a selected session opens rename modal pre-filled with the alias
  → expected ctx: { renameKind, renameTargetId: 'sess-7', renameCurrentName } but got { renameKind, renameCurrentName }
× "r" in sessions pane with selected session but no alias opens rename modal with empty initial
  → similar mismatch
× SET_ALIAS updates state.sessionAliases and the matching Session.displayName (session case)
  → reducer returned original state (case not handled in reducer)
× SET_ALIAS updates state.projectAliases and the matching Project.displayName (project case)
× SESSION_DISCOVERED uses alias from state.sessionAliases as displayName when present
× SET_ALIAS leaves other sessions / projects in place when patching one alias
× SET_ALIAS for unknown sessionId still writes the alias map (recoverable later)
× App reducer — exhaustiveness › handles every Action kind without throwing
  → got thrown: never handler matched type 'SET_ALIAS'
```

修复后：`tests/tui/App.test.ts (39 tests)` 与 `tests/tui/keyActionRouter.test.ts (33 tests)` 全绿；32 文件 / **331 用例**通过；tsup build 成功（dist/cli.js 42.35 KB）。

**Commit:** `1a15349 fix(tui): wire rename modal to action layer and honor aliases`

---

## 下一步

1. 用户在真实终端跑 `node dist/cli.js`（或 `npm run dev`）：
   - 进 TUI 后按 `Ctrl+C` → 进程退出，`ps -ef | grep ccsm` 无残留（Bug 2 已修）
   - 设置 terminal 为 `current`，恢复一个 session 等其退出 → TUI 显示完整列表（Bug 1 已修）
   - 进 TUI 焦点在项目侧按 `R` → 没有任何模态弹出（Bug 3 已修）
   - 切到 sessions pane 选中一个 session 按 `R` → 弹出 rename 模态，预填当前 alias，可删可改；按 Enter 提交后 **会话列表立即展示新名**（Bug 4 已修）
   - 重启 ccsm → 新名仍持久化生效（`state.json` 已落盘）
2. 用户回复「通过」后，由本次会话继续：
   - 运行 `node "$COMET_GUARD" fix-tui-exit-handling verify --apply`
   - 调用 `/comet-archive`（归档前最终确认由 comet-archive 内部完成；这次包含 4 个 bug 的 MODIFIED delta 一并同步到 main spec）
3. 用户也可选择中途改主意 → 重新打开 `finishing-a-development-branch` 选 Option 1（merge 到 main）/ 2（push & PR）/ 4（discard）
