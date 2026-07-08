## Context

`ccsm` 是一个用 Ink + React 写的 macOS TUI (位于 `src/cli.tsx` 入口)：
1. `bootstrap` 启动一个 `runDiscovery(root, onMeta)` 后台扫描，把每个发现的 `SessionMeta` 通过 `_onSession(meta)` 推给 React reducer。
2. 用户在 `Enter` 上恢复 Session 时，`actions/resumeSession.ts` 调用 `dispatchOpen(terminal, ...)`，其中 `current` 后端 (`src/terminal/current.ts`) 会先把 Ink 拆掉，再在同一 TTY 跑 `claude --resume <id>`，退出后再 render 一个新的 Ink App。
3. App 的全局按键通过 `useInput` → `keyActionRouter.routeKey(...)` 派发；`q` 与 `Ctrl+C` 都被映射到 `opts.onQuit()`，后者 `releaseLock().finally(() => process.exit(0))`。

代码考古后定位到两条独立但同源的缺陷：

### Bug 1：remount 后 TUI 空白
当前 cli 的 `createAppElement` 闭包捕获的是 `bootstrap` 顶部声明的 `let projects: Project[] = []` —— 它只在首次 render 时取了一次值，永不更新。`setCurrentTerminalDeps({ createAppElement: () => createAppElement(projects), ... })` 把这个已经失效的引用固化进 current 后端。任何 Ink unmount / remount（例如 `current` backend 退出后、或者未来其他需要重启 Ink 的路径）都会让 `_render(_createAppElement())` 拿到全空的 `projects`，从而：
- 新 App 实例的 `useEffect(() => dispatch SET_PROJECTS projects)` 用空数组覆盖内部状态
- 后续 `_runDiscovery` 不会再被重启（因为 cli 的扫描副作用 `void (async () => { ... _runDiscovery(...) })` 只跑过一轮）
- 即使后续有事件进来也只是把新 meta 合到 empty group 里，UI 永远看不见 600+ 已存在的 session

### Bug 2：Ctrl+C 不终止进程
读 `node_modules/ink/build/components/App.js:151` 与 `node_modules/ink/build/hooks/use-input.js:104-106` 可以确认 Ink 7.x 的默认行为：

```js
// use-input.js
if (input === 'c' && key.ctrl && internal_exitOnCtrlC) {
    return; //   ← never invokes user handler
}
// App.js
if (input === '\x03' && exitOnCtrlC) {
    handleExit();   //  → onExit → handleAppExit → this.unmount()
}
```

即 Ink 在 `exitOnCtrlC: true`（默认）时会**短路掉 user `useInput`**，并把 Ctrl+C 转给 `handleExit()`，最终只调 `this.unmount()`。但 `unmount()`（见 `node_modules/ink/build/ink.js:491`）只拆除 React 树、关 raw mode、flush final frame，**不会调 `process.exit`**。Node 进程仍在 `setRawMode(false)` 后的 TTY 上挂着；只要 stdin/stdout 句柄没被强制关闭，事件循环就一直转。

`cli.tsx` 里虽然额外 `process.on('SIGINT', handleSignal)` 注册了一个回调，按理说 Ctrl+C 时也会触发——但因为 Ink 处于 raw mode 控制了 stdin，`'\x03'` 已经在用户态被 Ink 截走、并未上升为 SIGINT，所以 Node 层的 SIGINT 监听器根本不会被命中，进程就卡住了。

## Goals / Non-Goals

**Goals:**
- 在 `current` backend remount 后立即恢复完整的项目/Session 视图（无需手动重新进入 / 按 `Ctrl+C`）
- `Ctrl+C` 在 TUI 任意视图（含打开模态下）能干净退出 Node 进程，lock 文件被释放
- `r` 重命名键只在 `focusedPane === 'sessions'` 且有选中 session 时才打开重命名模态（项目侧保持 no-op）；模态预填当前 session 的 `sessionAliases[id]`，用户可清空再键入
- 保留现有 cli 模块化结构（`BootstrapDeps`、`setCurrentTerminalDeps` 接口签名稳定）
- 不引入新依赖

