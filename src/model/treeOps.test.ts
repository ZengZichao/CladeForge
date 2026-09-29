import { describe, it, expect, afterEach } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { parseNewick } from '../io/newick';
import {
  addChildren,
  addCharacterState,
  addChildrenSpaced,
  addCustomEdge,
  applyMidpointReroot,
  checkOutgroupReroot,
  collectSubtree,
  collapseBelowSupport,
  constrainedMoveNode,
  deleteNode,
  estimateAges,
  extractSubtree,
  fillParsimony,
  hasAges,
  insertParent,
  isDescendant,
  knownLength,
  ladderize,
  midpointRoot,
  midpointTarget,
  mrcaOf,
  newId,
  nodesMissingAges,
  normalizeSupport,
  outgroupReroot,
  pathBetween,
  pruneOrphanCharacterData,
  removeCharacter,
  removeCharacterState,
  reparent,
  rerootAtNode,
  resetIdGenerator,
  sequentialIdGenerator,
  setCharacterCostMatrix,
  setIdGenerator,
  setNodeState,
  tipCountBelow,
  topologicalNeighbour,
  toggleCollapse,
  toggleEventTrigger,
  topologicalHeights,
  validateTimeData,
  wouldCreateCycle,
} from './treeOps';
import { applyLayer, captureLayer, pruneLayerStore } from './layers';
import { parsimony } from './parsimony';
import { DEFAULT_EDGE_STYLE, type Character, type Project, type TreeNode } from './types';

function expectIntegrity(p: Project): void {
  expect(p.nodes[p.rootId].parentId).toBeNull();
  for (const [id, n] of Object.entries(p.nodes)) {
    if (id === p.rootId) continue;
    expect(n.parentId).not.toBeNull();
    const parent = p.nodes[n.parentId as string];
    expect(parent).toBeDefined();
    expect(parent.childrenIds).toContain(id);
  }
  expect(collectSubtree(p, p.rootId).size).toBe(Object.keys(p.nodes).length);
}

describe('treeOps', () => {
  it('addChildren adds n children under the parent', () => {
    const p = createEmptyProject();
    const ids = addChildren(p, p.rootId, 3);
    expect(ids).toHaveLength(3);
    expect(p.nodes[p.rootId].childrenIds).toHaveLength(3);
    expect(p.nodes[ids[0]].parentId).toBe(p.rootId);
  });

  it('deleteNode (cascade) removes the whole subtree', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    addChildren(p, a, 2);
    expect(Object.keys(p.nodes)).toHaveLength(4);
    deleteNode(p, a, true);
    expect(Object.keys(p.nodes)).toHaveLength(1);
  });

  it('deleteNode (non-cascade) lifts children to the parent', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const kids = addChildren(p, a, 2);
    deleteNode(p, a, false);
    expect(p.nodes[p.rootId].childrenIds).toEqual(expect.arrayContaining(kids));
    expect(p.nodes[kids[0]].parentId).toBe(p.rootId);
    expect(p.nodes[a]).toBeUndefined();
  });

  it('never deletes the root', () => {
    const p = createEmptyProject();
    expect(deleteNode(p, p.rootId, true)).toBe(false);
    expect(p.nodes[p.rootId]).toBeDefined();
  });

  it('reparent rejects cycles and accepts valid moves', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [b] = addChildren(p, a, 1);
    expect(isDescendant(p, a, b)).toBe(true);
    expect(reparent(p, a, b)).toBe(false); // would create a cycle
    expect(reparent(p, b, p.rootId)).toBe(true);
    expect(p.nodes[b].parentId).toBe(p.rootId);
  });

  it('insertParent splices a node between child and parent', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const mid = insertParent(p, a);
    expect(mid).toBeTruthy();
    expect(p.nodes[a].parentId).toBe(mid);
    expect(p.nodes[mid as string].parentId).toBe(p.rootId);
    expect(p.nodes[p.rootId].childrenIds).toContain(mid);
  });

  it('addCustomEdge validates self-loops and duplicates', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    expect(addCustomEdge(p, a, b, DEFAULT_EDGE_STYLE)).toBeTruthy();
    expect(addCustomEdge(p, a, b, DEFAULT_EDGE_STYLE)).toBeNull(); // duplicate
    expect(addCustomEdge(p, a, a, DEFAULT_EDGE_STYLE)).toBeNull(); // self loop
    expect(p.customEdges).toHaveLength(1);
  });

  it('deleting a node also removes touching custom edges', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    addCustomEdge(p, a, b, DEFAULT_EDGE_STYLE);
    deleteNode(p, a, true);
    expect(p.customEdges).toHaveLength(0);
  });

  it('collectSubtree gathers all descendants including self', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const kids = addChildren(p, a, 2);
    const set = collectSubtree(p, a);
    expect(set.has(a)).toBe(true);
    expect(set.has(kids[0])).toBe(true);
    expect(set.has(p.rootId)).toBe(false);
  });

  it('ladderize orders children by descending subtree size', () => {
    const p = createEmptyProject();
    const [b, a] = addChildren(p, p.rootId, 2); // initial order: b, a
    addChildren(p, a, 2); // a's subtree (3) is larger than b's (1)
    expect(p.nodes[p.rootId].childrenIds).toEqual([b, a]);
    ladderize(p);
    expect(p.nodes[p.rootId].childrenIds).toEqual([a, b]);
  });

  it('rerootAtNode re-hangs the tree and suppresses the old binary root', () => {
    const p = createEmptyProject();
    const oldRoot = p.rootId;
    addChildren(p, p.rootId, 2); // root -> (a, b)
    const a = p.nodes[oldRoot].childrenIds[0];
    const [c] = addChildren(p, a, 2); // a -> (c, d)
    expect(Object.keys(p.nodes)).toHaveLength(5);

    expect(rerootAtNode(p, c)).toBe(true);
    expect(p.rootId).not.toBe(oldRoot);
    expect(p.nodes[oldRoot]).toBeUndefined(); // binary root became a unifurcation and was spliced
    expect(Object.keys(p.nodes)).toHaveLength(5); // +newRoot, -oldRoot
    expect(p.nodes[c].parentId).toBe(p.rootId);
    expectIntegrity(p);
  });

  it('rerootAtNode refuses the existing root', () => {
    const p = createEmptyProject();
    expect(rerootAtNode(p, p.rootId)).toBe(false);
  });

  it('mrcaOf and pathBetween locate the common ancestor and connecting path', () => {
    const p = createEmptyProject();
    const [left, right] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, left, 2);
    const [b1] = addChildren(p, right, 1);

    expect(mrcaOf(p, a1, a2)).toBe(left);
    expect(mrcaOf(p, a1, b1)).toBe(p.rootId);

    const pb = pathBetween(p, a1, a2);
    expect(pb).not.toBeNull();
    expect(pb!.mrca).toBe(left);
    expect(pb!.nodes.has(left)).toBe(true);
    expect(pb!.branches.has(a1)).toBe(true);
    expect(pb!.branches.has(a2)).toBe(true);
    expect(pb!.branches.has(left)).toBe(false); // the MRCA's own incoming branch is excluded
  });

  it('midpointTarget returns a valid re-root target and rerooting stays consistent', () => {
    // Midpoint rooting is a branch-length operation: give the tree the lengths
    // it needs. Measuring a tree with NO lengths would price every branch as 1
    // and fabricate a diameter out of nothing, so such a tree is refused — see
    // the next test.
    const p = createEmptyProject();
    const [, x] = addChildren(p, p.rootId, 2); // root -> (a, x)
    const [, y] = addChildren(p, x, 2); // x -> (b, y)
    addChildren(p, y, 2); // y -> (c, d)
    const ids = p.nodes[p.rootId].childrenIds;
    p.nodes[ids[0]].branchLength = 3;
    p.nodes[ids[1]].branchLength = 1;
    const kidsOfX = p.nodes[x].childrenIds;
    p.nodes[kidsOfX[0]].branchLength = 1;
    p.nodes[kidsOfX[1]].branchLength = 1;
    for (const cid of p.nodes[y].childrenIds) p.nodes[cid].branchLength = 4;
    const t = midpointTarget(p);
    expect(t).not.toBeNull();
    expect(t).not.toBe(p.rootId);
    expect(rerootAtNode(p, t as string)).toBe(true);
    expectIntegrity(p);
  });

  it('midpoint rooting refuses a tree with no usable branch lengths', () => {
    const p = createEmptyProject();
    addChildren(p, p.rootId, 2);
    addChildren(p, p.nodes[p.rootId].childrenIds[0], 2);
    expect(midpointRoot(p)).toEqual({ ok: false, failure: 'no-usable-lengths' });
    expect(midpointTarget(p)).toBeNull();
    expect(applyMidpointReroot(p).ok).toBe(false);
    // Nothing was changed: the refusal is not a silent no-op with a broken tree.
    expectIntegrity(p);
  });
});

