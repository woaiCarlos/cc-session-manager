import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

vi.mock('../../src/discovery/parse.js', () => ({
  parseJsonlFile: vi.fn(),
}));

import { parseJsonlFile } from '../../src/discovery/parse.js';
import { runDiscovery } from '../../src/discovery/index.js';
import type { SessionMeta } from '../../src/state/types.js';

const mockedParse = vi.mocked(parseJsonlFile);

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-coord-'));
  mockedParse.mockReset();
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('runDiscovery', () => {
  it('emits metadata for every valid session', async () => {
    // Replace mocked parse with the real implementation for this end-to-end check.
    const { parseJsonlFile: realParse } = await vi.importActual<
      typeof import('../../src/discovery/parse.js')
    >('../../src/discovery/parse.js');
    mockedParse.mockImplementation(realParse);

    const lines = [
      JSON.stringify({
        type: 'user',
        sessionId: 's1',
        cwd: '/p1',
        message: { content: 'A' },
        timestamp: '2026-01-01T00:00:00Z',
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 's2',
        cwd: '/p2',
        message: { content: 'B' },
        timestamp: '2026-01-01T00:01:00Z',
      }),
    ];
    for (const id of ['s1', 's2']) {
      await fs.writeFile(
        path.join(tmp, `${id}.jsonl`),
        lines.find((l) => l.includes(id))! + '\n',
      );
    }

    const collected: string[] = [];
    await runDiscovery(tmp, (m) => collected.push(m.sessionId));
    expect(collected.sort()).toEqual(['s1', 's2']);
  });

  it('caps concurrency at the pool size (≤ 4)', async () => {
    const fileCount = 12;
    for (let i = 0; i < fileCount; i++) {
      await fs.writeFile(path.join(tmp, `f${i}.jsonl`), '');
    }

    let active = 0;
    let maxActive = 0;
    const metaByFile = new Map<string, SessionMeta>();
    mockedParse.mockImplementation(async (file) => {
      active++;
      if (active > maxActive) maxActive = active;
      // Force enough latency to expose overlap.
      await new Promise((r) => setTimeout(r, 15));
      active--;
      const id = path.basename(file, '.jsonl');
      const meta: SessionMeta = {
        sessionId: id,
        cwd: '/x',
        firstUserMessage: null,
        lastPrompt: null,
        lastTimestamp: '2026-01-01T00:00:00Z',
        sizeBytes: 0,
        lineCount: 1,
      };
      metaByFile.set(file, meta);
      return meta;
    });

    const collected: string[] = [];
    await runDiscovery(tmp, (m) => collected.push(m.sessionId));

    // Hard cap: never exceed 4 concurrent parses.
    expect(maxActive).toBeLessThanOrEqual(4);
    // All files are processed.
    expect(collected.length).toBe(fileCount);
  });

  it('skips files that fail to parse and continues the rest', async () => {
    for (const name of ['a', 'b', 'c']) {
      await fs.writeFile(path.join(tmp, `${name}.jsonl`), '');
    }
    mockedParse.mockImplementation(async (file) => {
      if (file.endsWith('b.jsonl')) throw new Error('boom');
      return {
        sessionId: path.basename(file, '.jsonl'),
        cwd: '/x',
        firstUserMessage: null,
        lastPrompt: null,
        lastTimestamp: '2026-01-01T00:00:00Z',
        sizeBytes: 0,
        lineCount: 1,
      };
    });

    const collected: string[] = [];
    // Should not throw.
    await runDiscovery(tmp, (m) => collected.push(m.sessionId));
    expect(collected.sort()).toEqual(['a', 'c']);
  });

  it('emits nothing when the root has no jsonl files', async () => {
    const collected: string[] = [];
    await runDiscovery(tmp, (m) => collected.push(m.sessionId));
    expect(collected).toEqual([]);
    expect(mockedParse).not.toHaveBeenCalled();
  });
});