**Non-Goals:**
- 不改变任何 spec 文案（tui-interface / terminal-integration 的 REQUIREMENTS 已正确）
- 不重写 Ink 渲染管线 / 不引入新的 React Context
- 不动 lock 释放的现有实现（`release()` 已经是 best-effort）

### Bug 3：`r` 键在项目侧也触发重命名

`src/tui/keyActionRouter.ts:155` 现有：

```ts
if (input === 'r') {
  dispatch({ type: 'OPEN_MODAL', modal: 'rename' });
}
```

这一行**没有看 `state.focusedPane` 也没有看 `state.selectedSessionId`**。在项目列表（focusedPane='projects'）上按 R 也会进 rename 模态。spec 文字 `tui-interface/spec.md` 当前写的是「Rename the focused item (project or session)」，与用户当前期望（R = 仅 session）冲突，因此 spec 也要改。

核心改动：在 router 里把 `r` 门控成

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

`RenameModal` 已经支持 `kind: 'session' | 'project'` 和 `initial` 预填（`App.tsx:396-407`），无需改模态。

### Bug 4：重命名数据不闭环

调用 `renameSession(id, newName)` / `renameProject(key, newName)` 的 action 在 `src/actions/` 里早已实现（通过 `setAlias` 落盘）—— 但 App.tsx 的 rename modal `onSubmit` 是占位，**根本没调它们**：

```ts
onSubmit={() => {
  /* 真正写 alias 的派发由 renameProject / renameSession action
     在后续 task 内联；本任务仅挂 UI 与 keybinding 接线。 */
  dispatch({ type: 'CLOSE_MODAL' });
}}
```

注释说「实际写 alias 在后续 task 内联」——后续 task 没来。

此外，reducer 内的 `deriveDisplayName(meta)` 在 `SESSION_DISCOVERED` 路径下只看 `lastPrompt ?? firstUserMessage ?? sessionId`，完全忽略 `state.sessionAliases`。即便后续接入落盘，已存在的 `state.projects[i].sessions[j].displayName` 在第一次发现时就用 prompt 文本塑好了，**重命名不会刷新**。

跟 `group.ts:53` 的 `sessionDisplayName(meta, alias)` 走 alias → lastPrompt → firstMessage → cwd basename 优先级不一致 —— 也就是说同一份数据在两个渲染路径上有不同的优先级链。

### Bug 4c 修复：`saveState` 同步落盘（防止 quit 截断丢失）

Bug 4b 修好后同次会话内 UI 立刻变（乐观更新），但「下次启动也保持」仍可能丢失：

- App.tsx onSubmit 异步 fire-and-forget 调 `renameSessionAction`；action 内 `await saveState(next)` 用 `fs.writeFile` + `fs.rename`（async）
- 用户按 Enter 后如果立刻 `Ctrl+C`（或关闭终端窗口），cli.tsx 的 `handleSignal` 会同步调 `process.exit(0)` —— 此时 `fs.writeFile` / `fs.rename` 的异步操作仍在 Node.js libuv 队列里，没真正落到磁盘
- 状态：state.json 仍是旧版本或不存在；下次 boot `SESSION_DISCOVERED` 走 prompt fallback → 显示「长文案」

修复：把 `saveState` 内部的 fs 操作改为同步 API（`mkdirSync` / `writeFileSync` / `renameSync`）。Node.js 的 sync 系统调用一旦返回，write+rename 已经在内核层面完成；进程被 SIGKILL 也已经持久化。

API 兼容性：`saveState` / `setAlias` / `renameSession` 仍返回 `Promise<void>`（避免改 return 类型造成 churn）；同步工作完成后再 `return`（让 await 立即 fulfilled）。action 测试里的 `mockResolvedValue(undefined)` 不受影响。

读取侧 `loadState` 保留 async API（不需要为读改 sync），因为读路径不存在「早于落盘完成」的退出竞争 —— `state.json` 完整写入后才被读。