describe('causal-chain cycle guard', () => {
  it('rejects links that would close a cycle and self-links', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [b, c] = addChildren(p, a, 2);
    const ev = (nodeId: string) => ({
      id: `ev_${nodeId}`,
      typeId: 'key-innovation',
      target: 'branch' as const,
      nodeId,
      triggers: [] as string[],
    });
    p.events = [ev(a), ev(b), ev(c)];
    const [ea, eb, ec] = p.events;

    toggleEventTrigger(p, ea.id, eb.id);
    toggleEventTrigger(p, eb.id, ec.id);
    expect(ea.triggers).toEqual([eb.id]);
    expect(eb.triggers).toEqual([ec.id]);

    // c -> a would close the cycle a -> b -> c -> a.
    expect(wouldCreateCycle(p, ec.id, ea.id)).toBe(true);
    toggleEventTrigger(p, ec.id, ea.id);
    expect(ec.triggers).toEqual([]);

    // Removing the link again works; self-links are always rejected.
    toggleEventTrigger(p, eb.id, ec.id);
    expect(eb.triggers).toEqual([]);
    toggleEventTrigger(p, ea.id, ea.id);
    expect(ea.triggers).toEqual([eb.id]);
  });
});

describe('nodesMissingAges', () => {
  it('returns all nodes when no ages are set', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const missing = nodesMissingAges(p);
    expect(missing).toHaveLength(3);
    const ids = new Set(missing.map((n) => n.id));
    expect(ids.has(p.rootId)).toBe(true);
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(true);
  });

  it('returns an empty array when all nodes have ages', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[p.rootId].age = 10;
    p.nodes[a].age = 5;
    p.nodes[b].age = 0;
    expect(nodesMissingAges(p)).toHaveLength(0);
  });

  it('returns only nodes without ages (mixed scenario)', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[p.rootId].age = 100;
    // a and b are missing ages
    const missing = nodesMissingAges(p);
    expect(missing).toHaveLength(2);
    const labels = new Set(missing.map((n) => n.id));
    expect(labels.has(a)).toBe(true);
    expect(labels.has(b)).toBe(true);
    expect(labels.has(p.rootId)).toBe(false);
  });

  it('excludes descendants of collapsed nodes', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, a, 2);
    // Set ages on root and b, but not on a or its children.
    p.nodes[p.rootId].age = 10;
    p.nodes[b].age = 0;
    // Without collapsing: a, a1, a2 are missing (3 nodes).
    expect(nodesMissingAges(p)).toHaveLength(3);
    // Collapse a: its descendants (a1, a2) are invisible, but a itself
    // is still visible and still missing an age.
    toggleCollapse(p, a);
    const missing = nodesMissingAges(p);
    const ids = new Set(missing.map((n) => n.id));
    expect(missing).toHaveLength(1);
    expect(ids.has(a)).toBe(true);
    expect(ids.has(a1)).toBe(false);
    expect(ids.has(a2)).toBe(false);
  });
});

