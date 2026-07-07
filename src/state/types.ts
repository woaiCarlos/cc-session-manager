export type TerminalChoice = 'current' | 'terminal' | 'iterm2' | 'warp';
export type Terminal = TerminalChoice;

export interface ManualProject {
  path: string;
  addedAt: string; // ISO8601
}

export interface SessionMeta {
  sessionId: string;
  cwd: string;
  firstUserMessage: string | null;
  lastPrompt: string | null;
  /** Bug 4d：Claude Code 通过 JSONL 事件写入的自定义名字（`/rename`）。最新一条获胜。
   *  ccsm 把它作为显示名的唯一主源，不再维护自己的 alias。 */
  customTitle?: string;
  lastTimestamp: string; // ISO8601
  sizeBytes: number;
  lineCount: number;
}

export interface Session {
  id: string;
  displayName: string;
  cwd: string;
  lastActiveRelative: string;
  lastTimestamp: string;
  /** JSONL file size in bytes. Populated from SessionMeta.sizeBytes via
   *  parseJsonlFile → groupSessions / SESSION_DISCOVERED. Surfaced by the
   *  SessionPane to help users spot large sessions in long lists. */
  sizeBytes: number;
  /**
   * Absolute path to the JSONL file backing this session. Populated by the
   *  SESSION_DISCOVERED reducer from `jsonlIndex[sessionId]` (which cli.tsx
   *  builds during runDiscovery). Used by Bug A: the 'current' backend
   *  rescan hook calls parseJsonlFile on this path after claude exits.
   */
  jsonlPath?: string;
}

export interface Project {
  key: string;
  displayName: string;
  cwd: string;
  manual: boolean;
  hidden: boolean;
  sessions: Session[];
}

export type ModalKind = 'none' | 'search' | 'rename' | 'settings' | 'help' | 'confirm' | 'warning';

export interface ModalContext {
  renameKind?: 'session' | 'project';
  renameId?: string;
  renameTargetId?: string;
  renameCurrentName?: string;
  warningPid?: number;
  confirmAction?: 'deleteManualProject';
  confirmPayload?: string;
}

export interface AppState {
  sessionRoot: string | null;
  terminal: TerminalChoice;
  sessionAliases: Record<string, string>;
  projectAliases: Record<string, string>;
  manualProjects: ManualProject[];
  hiddenProjects: string[];
}

export const DEFAULT_STATE: AppState = {
  sessionRoot: null,
  terminal: 'current',
  sessionAliases: {},
  projectAliases: {},
  manualProjects: [],
  hiddenProjects: [],
};

export interface ScanProgress {
  current: number;
  total: number;
}
