import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reusable JSONL fixtures for the discovery module.
 *
 * Tests should import from this module rather than hard-coding paths so that
 * the fixture location stays a single source of truth.
 */
export const fixturesDir = __dirname;

export const fixtures = {
  /** Well-formed session: user/assistant/last-prompt records with monotonically increasing timestamps. */
  normal: path.join(__dirname, 'normal.jsonl'),
  /** Mix of valid records and malformed JSON lines; parser must skip the bad lines. */
  corrupt: path.join(__dirname, 'corrupt.jsonl'),
  /** Zero-byte file; parser must return null without throwing. */
  empty: path.join(__dirname, 'empty.jsonl'),
} as const;

export type FixtureName = keyof typeof fixtures;