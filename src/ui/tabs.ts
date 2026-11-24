// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Shared "close this tab" entry point.
//
// `closeTab` in the store performs NO dirty check by design — the
// unsaved-changes guard lives at the interaction layer. Keeping that guard
// here (instead of inline in the TabBar) lets the ⌘W shortcut and the tab ×
// button share one behaviour: a dirty tab always asks, a clean one closes
// immediately. The keyboard path used to call the store action directly and
// silently dropped a dirty tab (the × button asked — two paths, two rules).

import { useStore } from '../model/store';
import { requestConfirm } from './confirmDialog';
import { S } from './strings';
import * as file from '../io/fileActions';
import { isTauri } from '../io/fileService';

/**
 * Dirty flag for a tab: the ACTIVE tab reads the live document fields, a
 * parked one reads its snapshot — the same rule the tab bar renders.
 */
export function isTabDirty(id: string): boolean {
  const s = useStore.getState();
  if (id === s.activeTabId) return s.revision !== s.lastSavedRevision;
  const snap = s.tabStore[id];
  return snap ? snap.revision !== snap.lastSavedRevision : false;
}

function tabTitle(id: string): string {
  const s = useStore.getState();
  return (id === s.activeTabId ? s.project.name : s.tabStore[id]?.project.name) || S.tabs.untitled;
}

/**
 * B4 (UI_UX_REVIEW): the desktop-convention third choice. A native save must
 * clear the dirty flag before closing. A browser download is not durable proof,
 * so its explicit alternative closes only after the download is requested.
 */
async function saveThenClose(id: string): Promise<void> {
  const st = useStore.getState();
  if (id !== st.activeTabId) st.switchTab(id);
  const native = isTauri();
  const outcome = await file.actionSaveProject();
  const canClose = native
    ? outcome === 'in-place' && !isTabDirty(id)
    : outcome === 'downloaded';
  if (canClose) useStore.getState().closeTab(id);
}

/**
 * Close a tab behind the unsaved-changes confirm. A clean tab closes
 * immediately; a dirty one gets the three-button desktop convention —
 * 保存并关闭（桌面端）/ 下载并关闭（浏览器端）/ 不保存 / 取消 — instead of the old close-only ask that hid the
 * save path behind ⌘S muscle memory.
 */
export function confirmCloseTab(id: string): void {
  if (!isTabDirty(id)) {
    useStore.getState().closeTab(id);
    return;
  }
  const browser = !isTauri();
  requestConfirm({
    key: 'close-tab',
    title: S.tabs.closeConfirmTitle,
    message: browser
      ? S.tabs.closeConfirmMessageBrowser(tabTitle(id))
      : S.tabs.closeConfirmMessage(tabTitle(id)),
    // The destructive choice stays the red confirm (and keeps the ask-again
    // opt-out hidden, matching the delete guard): 不保存直接关闭.
    confirmLabel: S.tabs.closeDiscard,
    danger: true,
    alternate: {
      label: browser ? S.tabs.closeDownloadAndClose : S.tabs.closeSave,
      onAction: () => {
        void saveThenClose(id);
      },
    },
    onConfirm: () => useStore.getState().closeTab(id),
  });
}
