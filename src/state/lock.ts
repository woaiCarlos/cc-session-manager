import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './store.js';

const LOCK_PATH = path.join(CONFIG_DIR, 'lock');

interface LockData {
  pid: number;
  timestamp: number;
}

async function readLock(): Promise<LockData | null> {
  try {
    const raw = await fs.readFile(LOCK_PATH, 'utf8');
    return JSON.parse(raw) as LockData;
  } catch {
    return null;
  }
}

async function writeLock(pid: number): Promise<void> {
  const data: LockData = { pid, timestamp: Date.now() };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(LOCK_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export async function tryAcquire(): Promise<'acquired' | 'taken' | 'stale'> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const existing = await readLock();
  if (!existing) {
    await writeLock(process.pid);
    return 'acquired';
  }
  try {
    process.kill(existing.pid, 0);
    return 'taken';
  } catch {
    // dead PID
  }
  const ageMs = Date.now() - existing.timestamp;
  if (ageMs > 24 * 60 * 60 * 1000) {
    await writeLock(process.pid);
    return 'stale';
  }
  return 'taken';
}

export async function release(): Promise<void> {
  try {
    const existing = await readLock();
    if (existing?.pid === process.pid) {
      await fs.unlink(LOCK_PATH);
    }
  } catch {
    /* ignore */
  }
}

process.on('exit', () => void release());
process.on('SIGINT', () => {
  void release();
  process.exit(0);
});
