import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRoot } from '../../src/discovery/detectRoot.js';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-detect-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('detectRoot', () => {
  it('prefers CLAUDE_CONFIG_DIR when set', async () => {
    const custom = path.join(tmpDir, 'custom');
    await fs.mkdir(path.join(custom, 'projects'), { recursive: true });
    const root = await detectRoot({ HOME: tmpDir, CLAUDE_CONFIG_DIR: custom });
    expect(root).toBe(path.join(custom, 'projects'));
  });

  it('falls back to ~/.claude/projects/', async () => {
    const projects = path.join(tmpDir, '.claude', 'projects');
    await fs.mkdir(projects, { recursive: true });
    const root = await detectRoot({ HOME: tmpDir });
    expect(root).toBe(projects);
  });

  it('returns null when no path exists', async () => {
    const root = await detectRoot({ HOME: tmpDir });
    expect(root).toBeNull();
  });
});