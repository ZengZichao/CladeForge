// One delete-risk predicate, one confirmation key per entry point, and an Undo
// toast that undoes the deletion that produced it.
//
// Every delete entry point — `ContextMenu`, the `TreeCanvas` keyboard path, the
// inspector's single-node and multi-node prompts — asks the same question, in the
// same unit:
//   * the threshold `deleteThreshold(project)` is expressed in TIPS
//     (`max(5, 5 % of the tree's tips)`), never against a subtree's NODE count;
//   * the risk is computed once in `assessDeletion()` rather than hard-coded per
//     call site, so a 1 000-tip tree and a 5-tip tree are not judged by different
//     rules — mixed units let one path execute a cut the other would ask about;
//   * `confirmKeyFor(entry)` gives each entry point its own `confirm:skip` key, so
//     opting out of the inspector's prompt never opts out of the context menu's.
//
// Tips are the unit because the taxa a user loses are tips; internal nodes are
// topology.
//
// The toast's Undo button holds the exact history entry the delete pushed and
// unwinds to it. A bare `undo()` would revert whatever happens to be on top of the
// stack at click time, so an edit made while the toast was alive would be reverted
// instead of the deletion; the button says so when that entry is no longer
// reachable (HISTORY_LIMIT eviction, or a new document loaded).

import { collectSubtree, deleteThreshold } from '../model/treeOps';
import type { NodeId, Project } from '../model/types';
import type { HistoryEntry } from '../model/history';
import { useStore } from '../model/store';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';
import { S, deletedCount, tr } from './strings';

/** Where the delete was requested from — decides the "don't ask again" key. */
export type DeleteEntry = 'keyboard' | 'context-menu' | 'inspector-node' | 'inspector-multi';

export interface DeletionRisk {
  /** Nodes removed (the union of the selected subtrees; overlaps counted once). */
  nodes: number;
  /** Tips removed — the unit the threshold is expressed in. */
  tips: number;
  totalTips: number;
  /** `tips / totalTips`, rounded to whole percent. */
  percent: number;
  /** Adaptive, tip-based: `max(5, 5 % of the tree's tips)`. */
  threshold: number;
  needsConfirm: boolean;
}

/**
 * The single risk predicate shared by every delete entry point.
 *
 * A deletion is "large" when it takes out at least `deleteThreshold(project)`
 * tips, or at least half of the tree's sampling — the second clause covers trees
 * too small for the adaptive threshold to bite, where "4 of 4 tips" would run
 * without a word. Overlapping selections (a parent and its own descendant) are
 * de-duplicated, so the reported size is what actually disappears.
 */
export function assessDeletion(project: Project, ids: readonly NodeId[]): DeletionRisk {
  const removed = new Set<NodeId>();
  for (const id of ids) {
    if (!project.nodes[id]) continue; // already gone (double delete, stale selection)
    for (const nid of collectSubtree(project, id)) removed.add(nid);
  }
  let tips = 0;
  let totalTips = 0;
  for (const id of Object.keys(project.nodes)) {
    const node = project.nodes[id];
    if (!node || node.childrenIds.length > 0) continue;
    totalTips += 1;
    if (removed.has(id)) tips += 1;
  }
  const percent = totalTips > 0 ? Math.round((tips / totalTips) * 100) : 0;
  const threshold = deleteThreshold(project);
  return {
    nodes: removed.size,
    tips,
    totalTips,
    percent,
    threshold,
    needsConfirm: tips >= threshold || (tips > 0 && percent >= 50),
  };
}

/** One skip-key per entry point, so the prompts never share an opt-out. */
export function confirmKeyFor(entry: DeleteEntry): string {
  switch (entry) {
    case 'keyboard':
      return 'delete-node-keyboard';
    case 'context-menu':
      return 'delete-node-context';
    case 'inspector-node':
      return 'delete-node-inspector';
    case 'inspector-multi':
      return 'delete-multi-inspector';
  }
}

/** What the history stack looked like immediately BEFORE a destructive edit. */
export interface UndoPoint {
  before: number;
  previousTop: HistoryEntry | null;
}

/** Call directly before the edit. */
export function captureUndoPoint(): UndoPoint {
  const past = useStore.getState().past;
  return {
    before: past.length,
    previousTop: past.length > 0 ? past[past.length - 1] : null,
  };
}

/**
 * Call directly after the edit: the history entry that edit pushed, or null when
 * the edit recorded no step (a no-op recipe / a capped stack that did not move).
 */
