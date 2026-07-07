## Context

ccsm 在 `fix-tui-exit-handling` 之后，TTY 流已经能干净地承载 `claude --resume <id>` 进入与退出。但**退出后的状态**是冷的：

- `src/cli.tsx:168-172` 的 `runDiscovery` 是一次性的（`void (async () => { ... })`），没有任何「resume 退出后重新扫描」的钩子。
- `src/terminal/current.ts:83-97` 的 `child.on('exit')` 路径只做 `deps!.render(deps!.createAppElement())`，重新渲染的是**首次扫描时的快照**。
- `src/tui/App.tsx:111-165` 的 `SESSION_DISCOVERED` reducer 已经能在「同 id 已存在 + displayName 不同」时 patch（行 137-148），所以只要有新 meta 推回 reducer，UI 就能自我修复。**缺的只是入口**。

`SessionMeta.sizeBytes` 与 `lineCount` 早已在 `parse.ts:115-116` 采集，但 `Session` 类型与 `SessionPane` 渲染都没用到，等于「数据存在但用户看不见」。

代码考古定位两条独立但都属于「已有数据 / 已有副作用未触达」的缺陷：

### Bug A：退出 Claude Code 后不刷新

现状时间线：
1. `bootstrap()` 启动 → `_render(createAppElement(projects))` 渲染 Ink App。
2. `void (async () => { jsonlIndex = await _runDiscovery(root, onMeta); _onScanComplete(); })()` 启动后台扫描，把所有 JSONL 解析成 `SessionMeta` 推给 React reducer。
3. 用户在某个 session 上按 Enter → `resumeSession()` → `dispatchOpen('current', ...)` → `current()` 的 `child.on('exit')` 触发 `deps.render(deps.createAppElement())`。
4. 新 App 实例的 `useEffect` 用 `props.projects`（闭包外变量 `latestProjects`）初始化；`latestProjects` 在第 2 步扫描完后被 `onProjectsChange` 写入，**但仍是启动时那次扫描的结果**。
5. Claude Code 在 resume 期间可能写新的 `custom-title`、`last-prompt`、增加更多 events —— 这些变化永远不会被 ccsm 看到。

诊断结论：retryable 副作用缺失。`runDiscovery` 自身能跑多遍，reducer 自身能去重合并，**差的只是从 current.ts 到 cli.tsx 再到 onMeta 的回路**。

### Bug B：session 大小未展示

- `parse.ts:115` 已经在收集 `sizeBytes`（来自 `fs.stat`）。
- `grouping/group.ts:55-61` 把 `m.sizeBytes` **丢了**，只透传 `displayName/cwd/lastActiveRelative/lastTimestamp`。
- `state/types.ts:22-28` `Session` 没有 `sizeBytes` 字段。
- `SessionPane.tsx:75-83` 每行渲染 `displayName · lastActiveRelative`，没有大小信息。

修复是个最小数据流补丁：把 `m.sizeBytes` 一路透传到 `Session.sizeBytes`，然后在 `SessionPane` 末尾多一段渲染。

## Goals / Non-Goals

**Goals:**
- `current` 后端的 `child.exit` 路径上重新解析该 session 对应的 JSONL 文件并把更新过的 meta 通过 `onMeta` 推回 App reducer；UI 自动刷新 displayName / sizeBytes / lastPrompt / lastTimestamp。
- Session 列表每个 row 末尾展示人类可读的 session 大小（`1.2 KB`、`3.4 MB`、`5.6 GB`）。
- compact 模式下不显示大小，避免窄列双行。
- 不引入新依赖、不改 public API、不动 `renameSession` 写入路径。

**Non-Goals:**
- 不实现「扫描整个 root」的全量 rescan（开销过大且 flicker 风险）。
- 不重写 `runDiscovery` 的并发模型。
- 不改 `cli.tsx` 现有的 `bootstrap`/`runDiscovery` 签名（向后兼容）。
- 不暴露 session 大小给 search filter / sort（仅展示用）。

### D1：单文件 rescan vs 全量 rescan

- **选择**：在 `child.on('exit')` 只重扫被 resume 的那一个 JSONL 文件。
- 理由：用户能感知到的变化只有「当前这个 session 的元数据」（名字/大小/时间），其他 session 在 claude 运行期间不会被修改。重扫一个文件 < 10ms，不会引发 flicker。
- 替代方案 A：`runDiscovery(root)` 全量重扫。
  - ❌ 600+ 文件扫描 500ms+，期间 Ink 重渲染可能显示半空状态；新增 bugs。
- 替代方案 B：定时轮询（如每 5s 扫一次）。
  - ❌ 持续 IO 浪费；用户主动 resume 后才需要的实时性不强。
- 替代方案 C：监听文件系统 inotify / fsevents。
  - ❌ 引入新依赖 + 平台分支；触面过大。

✅ 选 D1：单文件 rescan，挂在 `child.on('exit')` 路径上，before `deps.render` 调用之前（或之后，不影响结果，因 reducer 状态会立即同步）。

### D2：rescan 回调注册点

