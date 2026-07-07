import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface Env {
  HOME?: string | undefined;
  CLAUDE_CONFIG_DIR?: string | undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function detectRoot(env: Env = process.env): Promise<string | null> {
  const home = env.HOME ?? os.homedir();
  const configDir = env.CLAUDE_CONFIG_DIR;

  const candidates: string[] = [];
  if (configDir) candidates.push(path.join(configDir, 'projects'));
  candidates.push(path.join(home, '.claude', 'projects'));
  candidates.push(path.join(home, 'Library', 'Application Support', 'Claude', 'projects'));

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}