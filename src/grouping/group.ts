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

export function sessionDisplayName(meta: SessionMeta): string {
  // Bug 4d：单一主源 = Claude Code 的 custom-title（写入 JSONL）。
  // 不再读 `state.sessionAliases` / 本地 alias —— 那是 ccsm 自维护
  // 的副本，跟 CC 的 /rename 冲突。后续 ccsm R 键也直接写 custom-title
  // 到同一文件，达成「单一来源」。
  if (meta.customTitle) return meta.customTitle;
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
        displayName: sessionDisplayName(m),
        cwd: m.cwd,
        lastActiveRelative: relativeTime(m.lastTimestamp),
        lastTimestamp: m.lastTimestamp,
        sizeBytes: m.sizeBytes,
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

  // 3. 合并 manualProjects（区分 manual: true 与自动派生）
  for (const mp of state.manualProjects) {
    const key = path.resolve(mp.path);
    if (!projects.find((p) => p.key === key)) {
      projects.push({
        key,
        displayName: projectDisplayName(key, state.projectAliases[key]),
        cwd: key,
        manual: true,
        hidden: state.hiddenProjects.includes(key),
        sessions: [],
      });
    } else {
      // 已有自动派生 → 标记 manual=true
      const existing = projects.find((p) => p.key === key)!;
      existing.manual = true;
    }
  }

  // 4. 排序：manual 在前，再按最近 session 时间倒序
  projects.sort((a, b) => {
    if (a.manual !== b.manual) return a.manual ? -1 : 1;
    const aTs = a.sessions[0]?.lastTimestamp ?? '';
    const bTs = b.sessions[0]?.lastTimestamp ?? '';
    return bTs.localeCompare(aTs);
  });

  return projects.filter((p) => !p.hidden);
}