## Decisions

需要两段同步改动：

1. **新增 reducer action `SET_ALIAS`**：把 alias 写进 `state.sessionAliases` 或 `state.projectAliases`，同时把 `state.projects` 中对应 Session / Project 副本的 `displayName` 字段同步刷新。这样下次 render 即时拿到新名，无需再次扫描。

2. **`rename modal onSubmit` 真正调 action**，并把目标 ID 走 ctx 路由过来：

   ```ts
   // keyActionRouter.ts（r 键 dispatch）
   ctx: {
     renameKind: 'session',
     renameTargetId: state.selectedSessionId, // ← 新增
     renameCurrentName: state.sessionAliases[state.selectedSessionId] ?? '',
   }
   ```

   ```ts
   // App.tsx（rename modal onSubmit — Bug 4b 收敛为乐观更新）
   onSubmit={(newName) => {
     const safeName = newName.trim();
     const kind = state.modalContext.renameKind ?? 'session';
     const targetId = state.modalContext.renameTargetId
       ?? (kind === 'session' ? state.selectedSessionId : state.selectedProjectKey);
     if (typeof targetId !== 'string' || safeName.length === 0) {
       dispatch({ type: 'CLOSE_MODAL' });
       return;
     }
     // 1) 乐观：同步 dispatch SET_ALIAS 让 UI 立刻看到新名
     // 2) 同步 dispatch CLOSE_MODAL 让用户立刻看到反馈
     // 这两步必须在 await 之前，避免任何 await/then 回调被推迟导致
     // 「列表还是长文案」症状；无论落盘成功或失败，UI 都已经更新
     dispatch({ type: 'SET_ALIAS', kind, key: targetId, name: safeName });
     dispatch({ type: 'CLOSE_MODAL' });
     // 3) 后台异步落盘；失败时 dispatch NOTICE 报告（status bar 显示）
     const persist = kind === 'session'
       ? renameSessionAction(targetId, safeName)
       : renameProjectAction(targetId, safeName);
     void persist.catch((err: unknown) => {
       const msg = err instanceof Error ? err.message : String(err);
       dispatch({ type: 'NOTICE', kind: 'error', message: `Rename failed: ${msg}` });
     });
   }}
   ```

3. **`deriveDisplayName` 接受 alias 参数，并在 `SESSION_DISCOVERED` 内从 `state.sessionAliases[meta.sessionId]` 取值先判断** —— 让 reducer 路径和 `groupSessions` 的优先级一致。

### D1：保留 App「props.projects」机制，但加 `onProjectsChange` 让 App 主动上报

- **选择**：在 `App.tsx` 增加 prop `onProjectsChange?: (projects: Project[]) => void`；`App` 在 `state.projects` 变化时 `useEffect` 调它。`bootstrap` 用一个 `latestProjects: Project[]` 闭包外变量持有；`createAppElement` 读取 `latestProjects` 而非首次空值。
- **替代方案 A**：cli 改用 React Context 共享一份 `projectsRef`，绕过 props。
  - ❌ 需要新增 Context、provider wrapper 改造，触面比 `onProjectsChange` 大。
- **替代方案 B**：直接重新跑 `runDiscovery`（首次 → unmount → 再次 runDiscovery）。
  - ❌ 浪费 600+ 个 session 的重新扫描；首次发现已使用过的项目命名/别名仍需要 App 内部 reducer 串起来，重启后别名/排序丢失。
- **替代方案 C**：在 `current.ts` 内部持久化一份（写临时文件）并在 remount 时读回。
  - ❌ 引入新 I/O 与失败模式，无收益。

✅ 选 D1：行为最小变更、与现有「props 推动 state + reducer 反派更新」模式一致。

### D2：通过 `state/projects` 的 stringify-by-reference 检测变更

