import path from 'node:path';
import type { SessionMeta, AppState, Project, Session } from '../state/types.js';

// 占位；Task 后续替换为 ../util/relative-time.js
const relativeTime = (iso: string): string => iso;

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

export function groupSessions(metas: SessionMeta[], state: AppState): Project[] {
  // 1. 按 cwd 分组
  const groups = new Map<string, SessionMeta[]>();
  for (const m of metas) {
    const key = path.resolve(m.cwd);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // 2. 派生 Project
  const projects: Project[] = [];
  for (const [key, list] of groups) {
    const sessions: Session[] = list
      .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      .map((m) => ({
        id: m.sessionId,
        displayName: sessionDisplayName(m, state.sessionAliases[m.sessionId]),
        cwd: m.cwd,
        lastActiveRelative: relativeTime(m.lastTimestamp),
        lastTimestamp: m.lastTimestamp,
      }));
    projects.push({
      key,
      displayName: projectDisplayName(key, state.projectAliases[key]),
      cwd: key,
      manual: false,
      hidden: state.hiddenProjects.includes(key),
      sessions,
    });
  }
  return projects;
}
