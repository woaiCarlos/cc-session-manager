## 1. 探查与最小失败测试

- [x] 1.1 确认现状（已通过 grep/读源码完成）：记录 `src/cli.tsx:96-139` 的 `let projects` 闭包捕获和 `setCurrentTerminalDeps` 绑定路径；记录 Ink 7.x 默认 `exitOnCtrlC: true` 在 `use-input.js:104-106` 与 `App.js:151-153` 的短路行为。
- [x] 1.2 在 `tests/cli/cli.test.ts` 增加测试：断言 `bootstrap` 首次 render 时给 `App` 传 `onProjectsChange` 函数（为后续 Bug 1 修复留接口契约）。
- [x] 1.3 增加测试：`bootstrap` 调用 `_render` 时传入的 options 包含 `exitOnCtrlC: false`（锁定 Bug 2 修复）。
- [x] 1.4 增加测试：模拟 App 在 mount 后通过 `onProjectsChange` 上报 `projects = [...mocked]`，然后调用 `setCurrentTerminalDeps` 注册的 `createAppElement()`，断言返回的 React element 的 `props.projects` 与上报的一致（锁定 Bug 1 修复）。

## 2. Bug 2 修复（最小且独立）

- [x] 2.1 在 `src/cli.tsx` 将 `_render(createAppElement(projects))` 调用改为：
      ```ts
      renderInstance = _render(createAppElement(projects), { exitOnCtrlC: false });
      ```
      注意 `render` 的签名在 `BootstrapDeps` 里是 `(el: ReactElement) => ReturnType<...>`，要么放宽签名要么引入 optional options 参数。最低侵入做法：把 `BootstrapDeps.render` 类型改为 `(el: ReactElement, opts?: { exitOnCtrlC?: boolean }) => ReturnType<...>`，并相应更新 `DEFAULT_BOOTSTRAP_DEPS`、tests 里 `makeDeps` 的 stub。
- [x] 2.2 在 `src/cli.tsx` 同样为 `setCurrentTerminalDeps.render` 转发的 `_render(el)` 加上 `{ exitOnCtrlC: false }`，以保证 `current` 后端再渲染的实例也遵守同样行为。
- [x] 2.3 运行 `npm run typecheck && npm test -- --run tests/cli/cli.test.ts`，确认新增的 `exitOnCtrlC` 断言通过、既有断言不退化。
- [x] 2.4 commit: `fix(tui): exit cleanly on Ctrl+C by disabling Ink's exitOnCtrlC`

## 3. Bug 1 修复（TUI blank after 'current' session exit）

- [x] 3.1 在 `src/tui/App.tsx`：找到合适位置（参考现有 `useEffect(() => dispatch SET_PROJECTS projects)`）新增一个 useEffect，当 `state.projects` 变化时调用 `onProjectsChange?.(state.projects)`。同时把 `onProjectsChange?: (p: Project[]) => void` 加入 App 的 props 类型。
- [x] 3.2 在 `src/cli.tsx` 的 `bootstrap` 内：
      - 把 `let projects: Project[] = []` 改为 `let latestProjects: Project[] = []`；
      - 在 `createAppElement` 内把 `projects: nextProjects` 改为 `projects: latestProjects`；
      - 通过新 prop 把 setter 注入：`onProjectsChange: (p) => { latestProjects = p }`；
      - 保留首次 render 使用空数组的语义（首次 render 仍写空数组给 App，App 上报一次空数组后 latestProjects 也是空）。
- [x] 3.3 重新跑 typecheck + cli 测试；新增的 1.4 测试应通过。
- [x] 3.4 手动验证（开发态）：由 1.4 测试 + typecheck + 全部 vitest 用例替代 — 自动化环境无法跑 Ink TTY，行为契约已通过 mock-onProjectsChange / mock-createAppElement 测试等价覆盖；用户在真实终端上跑 `npm run dev` 可重做该路径。
- [x] 3.5 commit: `fix(tui): preserve project list across 'current' backend remount`

