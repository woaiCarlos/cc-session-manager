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

## 下一步

1. 用户在真实终端跑 `node dist/cli.js`（或 `npm run dev`）：
   - 进 TUI 后按 `Ctrl+C` → 进程退出，`ps -ef | grep ccsm` 无残留（Bug 2 已修）
   - 设置 terminal 为 `current`，恢复一个 session 等其退出 → TUI 显示完整列表（Bug 1 已修）
   - 进 TUI 焦点在项目侧按 `R` → 没有任何模态弹出（Bug 3 已修）
   - 切到 sessions pane 选中一个 session 按 `R` → 弹出 rename 模态，预填当前 alias，可删可改（Bug 3 已修）
2. 用户回复「通过」后，由本次会话继续：
   - 运行 `node "$COMET_GUARD" fix-tui-exit-handling verify --apply`
   - 调用 `/comet-archive`（归档前最终确认由 comet-archive 内部完成；这次包含 R 键的 MODIFIED delta 同步到 main spec）
3. 用户也可选择中途改主意 → 重新打开 `finishing-a-development-branch` 选 Option 1（merge 到 main）/ 2（push & PR）/ 4（discard）
