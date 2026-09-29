// What a right-click does to the current selection.
//
// Extracted from `App.tsx` so the rule is testable: one missing guard here leaves
// a fully implemented feature unreachable through the UI.
//
// `handleContextMenu` must not run `st.select(nodeId)` blindly — `store.select(id)`
// with the default `additive = false` collapses the whole selection to that one
// node. The context menu gates "设为外群并定根 / Set as outgroup & reroot" on
// `selection.length > 1`, so if the right-click wiped the selection first, the
// multi-selection the user ⌘-clicked together would already be gone by the time
// the menu opened and the item could never appear. Right-clicking INSIDE a
// selection must keep it; right-clicking somewhere outside one must still behave
// like a normal click.

import type { NodeId } from '../model/types';

/**
 * The selection a right-click at `nodeId` should leave in place, or `null` for
 * "keep what is already selected" (so the caller can skip the store write
 * entirely rather than re-issue it).
 */
export function selectionForRightClick(
  selection: readonly NodeId[],
  nodeId: NodeId | null,
): NodeId[] | null {
  if (!nodeId) return null;
  if (selection.includes(nodeId)) return null; // inside the multi-selection — keep it
  return [nodeId];
}

/** The single-node form, for callers that only have the current selection to hand. */
export function shouldReselectOnRightClick(
  selection: readonly NodeId[],
  nodeId: NodeId | null,
): boolean {
  return selectionForRightClick(selection, nodeId) !== null;
}
