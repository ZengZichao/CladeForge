// Structural-sharing undo/redo history.
//
// Immer freezes every state it produces, and freshly loaded / parsed projects
// are frozen on entry (see store.ts), so each Project is an immutable snapshot
// we can retain *by reference* — no per-edit deep clone, which keeps taking a
// snapshot off the hot path. A history entry also captures what the user was
// *looking at* — selection, the active character and the canvas view — so undo
// returns to that moment rather than jumping the viewport out from under them:
// restoring the document alone would not restore the moment they stopped at.

import type { EdgeId, NodeId, Project, ViewTransform } from './types';

export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  project: Project;
  selection: NodeId[];
  selectedEdgeId: EdgeId | null;
  /** Canvas zoom / pan in effect when the snapshot was taken. */
  view: ViewTransform;
  /** Character whose states were colouring the tree (null = style colours). */
  activeCharacterId: string | null;
}

/**
 * Return a new stack with `entry` appended, capped at `limit`
 * (the oldest entries are dropped once the cap is exceeded).
 */
export function pushSnapshot(
  stack: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  const next = stack.length >= limit ? stack.slice(stack.length - limit + 1) : stack.slice();
  next.push(entry);
  return next;
}
