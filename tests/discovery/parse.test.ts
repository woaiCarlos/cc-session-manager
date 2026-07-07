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
    const meta = await parseJsonlFile(file);
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe('abc');
    expect(meta!.cwd).toBe('/x');
    expect(meta!.firstUserMessage).toBe('Fix login bug');
    expect(meta!.lastPrompt).toBe('Refactored fix');
    expect(meta!.lastTimestamp).toBe('2026-01-01T00:02:00Z');
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
    const meta = await parseJsonlFile(file);
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe('abc');
    expect(meta!.firstUserMessage).toBe('Hi');
  });

  it('returns the most recent last-prompt when multiple exist', async () => {
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'abc', cwd: '/x', message: { content: 'A' }, timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'first', timestamp: '2026-01-01T01:00:00Z' }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc', lastPrompt: 'second', timestamp: '2026-01-01T02:00:00Z' }),
    ]);
    const meta = await parseJsonlFile(file);
    expect(meta).not.toBeNull();
    expect(meta!.lastPrompt).toBe('second');
  });

  it('handles records missing optional fields', async () => {
    // No cwd, no lastPrompt, no firstUserMessage content
    const file = await writeSession([
      JSON.stringify({ type: 'user', sessionId: 'xyz', message: { content: null }, timestamp: '2026-03-01T00:00:00Z' }),
    ]);
    const meta = await parseJsonlFile(file);
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe('xyz');
    expect(meta!.cwd).toBe('');
    expect(meta!.firstUserMessage).toBeNull();
    expect(meta!.lastPrompt).toBeNull();
  });
});
