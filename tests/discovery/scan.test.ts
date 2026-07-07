import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listJsonlFiles } from '../../src/discovery/scan.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccsm-scan-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('listJsonlFiles', () => {
  it('lists .jsonl files recursively', async () => {
    await fs.writeFile(path.join(tmp, 'a.jsonl'), '');
    await fs.mkdir(path.join(tmp, 'sub'));
    await fs.writeFile(path.join(tmp, 'sub', 'b.jsonl'), '');
    await fs.writeFile(path.join(tmp, 'c.txt'), ''); // ignore
    const files = await listJsonlFiles(tmp);
    expect(files.sort()).toEqual(
      [path.join(tmp, 'a.jsonl'), path.join(tmp, 'sub', 'b.jsonl')].sort()
    );
  });

  it('returns empty array when nothing exists', async () => {
    const files = await listJsonlFiles(tmp);
    expect(files).toEqual([]);
  });

  it('returns empty array when root path does not exist', async () => {
    const files = await listJsonlFiles(path.join(tmp, 'missing'));
    expect(files).toEqual([]);
  });
});
