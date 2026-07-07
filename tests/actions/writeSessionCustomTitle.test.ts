// Tests for writeSessionCustomTitle — Bug 4d 替代旧的 renameSession。
// 验证 appendFile 的事件结构与文件持久化结果。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeSessionCustomTitle } from '../../src/actions/writeSessionCustomTitle.js';

let tmp: string;
let jsonlPath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-rename-'));
  jsonlPath = path.join(tmp, 'session.jsonl');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('writeSessionCustomTitle', () => {
  it('appends a custom-title event line to the JSONL file', async () => {
    await writeSessionCustomTitle(jsonlPath, 'sess-1', '飞牛内网穿透');

    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]!);
    expect(event.type).toBe('custom-title');
    expect(event.sessionId).toBe('sess-1');
    expect(event.customTitle).toBe('飞牛内网穿透');
    expect(typeof event.timestamp).toBe('string');
    expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('appends additional events without disturbing prior ones', async () => {
    await writeSessionCustomTitle(jsonlPath, 'sess-1', 'first');
    await writeSessionCustomTitle(jsonlPath, 'sess-1', 'second');

    const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    const second = JSON.parse(lines[1]!);
    expect(first.customTitle).toBe('first');
    expect(second.customTitle).toBe('second');
    // Newer event has higher (or equal) timestamp
    expect(second.timestamp >= first.timestamp).toBe(true);
  });

  it('preserves Chinese characters in the customTitle field', async () => {
    await writeSessionCustomTitle(jsonlPath, 'sess-cjk', '安卓APP打哈欠');
    const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    const event = JSON.parse(lines[0]!);
    expect(event.customTitle).toBe('安卓APP打哈欠');
  });

  it('escapes quotes / backslashes to keep valid JSON', async () => {
    await writeSessionCustomTitle(jsonlPath, 'sess-x', 'has "quote" and \\ back');
    const content = readFileSync(jsonlPath, 'utf8');
    // Should be parseable as JSON line
    const ev = JSON.parse(content.trim());
    expect(ev.customTitle).toBe('has "quote" and \\ back');
  });
});
