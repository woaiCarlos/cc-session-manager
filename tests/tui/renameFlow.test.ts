// Comprehensive integration test for Bug 4d: simulate the user flow going
// through ccsm's rename modal → writeSessionCustomTitle → custom-title event
// written to JSONL → SESSION_DISCOVERED picks it up → displayName reflects
// the new name. Renders nothing — directly exercises the reducer + action.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reducer, initialState } from '../../src/tui/App.js';
import type { UiState } from '../../src/tui/App.js';
import { routeKey } from '../../src/tui/keyActionRouter.js';
import type { Action } from '../../src/tui/App.js';
import { writeSessionCustomTitle } from '../../src/actions/writeSessionCustomTitle.js';
import { scanOneJsonl } from '../helpers/scanOneJsonl.js';
import type { SessionMeta } from '../../src/state/types.js';

function makeProjectWith(
  sessions: { id: string; displayName: string; cwd: string }[],
): { key: string; project: ReturnType<typeof Object> } {
  return {
    key: '/Users/foo/FN-NAS',
    project: {
      key: '/Users/foo/FN-NAS',
      displayName: 'FN-NAS',
      cwd: '/Users/foo/FN-NAS',
      manual: false,
      hidden: false,
      sessions: sessions.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        cwd: s.cwd,
        lastActiveRelative: '1h ago',
        lastTimestamp: '2026-07-07T00:00:00Z',
      })),
    } as never,
  };
}

describe('Rename end-to-end flow (Bug 4d)', () => {
  let next: UiState;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ccsm rename modal → writeSessionCustomTitle → JSONL → SESSION_DISCOVERED picks up new name', async () => {
    // 1) Set up a fake JSONL session file with the long original title
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-rename-'));
    const jsonlPath = path.join(tmp, 'session.jsonl');
    const longText =
      'a very very very long text describing the conversation content for the FN-NAS project';
    await fs.writeFile(
      jsonlPath,
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-fn-nas',
        cwd: '/Users/foo/FN-NAS',
        message: { content: longText },
        lastPrompt: null,
        timestamp: '2026-07-07T00:00:00.000Z',
      }) + '\n',
      'utf8',
    );

    // 2) App reads the JSONL via parseJsonlFile (real, not stubbed)
    const initial = await scanOneJsonl(jsonlPath);
    expect(initial.customTitle).toBeUndefined();
    expect(initial.firstUserMessage).toBe(longText);

    // 3) SESSION_DISCOVERED with the long firstUserMessage → displayName truncates
    next = reducer(initialState, { type: 'SESSION_DISCOVERED', meta: initial });
    expect(next.projects).toHaveLength(1);
    const initialDisplay = next.projects[0]!.sessions[0]!.displayName;
    expect(initialDisplay).toMatch(/^a very very/);
    expect(initialDisplay.length).toBeLessThanOrEqual(61);

    // 4) User selects the session and presses R
    next = reducer(next, { type: 'FOCUS_PANE', pane: 'sessions' });
    next = reducer(next, {
      type: 'SELECT_PROJECT',
      key: '/Users/foo/FN-NAS',
    });
    next = reducer(next, { type: 'SELECT_SESSION', id: 'sess-fn-nas' });

    const dispatched: Action[] = [];
    const dispatch = (action: Action) => {
      dispatched.push(action);
      next = reducer(next, action);
    };
    routeKey(
      next,
      dispatch as unknown as React.Dispatch<Action>,
      'r',
      {
        tab: false,
        escape: false,
        ctrl: false,
        upArrow: false,
        downArrow: false,
        return: false,
      },
      {
        onCopySession: () => {},
        onAddProject: () => {},
        onDeleteProject: () => {},
        onResumeSession: () => {},
        onNewSession: () => {},
        onQuit: () => {},
      },
    );

    const modalAction = dispatched[0] as Action | undefined;
    expect(modalAction?.type).toBe('OPEN_MODAL');
    if (modalAction?.type !== 'OPEN_MODAL') return;
    expect(modalAction.ctx?.renameTargetId).toBe('sess-fn-nas');

    // 5) User types "飞牛内网穿透" and presses Enter. ccsm onSubmit
    //    → writeSessionCustomTitle (sync) → JSONL has the new event →
    //    optimistic SESSION_DISCOVERED-style dispatch refreshes UI.
    const newName = '飞牛内网穿透';
    await writeSessionCustomTitle(jsonlPath, 'sess-fn-nas', newName);

    // 6) On-disk: the JSONL now has the latest custom-title event
    const reloaded = await scanOneJsonl(jsonlPath);
    expect(reloaded.customTitle).toBe('飞牛内网穿透');

    // 7) SESSION_DISCOVERED with the new meta → displayName = newName
    next = reducer(next, { type: 'SESSION_DISCOVERED', meta: reloaded });
    expect(next.projects[0]!.sessions[0]!.displayName).toBe(newName);

    // 8) JSONL file exists after writing (sync persist guarantee)
    expect(existsSync(jsonlPath)).toBe(true);

    // Cleanup
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
