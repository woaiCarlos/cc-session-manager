import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { SessionMeta } from '../state/types.js';

interface JsonRecord {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  lastPrompt?: string;
  customTitle?: string; // Bug 4d: Claude Code `/rename` 写入的事件
  message?: { content?: unknown };
}

function readContentString(content: unknown): string | null {
  if (typeof content === 'string' && content.length > 0) return content;
  return null;
}

/**
 * Bug 4d：parseJsonlFile 现在返回 `{ meta, jsonlPath }` —— 让上层能
 * 用 sessionId 反查文件路径（rename onSubmit 要写回这个文件）。
 */
export interface ParsedSession {
  meta: SessionMeta;
  jsonlPath: string;
}

/**
 * Parse a single `.jsonl` session file into a `SessionMeta`.
 * Streaming, line-by-line, with per-line fault tolerance:
 * malformed JSON lines are skipped, never abort the whole parse.
 *
 * Bug 4d：除 `firstUserMessage` / `lastPrompt` 外，还采集**最新一条**
 * `{"type":"custom-title","customTitle":"..."}` 事件作为
 * `customTitle` —— 这是 Claude Code `/rename` slash command 的
 * 唯一持久化位置；ccsm 把它作为显示名主源。
 *
 * Returns `null` if the file does not exist, is not a regular file, has no
 * recoverable `sessionId`, or has no `lastTimestamp` (i.e. zero usable records).
 */
export async function parseJsonlFile(
  filePath: string,
): Promise<ParsedSession | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) return null;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstUserMessage: string | null = null;
  let lastPrompt: string | null = null;
  let customTitle: string | undefined;
  let lastTimestamp: string | undefined;
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;
    let rec: JsonRecord;
    try {
      rec = JSON.parse(line) as JsonRecord;
    } catch {
      // C13: per-line error isolation — skip malformed JSON
      continue;
    }
    if (!sessionId && typeof rec.sessionId === 'string') sessionId = rec.sessionId;
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;
    if (rec.type === 'user' && firstUserMessage === null) {
      firstUserMessage = readContentString(rec.message?.content);
    }
    if (rec.type === 'last-prompt' && typeof rec.lastPrompt === 'string') {
      // File-order wins: JSONL is append-only, so the latest line is the
      // most recent event regardless of timestamp. Older code compared by
      // timestamp which broke the rescan-on-exit flow: claude could write
      // a new last-prompt with a stale timestamp (or after a newer regular
      // event landed), causing the prompt update to be silently dropped.
      lastPrompt = rec.lastPrompt;
    }
    if (
      rec.type === 'custom-title' &&
      typeof rec.customTitle === 'string' &&
      rec.customTitle.length > 0
    ) {
      // Same rationale as lastPrompt above: file-order wins. The Bug A
      // rescan hook needs to pick up the latest custom-title even when
      // claude's timestamp on the new event is older than the latest
      // regular event timestamp in the file.
      customTitle = rec.customTitle;
    }
    if (typeof rec.timestamp === 'string') {
      if (!lastTimestamp || rec.timestamp > lastTimestamp) lastTimestamp = rec.timestamp;
    }
  }

  // Fallback sessionId from filename when no record carried one.
  if (!sessionId) {
    const base = path.basename(filePath, '.jsonl');
    sessionId = base || undefined;
  }

  if (!sessionId || !lastTimestamp) return null;

  return {
    meta: {
      sessionId,
      cwd: cwd ?? '',
      firstUserMessage,
      lastPrompt,
      customTitle,
      lastTimestamp,
      sizeBytes: stat.size,
      lineCount,
    },
    jsonlPath: filePath,
  };
}
