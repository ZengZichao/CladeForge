// @vitest-environment jsdom
// One delete-risk predicate, one confirmation key per entry point, and a toast
// Undo button that reverts the delete that produced it rather than whatever
// happens to be on the history stack when it is clicked.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import {
  assessDeletion,
  captureUndoPoint,
  confirmKeyFor,
  deletableIds,
  requestDeletion,
  revertToUndoTarget,
  undoTargetFor,
  type DeleteEntry,
} from './deleteGuard';
import { registerConfirmHandler, type ConfirmRequest } from './confirmDialog';
import { deleteNode, renameNode } from '../model/treeOps';
import { parseNewick } from '../io/newick';
import { useStore } from '../model/store';
import { useToasts } from './toast';
import { deletedCount } from './strings';
import type { NodeId, Project } from '../model/types';

const stepCount = (): number => useStore.getState().past.length;

const labels = (p: Project): string[] =>
  Object.values(p.nodes)
    .filter((n) => n.childrenIds.length === 0)
    .map((n) => n.label)
    .sort();

function tipId(p: Project, label: string): NodeId {
  const id = Object.keys(p.nodes).find((k) => p.nodes[k].label === label);
  if (!id) throw new Error(`no tip labelled ${label}`);
  return id;
}

/** The id of the (unique) internal node whose descendant tips are exactly `tipLabels`. */
function cladeId(p: Project, ...tipLabels: string[]): NodeId {
  const wanted = new Set(tipLabels);
  for (const id of Object.keys(p.nodes)) {
    if (p.nodes[id].childrenIds.length === 0) continue;
    const got = new Set<string>();
    const walk = (n: NodeId): void => {
      const node = p.nodes[n];
      if (node.childrenIds.length === 0) got.add(node.label);
      for (const c of node.childrenIds) walk(c);
    };
    walk(id);
    if (got.size === wanted.size && [...got].every((l) => wanted.has(l))) return id;
  }
  throw new Error(`no clade with exactly ${[...wanted].join(',')}`);
}

/**
 * 40 tips. The subtree shapes the tests lean on:
 *   `((L0,L1),(L2,(L3,L4)))` → 5 tips in 9 nodes
 *   `(L2,(L3,L4))`           → 3 tips in 5 nodes   (NODES ≫ TIPS)
 *   `(L5,…,L10)`             → 6 tips in 7 nodes
 */
function tree40(): Project {
  const leaves: string[] = [];
  for (let i = 0; i < 40; i += 1) leaves.push(`L${i}`);
  const head = `((${leaves[0]},${leaves[1]}),(${leaves[2]},(${leaves[3]},${leaves[4]})))`;
  const six = `(${leaves.slice(5, 11).join(',')})`;
  const rest = `(${leaves.slice(11).join(',')})`;
  return parseNewick(`(${head},${six},${rest});`, 't40');
}

