import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the folder picker so the test can drive what the user "selected"
// without invoking osascript. The real implementation lands in Task 8.
vi.mock('../../src/util/folder-picker.js', () => ({
  pickFolder: vi.fn(),
}));

// Mock node:fs so the action's stat() call can be controlled per test
// (existing dir, missing path, file-not-dir, etc.) without touching disk.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
    },
  };
});

// Mock the state store so the action's contract is observable in isolation
// from on-disk persistence — store.test.ts already covers load/save.
vi.mock('../../src/state/store.js', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pickFolder } from '../../src/util/folder-picker.js';
import { loadState, saveState } from '../../src/state/store.js';
import { DEFAULT_STATE } from '../../src/state/types.js';
import { addManualProject } from '../../src/actions/addManualProject.js';
import type { AppState, ManualProject } from '../../src/state/types.js';

const mockedPickFolder = vi.mocked(pickFolder);
const mockedStat = vi.mocked(fs.stat);
const mockedLoadState = vi.mocked(loadState);
const mockedSaveState = vi.mocked(saveState);

function makeState(overrides: Partial<AppState> = {}): AppState {
  return { ...DEFAULT_STATE, ...overrides };
}

beforeEach(() => {
  mockedPickFolder.mockReset();
  mockedStat.mockReset();
  mockedLoadState.mockReset();
  mockedSaveState.mockReset();
  // Default: saveState resolves; loadState returns defaults.
  mockedSaveState.mockResolvedValue(undefined);
  mockedLoadState.mockResolvedValue(makeState());
});

