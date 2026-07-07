import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

vi.mock('../../src/discovery/parse.js', () => ({
  parseJsonlFile: vi.fn(),
}));

import { parseJsonlFile } from '../../src/discovery/parse.js';
import { scanBackground } from '../../src/discovery/index.js';
import type { SessionMeta } from '../../src/state/types.js';

const mockedParse = vi.mocked(parseJsonlFile);

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-bg-'));
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

describe('scanBackground (AsyncGenerator API)', () => {
  it('yields every SessionMeta from runDiscovery', async () => {
    for (const id of ['a', 'b', 'c']) {
      await fs.writeFile(path.join(tmp, `${id}.jsonl`), '');
    }
    mockedParse.mockImplementation(async (file) => mkMeta(path.basename(file, '.jsonl')));

    const collected: string[] = [];
    for await (const meta of scanBackground(tmp)) {
      collected.push(meta.sessionId);
    }
    expect(collected.sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns (terminates) when root has no jsonl files', async () => {
    const collected: SessionMeta[] = [];
    for await (const meta of scanBackground(tmp)) {
      collected.push(meta);
    }
    expect(collected).toEqual([]);
    expect(mockedParse).not.toHaveBeenCalled();
  });

  it('does not yield until the main thread has had a chance to render (microtask scheduling)', async () => {
    // Mock parse to delay ~30ms so the generator is in the middle of work
    // when we check whether the main thread can render.
    await fs.writeFile(path.join(tmp, 'late.jsonl'), '');
    mockedParse.mockImplementation(async (file) => {
      await new Promise((r) => setTimeout(r, 30));
      return mkMeta(path.basename(file, '.jsonl'));
    });

    const gen = scanBackground(tmp);

    // First .next() — starts the generator. Because `void runDiscovery(...)`
    // is dispatched and the body awaits a microtask before yielding, the
    // promise must NOT be resolved synchronously.
    const first = gen.next();
    let mainThreadRendered = false;
    // Microtask scheduled AFTER .next() returns — represents the UI's
    // first paint. If the generator yielded synchronously, `value` would
    // already be set. The contract is: yield happens AFTER at least one
    // microtask tick.
    await Promise.resolve().then(() => {
      mainThreadRendered = true;
    });
    expect(mainThreadRendered).toBe(true);
    // At this point the first .next() promise has not settled — scan is
    // still in flight (parse takes 30ms), so first.value is undefined.
    const peeked = await Promise.race([
      first.then((r) => ({ settled: true as const, ...r })),
      new Promise<{ settled: false }>((r) => setTimeout(() => r({ settled: false }), 5)),
    ]);
    expect(peeked.settled).toBe(false);

    // Now drain the rest.
    const rest: string[] = [];
    let cur = await first;
    while (!cur.done) {
      rest.push(cur.value.sessionId);
      cur = await gen.next();
    }
    expect(rest).toEqual(['late']);
  });

  it('propagates discovery-level errors (e.g. EACCES on root) to the consumer', async () => {
    // Replace mocked parse with real parse, then make listJsonlFiles fail
    // by pointing at a path that exists but is a file (not a directory).
    // The simplest way: write a file and treat it as the rootPath.
    const fileAsRoot = path.join(tmp, 'not-a-dir.jsonl');
    await fs.writeFile(fileAsRoot, '');
    mockedParse.mockImplementation(async () => mkMeta('x'));

    const gen = scanBackground(fileAsRoot);
    await expect(gen.next()).rejects.toThrow();
    // Drain remaining — must not hang.
    try {
      while (true) {
        const r = await gen.next();
        if (r.done) break;
      }
    } catch {
      // expected — error already raised above
    }
  });

  it('returns an object that is async-iterable (Symbol.asyncIterator)', () => {
    const gen = scanBackground(tmp);
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
    // Should be the generator itself.
    expect(gen[Symbol.asyncIterator]()).toBe(gen);
  });
});