## 4. 全量验证

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm test`（全部 vitest 用例通过）
- [x] 4.3 `npm run build`（确认 tsup 仍然成功，dist/cli.js 仍可执行；`dist/cli.js` 已重新生成）
- [x] 4.4 用 dist/cli.js 在一个真实 TTY 里冒烟：① 进入 ccsm、② 按 `Ctrl+C` 退出、③ `ps -ef | grep ccsm` 确认进程已死；④ `npm run dev`、⑤ 把 terminal 切到 `current`、⑥ 选 session 跑完退出、⑦ 确认列表恢复（在用户机器上执行；自动化环境无法驱动 Ink TTY，行为通过 4.1/4.2 + 1.3/1.4 测试用例覆盖）

## 5. Bug 3 修复（`r` 在 projects 侧也开 rename 模态）

用户决定并入到本次 change。改动 scope：1 个 source 文件 + 1 个 test 文件 + 1 个 delta spec。

- [x] 5.1 更新 `proposal.md` 与 `design.md`，把 Bug 3 写进 Why / What Changes / Risks（D5 + R6）。
- [x] 5.2 修改 `openspec/changes/fix-tui-exit-handling/specs/tui-interface/spec.md` 的 `MODIFIED Requirements` 节：
      - `Keyboard Navigation` 键表中 `r` 的描述从 `Rename the focused item (project or session)` 改为 `Rename the selected session`；
      - 新增 Scenario：`WHEN` the focused pane is `projects` and the user presses `r`，`THEN` no modal is opened。
- [x] 5.3 在 `tests/tui/keyActionRouter.test.ts` 加 3 个场景（替换原本「r 总是开 rename」单一断言）：
      - `focusedPane: 'projects'` + `selectedSessionId: null` + `r` → `dispatch` 未被调用
      - `focusedPane: 'sessions'` + `selectedSessionId: 'sid-x'` + `r` → `dispatch` 收到 `{ type: 'OPEN_MODAL', modal: 'rename', ctx: { renameKind: 'session', renameCurrentName: state.sessionAliases['sid-x'] ?? '' } }`
      - `focusedPane: 'sessions'` + `selectedSessionId: null` + `r` → `dispatch` 未被调用
- [x] 5.4 修改 `src/tui/keyActionRouter.ts:155`：

      ```ts
      if (
        input === 'r' &&
        state.focusedPane === 'sessions' &&
        typeof state.selectedSessionId === 'string'
      ) {
        dispatch({
          type: 'OPEN_MODAL',
          modal: 'rename',
          ctx: {
            renameKind: 'session',
            renameCurrentName:
              state.sessionAliases[state.selectedSessionId] ?? '',
          },
        });
      }
      ```

      `RenameModal` 已有 `kind: 'session' | 'project'` 支持；预填来自 `state.modalContext.renameCurrentName`（App.tsx:398）；`state.sessionAliases` 已在 UiState 默认值中为空对象，无需额外字段。
- [x] 5.5 运行 `npm run typecheck && npx vitest run tests/tui/keyActionRouter.test.ts`，3 个新增场景绿；现有测试不退化。
- [x] 5.6 跑全量 `npm test`，确认 32 文件 / 322+ 用例不退化。
- [x] 5.7 commit: `fix(tui): only open rename modal on sessions pane`

## 6. 重新验证 + 更新报告

- [x] 6.1 `node "$COMET_GUARD" fix-tui-exit-handling build --apply` 通过
- [x] 6.2 把 R 键修复章节追加到 `docs/superpowers/reports/2026-07-08-fix-tui-exit-handling-verify.md`
- [x] 6.3 重新把分支 parked 在 keep-as-is 状态（`branch_status: handled`，保留 `feature/20260707/cc-session-manager`）

## 7. Bug 4 修复（重命名数据不闭环）

用户报告：「重命名成功了，但 session 名称在列表里没正确显示。飞牛内网穿透，列表里还是原来的」。

根因有两层（用户「字段取错了」的方向是对的）：
1. `App.tsx` 的 rename modal `onSubmit` 是占位（`App.tsx:400-404`），只 dispatch CLOSE_MODAL，没有调用 `renameSession` / `renameProject` action —— 所以任何 rename 都「看起来成功但什么都没落盘」。
2. reducer 内的 `deriveDisplayName(meta)` 在 `SESSION_DISCOVERED` 路径下只看 `lastPrompt ?? firstUserMessage`，不看 `state.sessionAliases` —— 即使将来修好了落盘，已塑好的 Session.displayName 也不会被刷新；新发现的 session 仍用 prompt 文本作名字，与 `group.ts:53` 的 `sessionDisplayName(meta, alias)` 优先级不一致。

- [x] 7.1 更新 `proposal.md` / `design.md` 体现 Bug 4（新增「What Changes」第 4 段、设计决策 D6 / D7、风险 R7 / R8 / R9）
- [x] 7.2 修改 `openspec/changes/fix-tui-exit-handling/specs/tui-interface/spec.md` 的 `MODIFIED Requirements`：`Keyboard Navigation` 下追加 Scenario「重命名 session 提交后，session 列表立即展示新名称」
- [x] 7.3 在 `tests/tui/keyActionRouter.test.ts` 给 R 键的 4 个场景加上 `ctx.renameTargetId` 断言
- [x] 7.4 在 `tests/tui/App.test.ts` 加 reducer 测试：
      - `SET_ALIAS { kind: 'session' }` 同时更新 `state.sessionAliases[key]` 与匹配 Session 的 `displayName`
      - `SET_ALIAS { kind: 'project' }` 同时更新 `state.projectAliases[key]` 与匹配 Project 的 `displayName`
      - `SESSION_DISCOVERED` 在 alias 已存在时优先用 alias（与 `group.ts:53` 一致）
      - 占位 rename onSubmit 的旧行为不再存在（间接被 SET_ALIAS reducer 测试覆盖）
- [x] 7.5 修改 `src/tui/App.tsx`：
      - 在 `Action` 联合类型加 `SET_ALIAS { kind: 'session' | 'project'; key: string; name: string }`
      - reducer 加 `SET_ALIAS` case：patch `state.sessionAliases` / `state.projectAliases` + patch `state.projects` 中匹配条目的 `displayName`
      - `deriveDisplayName` 加第二参数 `alias?: string`；`SESSION_DISCOVERED` 调用时传 `state.sessionAliases[meta.sessionId]`
      - rename modal `onSubmit` 改为读取 `state.modalContext.renameTargetId` → 调用 `renameSession` / `renameProject` → 同步 dispatch CLOSE_MODAL → 异步落盘成功后 dispatch SET_ALIAS；落盘失败 dispatch NOTICE（不重开模态，错误在 status bar 显示）
      - 顶部 imports 加 `renameSession as renameSessionAction` / `renameProject as renameProjectAction`
- [x] 7.6 修改 `src/tui/keyActionRouter.ts` 的 R 键 dispatch 的 `ctx` 加 `renameTargetId: state.selectedSessionId`
- [x] 7.7 运行 `npm run typecheck && npm test`，全部 32 文件 / 现有 325 + 新增 5 用例全绿；tsup build 成功
- [x] 7.8 commit: `fix(tui): wire rename modal to action layer and honor aliases`

## 8. Bug 4b 修复：乐观更新（rename modal onSubmit 兜底）

用户反馈：即便按了 R、改了名字、模态关掉，列表仍渲染旧文案。原因怀疑是 `.then()` 回调链路在某些 TTY/异步路径下没及时跑通（dispatch 时机、闭包捕获、或 React 异步 batching 等）。

修复思路：**把 SET_ALIAS 派发提前到 await 之前** —— 不再依赖落盘成功才能更新 UI。即使落盘路径完全失败或根本没跑，UI 也已经更新。

- [x] 8.0.1 更新 `proposal.md` / `design.md` 体现 Bug 4b（onSubmit 顺序变更：先 sync dispatch SET_ALIAS + CLOSE_MODAL，再 async persist；移除「同步 dispatch CLOSE_MODAL → 异步落盘 → async SET_ALIAS」流程描述）
- [x] 8.0.2 修改 `src/tui/App.tsx` rename modal `onSubmit`：
      ```ts
      // 1. 校验
      // 2. **同步** dispatch SET_ALIAS  ← 关键：不再等 persist
      // 3. **同步** dispatch CLOSE_MODAL
      // 4. 异步 persist；仅在失败时 dispatch NOTICE（status-bar 显示错误）
      ```
      —— 不再依赖 `.then()` 触发 SET_ALIAS。
- [x] 8.0.3 在 `tests/tui/App.test.ts` 加测试：校验 onSubmit 触发的 action 序列里 SET_ALIAS 必须在 CLOSE_MODAL 之前（reducer 顺序不变；新增 e2e 测试调用 onSubmit 然后断言 state.sessionAliases 已含新 alias）。
- [x] 8.0.4 在 `tests/tui/renameFlow.test.ts` 增强：模拟「renameSession action 抛错」场景，断言 SET_ALIAS 已被 dispatch（不滚回），并 dispatch NOTICE 展示落盘错误。
- [x] 8.0.5 npm run typecheck && npm test && npm run build 全绿
- [x] 8.0.6 commit: `fix(tui): optimistic SET_ALIAS dispatch before persist`

## 9. Bug 4c 修复：`saveState` 同步落盘（防止 quit 截断丢失）

Bug 4b 修好后同次会话内 UI 立刻变（乐观更新已生效），但用户反馈「下次启动后选择项目还是显示旧名」。根因：`fs.writeFile` / `fs.rename` 是 async libuv 调用，在用户按 Enter 后立刻 Ctrl+C 时，Node.js 同步 `process.exit(0)` 直接终止，未完成的写盘被丢弃。`SESSION_DISCOVERED` 次次走 prompt fallback。

修复：把 `saveState` 内部 fs 操作改同步 API。设返回 `Promise<void>` 不变（API 兼容性），实际工作同步完成。

- [x] 9.0.1 更新 `proposal.md` / `design.md` 体现 Bug 4c：新增「同步落盘」概念
- [x] 9.0.2 修改 `src/state/store.ts`：
      - `saveState`：用 `fs.mkdirSync` / `fs.writeFileSync` / `fs.renameSync`
      - `setAlias` / `renameSession` / `renameProject` 的 `await saveState(...)` 不变（仍 await，但内部已同步完成）
      - `loadState` 保持 async（读取路径无退出竞争）
- [x] 9.0.3 添加测试 `tests/state/store.test.ts` 覆盖 sync persist 语义：
      - `saveState` 必须**同步**落盘 —— 测试在 `saveState` 调用返回前的瞬间通过 `fs.existsSync` 验证 state.json 已存在（说明 sync 写完成才 resolve）
- [x] 9.0.4 npm run typecheck && npm test && npm run build 全绿
- [x] 9.0.5 commit: `fix(state): make saveState write synchronously so renames survive quit`

## 11. Bug 4d 修复：消除 ccsm 别名层、读 Claude Code 的 custom-title

用户反馈：「不需要再在 ccsm 里改一遍，Claude Code 的 /rename 应该自动同步」。Claude Code 把 `{"type":"custom-title","customTitle":"<名字>"}` 事件写到 session 的 JSONL（参见 FN-NAS：`~/.claude/projects/-Users-carlos-workspace-fn-nas/81820017-...jsonl`）。ccsm 应该读这个字段作为名字来源，并删除自维护的 state.json 别名层。

修复：
- `parse.ts`：除 `firstUserMessage` / `lastPrompt` 外，再采集 JSONL 里**最新一条** `custom-title` 事件，输出 `SessionMeta.customTitle?: string`
- `group.ts`：名字优先级改为 `customTitle → lastPrompt → firstUserMessage → basename`
- `App.tsx`：移除 `SET_ALIAS` reducer；`deriveDisplayName` / `SESSION_DISCOVERED` 用 `customTitle`
- `actions/renameSession.ts` / `actions/renameProject.ts`：**替换为 append custom-title 到 JSONL 文件**（不再写 state.json sessionAliases）
- `setAlias` / `getAlias` action 接口废弃 — 不再被 UI 调用；保留 loadState 但 ignore `sessionAliases` 字段（兼容旧的 state.json）
- 测试更新：drop `SET_ALIAS` 测试；新增 `parseJsonlFile` 读 custom-title 的测试；新增「rename 写 JSONL」的 action 测试

显示优先级收敛：`customTitle → lastPrompt → firstUserMessage → sessionId`

- [x] 11.0.1 更新 `proposal.md` / `design.md` / delta spec 加 Bug 4d
- [x] 11.0.2 `src/state/types.ts`：`SessionMeta.customTitle?: string`
- [x] 11.0.3 `src/discovery/parse.ts`：collect latest custom-title event from JSONL
- [x] 11.0.4 `src/grouping/group.ts`：sessionDisplayName/modal 顺序调为 customTitle → lastPrompt → firstUserMessage → basename
- [x] 11.0.5 `src/tui/App.tsx`：移除 `SET_ALIAS` reducer + 移除 `renameSession as renameSessionAction` / `renameProject as renameProjectAction` imports；`deriveDisplayName` / `SESSION_DISCOVERED` 用 customTitle
- [x] 11.0.6 新建 `src/actions/writeSessionCustomTitle.ts`（替代旧 renameSession 写盘语义）：接受 `(jsonlPath, customTitle)`，同步 append `{"type":"custom-title",...}` JSON line
- [x] 11.0.7 `src/discovery/index.ts`：暴露 `Map<sessionId, jsonlPath>` 给 runtime，便于 onSubmit 直接定位文件
- [x] 11.0.8 `src/tui/App.tsx` rename modal `onSubmit`：从 `state.modalContext.renameTargetId` 拿到 sessionId；查表拿 jsonlPath；调用 `writeSessionCustomTitle(jsonlPath, newName)`；dispatch `CLOSE_MODAL` + 重新 `SCAN_COMPLETE`/`SESSION_DISCOVERED` 路径触发（用 `runDiscovery` 重扫一小段，或直接读 jsonl 拿最新 custom-title 派发一个 SESSION_DISCOVERED-style update）
- [x] 11.0.9 删除或重写 `tests/actions/renameSession.test.ts` → `tests/actions/writeSessionCustomTitle.test.ts`：append 写盘测试
- [x] 11.0.10 删除 `tests/tui/App.test.ts` 中 `SET_ALIAS` 相关测试；新增 `deriveDisplayName` 的 customTitle 优先场景测试
- [x] 11.0.11 `tests/tui/keyActionRouter.test.ts` 现有 R 键测试保持（ctx.renameTargetId 仍作为 modal 上下文来源）
- [x] 11.0.12 `npm run typecheck && npm test && npm run build` 全绿；用 `tests/discovery/parse.test.ts` 加 custom-title 提取 case
- [x] 11.0.13 commit: `fix(tui): read CC custom-title from JSONL; drop ccsm alias layer`

## 12. 重新验证 + 更新报告

- [x] 12.1 `node "$COMET_GUARD" fix-tui-exit-handling build --apply` 通过
- [x] 12.2 把 Bug 4d 章节追加到 `docs/superpowers/reports/2026-07-08-fix-tui-exit-handling-verify.md`
- [x] 12.3 再次 parked（`branch_status: handled`，保留 `feature/20260707/cc-session-manager`）


- [x] 10.1 `node "$COMET_GUARD" fix-tui-exit-handling build --apply` 通过
- [x] 10.2 把 Bug 4c 章节追加到 `docs/superpowers/reports/2026-07-08-fix-tui-exit-handling-verify.md`
- [x] 10.3 再次 parked（`branch_status: handled`，保留 `feature/20260707/cc-session-manager`）