describe('addManualProject', () => {
  it('returns null when the user cancels the folder picker', async () => {
    // pickFolder returns null when the user dismisses the osascript
    // dialog. The action must short-circuit without touching state.
    mockedPickFolder.mockResolvedValueOnce(null);

    const result = await addManualProject();

    expect(result).toBeNull();
    expect(mockedLoadState).not.toHaveBeenCalled();
    expect(mockedSaveState).not.toHaveBeenCalled();
  });

  it('appends a {path, addedAt} entry to manualProjects and returns the resolved path', async () => {
    // Happy path: user picks a real directory → action must persist it
    // and return the (resolved) absolute path so the TUI can refresh.
    const picked = '/Users/alice/code/my-app';
    const resolved = path.resolve(picked);
    mockedPickFolder.mockResolvedValueOnce(picked);
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => true } as any,
    );
    mockedLoadState.mockResolvedValueOnce(makeState({ manualProjects: [] }));
    mockedSaveState.mockResolvedValueOnce(undefined);

    const result = await addManualProject();

    expect(result).toBe(resolved);
    expect(mockedSaveState).toHaveBeenCalledTimes(1);
    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toHaveLength(1);
    expect(savedArg.manualProjects[0]!.path).toBe(resolved);
    expect(typeof savedArg.manualProjects[0]!.addedAt).toBe('string');
    // ISO8601 — must parse cleanly and round-trip to a valid Date.
    expect(Number.isNaN(Date.parse(savedArg.manualProjects[0]!.addedAt))).toBe(false);
  });

  it('returns null and does not write state when the picked path is not a directory', async () => {
    // The user can mis-click a file in the dialog (or symlink-to-file).
    // The action must reject non-directory selections rather than persist
    // a project entry that the discovery layer cannot scan.
    mockedPickFolder.mockResolvedValueOnce('/Users/alice/code/notes.txt');
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => false } as any,
    );

    const result = await addManualProject();

    expect(result).toBeNull();
    expect(mockedLoadState).not.toHaveBeenCalled();
    expect(mockedSaveState).not.toHaveBeenCalled();
  });

  it('returns null and does not write state when the picked path does not exist', async () => {
    // A path that no longer exists between dialog selection and stat must
    // not be persisted (e.g. the directory was deleted while the dialog
    // was open, or a network share unmounted).
    mockedPickFolder.mockResolvedValueOnce('/Users/alice/code/ghost-dir');
    mockedStat.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    const result = await addManualProject();

    expect(result).toBeNull();
    expect(mockedLoadState).not.toHaveBeenCalled();
    expect(mockedSaveState).not.toHaveBeenCalled();
  });

  it('is idempotent: re-adding an already-present path returns the path without duplicating', async () => {
    // The TUI status-bar shows existing manualProjects; if the user
    // re-selects one, the action must not append a duplicate entry.
    // Returning the resolved path lets the UI move the cursor / show a
    // "already added" hint without changing the underlying state.
    const existing: ManualProject = {
      path: '/Users/alice/code/my-app',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    const resolved = path.resolve(existing.path);

    mockedPickFolder.mockResolvedValueOnce(existing.path);
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => true } as any,
    );
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [existing] }),
    );

    const result = await addManualProject();

    expect(result).toBe(resolved);
    expect(mockedSaveState).not.toHaveBeenCalled();
  });

  it('treats symlinked directories as directories', async () => {
    // macOS frequently presents symlinks as folders in the picker.
    // fs.stat follows symlinks; isDirectory() must report true for the
    // target. Verify the action does not incorrectly reject a symlink.
    mockedPickFolder.mockResolvedValueOnce('/Users/alice/code/symlink-to-repo');
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => true } as any,
    );
    mockedLoadState.mockResolvedValueOnce(makeState({ manualProjects: [] }));
    mockedSaveState.mockResolvedValueOnce(undefined);

    const result = await addManualProject();

    expect(result).toBe(path.resolve('/Users/alice/code/symlink-to-repo'));
    expect(mockedSaveState).toHaveBeenCalledTimes(1);
  });

  it('appends to an existing manualProjects list rather than overwriting it', async () => {
    // The action must merge with existing entries (preserve other manual
    // projects), not replace the whole array.
    const existing: ManualProject = {
      path: '/Users/alice/code/other-app',
      addedAt: '2026-02-02T00:00:00.000Z',
    };
    const newPath = '/Users/alice/code/my-app';
    const newResolved = path.resolve(newPath);

    mockedPickFolder.mockResolvedValueOnce(newPath);
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => true } as any,
    );
    mockedLoadState.mockResolvedValueOnce(
      makeState({ manualProjects: [existing] }),
    );
    mockedSaveState.mockResolvedValueOnce(undefined);

    await addManualProject();

    const savedArg = mockedSaveState.mock.calls[0]![0] as AppState;
    expect(savedArg.manualProjects).toHaveLength(2);
    expect(savedArg.manualProjects[0]).toEqual(existing);
    expect(savedArg.manualProjects[1]!.path).toBe(newResolved);
  });

  it('propagates a rejection from saveState without swallowing it', async () => {
    // The UI relies on this rejection to surface a persistence failure
    // (disk full, EACCES on the config dir). A silently-swallowed error
    // would leave the user thinking the project was added when state.json
    // is unchanged.
    const picked = '/Users/alice/code/my-app';
    mockedPickFolder.mockResolvedValueOnce(picked);
    mockedStat.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDirectory: () => true } as any,
    );
    mockedLoadState.mockResolvedValueOnce(makeState({ manualProjects: [] }));
    const err = new Error('EACCES: permission denied');
    mockedSaveState.mockRejectedValueOnce(err);

    await expect(addManualProject()).rejects.toBe(err);
  });

  it('passes a non-empty prompt to pickFolder', async () => {
    // The picker dialog will surface this string to the user; an empty
    // prompt would render a blank title bar and confuse the user.
    mockedPickFolder.mockResolvedValueOnce(null);

    await addManualProject();

    expect(mockedPickFolder).toHaveBeenCalledTimes(1);
    const [prompt] = mockedPickFolder.mock.calls[0]!;
    expect(typeof prompt).toBe('string');
    expect((prompt as string).length).toBeGreaterThan(0);
  });
});