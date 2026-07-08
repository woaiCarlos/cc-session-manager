/**
 * Action: write a `custom-title` event to a Claude Code session JSONL file.
 *
 * Bug 4d 替代旧的 `renameSession` / `renameProject`：
 * 不再在 ccsm 的 `state.json` 自维护一个 alias map，而是把
 * `{"type":"custom-title","customTitle":"<name>","sessionId":"<id>","timestamp":"<ISO8601>"}`
 * 这一行直接 append 到 Claude Code 的 session JSONL —— 与 CC 的 `/rename`
 * slash command 写入同一个文件，达成「单一持久化来源」。
 *
 * ccsm 启动时 parse.ts 从 JSONL 抽 latest `custom-title`，App 把它作为
 * 显示名的主源；本 action 让 ccsm 的 R 键 UX 入口也能触发同样的写入。
 *
 * 文件路径：调用方传入（discovery 阶段同时维护一张 `sessionId → jsonlPath`
 * map，rename modal 的 onSubmit 通过 sessionId 查表拿到）。
 *
 * 使用 fs.appendFileSync：appendFileSync 单次 syscall 原子追加一行；sync
 * 即便用户按 Enter 后立刻 Ctrl+C，写盘也已落盘。
 */
import { appendFileSync } from 'node:fs';

/**
 * 把 `{"type":"custom-title", ...}` 一行同步追加到指定 JSONL。
 *
 * @param jsonlPath session 的主 JSONL 绝对路径
 * @param sessionId session id（与文件中已有 sessionId 一致）
 * @param customTitle 用户输入的新名字（已 trim 过、非空）
 * @returns 异步 Promise<void>，resolve 后意味着写入完成
 */
export async function writeSessionCustomTitle(
  jsonlPath: string,
  sessionId: string,
  customTitle: string,
): Promise<void> {
  const safeTitle = JSON.stringify(customTitle); // 防引号 / 控制字符污染 JSON
  const event = {
    type: 'custom-title',
    customTitle: JSON.parse(safeTitle) as string,
    sessionId,
    timestamp: new Date().toISOString(),
  };
  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(jsonlPath, line, 'utf8');
}
