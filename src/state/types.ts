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