- **选择**：在 `cli.tsx` 的 `bootstrap` 内定义 `rescanSession: (jsonlPath, sessionId) => void` 闭包，调用 `parseJsonlFile(jsonlPath)` 并把得到的 meta 推给 `_onSession`；通过 `setCurrentTerminalDeps` 的新字段 `rescanSession` 暴露给 `current.ts`。
- 替代方案 A：让 `current.ts` 自己 import `parseJsonlFile`。
  - ❌ 让 terminal 模块依赖 discovery 模块，违反现有 `terminal/` ↔ `discovery/` 解耦。
- 替代方案 B：在 `App.tsx` 内的 `useEffect` 注册全局监听。
  - ❌ App 已被 unmount，没有 hook 接收回调。

✅ 选 D2：cli 闭包持有 rescan 能力，current.ts 仅触发，不了解实现细节。

### D3：rescan 失败处理

- 单文件 rescan 失败（文件被删、权限错）时：
  - `parseJsonlFile` 已 `try/catch` 内部解析错误并返回 `null`（参见 `parse.ts:42-46`）。
  - 若返回 `null`（文件被删），cli 闭包**不调用** `onMeta`，让 reducer 内的 session 保留旧 meta —— 因为「文件消失」场景下保留旧 entry 比静默删行更友好（用户可能只是想 ccsm 重新看，下次启动自然会消失）。
  - 若 `parseJsonlFile` 抛错（罕见，理论上内部已 catch），cli 闭包也 swallow；额外 `console.error('[rescan] failed:', err)` 留给调试。

### D4：formatBytes 边界值

- 0 → `"0 B"`
- < 1024 → `"<n> B"`
- < 1024² → `"<n> KB"`（一位小数，如 `"1.2 KB"`）
- < 1024³ → `"<n> MB"`（一位小数）
- ≥ 1024³ → `"<n> GB"`（一位小数）

实现：

```ts
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}
```

### D5：SessionPane 渲染顺序

- 现状：`displayName · lastActiveRelative`（compact 隐藏 `lastActiveRelative`）
- 改动后：`displayName · lastActiveRelative · 1.2 KB`（compact 同时省略两个次要字段）
- 颜色：大小用 `<Text dimColor>` —— 与 `lastActiveRelative` 视觉一致，不抢眼。

## Risks / Trade-offs

- **[R1] rescan 时机与 Ink remount 的 race** — `child.on('exit')` 内顺序：
  1. `rescanSession(jsonlPath, sessionId)` —— 同步 await 完才推进；解析出的 meta 通过 `_onSession` 派发到**已卸的旧 App**（reducer 已无 listener，等同 noop）。
  2. `deps.render(deps.createAppElement())` —— 创建新 App 实例，`useEffect` 注册新的 `_onSession`/`_onScanComplete` listener。
  
  这就有一个 race：步骤 1 派发的 meta 在旧 App 上被丢失。**修复**：rescan 时先记到 `cli.tsx` 的 `pendingRescanMetas: SessionMeta[]` 数组；新 App 的 mount effect 把这些 pending metas 全部 drain 出去再 `_onScanComplete`。
  
  更简洁替代：把 rescan 放在 `deps.render(...)` **之后**：
  1. `deps.render(deps.createAppElement())` —— 新 App mount，注册 `_onSession`。
  2. `rescanSession(...)` —— 派发到新 App 的 listener。
  
  ✅ 选 R1-b：rescan 放到 render 之后；新 App reducer 收到 SESSION_DISCOVERED 时会做 displayName patch，UI 自动更新。
- **[R2] rescan 期间用户操作（按 Enter / 按 q）** — Ink remount 后立即派发 SESSION_DISCOVERED，期间用户可能已经在操作；reducer 的 `SESSION_DISCOVERED` 是纯 immutable update，不阻塞输入，OK。
- **[R3] `Session.sizeBytes` 字段缺失导致 reducer/SessionPane 类型错误** — `Session` 接口增字段属 breaking 类型变更，但 ccsm 是 bin 部署，没有外部 consumer；测试同步更新即可。
- **[R4] `formatBytes` 在 compact 模式被忽略** — `SessionPane` 接收 `compact` prop 已经存在（`SessionPane.tsx:18`），无需新增 props。
- **[R5] rescan 拉取到的 meta 与当前 store 内的 session 行** — reducer 已有「同 id 不同 displayName → patch」逻辑（`App.tsx:137-148`），扩展为「同 id 不同 displayName 或 sizeBytes 不同 → patch」。本次同步扩展 reducer。
- **[R6] `cli.tsx` 的 `latestProjects` 闭包在 Ink remount 后是否拿到最新数据** — `latestProjects` 由新 App mount 后的 `useEffect → onProjectsChange(state.projects)` 写回。但 rescan 期间 `_onSession` 已被新 App 接管，会通过 `onProjectsChange` 自动同步 latestProjects。OK。

## Migration Plan

无需迁移。修复即生效；旧版本用户升级 `ccsm` 安装即可。

## Open Questions

- 无。