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
  message?: { content?: unknown };
}

function readContentString(content: unknown): string | null {
  if (typeof content === 'string' && content.length > 0) return content;
  return null;
}

/**
 * Parse a single `.jsonl` session file into a `SessionMeta`.
 * Streaming, line-by-line, with per-line fault tolerance:
 * malformed JSON lines are skipped, never abort the whole parse.
 *
 * Returns `null` if the file does not exist, is not a regular file, has no
 * recoverable `sessionId`, or has no `lastTimestamp` (i.e. zero usable records).
 */
export async function parseJsonlFile(filePath: string): Promise<SessionMeta | null> {
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
      // Prefer the latest last-prompt by timestamp.
      if (!rec.timestamp || !lastTimestamp || rec.timestamp > lastTimestamp) {
        lastPrompt = rec.lastPrompt;
      }
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
    sessionId,
    cwd: cwd ?? '',
    firstUserMessage,
    lastPrompt,
    lastTimestamp,
    sizeBytes: stat.size,
    lineCount,
  };
}