describe('assessDeletion — one predicate, tips as the unit', () => {
  it('sizes a 40-tip tree from tips, with threshold = max(5, 5 %)', () => {
    const p = tree40();
    const risk = assessDeletion(p, [cladeId(p, 'L0', 'L1', 'L2', 'L3', 'L4')]);
    expect(risk.totalTips).toBe(40);
    expect(risk.threshold).toBe(5);
    expect(risk.tips).toBe(5);
    expect(risk.nodes).toBe(9);
    expect(risk.percent).toBe(13);
    expect(risk.needsConfirm).toBe(true);
  });

  it('a 5-node / 3-tip cut needs no confirmation, where the node count said "large"', () => {
    const p = tree40();
    const risk = assessDeletion(p, [cladeId(p, 'L2', 'L3', 'L4')]);
    expect(risk.tips).toBe(3);
    expect(risk.nodes).toBe(5); // sizing on the NODE count alone would call this "large"
    expect(risk.needsConfirm).toBe(false); // the tip-based predicate does not
  });

  it('a 7-node clade that takes 6 tips of 40 confirms', () => {
    const p = tree40();
    const risk = assessDeletion(p, [cladeId(p, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10')]);
    expect(risk.tips).toBe(6);
    expect(risk.nodes).toBe(7);
    expect(risk.percent).toBe(15);
    expect(risk.needsConfirm).toBe(true);
  });

  it('removing half or more of a small tree always confirms', () => {
    const p = parseNewick('((A,B),(C,D));', 'small');
    expect(assessDeletion(p, [tipId(p, 'A')]).needsConfirm).toBe(false); // 1 of 4 tips
    const cherry = assessDeletion(p, [cladeId(p, 'C', 'D')]);
    expect(cherry.tips).toBe(2);
    expect(cherry.threshold).toBe(5); // the adaptive floor cannot bite on a 4-tip tree
    expect(cherry.percent).toBe(50);
    expect(cherry.needsConfirm).toBe(true); // …so the "half the sampling" clause does
  });

  it('overlapping selections and stale ids are counted once', () => {
    const p = tree40();
    const parent = cladeId(p, 'L0', 'L1', 'L2', 'L3', 'L4');
    const child = cladeId(p, 'L0', 'L1');
    const alone = assessDeletion(p, [parent]);
    expect(assessDeletion(p, [parent, child]).nodes).toBe(alone.nodes);
    expect(assessDeletion(p, [parent, child]).tips).toBe(alone.tips);
    expect(assessDeletion(p, [parent, 'gone' as NodeId]).nodes).toBe(alone.nodes);
    expect(assessDeletion(p, []).needsConfirm).toBe(false);
  });
});

describe('confirmKeyFor — one key per entry point', () => {
  it('the four delete entry points have distinct skip keys', () => {
    const entries: DeleteEntry[] = ['keyboard', 'context-menu', 'inspector-node', 'inspector-multi'];
    const keys = entries.map(confirmKeyFor);
    expect(new Set(keys).size).toBe(4);
    keys.forEach((k) => expect(k).toMatch(/^delete-/));
  });

  it("don't-ask-again for one entry point leaves the others alone", () => {
    const requests: ConfirmRequest[] = [];
    registerConfirmHandler((req) => requests.push(req));
    const p = tree40();
    const big = [cladeId(p, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10')];
    let mutated = 0;
    const mutate = () => {
      mutated += 1;
    };
    // Opt out of the CONTEXT-MENU prompt only.
    localStorage.setItem('cladeforge:confirm:skip:delete-node-context', 'true');
    requestDeletion(p, big, 'context-menu', mutate);
    expect(mutated).toBe(1); // straight through, no dialog
    expect(requests).toHaveLength(0);
    // …the keyboard prompt for the very same nodes still appears.
    requestDeletion(p, big, 'keyboard', mutate);
    expect(mutated).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].key).toBe('delete-node-keyboard');
    expect(requests[0].danger).toBe(true);
    requests[0].onConfirm();
    expect(mutated).toBe(2);
  });
});

describe('undoable delete toast', () => {
  let requests: ConfirmRequest[] = [];

  beforeEach(() => {
    requests = [];
    registerConfirmHandler((req) => requests.push(req));
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** Run the shared delete flow, answering any confirmation; return the toast's Undo. */
  function undoButtonOf(entry: DeleteEntry, ids: NodeId[]): () => void {
    const before = useToasts.getState().toasts.length;
    requestDeletion(useStore.getState().project, ids, entry, () => {
      useStore.getState().apply((d) => {
        for (const id of ids) deleteNode(d, id, true);
      });
    });
    while (requests.length > 0) (requests.shift() as ConfirmRequest).onConfirm();
    const toasts = useToasts.getState().toasts;
    expect(toasts.length).toBe(before + 1);
    const action = toasts[toasts.length - 1].action;
    expect(action, 'the delete toast carries an Undo action').toBeDefined();
    return action!.run;
  }

  it('a bare undo() after a later edit leaves the clade deleted', () => {
    useStore.getState().loadProject(tree40());
    const clade = cladeId(useStore.getState().project, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10');
    undoButtonOf('keyboard', [clade]);
    expect(labels(useStore.getState().project)).not.toContain('L5');
    useStore.getState().apply((d) => renameNode(d, tipId(d, 'L0'), 'RENAMED'));
    useStore.getState().undo(); // ← what a bare-undo toast button would run
    expect(labels(useStore.getState().project)).not.toContain('L5'); // delete NOT reverted
    expect(useStore.getState().project.nodes[tipId(useStore.getState().project, 'L0')].label).toBe('L0');
  });

  it('the toast Undo restores the clade it was about, even after a later edit', () => {
    useStore.getState().loadProject(tree40());
    const clade = cladeId(useStore.getState().project, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10');
    const undo = undoButtonOf('keyboard', [clade]);
    useStore.getState().apply((d) => renameNode(d, tipId(d, 'L0'), 'RENAMED'));
    undo();
    const restored = useStore.getState().project;
    expect(labels(restored)).toContain('L5');
    expect(labels(restored)).toHaveLength(40);
    // Rolling back to the delete's own snapshot also rolls back the later edit —
    // that is the honest reading of "put the deleted clade back".
    expect(restored.nodes[tipId(restored, 'L0')].label).toBe('L0');
  });

  it('says so when the recorded step is no longer reachable', () => {
    useStore.getState().loadProject(tree40());
    const clade = cladeId(useStore.getState().project, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10');
    const undo = undoButtonOf('context-menu', [clade]);
    useStore.getState().loadProject(tree40()); // fresh document → history cleared
    const before = useToasts.getState().toasts.length;
    expect(() => undo()).not.toThrow();
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(before + 1);
    expect(toasts[toasts.length - 1].message).toMatch(/无法从提示按钮撤销|no longer be undone/);
  });

  it('revertToUndoTarget rewinds to exactly the captured snapshot', () => {
    useStore.getState().loadProject(tree40());
    const pristine = useStore.getState().project;
    const point = captureUndoPoint();
    expect(undoTargetFor(point)).toBeNull(); // nothing pushed yet → no phantom target
    useStore.getState().apply((d) =>
      deleteNode(d, cladeId(d, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'), true),
    );
    const target = undoTargetFor(point);
    expect(target).not.toBeNull();
    useStore.getState().apply((d) => renameNode(d, tipId(d, 'L0'), 'X'));
    useStore.getState().apply((d) => renameNode(d, tipId(d, 'L1'), 'Y'));
    expect(useStore.getState().project).not.toBe(pristine);
    expect(revertToUndoTarget(target)).toBe(true);
    expect(useStore.getState().project).toBe(pristine);
    expect(labels(pristine)).toHaveLength(40);
    expect(revertToUndoTarget(null)).toBe(false);
  });
});

/**
 * Deleting the root is a no-op, so it must not be reported as a bulk delete.
 *
 * `treeOps.deleteNode` refuses the root (a rooted tree has to keep one), while
 * sizing the edit from the raw selection counts every node beneath it and toasts
 * that number whatever happened. On a 40-tip tree, Delete with the root selected
 * would then announce "已删除 47 个节点" — with an Undo button for a document that
 * had not changed — for a cut that removes nothing at all.
 */
describe('the root is refused by name, and the count is what disappeared', () => {
  let requests: ConfirmRequest[] = [];

  beforeEach(() => {
    requests = [];
    registerConfirmHandler((req) => requests.push(req));
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  /** The shared flow, answering any confirmation, returning the toasts it left. */
  function run(ids: NodeId[]): { mutated: number; toasts: ReturnType<typeof useToasts.getState>['toasts'] } {
    const before = useToasts.getState().toasts.length;
    let mutated = 0;
    requestDeletion(useStore.getState().project, ids, 'keyboard', () => {
      mutated += 1;
      const selected = ids;
      useStore.getState().apply((d) => {
        for (const id of selected) deleteNode(d, id, true);
      });
    });
    while (requests.length > 0) (requests.shift() as ConfirmRequest).onConfirm();
    return { mutated, toasts: useToasts.getState().toasts.slice(before) };
  }

  it('a root-only selection is refused, with the reason', () => {
    useStore.getState().loadProject(tree40());
    const total = Object.keys(useStore.getState().project.nodes).length;
    const before = stepCount();
    const { mutated, toasts } = run([useStore.getState().project.rootId]);

    expect(mutated, 'the recipe is never run for a cut that cannot happen').toBe(0);
    expect(Object.keys(useStore.getState().project.nodes)).toHaveLength(total);
    expect(stepCount()).toBe(before); // no history entry for a refused edit
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].message).toMatch(/根节点|root/);
    expect(toasts[0].message).toMatch(/有根的树必须保留一个根|has to keep a root/);
    expect(toasts[0].action, 'nothing to undo').toBeUndefined();
    expect(requests, 'a refusal is not a confirmation').toEqual([]);
  });

  it('the toast reports the nodes that actually went, not the ones selected', () => {
    useStore.getState().loadProject(tree40());
    const p = useStore.getState().project;
    const total = Object.keys(p.nodes).length;
    const clade = cladeId(p, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10');
    // The selection covers the whole tree (root + clade ⊂ root's subtree) = 47
    // nodes, but only the clade's 7 can be removed.
    const { mutated, toasts } = run([p.rootId, clade]);

    expect(mutated).toBe(1);
    expect(Object.keys(useStore.getState().project.nodes)).toHaveLength(total - 7);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe(deletedCount(7));
    expect(toasts[0].message).not.toBe(deletedCount(total));
    // And its Undo really does bring the 7 back.
    act(() => toasts[0].action!.run());
    expect(Object.keys(useStore.getState().project.nodes)).toHaveLength(total);
  });

  it('deleting the root of a small tree is refused too (no confirm, no toast count)', () => {
    useStore.getState().loadProject(parseNewick('((A,B),(C,D));', 'tiny'));
    const before = stepCount();
    const { mutated, toasts } = run([useStore.getState().project.rootId]);
    expect(mutated).toBe(0);
    expect(stepCount()).toBe(before);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].message).not.toMatch(/已删除|Deleted/);
  });

  it('a selection of ids that no longer exist says nothing was deleted', () => {
    useStore.getState().loadProject(tree40());
    const before = stepCount();
    const { toasts } = run(['gone' as NodeId, 'also-gone' as NodeId]);
    expect(stepCount()).toBe(before);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toMatch(/没有节点被删除|Nothing was deleted/);
    expect(toasts[0].action, 'no undo for a no-op').toBeUndefined();
  });

  it('deletableIds keeps everything but the root', () => {
    useStore.getState().loadProject(tree40());
    const p = useStore.getState().project;
    const clade = cladeId(p, 'L5', 'L6', 'L7', 'L8', 'L9', 'L10');
    expect(deletableIds(p, [p.rootId])).toEqual([]);
    expect(deletableIds(p, [p.rootId, clade])).toEqual([clade]);
    expect(deletableIds(p, [clade, 'gone' as NodeId])).toEqual([clade]);
  });
});
