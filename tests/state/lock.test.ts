/**
 * Task 9.1 — `src/state/lock.ts` (process-level lock).
 *
 * Contract verified here:
 *  - `tryAcquire()` returns `'acquired'` when no lock file exists and writes
 *    `{pid, timestamp}` to `${CONFIG_DIR}/lock`.
 *  - `tryAcquire()` returns `'taken'` when the existing lock points at a
 *    live PID (process.kill(pid, 0) does not throw) and the timestamp is
 *    fresh (≤ 24h).
 *  - `tryAcquire()` returns `'stale'` when the existing PID is dead but the
 *    lock is older than the 24h threshold → caller now owns the lock.
 *  - `tryAcquire()` returns `'taken'` when the existing PID is dead but the
 *    lock is younger than 24h (dead PID within the grace window must not be
 *    auto-stolen — the next restart needs to clear it manually).
 *  - `release()` unlinks the lock file IFF it was written by our PID; on a
 *    foreign lock it is a no-op.
 *
 * Implementation detail: lock.ts installs `process.on('exit')` and
 * `process.on('SIGINT')` at module load time. To avoid polluting the test
 * runner, we set HOME / XDG_CONFIG_HOME before importing and never fire
 * SIGINT in this file (the hooks are also no-ops for foreign locks).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let lockModule: typeof import('../../src/state/lock.js');

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-lock-'));
  originalEnv = { ...process.env };
  process.env.HOME = tmpDir;
  process.env.XDG_CONFIG_HOME = path.join(tmpDir, '.config');
  vi.resetModules();
  lockModule = await import('../../src/state/lock.js');
});

afterEach(async () => {
  process.env = originalEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('lock.tryAcquire', () => {
  it("writes {pid, timestamp} and returns 'acquired' when no lock exists", async () => {
    const result = await lockModule.tryAcquire();
    expect(result).toBe('acquired');

    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { pid: number; timestamp: number };
    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.timestamp).toBe('number');
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it("returns 'taken' when an existing lock points at a live PID", async () => {
    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // process.pid is always live in this test runner
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
      'utf8',
    );

    // Our own PID holds the lock — this call should report 'taken'.
    const result = await lockModule.tryAcquire();
    expect(result).toBe('taken');
  });

  it("returns 'taken' for a dead PID within the 24h grace window", async () => {
    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // Pick a PID that is almost certainly dead (a synthetic large number).
    // process.kill(pid, 0) should throw ESRCH on a non-existent PID.
    const deadPid = 999_999_999;
    // 1 hour ago — fresh enough to not be considered stale.
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: deadPid, timestamp: oneHourAgo }),
      'utf8',
    );

    const result = await lockModule.tryAcquire();
    expect(result).toBe('taken');

    // The foreign lock must NOT have been overwritten.
    const raw = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      pid: number;
    };
    expect(raw.pid).toBe(deadPid);
  });

  it("returns 'stale' and steals the lock when the dead PID is older than 24h", async () => {
    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const deadPid = 999_999_998;
    // 48 hours ago — past the 24h stale threshold.
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: deadPid, timestamp: twoDaysAgo }),
      'utf8',
    );

    const result = await lockModule.tryAcquire();
    expect(result).toBe('stale');

    const raw = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      pid: number;
    };
    expect(raw.pid).toBe(process.pid);
  });
});

describe('lock.release', () => {
  it('unlinks the lock file when it was written by our PID', async () => {
    const acquired = await lockModule.tryAcquire();
    expect(acquired).toBe('acquired');

    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    expect((await fs.stat(lockPath)).isFile()).toBe(true);

    await lockModule.release();

    await expect(fs.stat(lockPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it("is a no-op when the lock file belongs to another PID", async () => {
    const storeModule = await import('../../src/state/store.js');
    const lockPath = path.join(storeModule.CONFIG_DIR, 'lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const foreignPid = 999_999_997;
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: foreignPid, timestamp: Date.now() }),
      'utf8',
    );

    await lockModule.release();

    // Foreign lock must survive a release attempt from our PID.
    const raw = await fs.readFile(lockPath, 'utf8');
    expect(JSON.parse(raw).pid).toBe(foreignPid);
  });

  it('resolves without throwing when no lock file exists', async () => {
    // No tryAcquire first — release() on a missing lock must be idempotent.
    await expect(lockModule.release()).resolves.toBeUndefined();
  });
});
