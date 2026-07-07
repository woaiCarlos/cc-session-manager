import { describe, it, expect } from 'vitest';
import { groupSessions } from '../../src/grouping/group.js';
import { DEFAULT_STATE, type SessionMeta } from '../../src/state/types.js';

const s = (overrides: Partial<SessionMeta>): SessionMeta => ({
  sessionId: 'sid',
  cwd: '/p1',
  firstUserMessage: null,
  lastPrompt: null,
  lastTimestamp: '2026-01-01T00:00:00Z',
  sizeBytes: 1,
  lineCount: 1,
  ...overrides,
});

describe('groupSessions', () => {
  it('groups sessions by shared cwd', () => {
    const result = groupSessions(
      [s({ sessionId: 'a', cwd: '/p1' }), s({ sessionId: 'b', cwd: '/p1' }), s({ sessionId: 'c', cwd: '/p2' })],
      DEFAULT_STATE
    );
    expect(result.map((p) => p.cwd).sort()).toEqual(['/p1', '/p2']);
    const p1 = result.find((p) => p.cwd === '/p1')!;
    expect(p1.sessions.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});
