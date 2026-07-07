import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Recursively list all `*.jsonl` files under `rootPath`.
 * Returns absolute paths. If `rootPath` does not exist, returns `[]`.
 */
export async function listJsonlFiles(rootPath: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }

  try {
    await walk(rootPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  return out;
}
