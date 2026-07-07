/**
 * Lock release stub — invoked by the App's quit path (`q` / Ctrl+C) and the
 * shutdown escalator before the process exits.
 *
 * Lock acquisition (`tryAcquire`) is wired in the bootstrap pipeline (see
 * `src/cli.tsx` design comment for ordering); this module currently exposes
 * only the symmetric release side. The release is intentionally idempotent
 * — repeated calls (or calls without a prior acquire) must not throw.
 *
 * Implementation: writes nothing for now (acquisition-side persistence is a
 * later task). The function exists so that the runtime side effect declared
 * in the brief resolves at the type level and so that subsequent work can
 * replace this body without touching App.tsx or cli.tsx.
 */

let released = 0;

/** Release the run-level lock. Idempotent; resolves even if not held. */
export async function release(): Promise<void> {
  released += 1;
  return;
}

/** Test-only inspection: number of times release() has been called. */
export function _releaseCountForTest(): number {
  return released;
}

export async function resetForTest(): Promise<void> {
  released = 0;
}
