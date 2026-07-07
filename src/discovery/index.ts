import os from 'node:os';
import { listJsonlFiles } from './scan.js';
import { parseJsonlFile } from './parse.js';
import type { SessionMeta, ScanProgress } from '../state/types.js';

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
/**
 * Bug 4d：runDiscovery 现在同时对外暴露 sessionId → jsonlPath 的映射，
 * 让 rename onSubmit 能用 sessionId 反查文件路径，把 custom-title 写回 Claude Code 的 JSONL。
 */
export type JsonlIndex = Record<string, string>;

export async function runDiscovery(
  rootPath: string,
  onMeta: (meta: SessionMeta) => void,
  onParsed?: (parsed: { meta: SessionMeta; jsonlPath: string }) => void,
): Promise<JsonlIndex> {
  const files = await listJsonlFiles(rootPath);
  const index: JsonlIndex = {};
  if (files.length === 0) return index;

  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const file = files[idx];
      try {
        const parsed = await parseJsonlFile(file);
        if (!parsed) continue;
        index[parsed.meta.sessionId] = parsed.jsonlPath;
        onMeta(parsed.meta);
        if (onParsed) onParsed(parsed);
      } catch (err) {
        // C13: per-file fault tolerance — skip, log, keep going.
        // eslint-disable-next-line no-console
        console.error('[discovery] parse failed:', file, err);
      }
    }
  }

  const poolSize = Math.min(POOL_SIZE, files.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return index;
}

/**
 * Background scan as an AsyncGenerator.
 *
 * Starts `runDiscovery` immediately, then yields `SessionMeta` values as
 * they are produced. The UI can `for await (const meta of scanBackground(root))`
 * and render items progressively instead of waiting for the whole scan.
 *
 * First-frame guarantee: the first `gen.next()` does not yield a value
 * before the caller has had a chance to run at least one microtask
 * (microtask scheduling separates scan kickoff from first paint).
 *
 * Errors from `runDiscovery` (e.g. EACCES on the root) propagate to the
 * consumer via the iterator's `.throw()` — per-file parse failures are
 * still swallowed inside `runDiscovery` (C13 fault tolerance).
 */
export async function* scanBackground(rootPath: string): AsyncGenerator<SessionMeta> {
  const buffer: SessionMeta[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let error: unknown = null;

  const signal: () => void = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  // Kick off discovery in the background. Fire-and-forget on purpose:
  // we don't want to await this inside the generator body because that
  // would make the first .next() return until the whole scan finishes.
  const runP = runDiscovery(rootPath, (meta) => {
    buffer.push(meta);
    signal();
  });
  runP.then(
    () => {
      finished = true;
      signal();
    },
    (err: unknown) => {
      error = err;
      signal();
    },
  );

  try {
    while (true) {
      if (buffer.length > 0) {
        yield buffer.shift()!;
        continue;
      }
      if (error) throw error;
      if (finished) return;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        // Edge case: items or error arrived between the `if` checks above
        // and us installing the resolver. Re-signal to unblock.
        if (buffer.length > 0 || error || finished) {
          resolveNext = null;
          resolve();
        }
      });
    }
  } finally {
    // Drain the background promise so an early break doesn't leak
    // an unhandled rejection. `runP` always settles (success or error),
    // so this await completes promptly.
    await runP.catch(() => {});
  }
}

/**
 * Result of `scanAsync` once the underlying scan settles.
 */
export interface ScanAsyncResult {
  /** True when the scan completed without a discovery-level error. */
  done: boolean;
  /** Total number of SessionMeta items the scan produced. */
  total: number;
  /** Discovery-level error (e.g. EACCES), or undefined on success. */
  error?: unknown;
}

/**
 * Optional lifecycle hooks for `scanAsync`.
 */
export interface ScanAsyncHandlers {
  /** Called for every successfully parsed `SessionMeta`. */
  onMeta?: (meta: SessionMeta) => void;
  /** Called for every progress tick; `current` is monotonically non-decreasing. */
  onProgress?: (p: ScanProgress) => void;
  /** Called exactly once when the scan finishes successfully. */
  onDone?: (info: { total: number }) => void;
  /** Called exactly once if the scan fails with a discovery-level error. */
  onError?: (err: unknown) => void;
}

/**
 * Callback / event-based wrapper around `runDiscovery`.
 *
 * Designed for non-async-iterator consumers (UI event handlers, logging
 * pipelines). Returns a `Promise<ScanAsyncResult>` so callers can still
 * `await` the final outcome.
 *
 * Per-file parse failures are swallowed inside `runDiscovery` (C13).
 * Discovery-level failures (root unreachable, etc.) resolve the returned
 * promise with `done: false, error: ...` and fire `onError`.
 */
export async function scanAsync(
  rootPath: string,
  onMeta?: (meta: SessionMeta) => void,
  handlers?: ScanAsyncHandlers,
): Promise<ScanAsyncResult> {
  try {
    // Pre-discover so we can report a stable `total` to the consumer.
    // (We still let runDiscovery parse in parallel.)
    const files = await listJsonlFiles(rootPath);
    let produced = 0;
    const cb = (meta: SessionMeta): void => {
      produced++;
      if (onMeta) onMeta(meta);
      if (handlers?.onProgress) {
        handlers.onProgress({ current: produced, total: files.length });
      }
    };
    if (handlers?.onProgress) {
      handlers.onProgress({ current: 0, total: files.length });
    }
    await runDiscovery(rootPath, cb);
    if (handlers?.onProgress) {
      handlers.onProgress({ current: produced, total: files.length });
    }
    if (handlers?.onDone) handlers.onDone({ total: produced });
    return { done: true, total: produced };
  } catch (err) {
    if (handlers?.onError) handlers.onError(err);
    return { done: false, total: 0, error: err };
  }
}