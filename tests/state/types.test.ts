import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_STATE, type AppState, type ManualProject, type Terminal, type TerminalChoice } from '../../src/state/types.js';

describe('state types', () => {
  it('exports the supported terminal union', () => {
    expectTypeOf<'terminal' | 'iterm2' | 'warp'>().toEqualTypeOf<Terminal>();
    expectTypeOf<Terminal>().toEqualTypeOf<TerminalChoice>();
  });

  it('exports ManualProject with path and ISO timestamp fields', () => {
    const project: ManualProject = {
      path: '/Users/carlos/workspace/example',
      addedAt: '2026-07-07T00:00:00.000Z',
    };

    expect(project.path).toBe('/Users/carlos/workspace/example');
    expect(project.addedAt).toBe('2026-07-07T00:00:00.000Z');
  });

  it('exports AppState and default state invariants', () => {
    expectTypeOf(DEFAULT_STATE).toEqualTypeOf<AppState>();

    expect(DEFAULT_STATE).toEqual({
      sessionRoot: null,
      terminal: 'terminal',
      sessionAliases: {},
      projectAliases: {},
      manualProjects: [],
      hiddenProjects: [],
    });
  });
});
