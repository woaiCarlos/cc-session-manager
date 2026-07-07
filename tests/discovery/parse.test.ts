import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonlFile } from '../../src/discovery/parse.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-parse-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeSession(lines: string[]): Promise<string> {
  const f = path.join(tmp, 'test.jsonl');
  await fs.writeFile(f, lines.join('\n') + (lines.length ? '\n' : ''));
  return f;
}

describe('parseJsonlFile', () => {
  it('extracts metadata from a well-formed session', async () => {
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'Fix login bug' }, timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'assistant', sessionId: 'abc', message: { content: [] }, timestamp: '2026-01-01T00:01:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'Refactored fix', timestamp: '2026-01-01T00:02:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.jsonlPath).toBe(file);
    const meta = parsed!.meta;
    expect(meta.sessionId).toBe('abc');
    expect(meta.cwd).toBe('/x');
    expect(meta.firstUserMessage).toBe('Fix login bug');
    expect(meta.lastPrompt).toBe('Refactored fix');
    expect(meta.lastTimestamp).toBe('2026-01-01T00:02:00Z');
  });

  it('returns null for empty file', async () => {
    const file = await writeSession([]);
    const meta = await parseJsonlFile(file);
    expect(meta).toBeNull();
  });

  it('skips malformed lines without aborting', async () => {
    const file = await writeSession([
      'not-json',
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'Hi' }, timestamp: '2026-02-01T00:00:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.sessionId).toBe('abc');
    expect(parsed!.meta.firstUserMessage).toBe('Hi');
  });

  it('returns the most recent last-prompt when multiple exist', async () => {
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'first', timestamp: '2026-01-01T01:00:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'second', timestamp: '2026-01-01T02:00:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.lastPrompt).toBe('second');
  });

  it('handles records missing optional fields', async () => {
    // No cwd, no lastPrompt, no firstUserMessage content
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'xyz', message: { content: null }, timestamp: '2026-03-01T00:00:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.sessionId).toBe('xyz');
    expect(parsed!.meta.cwd).toBe('');
    expect(parsed!.meta.firstUserMessage).toBeNull();
    expect(parsed!.meta.lastPrompt).toBeNull();
  });

  // Bug 4d：parseJsonlFile 应该从 JSONL 抽出最新一条 `{"type":"custom-title",...}`
  // 事件，作为显示名主源。ccsm 不再自维护 alias。
  it('Bug 4d: extracts the latest custom-title event as the session customTitle', async () => {
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'custom-title', sessionId: 'abc', customTitle: '旧的别名', timestamp: '2026-01-01T01:00:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: '后置 prompt', timestamp: '2026-01-01T02:00:00Z' }),
      JSON.stringify({ type: 'custom-title', sessionId: 'abc', customTitle: '飞牛内网穿透', timestamp: '2026-01-01T03:00:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.customTitle).toBe('飞牛内网穿透');
  });

  it('Bug 4d: returns no customTitle when there is no custom-title event', async () => {
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.customTitle).toBeUndefined();
  });

  it('Bug 4d: prefers the LATER custom-title when both have the same timestamp', async () => {
    // Same timestamp on both events: the later-read wins (replace-by-greater-equal
    // semantics). Use the same ISO ts so the `>` comparison stays false and
    // `>=` (replaceOnEqual) takes effect for the second event.
    const ts = '2026-01-01T01:00:00Z';
    const file = await writeSession([
      JSON.stringify({ type: 'custom-title', sessionId: 'abc', customTitle: 'old', timestamp: ts }),
      JSON.stringify({ type: 'custom-title', sessionId: 'abc', customTitle: 'new', timestamp: ts }),
    ]);
    const parsed = await parseJsonlFile(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.customTitle).toBe('new');
  });
});