describe('constrainedMoveNode', () => {
  // root -> a -> b -> c laid out left-to-right at x = 0 / 100 / 200 / 300.
  function chainProject() {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [b] = addChildren(p, a, 1);
    const [c] = addChildren(p, b, 1);
    const layout = { type: 'rectangular-cladogram', orientation: 'LR', hGap: 100, vGap: 50 };
    const positions = new Map<string, { x: number; y: number }>([
      [p.rootId, { x: 0, y: 0 }],
      [a, { x: 100, y: 0 }],
      [b, { x: 200, y: 0 }],
      [c, { x: 300, y: 0 }],
    ]);
    return { p, a, b, c, layout, positions };
  }

  it('a descendant can never be dragged left past ANY ancestor', () => {
    const { p, a, b, c, layout, positions } = chainProject();
    // Drag the deep tip c far to the left, past b, a and the root.
    constrainedMoveNode(p, c, { x: -50, y: 0 }, layout, positions);
    const minGap = Math.max(20, layout.hGap * 0.3);
    const cx = p.nodes[c].position!.x;
    expect(cx).toBeGreaterThanOrEqual(positions.get(b)!.x + minGap);
    expect(cx).toBeGreaterThanOrEqual(positions.get(a)!.x + minGap);
    expect(cx).toBeGreaterThanOrEqual(positions.get(p.rootId)!.x + minGap);
  });

  it('still clamps against the direct parent when ancestors are consistent', () => {
    const { p, b, c, layout, positions } = chainProject();
    constrainedMoveNode(p, c, { x: 150, y: 0 }, layout, positions);
    const minGap = Math.max(20, layout.hGap * 0.3);
    expect(p.nodes[c].position!.x).toBe(200 + minGap);
    expect(p.nodes[b].position).toBeUndefined(); // b is outside c's subtree: unmoved
  });

  it('no runaway when a child sits closer than minGap (node stays under the pointer)', () => {
    const { p, a, b, c, layout, positions } = chainProject();
    // Pre-existing tight spacing: c only 20px right of b (< minGap).
    p.nodes[b].position = { x: 300, y: 0 };
    p.nodes[c].position = { x: 320, y: 0 };
    positions.set(b, { x: 300, y: 0 });
    positions.set(c, { x: 320, y: 0 });
    // Hold the pointer at 280 and simulate several drag frames. Re-clamping the
    // child boundary against c's already-moved position would slide b further left
    // every frame (runaway / escaped the pointer).
    for (let frame = 0; frame < 5; frame += 1) {
      constrainedMoveNode(p, b, { x: 280, y: 0 }, layout, positions);
      positions.set(b, p.nodes[b].position!);
      positions.set(c, p.nodes[c].position!);
    }
    const minGap = Math.max(20, layout.hGap * 0.3);
    // Stable at the pointer position — no frame-by-frame drift, and b never
    // crossed its ancestor a.
    expect(p.nodes[b].position!.x).toBe(280);
    expect(p.nodes[b].position!.x).toBeGreaterThanOrEqual(100 + minGap);
    // Relative spacing within the moved subtree is preserved exactly.
    expect(p.nodes[c].position!.x - p.nodes[b].position!.x).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Fixtures for the re-rooting / dating suite.
// ---------------------------------------------------------------------------

/** Attach a node with a fixed id so the assertions below are readable. */
function add(p: Project, id: string, label: string, parentId: string | null, extra: Partial<TreeNode> = {}): TreeNode {
  const n: TreeNode = { id, label, parentId, childrenIds: [], ...extra };
  p.nodes[id] = n;
  if (parentId) p.nodes[parentId].childrenIds.push(id);
  return n;
}

/** Topology as a labelled Newick skeleton — what a re-root is judged on. */
function skeleton(p: Project, id = p.rootId): string {
  const n = p.nodes[id];
  if (!n) return `?${id}`;
  if (n.childrenIds.length === 0) return n.label;
  return `(${n.childrenIds.map((c) => skeleton(p, c)).join(',')})${n.label}`;
}

/** Sum of every edge weight (a root has none) — invariant across a re-root. */
function totalLength(p: Project): number {
  return Object.values(p.nodes).reduce(
    (s, n) => s + (n.parentId ? knownLength(n.branchLength) ?? 0 : 0),
    0,
  );
}

/** Undirected path distance between two nodes, over the edge weights. */
function pathLength(p: Project, a: string, b: string): number {
  const m = mrcaOf(p, a, b);
  if (m === null) return NaN;
  const up = (from: string): number => {
    let d = 0;
    let cur: TreeNode | undefined = p.nodes[from];
    while (cur && cur.id !== m) {
      d += knownLength(cur.branchLength) ?? 0;
      cur = cur.parentId ? p.nodes[cur.parentId] : undefined;
    }
    return d;
  };
  return up(a) + up(b);
}

/** `(((A:2,B:2)Y:1,C:4)X:1,D:3)R` — the fixture the re-rooting cases run on. */
function fourTipTree(): Project {
  const p = createEmptyProject();
  p.nodes[p.rootId].label = 'R';
  add(p, 'x', 'X', p.rootId, { branchLength: 1 });
  add(p, 'd', 'D', p.rootId, { branchLength: 3 });
  add(p, 'y', 'Y', 'x', { branchLength: 1 });
  add(p, 'c', 'C', 'x', { branchLength: 4 });
  add(p, 'a', 'A', 'y', { branchLength: 2 });
  add(p, 'b', 'B', 'y', { branchLength: 2 });
  return p;
}

/** A self-consistent chronogram: every branch equals its age span. */
function chronogram(): Project {
  const p = createEmptyProject();
  p.nodes[p.rootId].label = 'R';
  p.nodes[p.rootId].age = 100;
  add(p, 'x', 'X', p.rootId, { age: 60, branchLength: 40 });
  add(p, 'd', 'D', p.rootId, { age: 0, branchLength: 100 });
  add(p, 'y', 'Y', 'x', { age: 40, branchLength: 20 });
  add(p, 'c', 'C', 'x', { age: 0, branchLength: 60 });
  add(p, 'a', 'A', 'y', { age: 0, branchLength: 40 });
  add(p, 'b', 'B', 'y', { age: 0, branchLength: 40 });
  return p;
}

describe('outgroupReroot', () => {
  it('roots a single-tip outgroup on its own branch, not one level higher', () => {
    const p = fourTipTree();
    expect(skeleton(p)).toBe('(((A,B)Y,C)X,D)R');
    const res = outgroupReroot(p, ['c']);
    expect(res.ok).toBe(true);
    expect(res.rootEdgeOf).toBe('c');
    // C sits alone on one side of the root: (C,((A,B),D)).
    expect(skeleton(p)).toBe('(C,((A,B)Y,D)X)');
    expectIntegrity(p);
  });

  it('single-tip and clade selections are different operations', () => {
    // A single tip has to root on ITS OWN branch: rooting it on the parent instead
    // would make "outgroup = A" produce exactly the tree of "outgroup = (A,B)".
    const single = fourTipTree();
    expect(outgroupReroot(single, ['a']).ok).toBe(true);
    const pair = fourTipTree();
    expect(outgroupReroot(pair, ['a', 'b']).ok).toBe(true);
    expect(skeleton(single)).toBe('(A,(B,(C,D)X)Y)');
    expect(skeleton(pair)).toBe('((A,B)Y,(C,D)X)');
    expect(skeleton(single)).not.toBe(skeleton(pair));
    expectIntegrity(single);
    expectIntegrity(pair);
  });

  it('roots on a tip that hangs directly off the root', () => {
    const p = fourTipTree();
    expect(outgroupReroot(p, ['d']).ok).toBe(true);
    expect(skeleton(p)).toBe('(D,((A,B)Y,C)X)');
    expectIntegrity(p);
  });

  it('refuses with a reason the caller can show, leaving the tree untouched', () => {
    const p = fourTipTree();
    expect(outgroupReroot(p, [])).toEqual({ ok: false, reason: 'empty-selection' });
    expect(outgroupReroot(p, ['nope'])).toEqual({ ok: false, reason: 'node-missing' });
    expect(outgroupReroot(p, [p.rootId])).toEqual({ ok: false, reason: 'outgroup-is-root' });
    // Selecting both daughters of the root is the whole tree: no branch to move.
    expect(outgroupReroot(p, ['c', 'd'])).toEqual({ ok: false, reason: 'outgroup-is-root' });
    expect(skeleton(p)).toBe('(((A,B)Y,C)X,D)R');
  });

  it('the pre-flight check agrees with the operation', () => {
    expect(checkOutgroupReroot(fourTipTree(), ['a'])).toBeNull();
    expect(checkOutgroupReroot(fourTipTree(), ['c', 'd'])).toBe('outgroup-is-root');
    expect(checkOutgroupReroot(fourTipTree(), [])).toBe('empty-selection');
    expect(checkOutgroupReroot(fourTipTree(), ['ghost'])).toBe('node-missing');
    const rooted = fourTipTree();
    expect(checkOutgroupReroot(rooted, [rooted.rootId])).toBe('outgroup-is-root');
  });
});

describe('branch lengths and ages across a re-root', () => {
  it('migrates every branch length with its edge and preserves the tree length', () => {
    const p = fourTipTree();
    const oldRoot = p.rootId;
    expect(totalLength(p)).toBe(13);
    expect(outgroupReroot(p, ['c']).ok).toBe(true);
    // The split branch (C's incoming, length 4) is halved at the midpoint root…
    expect(p.nodes.c.branchLength).toBe(2);
    expect(p.nodes.x.branchLength).toBe(2);
    // …the reversed edge carries the weight it had before the reversal (X's 1
    // moved up onto the former root, which became X's child)…
    expect(p.nodes[oldRoot]).toBeUndefined(); // …and that unifurcation was suppressed
    // …with its segment merged into the surviving lineage, not thrown away.
    expect(p.nodes.d.branchLength).toBe(4); // 1 (the former root's edge) + 3
    expect(totalLength(p)).toBe(13);
  });

  it('keeps an unknown branch length unknown instead of inventing 1 or 0', () => {
    const p = fourTipTree();
    delete p.nodes.c.branchLength;
    expect(outgroupReroot(p, ['c']).ok).toBe(true);
    expect(p.nodes.c.branchLength).toBeUndefined();
    expect(p.nodes.x.branchLength).toBeUndefined();
    expect(p.nodes.y.branchLength).toBe(1); // an edge that did not move is intact
    expect(p.nodes.a.branchLength).toBe(2);
  });

  it('dates the fresh root so a re-root’s age inversions become checkable', () => {
    const clean = chronogram();
    expect(validateTimeData(clean)).toEqual([]); // the fixture is consistent
    const p = chronogram();
    expect(outgroupReroot(p, ['c']).ok).toBe(true);
    // Midpoint of the branch from X (60 Ma) to C (0 Ma).
    expect(p.nodes[p.rootId].age).toBe(30);
    const issues = validateTimeData(p);
    expect(issues.some((s) => /older than its parent/.test(s))).toBe(true);
  });

  it('re-attaches the former root’s events and calibrations, not deletes them', () => {
    const p = fourTipTree();
    const oldRoot = p.rootId;
    p.events = [
      { id: 'ev-root', typeId: 'key-innovation', target: 'branch', nodeId: oldRoot, triggers: [] },
    ];
    p.calibrationPoints = [{ id: 'cp-root', nodeId: oldRoot, minAge: 1, maxAge: 5 }];
    expect(outgroupReroot(p, ['c']).ok).toBe(true);
    expect(p.events).toHaveLength(1);
    expect(p.events[0].nodeId).toBe('d'); // the surviving lineage of the old root
    expect(p.calibrationPoints[0].nodeId).toBe('d');
  });

  it('midpoint rooting puts the root inside the branch, equalising both halves', () => {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId, { branchLength: 1 });
    add(p, 'c', 'C', p.rootId, { branchLength: 4 });
    add(p, 'a', 'A', 'x', { branchLength: 1 });
    add(p, 'b', 'B', 'x', { branchLength: 1 });
    const r = midpointRoot(p);
    expect(r.ok).toBe(true);
    expect(r.placement!.targetId).toBe('c');
    // Longest tip-to-tip path is A↔C = 1 + 1 + 4 = 6; half of it is 3, which is
    // 1 unit down the 4-unit C branch — inside it, not on one of its endpoints.
    expect(r.placement!.diameter).toBe(6);
    expect(r.placement!.fraction).toBeCloseTo(0.25, 10);
    expect(r.placement!.complete).toBe(true);
    expect(applyMidpointReroot(p).ok).toBe(true);
    expectIntegrity(p);
    const root = p.rootId;
    expect(pathLength(p, root, 'a')).toBeCloseTo(3, 10);
    expect(pathLength(p, root, 'c')).toBeCloseTo(3, 10);
    expect(totalLength(p)).toBe(7);
  });

  it('excludes branch lengths that are missing and says the diameter is partial', () => {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId, { branchLength: 1 });
    add(p, 'c', 'C', p.rootId, { branchLength: 4 });
    add(p, 'a', 'A', 'x', { branchLength: 1 });
    add(p, 'b', 'B', 'x', { branchLength: 1 });
    delete p.nodes.b.branchLength;
    const r = midpointRoot(p);
    expect(r.placement!.unknownEdges).toBe(1);
    expect(r.placement!.complete).toBe(false);
    // Measured over the priced part of the tree only: pricing the missing branch
    // as 1 would grow the diameter out of thin air.
    expect(r.placement!.diameter).toBe(6);
    expect(r.placement!.targetId).toBe('c');
  });

  it('treats a negative length as unknown, but a RECORDED ZERO as real data', () => {
    const p = createEmptyProject();
    add(p, 'x', 'X', p.rootId, { branchLength: 1 });
    add(p, 'c', 'C', p.rootId, { branchLength: -5 });
    add(p, 'a', 'A', 'x', { branchLength: 1 });
    add(p, 'b', 'B', 'x', { branchLength: 0 });
    const r = midpointRoot(p);
    // A recorded 0 is a real zero-cost branch — the same reading `treeSummary`
    // uses when it counts the tree length. Only the negative is not a length at
    // all. Calling both unknown would disagree with stats.ts and throw away
    // measured path lengths elsewhere.
    expect(r.placement!.unknownEdges).toBe(1); // C(-5) only
    expect(r.placement!.diameter).toBe(2); // A↔X↔root is still the longest priced path
  });

  it('keeps a recorded zero when a node is deleted without cascading', () => {
    const p = createEmptyProject();
    add(p, 'x', 'n', p.rootId, { branchLength: 5 });
    add(p, 'a', 'A', 'x', { branchLength: 0 });
    add(p, 'b', 'B', 'x', { branchLength: 1 });
    deleteNode(p, 'x', false);
    // The merged edge is the deleted node's 5 plus A's recorded 0 — not unknown.
    expect(p.nodes.a.branchLength).toBe(5);
    expect(p.nodes.b.branchLength).toBe(6);
  });
});

describe('estimateAges', () => {
  it('never overwrites an age the user entered', () => {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId);
    add(p, 'd', 'D', p.rootId);
    add(p, 'a', 'A', 'x');
    add(p, 'b', 'B', 'x');
    p.nodes.a.age = 48; // a fossil date: an age the user entered is never rewritten
    const r = estimateAges(p);
    expect(p.nodes.a.age).toBe(48);
    expect(r.preserved).toBe(1);
    expect(r.filled).toEqual(expect.arrayContaining(['x', 'd', 'b', p.rootId]));
    expect(r.changed).toBe(true);
    expect(r.tipsAssumedPresent).toBe(2); // d and b had no age and read as extant
  });

  it('scales estimates onto the tree’s absolute ages so units stay consistent', () => {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    p.nodes[p.rootId].age = 100;
    add(p, 'x', 'X', p.rootId);
    add(p, 'd', 'D', p.rootId);
    add(p, 'a', 'A', 'x');
    add(p, 'b', 'B', 'x');
    const r = estimateAges(p);
    expect(r.unit).toBe('project');
    expect(r.calibrationAge).toBe(100);
    // Depths 2 / 1 / 0 stretched onto the 100 Ma the user already supplied.
    expect(p.nodes.x.age).toBe(50);
    expect(p.nodes.d.age).toBe(0);
    expect(topologicalHeights(p).get(p.rootId)).toBe(2);
    // The raw edge count is kept next to the written age, never inside it.
    expect(p.nodes.x.meta?.relativeDepth).toBe(1);
    expect(p.nodes.x.meta?.ageEstimated).toBe(true);
    // The node the user dated is untouched — no estimate flags on it.
    expect(p.nodes[p.rootId].meta).toBeUndefined();
  });

  it('reports relative units when the tree has no absolute age to scale onto', () => {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId);
    add(p, 'a', 'A', 'x');
    add(p, 'b', 'B', 'x');
    const r = estimateAges(p);
    expect(r.unit).toBe('relative');
    expect(r.timeUnit).toBe('Ma');
    expect(p.nodes[p.rootId].age).toBe(2);
    expect(p.nodes.x.meta?.ageEstimated).toBe(true);
    // The axis unit is untouched — the caller must surface the mismatch.
    expect(p.layout.timeUnit).toBe('Ma');
  });

  it('leaves a fully dated tree alone', () => {
    const p = chronogram();
    const before = JSON.stringify(p.nodes);
    const r = estimateAges(p);
    expect(r.changed).toBe(false);
    expect(r.filled).toEqual([]);
    expect(JSON.stringify(p.nodes)).toBe(before);
  });
});