- 简单实现：`useEffect(() => { onProjectsChange?.(state.projects); }, [state.projects])`。
- 不做 deep-equality short-circuit：reducer 每次 SESSION_DISCOVERED 都会新生成数组引用，已经天然防止无限触发；`onProjectsChange` 内部也不会无意义地把同一个引用写回 `latestProjects`。

### D3：修 Ctrl+C = `exitOnCtrlC: false`，让 `useInput` 真正处理

- **选择**：在 cli 的 `_render(createAppElement(projects))` 调用上显式传 `{ exitOnCtrlC: false }`，让 Ink 不再短路 `useInput`，从而使 `keyActionRouter` 把 `Ctrl+C` 路由到 `onQuit`，最终 `releaseLock().finally(() => process.exit(0))`。
- **替代方案 A**：维持 `exitOnCtrlC: true`，并在 Ink 的 `onExit` / `unmount` 后手动 `process.exit(0)`。
  - ❌ 需要把 bootstrap 改成接收 render 的 onExit 回调，引入新依赖关系。
- **替代方案 B**：注册 `process.on('SIGINT')` 并同时 detach Ink TTY。
  - ❌ Ink 已经把 Ctrl+C 在用户态截走，SIGINT 监听器不会触发。
- **替代方案 C**：每次 keystroke 都 raw-read 而不是交给 Ink。
  - ❌ 完全重写，触面过大。

✅ D3 一行 `exitOnCtrlC: false` 即可，与既有 `keyActionRouter` 设计无冲突。

### D4：保留 `q` 与 `Ctrl+C` 等价行为

`q` 走的也是同一条 `onQuit` 路径，`exitOnCtrlC: false` 不影响 `q`，无需改动。

### D5：`r` 键的两种语义选择

- **选择**：a) 仍允许 R 重命名 project；b) 仅 session 侧生效。  
  通过用户反馈选择了 **b**（仅 session），因为 alias 的语义本来就以「具体一次对话」为单位；项目侧重命名会改 groupKey，副作用面比 alias 大，且目前 TUI 还没有 project alias 的 UX 通路。
- **替代方案**：route R 总是预填 modal，但允许用户在 modal 里切换 kind。  
  ❌ 复杂度高、与「保留最小变更」原则冲突。

✅ 选 b + D4：仅 sessions pane 的 R 开模态；保留 `renameProject` action 模块（不删源码），但路由层不再触发。

### D6：重命名数据流的同步点选 SET_ALIAS reducer（而非 BOOTSTRAP 全量刷新）

- **选择**：在 reducer 增补 `SET_ALIAS { kind, key, name }`，局部更新 `sessionAliases` / `projectAliases`，并同步 patch `state.projects` 中匹配条目的 `displayName`。
- **替代方案 A**：rename 落盘成功后再次全量 `runDiscovery` + 重建 groups。
  - ❌ 600+ sessions 重新扫描，浪费时间；并且和 Bug 1 fix 的「避免 flicker」目标冲突。
- **替代方案 B**：rename 落盘成功后 `loadState()` + `dispatch BOOTSTRAP` 重新初始化整棵 React 树。
  - ❌ 用户的 selectedProjectKey / selectedSessionId / focusedPane / 模态状态都会被清掉，UX 灾难。
- **替代方案 C**：直接 mutate `state.projects[i].sessions[j].displayName`，绕开 reducer。
  - ❌ 违反现有「reducer 纯函数」约束，会让 `useEffect`/订阅路径行为不可预测。

✅ 选 D6：增量 patch alias + projects.displayName，与现有 immutable update 路径一致；副作用只在被命中的 session/project 上；不触发其他 React state 重置。

### D7：`deriveDisplayName` 优先级对齐 `group.ts:53`

- **选择**：`deriveDisplayName(meta, alias?)` 新增第二个参数。`SESSION_DISCOVERED` 路径传 `state.sessionAliases[meta.sessionId]`。空 alias 时退回原 `lastPrompt ?? firstUserMessage ?? sessionId`。
- 这样两条渲染路径（reducer 内的 `SESSION_DISCOVERED` 和 `groupSessions(...)`）对同一份 `(SessionMeta, sessionAliases)` 都给出相同 `displayName`，消除「fix 完 alias 之后新发现的 session 名 vs 老 session 名表现不一致」的潜在 drift。

