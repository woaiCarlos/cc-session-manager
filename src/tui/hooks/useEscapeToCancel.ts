import { useInput } from 'ink';

// ---------------------------------------------------------------------------
// useEscapeToCancel：模态内 Esc 键 → 触发 onCancel。
//
// 与 useKeybindings 的 onClearSearch 不同：
//  - useKeybindings 是全局键位表（main view 使用），同时也会响应 Esc；
//  - 这个 hook 专给模态组件（SearchModal / RenameModal / ConfirmModal ...）
//    在挂载期间注册一个独立的 Esc 监听，用于关闭自身。
// 设计选择：抽成独立 hook 是为了 (1) 不污染 useKeybindings 的全局职责，
// (2) 便于单测（与 useKeybindings 测试模式一致）。
// ---------------------------------------------------------------------------

export function useEscapeToCancel(onCancel: () => void): void {
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
}