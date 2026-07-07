import { useInput } from 'ink';
import type { Dispatch } from 'react';

interface Callbacks {
  onResume: () => void;
  onNew: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onSearch: () => void;
  onQuit: () => void;
  onTab: () => void;
  onUp: () => void;
  onDown: () => void;
  onEnter: () => void;
  onClearSearch: () => void;
}

type Action =
  | { type: 'FOCUS_PANE'; pane: 'projects' | 'sessions' }
  | { type: 'OPEN_MODAL'; modal: 'search' | 'rename' | 'settings' | 'help' | 'confirm' };

export function useKeybindings(
  dispatch: Dispatch<Action>,
  cbs: Callbacks
): void {
  useInput((input, key) => {
    if (key.tab) {
      dispatch({ type: 'FOCUS_PANE', pane: 'projects' });
      cbs.onTab();
      return;
    }
    if (key.upArrow) return cbs.onUp();
    if (key.downArrow) return cbs.onDown();
    if (key.return) return cbs.onEnter();
    if (input === 'q' || (key.ctrl && input === 'c')) return cbs.onQuit();
    if (input === '/') return cbs.onSearch();
    if (input === 'r') return cbs.onRename();
    if (input === 'n') return cbs.onNew();
    if (input === 'd') return cbs.onDelete();
    if (input === 'c') return cbs.onCopy();
    if (input === 'a') return cbs.onAdd();
    if (input === ',') return cbs.onSettings();
    if (input === '?') return cbs.onHelp();
    if (key.escape) return cbs.onClearSearch();
  });
}
