import os from 'node:os';
import { listJsonlFiles } from './scan.js';
import { parseJsonlFile } from './parse.js';
import type { SessionMeta } from '../state/types.js';

/**
 * Bounded-concurrency discovery worker pool size.
 * Never zero; never more than 4; never more than (cpus - 1).
 */
const POOL_SIZE = Math.min(4, Math.max(1, os.cpus().length - 1));

/**
 * Walk `rootPath` for `*.jsonl` files and parse each one in parallel
 * (up to POOL_SIZE concurrent parses), invoking `onMeta` for every
 * successfully parsed `SessionMeta`.
 *
 * Per-file failures are logged and skipped — they never abort the scan.
 */
export async function runDiscovery(
  rootPath: string,
  onMeta: (meta: SessionMeta) => void,
): Promise<void> {
  const files = await listJsonlFiles(rootPath);
  if (files.length === 0) return;

  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const file = files[idx];
      try {
        const meta = await parseJsonlFile(file);
        if (meta) onMeta(meta);
      } catch (err) {
        // C13: per-file fault tolerance — skip, log, keep going.
        // eslint-disable-next-line no-console
        console.error('[discovery] parse failed:', file, err);
      }
    }
  }

  const poolSize = Math.min(POOL_SIZE, files.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
}
