import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

vi.mock('../../src/discovery/parse.js', () => ({
  parseJsonlFile: vi.fn(),
}));

import { parseJsonlFile } from '../../src/discovery/parse.js';
import { scanAsync } from '../../src/discovery/index.js';
import type { SessionMeta } from '../../src/state/types.js';

const mockedParse = vi.mocked(parseJsonlFile);

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-as-'));
  mockedParse.mockReset();
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function mkMeta(id: string): SessionMeta {
  return {
    sessionId: id,
    cwd: '/x',
    firstUserMessage: null,
    lastPrompt: null,
    lastTimestamp: '2026-01-01T00:00:00Z',
    sizeBytes: 0,
    lineCount: 1,
  };
}

describe('scanAsync (callback wrapper with progress/done/error events)', () => {
  it('returns a promise that resolves with the result when scan finishes', async () => {
    for (const id of ['x', 'y']) {
      await fs.writeFile(path.join(tmp, `${id}.jsonl`), '');
    }
    mockedParse.mockImplementation(async (file) => mkMeta(path.basename(file, '.jsonl')));

    const collected: string[] = [];
    const result = await scanAsync(tmp, (m) => collected.push(m.sessionId));
    expect(collected.sort()).toEqual(['x', 'y']);
    expect(result.done).toBe(true);
    expect(result.total).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it('emits progress events (current/total) during the scan', async () => {
    const fileCount = 5;
    for (let i = 0; i < fileCount; i++) {
      await fs.writeFile(path.join(tmp, `p${i}.jsonl`), '');
    }
    mockedParse.mockImplementation(async (file) => {
      await new Promise((r) => setTimeout(r, 10));
      return mkMeta(path.basename(file, '.jsonl'));
    });

    const progress: Array<{ current: number; total: number }> = [];
    const result = await scanAsync(tmp, undefined, {
      onProgress: (p) => progress.push({ ...p }),
    });
    expect(result.total).toBe(fileCount);
    // Each progress tick must agree: total should match final count.
    for (const p of progress) {
      expect(p.total).toBe(fileCount);
      expect(p.current).toBeGreaterThanOrEqual(0);
      expect(p.current).toBeLessThanOrEqual(fileCount);
    }
    // First progress should have total known before first parse completes.
    expect(progress.length).toBeGreaterThanOrEqual(fileCount);
  });

  it('invokes onDone exactly once when the scan finishes', async () => {
    await fs.writeFile(path.join(tmp, 'one.jsonl'), '');
    mockedParse.mockImplementation(async (file) => mkMeta(path.basename(file, '.jsonl')));

    const onDone = vi.fn();
    await scanAsync(tmp, undefined, { onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ total: 1 });
  });

  it('returns total=0 when root has no jsonl files (and no errors)', async () => {
    const onMeta = vi.fn();
    const onDone = vi.fn();
    const result = await scanAsync(tmp, onMeta, { onDone });
    expect(onMeta).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ total: 0 });
    expect(result.total).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('keeps per-file fault tolerance: skips bad files, reports success', async () => {
    for (const id of ['good1', 'bad', 'good2']) {
      await fs.writeFile(path.join(tmp, `${id}.jsonl`), '');
    }
    mockedParse.mockImplementation(async (file) => {
      if (path.basename(file).startsWith('bad')) {
        throw new Error('nope');
      }
      return mkMeta(path.basename(file, '.jsonl'));
    });
    const collected: string[] = [];
    const result = await scanAsync(tmp, (m) => collected.push(m.sessionId));
    expect(collected.sort()).toEqual(['good1', 'good2']);
    expect(result.total).toBe(2);
    expect(result.done).toBe(true);
  });

  it('does not block the main thread — first paint happens before parse completes', async () => {
    await fs.writeFile(path.join(tmp, 'slow.jsonl'), '');
    mockedParse.mockImplementation(async (file) => {
      await new Promise((r) => setTimeout(r, 40));
      return mkMeta(path.basename(file, '.jsonl'));
    });

    const scanPromise = scanAsync(tmp);
    // Microtask that simulates the UI's first render frame. If scanAsync
    // were synchronous up-front, this microtask would run AFTER it
    // already returned; if it's truly async, this microtask runs first.
    let rendered = false;
    scanPromise.then(() => {
      rendered = true;
    });
    await Promise.resolve().then(() => {
      /* nothing — just flush microtasks */
    });
    expect(rendered).toBe(false);
    await scanPromise;
    expect(rendered).toBe(true);
  });
});