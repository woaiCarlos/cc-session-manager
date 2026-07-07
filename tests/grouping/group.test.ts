import { describe, it, expect } from 'vitest';
import path from 'node:path';
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

  it('uses user alias over lastPrompt and cwd basename', () => {
    const result = groupSessions(
      [
        s({
          sessionId: 'a',
          cwd: '/p1',
          firstUserMessage: 'Fix login bug',
          lastPrompt: 'Latest prompt text',
        }),
      ],
      { ...DEFAULT_STATE, sessionAliases: { a: 'My alias' } }
    );
    const p = result[0];
    expect(p.displayName).toBe(path.basename('/p1'));
    expect(p.sessions[0].displayName).toBe('My alias');
  });

  it('sorts sessions within a project by lastTimestamp desc', () => {
    const result = groupSessions(
      [
        s({ sessionId: 'old', cwd: '/p1', lastTimestamp: '2026-01-01T00:00:00Z' }),
        s({ sessionId: 'newest', cwd: '/p1', lastTimestamp: '2026-03-01T00:00:00Z' }),
        s({ sessionId: 'mid', cwd: '/p1', lastTimestamp: '2026-02-01T00:00:00Z' }),
      ],
      DEFAULT_STATE
    );
    expect(result[0].sessions.map((s) => s.id)).toEqual(['newest', 'mid', 'old']);
  });

  it('merges manual projects even when no sessions exist', () => {
    const result = groupSessions(
      [],
      { ...DEFAULT_STATE, manualProjects: [{ path: '/empty', addedAt: '2026-01-01T00:00:00Z' }] }
    );
    const m = result.find((p) => p.cwd === path.resolve('/empty'));
    expect(m).toBeDefined();
    expect(m!.manual).toBe(true);
    expect(m!.sessions).toEqual([]);
  });

  it('flags auto-derived project as manual when listed in manualProjects', () => {
    const result = groupSessions(
      [s({ sessionId: 'a', cwd: '/p1' })],
      { ...DEFAULT_STATE, manualProjects: [{ path: '/p1', addedAt: '2026-01-01T00:00:00Z' }] }
    );
    const p = result.find((x) => x.cwd === path.resolve('/p1'))!;
    expect(p.manual).toBe(true);
    expect(p.sessions.map((s) => s.id)).toEqual(['a']);
  });

  it('filters out hidden projects', () => {
    const result = groupSessions(
      [s({ sessionId: 'a', cwd: '/p1' })],
      { ...DEFAULT_STATE, hiddenProjects: [path.resolve('/p1')] }
    );
    expect(result).toEqual([]);
  });
});
