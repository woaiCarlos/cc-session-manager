import path from 'node:path';
import type { SessionMeta } from '../state/types.js';

function stripXmlTags(s: string): string {
  return s
    .replace(/<command-message>([\s\S]*?)<\/command-message>/g, '$1')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '')
    .replace(/<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function sessionDisplayName(meta: SessionMeta, alias?: string): string {
  if (alias) return alias;
  if (meta.lastPrompt) return truncate(meta.lastPrompt);
  if (meta.firstUserMessage) {
    const stripped = stripXmlTags(meta.firstUserMessage);
    if (stripped) return truncate(stripped);
  }
  return path.basename(meta.cwd) || 'session';
}

export function projectDisplayName(cwd: string, alias?: string): string {
  return alias || path.basename(cwd) || cwd;
}