describe('treeOps topology and time guards', () => {
  it('insertParent splits the branch and dates the new node between its neighbours', () => {
    const p = chronogram();
    const mid = insertParent(p, 'a');
    expect(mid).toBeTruthy();
    expect(p.nodes[mid as string].branchLength).toBe(20);
    expect(p.nodes.a.branchLength).toBe(20);
    expect(p.nodes[mid as string].age).toBe(20); // (Y 40 + A 0) / 2
    expect(validateTimeData(p)).toEqual([]);
    // A branch with no length stays unknown on both halves.
    const q = createEmptyProject();
    const [c] = addChildren(q, q.rootId, 1);
    const m2 = insertParent(q, c) as string;
    expect(q.nodes[m2].branchLength).toBeUndefined();
    expect(q.nodes[c].branchLength).toBeUndefined();
    expect(q.nodes[m2].age).toBeUndefined();
    expectIntegrity(q);
  });

  it('hasAges does not unlock the time axis for a tree of zeros', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[p.rootId].age = 0;
    p.nodes[a].age = 0;
    p.nodes[b].age = 0;
    expect(hasAges(p)).toBe(false);
    p.nodes[p.rootId].age = 1;
    expect(hasAges(p)).toBe(true);
  });

  it('ladderize orders by descendant tip count (Farris), not by node count', () => {
    const p = createEmptyProject();
    const [u, w] = addChildren(p, p.rootId, 2);
    const [chain] = addChildren(p, u, 1);
    addChildren(p, chain, 1); // u's subtree: 3 nodes but only 1 tip
    addChildren(p, w, 2); // w's subtree: 3 nodes and 2 tips
    expect(tipCountBelow(p).get(u)).toBe(1);
    expect(tipCountBelow(p).get(w)).toBe(2);
    ladderize(p);
    expect(p.nodes[p.rootId].childrenIds).toEqual([w, u]);
    ladderize(p, true);
    expect(p.nodes[p.rootId].childrenIds).toEqual([u, w]);
  });

  it('survives a 5 000-deep ladder without recursion', () => {
    // A recursive walk costs one stack frame per level, so these helpers are
    // iterative.
    const p = createEmptyProject();
    let cur = p.rootId;
    for (let i = 0; i < 5000; i += 1) {
      const [kid] = addChildren(p, cur, 1);
      p.nodes[kid].label = `k${i}`;
      cur = kid;
    }
    expect(() => ladderize(p)).not.toThrow();
    expect(tipCountBelow(p).get(p.rootId)).toBe(1);
    expect(topologicalHeights(p).get(p.rootId)).toBe(5000);
    expect(() => estimateAges(p)).not.toThrow();
    expect(() => collapseBelowSupport(p, 50)).not.toThrow();
  });

  it('addChildren refuses a zero / negative count instead of adding one child', () => {
    const p = createEmptyProject();
    expect(addChildren(p, p.rootId, 0)).toEqual([]);
    expect(addChildren(p, p.rootId, -3)).toEqual([]);
    expect(addChildren(p, p.rootId, Number.NaN)).toEqual([]);
    expect(p.nodes[p.rootId].childrenIds).toHaveLength(0);
  });

  it('deleteNode refuses to splice when parentId and childrenIds disagree', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 2);
    const [b] = addChildren(p, a, 1);
    p.nodes[p.rootId].childrenIds = p.nodes[p.rootId].childrenIds.filter((x) => x !== a);
    expect(deleteNode(p, a, false)).toBe(false);
    expect(p.nodes[a]).toBeDefined();
    expect(p.nodes[b].parentId).toBe(a);
  });

  it('a walk up a corrupt parent cycle terminates', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [b] = addChildren(p, a, 1);
    p.nodes[a].parentId = b; // a -> b -> a
    // The guards answer with "one of the two cycle members" or "none" — what
    // they must not do is spin.
    expect([a, b, null]).toContain(mrcaOf(p, b, a));
    expect(() => rerootAtNode(p, b)).not.toThrow();
    expect(() => ladderize(p)).not.toThrow();
  });

  it('support thresholds compare 0–1 and 0–100 values on one scale', () => {
    expect(normalizeSupport(0.95)).toBe(95);
    expect(normalizeSupport(95)).toBe(95);
    expect(normalizeSupport(undefined)).toBeUndefined();
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId);
    add(p, 'z', 'Z', p.rootId);
    addChildren(p, 'x', 2);
    addChildren(p, 'z', 2);
    p.nodes.x.support = 0.6; // posterior probability: 60 %
    p.nodes.z.support = 90; // bootstrap percentage
    expect(collapseBelowSupport(p, 70)).toBe(1);
    expect(p.nodes.x.collapsed).toBe(true);
    expect(p.nodes.z.collapsed).toBeFalsy();
    // The same threshold expressed as a fraction means the same thing.
    const q = fourTipTree();
    q.nodes.y.support = 90;
    q.nodes.x.support = 0.5;
    expect(collapseBelowSupport(q, 0.7)).toBe(1);
    expect(q.nodes.x.collapsed).toBe(true);
    expect(q.nodes.y.collapsed).toBeFalsy();
  });

  it('unpinForReflow releases only the rows an insertion actually moves', () => {
    const p = createEmptyProject();
    const [e, m, l] = addChildren(p, p.rootId, 3);
    const [e1] = addChildren(p, e, 2);
    const [m1] = addChildren(p, m, 2);
    const [l1] = addChildren(p, l, 2);
    for (const id of [e1, m1, l1, m, p.rootId]) {
      p.nodes[id].position = { x: 10, y: 20 };
      p.nodes[id].pinned = true;
    }
    addChildrenSpaced(p, m, 1);
    expect(p.nodes[e1].pinned).toBe(true); // earlier in the sweep: hand-placed, kept
    expect(p.nodes[e1].position).toEqual({ x: 10, y: 20 });
    expect(p.nodes[l1].pinned).toBe(false); // after the insertion: re-spaced
    expect(p.nodes[m1].pinned).toBe(false);
    expect(p.nodes[m].pinned).toBe(false); // the touched parent re-centres
    expect(p.nodes[p.rootId].pinned).toBe(false); // …and so do its ancestors
  });

  it('validateTimeData reports branch/age conflicts and calibration violations', () => {
    const p = chronogram();
    p.nodes.a.branchLength = 99; // ages imply 40
    p.calibrationPoints = [{ id: 'cp', nodeId: 'x', minAge: 70, maxAge: 90 }]; // x is 60
    const issues = validateTimeData(p);
    expect(issues.some((s) => /Branch entering "A"/.test(s))).toBe(true);
    expect(issues.some((s) => /outside its calibration range/.test(s))).toBe(true);
    // An undated parent makes the time direction uncheckable — say so.
    const q = chronogram();
    delete q.nodes.x.age;
    expect(validateTimeData(q).some((s) => /cannot be checked/.test(s))).toBe(true);
  });
});