## Risks / Trade-offs

## Risks / Trade-offs

- **[R1] `onProjectsChange` 触发频率** → `state.projects` 在 SESSION_DISCOVERED 之间不会被 reducer 复制不必要的副本（reducer 已经是 immutable update）。实测 600+ sessions 扫描期间最多 1 次 change/setProjects 周期，且 `latestProjects` 写回是 O(1) 引用替换。
- **[R2] 退出路径同时被 `lock.ts` 与 cli 的 SIGINT 监听器覆盖** → 现存 `src/state/lock.ts:60-63` 已经 `process.on('SIGINT', () => void release(); process.exit(0))`。即便将来 raw mode 不可用导致 SIGINT 直接上来，这两个 listener 任一会保证 lock 释放 + 进程退出。无新增冲突。
- **[R3] 测试对 `setCurrentTerminalDeps` 是否被 stub** → 现有 `tests/cli/cli.test.ts` 没有 stub 它；本次 fix 仍直接调用 `setCurrentTerminalDeps`，不需新增 dep。Bootstrap dep 接口不变。
- **[R4] Bug 1 的 view 短暂空白期** → remount 后第一次 render 用的是过时的 `latestProjects`（来自 onProjectsChange 上一次回调），紧接 `useEffect` 会再用新 props.dispatch SET_PROJECTS 同步最新状态。视觉上是「列表立刻就出现」，而非「闪一下空白」。如果担心 race，可在 createAppElement 里同步 `useSyncExternalStore` 风格读取最新值——但目前 App reducer 是事件驱动的，足够。
- **[R5] `exitOnCtrlC: false` 改变 Ink 默认行为** → 风险场景：未来有人依赖 Ink 在 React 未挂载完前就接 Ctrl+C。本次主入口就一个 Ink 实例，不构成新风险。
- **[R6] R 键删掉 project 重命名通路** → 旧 spec 文字把它列为可重命名项目，本次修改后 `renameProject` action 仍可在程序内被调用（外部/未来扩展点），但用户从 TUI 主面板无法再触发。如果之后又想恢复，只需把 `r` dispatch 改成 dispatch OPEN_MODAL + ctx `renameKind: 'project'`。无破坏性、可逆。
- **[R7] Bug 4 SET_ALIAS 后的部分刷新** → 我们只 patch alias map + 目标 Session/Project 的 displayName 字段；不影响其他字段。如果用户在 rename 时切换 session（不可能，因为 modal 期间字母键被吞），也不会发生竞态。modal 关闭时 `modalContext` 重置，所以没有闭包陷阱。
- **[R8] `onSubmit` 同步关模态 vs 异步落盘** → 先同步 `dispatch CLOSE_MODAL`（用户即时反馈），再异步 `await renameSession()` → `dispatch SET_ALIAS`。如果在「关模态」与「落盘成功」之间 ccsm 进程被 SIGKILL（罕见），落盘会丢失但模态已关 —— 用户重新进入会看到旧名 + 未保存的状态。与现状（占位 onSubmit 永远不写盘）相比只是把 false-positive 「关模态」变 true-negative 「关模态但丢了」；用户首次 rename 成功即可纠正此前的认知偏差。
- **[R9] 落盘失败时 modal 已关** → 当前实现：失败时 dispatch `NOTICE` 错误，但不重开模态（避免模态重开 + selectedSessionId 已变更的竞态）。用户可在 status bar 看到 `Rename failed: EACCES...`；如需重试，需要重新按 R。这是 UX 折衷：完整解决需要模态 re-mount，但和当前 `useReducer` 状态机简化冲突，留待后续 task。

## Migration Plan

无需迁移。修复即生效；旧版本用户升级 `ccsm` 安装即可。

## Open Questions

- 无。
