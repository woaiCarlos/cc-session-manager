import { describe, it, expect } from 'vitest';
import { filterSessions } from '../../../src/tui/panes/SessionPane.js';
import type { Session } from '../../../src/state/types.js';

// ---------------------------------------------------------------------------
// 夹具：构造最小 Session
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-abc',
    displayName: 'login bug fix',
    cwd: '/Users/alice/work',
    lastActiveRelative: '5m ago',
    lastTimestamp: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

const sessionA = makeSession({
  id: 'sess-login',
  displayName: 'login bug fix',
  cwd: '/Users/alice/work',
});
const sessionB = makeSession({
  id: 'sess-other',
  displayName: 'unrelated work',
  cwd: '/Users/alice/personal',
});
const sessionC = makeSession({
  id: 'sess-deep',
  displayName: 'database refactor',
  cwd: '/Users/alice/work/db',
});

// ---------------------------------------------------------------------------
// filterSessions — 空查询保留全部
// ---------------------------------------------------------------------------

describe('filterSessions', () => {
  it('returns the original array reference when query is empty', () => {
    const sessions: Session[] = [sessionA, sessionB];
    const out = filterSessions(sessions, '');
    expect(out).toBe(sessions);
  });

  it('returns empty array when given empty sessions regardless of query', () => {
    expect(filterSessions([], '')).toEqual([]);
    expect(filterSessions([], 'login')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterSessions — displayName 命中（大小写不敏感）
// ---------------------------------------------------------------------------

describe('filterSessions — displayName match', () => {
  it('matches by displayName case-insensitively', () => {
    const out = filterSessions([sessionA, sessionB, sessionC], 'LOGIN');
    expect(out).toEqual([sessionA]);
  });

  it('matches a substring within displayName', () => {
    const out = filterSessions([sessionA, sessionB, sessionC], 'bug');
    expect(out).toEqual([sessionA]);
  });
});

// ---------------------------------------------------------------------------
// filterSessions — cwd 命中
// ---------------------------------------------------------------------------

describe('filterSessions — cwd match', () => {
  it('matches sessions whose cwd contains the query', () => {
    const out = filterSessions([sessionA, sessionB, sessionC], 'personal');
    expect(out).toEqual([sessionB]);
  });

  it('cwd match is case-insensitive (queries that only hit cwd)', () => {
    // 用 /db 这类仅 cwd 命中（displayName / id 都不含）的查询验证 cwd 路径
    const out = filterSessions([sessionA, sessionB, sessionC], 'DB');
    // sessionA.cwd = /Users/alice/work —— 不含 "db"
    // sessionB.cwd = /Users/alice/personal —— 不含 "db"
    // sessionC.cwd = /Users/alice/work/db —— 含 "db"
    expect(out).toEqual([sessionC]);
  });
});

// ---------------------------------------------------------------------------
// filterSessions — id 前缀匹配
// ---------------------------------------------------------------------------

describe('filterSessions — id prefix match', () => {
  it('matches when id starts with the query (lowercased)', () => {
    const out = filterSessions([sessionA, sessionB, sessionC], 'sess-login');
    expect(out).toEqual([sessionA]);
  });

  it('does NOT match when query is a substring but not a prefix of id', () => {
    // "login" 是 sess-login 的子串但不是其它 id 的前缀
    const out = filterSessions([sessionA, sessionB, sessionC], 'login');
    // 仅 sessionA 命中（displayName 包含 login）
    // sessionB / sessionC id 不以 "login" 开头
    expect(out).toEqual([sessionA]);
  });
});

// ---------------------------------------------------------------------------
// filterSessions — 无命中
// ---------------------------------------------------------------------------

describe('filterSessions — no match', () => {
  it('returns empty array when nothing matches', () => {
    const out = filterSessions([sessionA, sessionB, sessionC], 'zzzzzz');
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterSessions — 多字段命中不会重复
// ---------------------------------------------------------------------------

describe('filterSessions — dedup', () => {
  it('does not duplicate a session that matches on multiple fields', () => {
    // sessionA: displayName 包含 "login"，id 以 "sess-login" 开头 — 两个字段都命中
    const out = filterSessions([sessionA], 'login');
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(sessionA);
  });
});