describe('extractSubtree', () => {
  function richProject(): Project {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 'x', 'X', p.rootId);
    add(p, 'd', 'D', p.rootId);
    add(p, 'a', 'A', 'x');
    add(p, 'b', 'B', 'x');
    const ch: Character = {
      id: 'ch',
      name: 'Habitat',
      type: 'discrete',
      states: [
        { id: 's1', label: 'Aquatic', color: '#000000' },
        { id: 's2', label: 'Land', color: '#ffffff' },
      ],
      costMatrix: [
        [0, 2],
        [2, 0],
      ],
    };
    p.characters = [ch];
    setNodeState(p, 'a', 'ch', 's1');
    setNodeState(p, 'x', 'ch', 's2');
    p.events = [
      { id: 'ev-x', typeId: 'key-innovation', target: 'branch', nodeId: 'x', triggers: ['ev-d'] },
      { id: 'ev-d', typeId: 'adaptive-radiation', target: 'node', nodeId: 'd', triggers: [] },
    ];
    p.calibrationPoints = [
      { id: 'cp-x', nodeId: 'x', minAge: 10, maxAge: 20 },
      { id: 'cp-d', nodeId: 'd', minAge: 1, maxAge: 5 },
    ];
    p.environmentalEvents = [{ id: 'env1', label: 'Cooling', from: 15, to: 12, color: '#fff' }];
    p.customEdges = [
      { id: 'ce-in', sourceId: 'a', targetId: 'b', style: DEFAULT_EDGE_STYLE },
      { id: 'ce-out', sourceId: 'x', targetId: 'd', style: DEFAULT_EDGE_STYLE },
    ];
    return p;
  }

  it('keeps the subtree’s calibrations, context and (cleaned) causal links', () => {
    const p = richProject();
    const sub = extractSubtree(p, 'x');
    expect(sub).not.toBeNull();
    expect(Object.keys(sub!.nodes).sort()).toEqual(['a', 'b', 'x']);
    expect(sub!.rootId).toBe('x');
    expect(sub!.nodes.x.parentId).toBeNull();
    expect(sub!.calibrationPoints.map((c) => c.id)).toEqual(['cp-x']);
    expect(sub!.environmentalEvents).toHaveLength(1);
    expect(sub!.events.map((e) => e.id)).toEqual(['ev-x']);
    // The kept event must not point at the event that stayed behind.
    expect(sub!.events[0].triggers).toEqual([]);
    expect(sub!.customEdges.map((e) => e.id)).toEqual(['ce-in']);
    // Character assignments travel with the nodes.
    expect(sub!.nodes.a.charStates?.ch).toBe('s1');
  });

  it('deep-copies states and step matrices so the new tab cannot rewrite the original', () => {
    const p = richProject();
    const sub = extractSubtree(p, 'x')!;
    sub.characters[0].states[0].label = 'Renamed';
    sub.characters[0].costMatrix![0][1] = 99;
    sub.nodes.x.childrenIds.push('ghost');
    expect(p.characters[0].states[0].label).toBe('Aquatic');
    expect(p.characters[0].costMatrix![0][1]).toBe(2);
    expect(p.nodes.x.childrenIds).toEqual(['a', 'b']);
    expect(p.customEdges[0].style).not.toBe(sub.customEdges[0].style);
  });
});

