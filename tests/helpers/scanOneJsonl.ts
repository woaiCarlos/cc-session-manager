// Tiny helper that wraps parseJsonlFile for tests that need a real
// end-to-end JSONL → SessionMeta roundtrip. Extracted to helpers/ so
// multiple test files can share it.
import { parseJsonlFile } from '../../src/discovery/parse.js';
import type { SessionMeta } from '../../src/state/types.js';

export async function scanOneJsonl(jsonlPath: string): Promise<SessionMeta> {
  const parsed = await parseJsonlFile(jsonlPath);
  if (!parsed) throw new Error(`scanOneJsonl: failed to parse ${jsonlPath}`);
  return parsed.meta;
}
