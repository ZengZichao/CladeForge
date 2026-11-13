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
 * Close a tab behind the unsaved-changes confirm. A clean tab — or a user who
 * opted out of the 'close-tab' ask-again key — closes immediately; a dirty
 * one closes only through the dialog's confirm.
 */
export function confirmCloseTab(id: string): void {
  if (!isTabDirty(id)) {
    useStore.getState().closeTab(id);
    return;
  }
  requestConfirm({
    key: 'close-tab',
    title: S.tabs.closeConfirmTitle,
    message: S.tabs.closeConfirmMessage(tabTitle(id)),
    confirmLabel: S.tabs.close,
    danger: true,
    onConfirm: () => useStore.getState().closeTab(id),
  });
}