describe('character cleanup', () => {
  function scored(): { p: Project; ch: Character } {
    const p = createEmptyProject();
    p.nodes[p.rootId].label = 'R';
    add(p, 't', 'T', p.rootId);
    const ch: Character = {
      id: 'ch',
      name: 'Habitat',
      type: 'discrete',
      states: [
        { id: 's1', label: 'Aquatic', color: '#000' },
        { id: 's2', label: 'Land', color: '#fff' },
      ],
      costMatrix: [
        [0, 1],
        [1, 0],
      ],
    };
    p.characters = [ch];
    setNodeState(p, p.rootId, 'ch', 's1');
    setNodeState(p, 't', 'ch', 's1');
    return { p, ch };
  }

  it('removing a character clears its evidence meta too, live and stored', () => {
    const { p } = scored();
    p.nodes[p.rootId].charMeta = { ch: { confidence: 'high', support: 'ankle' } };
    p.layerStore = { other: captureLayer(p) };
    const res = removeCharacter(p, 'ch');
    expect(res.ok).toBe(true);
    expect(res.costMatrixDiscarded).toBe(true);
    expect(p.nodes[p.rootId].charStates).toBeUndefined();
    expect(p.nodes[p.rootId].charMeta).toBeUndefined();
    expect(p.nodes.t.charStates).toBeUndefined();
    const stored = p.layerStore.other;
    expect(Object.keys(stored.states)).toHaveLength(0);
    expect(Object.keys(stored.meta)).toHaveLength(0);
  });

  it('removing a state also cleans the stored hypothesis layers', () => {
    const { p } = scored();
    p.nodes[p.rootId].charMeta = { ch: { confidence: 'high', support: 'ankle' } };
    p.layerStore = { other: captureLayer(p) };
    const res = removeCharacterState(p, 'ch', 's1');
    expect(res.ok).toBe(true);
    expect(res.clearedAssignments).toBeGreaterThanOrEqual(2);
    expect(p.characters[0].states.map((s) => s.id)).toEqual(['s2']);
    expect(p.characters[0].costMatrix).toBeUndefined();
    expect(res.costMatrixDiscarded).toBe(true);
    expect(p.nodes[p.rootId].charMeta).toBeUndefined();
    // Switching layers must not resurrect the deleted state's assignment.
    applyLayer(p, p.layerStore.other);
    expect(p.nodes[p.rootId].charStates?.ch).toBeUndefined();
    expect(p.nodes[p.rootId].charMeta?.ch).toBeUndefined();
  });

  it('a missing state is reported, not applied', () => {
    const { p } = scored();
    expect(removeCharacterState(p, 'ch', 'ghost')).toEqual({
      ok: false,
      reason: 'state-missing',
      costMatrixDiscarded: false,
      clearedAssignments: 0,
    });
    expect(p.characters[0].states).toHaveLength(2);
    expect(p.characters[0].costMatrix).toBeDefined();
  });

  it('adding a state reports that a hand-built step matrix was reset', () => {
    const { p, ch } = scored();
    const res = addCharacterState(p, 'ch', { id: 's3', label: 'Air', color: '#abc' });
    expect(res.ok).toBe(true);
    expect(res.costMatrixDiscarded).toBe(true);
    expect(p.characters[0].states).toHaveLength(3);
    const silent = addCharacterState(p, 'nope', { id: 's4', label: 'x', color: '#000' });
    expect(silent.reason).toBe('character-missing');
    expect(ch.states).toHaveLength(3);
  });

  it('setNodeState stores declared states and missing codes — nothing else', () => {
    const { p } = scored();
    setNodeState(p, 't', 'ch', '?'); // standard missing-data code: kept as-is
    expect(p.nodes.t.charStates?.ch).toBe('?');
    setNodeState(p, 't', 'ch', '-');
    expect(p.nodes.t.charStates?.ch).toBe('-');
    setNodeState(p, 't', 'ch', 's2');
    expect(p.nodes.t.charStates?.ch).toBe('s2');
    // A stale id of a deleted state is no observation and must not be stored —
    // CI/RI, consistency checks and the canvas would all read it as a real state.
    setNodeState(p, 't', 'ch', 's1-deleted');
    expect(p.nodes.t.charStates?.ch).toBeUndefined();
    setNodeState(p, 't', 'ch', undefined);
    expect(p.nodes.t.charStates).toBeUndefined();
  });

  it('setCharacterCostMatrix rejects mismatched dimensions', () => {
    const { p } = scored();
    setCharacterCostMatrix(p, 'ch', [[0, 1], [1, 0]]);
    expect(p.characters[0].costMatrix).toEqual([[0, 1], [1, 0]]);
    setCharacterCostMatrix(p, 'ch', [[0]]);
    expect(p.characters[0].costMatrix).toBeUndefined();
  });

  it('pruneLayerStore drops orphan character keys a load may still carry', () => {
    // A hand-edited document can keep `charMeta` / stored-layer keys
    // for a character that no longer exists; loading must not resurrect them.
    const { p } = scored();
    p.layerStore = {
      other: {
        states: { [p.rootId]: { ch: 's1', ghost: 'x' } },
        meta: { [p.rootId]: { ch: { confidence: 'low' }, ghostChar: { confidence: 'high' } } },
        events: [],
      },
    };
    p.nodes[p.rootId].charMeta = { ch: { confidence: 'low' }, ghostChar: { confidence: 'high' } };
    expect(pruneLayerStore(p)).toBe(true);
    expect(p.layerStore.other.states[p.rootId]).toEqual({ ch: 's1' });
    expect(Object.keys(p.layerStore.other.meta[p.rootId])).toEqual(['ch']);
    // The active layer's own orphan meta is cleaned by the same load path.
    expect(pruneOrphanCharacterData(p)).toBe(1);
    expect(Object.keys(p.nodes[p.rootId].charMeta!)).toEqual(['ch']);
  });
});

