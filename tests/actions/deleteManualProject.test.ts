import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the state store so the action's contract is observable in isolation
// from on-disk persistence — store.test.ts already covers load/save.
// We deliberately do NOT mock `node:path`: the action's path comparison must
// use real path.resolve semantics, since that is what addManualProject
// stored when the user picked a folder.
vi.mock('../../src/state/store.js', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

import path from 'node:path';
import { loadState, saveState } from '../../src/state/store.js';
import { DEFAULT_STATE } from '../../src/state/types.js';
import { deleteManualProject } from '../../src/actions/deleteManualProject.js';
import type { AppState, ManualProject } from '../../src/state/types.js';

const mockedLoadState = vi.mocked(loadState);
const mockedSaveState = vi.mocked(saveState);

function makeState(overrides: Partial<AppState> = {}): AppState {
  return { ...DEFAULT_STATE, ...overrides };
}

beforeEach(() => {
  mockedLoadState.mockReset();
  mockedSaveState.mockReset();
  // Default: saveState resolves; loadState returns defaults.
  mockedSaveState.mockResolvedValue(undefined);
  mockedLoadState.mockResolvedValue(makeState());
});

describe('deleteManualProject', () => {
  it('removes the matching manual project by resolved groupKey and persists state', async () => {
    // Happy path: the action must write a new state where the targeted
    // manual entry is gone. We assert on the saveState argument so the
    // persistence contract is observable without touching disk.
    const target: ManualProject = {
      path: '/Users/alice/code/my-app',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    const other: ManualProject = {
      path: '/Users/alice/code/other-app',
      addedAt: '2026-02-02T00:00:00.000Z',
    };
    const resolvedTarget = path.resolve(target.path);
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [target, other] }),
    );

    await deleteManualProject(resolvedTarget);

    expect(mockedSaveState).toHaveBeenCalledTimes(1);
    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toHaveLength(1);
    expect(savedArg.manualProjects[0]).toEqual(other);
  });

  it('matches by resolved path so callers can pass either absolute or relative forms', async () => {
    // addManualProject stores path.resolve(...) of the picker's output,
    // so the canonical form in state is always absolute. The action must
    // apply path.resolve on the incoming groupKey too, otherwise callers
    // who pass an already-resolved path would silently fail to match.
    const target: ManualProject = {
      path: '/Users/alice/code/my-app',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    const other: ManualProject = {
      path: '/Users/alice/code/other-app',
      addedAt: '2026-02-02T00:00:00.000Z',
    };
    // Caller passes the absolute path exactly as addManualProject stored it.
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [target, other] }),
    );

    await deleteManualProject(target.path);

    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toEqual([other]);
  });

  it('preserves other manual projects and other state fields', async () => {
    // The action must not overwrite the entire state — only the targeted
    // manual entry should be filtered out; aliases, hiddenProjects,
    // sessionRoot, and terminal must round-trip unchanged.
    const target: ManualProject = {
      path: '/Users/alice/code/my-app',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    const other: ManualProject = {
      path: '/Users/alice/code/other-app',
      addedAt: '2026-02-02T00:00:00.000Z',
    };
    const initial = makeState({
      sessionRoot: '/Users/alice/.claude',
      terminal: 'iterm2',
      sessionAliases: { sess1: 'rename-A' },
      projectAliases: { '/Users/alice/code/other-app': 'Other App' },
      manualProjects: [target, other],
      hiddenProjects: ['/Users/alice/code/hidden'],
    });
    mockedLoadState.mockResolvedValueOnce(initial);

    await deleteManualProject(path.resolve(target.path));

    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.sessionRoot).toBe('/Users/alice/.claude');
    expect(savedArg.terminal).toBe('iterm2');
    expect(savedArg.sessionAliases).toEqual({ sess1: 'rename-A' });
    expect(savedArg.projectAliases).toEqual({
      '/Users/alice/code/other-app': 'Other App',
    });
    expect(savedArg.hiddenProjects).toEqual(['/Users/alice/code/hidden']);
    expect(savedArg.manualProjects).toEqual([other]);
  });

  it('is a no-op for auto-derived project groupKeys not present in manualProjects', async () => {
    // Spec constraint: 自动派生项目 (auto-derived projects) must not be
    // deletable through this action. The action operates exclusively on
    // `state.manualProjects`, which auto-derived entries never enter, so
    // a groupKey that points at an auto project finds no match and the
    // array is unchanged. The state write still happens — that's a
    // benign re-save with the same content, consistent with how
    // setAlias behaves on updates.
    const autoDerivedGroupKey = '/Users/alice/code/discovered-app';
    const existing: ManualProject = {
      path: '/Users/alice/code/manual-app',
      addedAt: '2026-03-03T00:00:00.000Z',
    };
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [existing] }),
    );

    await deleteManualProject(autoDerivedGroupKey);

    expect(mockedSaveState).toHaveBeenCalledTimes(1);
    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toEqual([existing]);
  });

  it('handles an empty manualProjects list without throwing', async () => {
    // A user with zero manual projects invoking Delete (via UI edge case)
    // must not crash; the action should persist an unchanged state.
    mockedLoadState.mockResolvedValueOnce(makeState({ manualProjects: [] }));

    await expect(
      deleteManualProject('/Users/alice/code/anything'),
    ).resolves.toBeUndefined();

    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toEqual([]);
  });

  it('propagates a rejection from saveState without swallowing it', async () => {
    // The UI relies on this rejection to surface a persistence failure
    // (disk full, EACCES on the config dir). A silently-swallowed error
    // would leave the TUI showing the project removed while state.json
    // is unchanged.
    const target: ManualProject = {
      path: '/Users/alice/code/my-app',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [target] }),
    );
    const err = new Error('EACCES: permission denied');
    mockedSaveState.mockRejectedValueOnce(err);

    await expect(
      deleteManualProject(path.resolve(target.path)),
    ).rejects.toBe(err);
  });
});