export function undoTargetFor(point: UndoPoint): HistoryEntry | null {
  const past = useStore.getState().past;
  if (past.length === 0) return null;
  const top = past[past.length - 1];
  // The stack did not gain an entry for this edit — do not blame an older one.
  if (top === point.previousTop && past.length <= point.before) return null;
  return top;
}

/**
 * Unwind the history to exactly `target` (the snapshot the destructive edit
 * recorded, i.e. the document as it was before it). Later edits made while the
 * toast was alive are rolled back too — that is what "put the deleted clade back"
 * means — and false is returned instead of guessing when the entry is gone.
 */
export function revertToUndoTarget(target: HistoryEntry | null): boolean {
  if (!target) return false;
  const idx = useStore.getState().past.indexOf(target);
  if (idx < 0) return false; // evicted by HISTORY_LIMIT, or a new document loaded
  for (let steps = useStore.getState().past.length - idx; steps > 0; steps -= 1) {
    useStore.getState().undo();
  }
  return useStore.getState().project === target.project;
}

/**
 * The part of a selection that a delete can actually carry out.
 *
 * `treeOps.deleteNode` refuses the root — a rooted tree has to keep one — so a
 * request whose ids are all the root deletes nothing at all, and a request that
 * mixes the root with a clade removes only the clade. Sizing the edit from the raw
 * selection is therefore a lie: on the 40-tip tree of `deleteGuard.test.ts`, Delete
 * with the root selected would report "已删除 47 个节点" for a no-op that never
 * touched the document.
 */
export function deletableIds(project: Project, ids: readonly NodeId[]): NodeId[] {
  return ids.filter((id) => project.nodes[id] && id !== project.rootId);
}

/**
 * Shared delete flow: assess → confirm (per-entry key) or run → toast with an
 * Undo bound to THIS edit. `mutate` performs the document change (and any
 * selection cleanup) so the callers keep their own recipe.
 */
export function requestDeletion(
  project: Project,
  ids: readonly NodeId[],
  entry: DeleteEntry,
  mutate: () => void,
): void {
  // Refuse the root-only case with the reason, instead of running a no-op and
  // announcing a bulk delete that never happened.
  const deletable = deletableIds(project, ids);
  if (deletable.length === 0 && ids.includes(project.rootId)) {
    // Unlabelled internal nodes are addressed by id prefix, as elsewhere.
    const rootNode = project.nodes[project.rootId];
    const rootName = rootNode?.label || rootNode?.id.slice(0, 6) || project.rootId;
    notify.error(
      tr(
        `无法删除根节点「${rootName}」：有根的树必须保留一个根，否则整棵树不再有共同的起点。如需改变根的位置，请使用「定根」。`,
        `The root “${rootName}” cannot be deleted: a rooted tree has to keep a root, or nothing shares an ancestor any more. Use reroot to move it instead.`,
      ),
    );
    return;
  }
  // Sized from what the edit can actually remove, so the toast's count is the
  // number of nodes the user loses — not the number they selected.
  const risk = assessDeletion(project, deletable);
  const run = () => {
    const point = captureUndoPoint();
    mutate();
    const target = undoTargetFor(point);
    if (!target) {
      // Nothing was recorded, so nothing was removed (a stale selection, an
      // already-deleted id): say that instead of claiming a delete and offering
      // an Undo of somebody else's step.
      notify.info(
        tr(
          '没有节点被删除：所选节点已不在当前文档中。',
          'Nothing was deleted: the selected nodes are not in this document any more.',
        ),
      );
      return;
    }
    notify.action(deletedCount(risk.nodes), S.notify.undo, () => {
      if (revertToUndoTarget(target)) return;
      notify.info(
        tr(
          '这一步已无法从提示按钮撤销（历史栈已被改写或已达上限）；请用 ⌘Z 逐步撤销。',
          'This step can no longer be undone from the toast (the history moved on, or reached its cap); use ⌘Z to step back.',
        ),
      );
    });
  };
  if (!risk.needsConfirm) {
    run();
    return;
  }
  requestConfirm({
    key: confirmKeyFor(entry),
    title: S.confirm.deleteManyTitle,
    message: S.confirm.deleteManyMessage(risk.nodes, risk.tips, risk.percent),
    confirmLabel: S.confirm.deleteManyConfirm,
    danger: true,
    onConfirm: run,
  });
}