describe('reproducible document ids', () => {
  afterEach(() => resetIdGenerator());

  it('a seeded generator rebuilds a document byte-for-byte', () => {
    setIdGenerator(sequentialIdGenerator('d'));
    const first = JSON.stringify(createEmptyProject('sample'));
    resetIdGenerator();
    setIdGenerator(sequentialIdGenerator('d'));
    const second = JSON.stringify(createEmptyProject('sample'));
    expect(second).toBe(first);
    expect(first).toContain('"d1"');
  });

  it('the default generator keeps ids unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(newId());
    expect(seen.size).toBe(500);
  });
});

// ── the "parsimony suggestion" must actually be most parsimonious ──
describe('fillParsimony honours the documented `chosen` contract', () => {
  function countChanges(p: Project, charId: string): number {
    let n = 0;
    for (const node of Object.values(p.nodes)) {
      if (!node.parentId) continue;
      const a = node.charStates?.[charId];
      const b = p.nodes[node.parentId]?.charStates?.[charId];
      if (a !== undefined && b !== undefined && a !== b) n += 1;
    }
    return n;
  }

  it('writes an assignment whose change count equals parsimony().cost', () => {
    const p = createEmptyProject();
    add(p, 'x', 'X', p.rootId);
    add(p, 'a', 'a', 'x'); add(p, 'b', 'b', 'x');
    add(p, 'y', 'Y', p.rootId);
    add(p, 'c', 'c', 'y'); add(p, 'd', 'd', 'y');
    const ch: Character = {
      id: 'ch1', name: 'x', type: 'discrete',
      states: [
        { id: 's0', label: 'S0', color: '#111111' },
        { id: 's1', label: 'S1', color: '#eeeeee' },
      ],
    };
    p.characters = [ch];
    // s0 on the left clade, s1 on the right: one change at the root.
    for (const [id, s] of [['a', 's0'], ['b', 's0'], ['c', 's1'], ['d', 's1']] as const) {
      p.nodes[id].charStates = { [ch.id]: s };
    }
    const cost = parsimony(p, ch).cost;
    fillParsimony(p, ch.id);
    expect(countChanges(p, ch.id)).toBe(cost);
  });

  it('does not inflate the cost when internal nodes carry a state tie', () => {
    // The shape that catches it: reading `states[0]` (declaration order)
    // instead of `chosen` fills an assignment costing 3 where the minimum is 2.
    const p = createEmptyProject();
    add(p, 'x1', 'X1', p.rootId);
    add(p, 'x1a', 'A1', 'x1'); add(p, 'a', 'a', 'x1a'); add(p, 'b', 'b', 'x1a');
    add(p, 'x1b', 'A2', 'x1'); add(p, 'c', 'c', 'x1b'); add(p, 'd', 'd', 'x1b');
    add(p, 'x2', 'X2', p.rootId); add(p, 'e', 'e', 'x2'); add(p, 'f', 'f', 'x2');
    add(p, 'x3', 'X3', p.rootId); add(p, 'g', 'g', 'x3'); add(p, 'h', 'h', 'x3');
    const ch: Character = {
      id: 'ch1', name: 'x', type: 'discrete',
      states: [
        { id: 's0', label: 'S0', color: '#111111' },
        { id: 's1', label: 'S1', color: '#eeeeee' },
      ],
    };
    p.characters = [ch];
    for (const [id, s] of [
      ['a', 's0'], ['b', 's0'], ['c', 's0'],
      ['d', 's1'], ['e', 's1'], ['f', 's1'], ['g', 's1'], ['h', 's1'],
    ] as const) {
      p.nodes[id].charStates = { [ch.id]: s };
    }
    const cost = parsimony(p, ch).cost;
    expect(cost).toBe(2);
    fillParsimony(p, ch.id);
    expect(countChanges(p, ch.id)).toBe(2);
  });
});

