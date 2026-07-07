// 注意：shebang 由 tsup banner (tsup.config.ts) 在 bundle 后注入；源文件不重复声明
import { detectRoot } from './discovery/detectRoot.js';
import { runDiscovery } from './discovery/index.js';
import { groupSessions } from './grouping/group.js';
import { loadState } from './state/store.js';
import { tryAcquire, release } from './state/lock.js';
import type { SessionMeta } from './state/types.js';

async function main(): Promise<void> {
  await tryAcquire();
  const state = await loadState();
  const root = state.sessionRoot ?? (await detectRoot());
  const metas: SessionMeta[] = [];
  if (root) await runDiscovery(root, (m) => metas.push(m));
  const projects = groupSessions(metas, state);
  console.log(JSON.stringify({ root, projectCount: projects.length, sessionCount: metas.length }, null, 2));
  await release();
}

void main();