// ── midpoint rooting over several priced components ──
describe('midpointRoot across multiple priced components', () => {
  it('measures the longest path across ALL components, not just the first', () => {
    // X hangs off the root on a priced edge; N has no length, so L1/L2 form a
    // separate priced component whose 17-unit path is the real diameter. Stopping
    // after the first component would root on the 1-unit edge.
    const p = parseNewick('(X:1,(L1:9,L2:8)N)R;');
    const r = midpointRoot(p);
    expect(r.ok).toBe(true);
    expect(r.placement!.diameter).toBe(17);
  });

  it('does not mistake a small first component for full coverage', () => {
    const p = parseNewick('(X:1,(L1:2,L2:3)N)R;');
    expect(midpointRoot(p).placement!.diameter).toBe(5);
  });

  it('handles three components and picks the longest', () => {
    const p = parseNewick('((a:100,b:100)X,(c:1,d:1)Y,(e:5,f:5)Z)R;');
    expect(midpointRoot(p).placement!.diameter).toBe(200);
  });

  it('reports no-usable-lengths when nothing is measured', () => {
    // The counter has to include the root, otherwise `unknownEdges === ids.length`
    // can never hold and this branch stays unreachable.
    const p = parseNewick('((A,B)X,(C,D)Y)R;');
    const r = midpointRoot(p);
    expect(r.ok).toBe(false);
    expect(r.failure).toBe('no-usable-lengths');
  });
});

// ── Alt+Arrow must move through the TOPOLOGY ──
describe('topologicalNeighbour honours the documented Alt+Arrow rule', () => {
  // ((a,b)X,(c,d)Y)R
  const p = parseNewick('((a:1,b:1)X:1,(c:1,d:1)Y:1)R;');
  const id = (label: string) => Object.values(p.nodes).find((n) => n.label === label)!.id;

  it('ArrowUp goes to the parent', () => {
    expect(topologicalNeighbour(p, id('a'), 'ArrowUp')).toBe(id('X'));
    expect(topologicalNeighbour(p, id('X'), 'ArrowUp')).toBe(id('R'));
  });

  it('ArrowDown goes to the first child', () => {
    expect(topologicalNeighbour(p, id('X'), 'ArrowDown')).toBe(id('a'));
  });

  it('ArrowLeft / ArrowRight step between siblings', () => {
    expect(topologicalNeighbour(p, id('a'), 'ArrowRight')).toBe(id('b'));
    expect(topologicalNeighbour(p, id('b'), 'ArrowLeft')).toBe(id('a'));
    expect(topologicalNeighbour(p, id('X'), 'ArrowRight')).toBe(id('Y'));
    expect(topologicalNeighbour(p, id('Y'), 'ArrowLeft')).toBe(id('X'));
  });

  it('does NOT wrap around to an unrelated node at the edges', () => {
    // A flat-list walk would wrap modulo the node count, landing Alt+Up from a deep
    // tip somewhere arbitrary instead of on its parent.
    expect(topologicalNeighbour(p, id('a'), 'ArrowLeft')).toBeUndefined();
    expect(topologicalNeighbour(p, id('R'), 'ArrowUp')).toBeUndefined();
    expect(topologicalNeighbour(p, id('a'), 'ArrowDown')).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(topologicalNeighbour(p, 'nope', 'ArrowUp')).toBeUndefined();
  });
});
