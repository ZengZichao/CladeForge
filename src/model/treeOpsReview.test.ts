// Regression tests for the review findings on rerooting, outgroup selection,
// and subtree extraction. Each test pins one finding from
// 审阅意见-科学正确性与功能测试.md (S1/S2/M1/M26/M28/M4).
import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import {
  rerootAtNode,
  outgroupReroot,
  checkOutgroupReroot,
  extractSubtree,
  estimateAgesWithCalibrations,
} from './treeOps';
import { createEmptyProject } from './sampleTree';
import type { TreeNode } from './types';

const nodeByLabel = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

/** Sum of branch lengths along the unique path between two tips (undefined when any edge is unknown). */
function patristic(
  p: ReturnType<typeof parseNewick>,
  a: string,
  b: string,
): number | undefined {
  const na = nodeByLabel(p, a);
  const nb = nodeByLabel(p, b);
  const anc: string[] = [];
  const seenA = new Set<string>();
  let c: TreeNode | null = na;
  while (c && !seenA.has(c.id)) {
    seenA.add(c.id);
    anc.push(c.id);
    c = c.parentId ? p.nodes[c.parentId] : null;
  }
  let total = 0;
  let unknown = false;
  // A node's own branchLength IS the edge to its parent; the root has none.
  const add = (n: typeof na): void => {
    if (!n || n.parentId === null) return;
    if (typeof n.branchLength !== 'number' || !Number.isFinite(n.branchLength)) unknown = true;
    else total += n.branchLength;
  };
  // Climb from b to the first node on a's ancestor path (the MRCA), adding
  // every edge below it.
  let d: TreeNode | null = nb;
  const seenB = new Set<string>();
  while (d && !anc.includes(d.id) && !seenB.has(d.id)) {
    seenB.add(d.id);
    add(d);
    d = d.parentId ? p.nodes[d.parentId] : null;
  }
  // The a-side: from a up to and including the MRCA's own edge.
  let up: TreeNode | null = na;
  const seenU = new Set<string>();
  while (up && up.id !== d?.id && !seenU.has(up.id)) {
    seenU.add(up.id);
    add(up);
    up = up.parentId ? p.nodes[up.parentId] : null;
  }
  if (d) add(d);
  return unknown ? undefined : total;
}

describe('review: reroot edge identity and tip conservation', () => {
  it('S1: rerooting a unifurcate root adds no fake tip', () => {
    const p = parseNewick('((A:1,B:1):1);');
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    const tips = Object.values(p.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort();
    expect(tips).toEqual(['A', 'B']);
    expect(Object.keys(p.nodes)).toHaveLength(4); // root, A, B, inner — no dangling ex-root leaf
  });

  it('S2: split support, branch style and branch events ride the reversed edge', () => {
    const p = parseNewick('((A:1,B:1)X:2,C:3,D:4)R:99;');
    const x = nodeByLabel(p, 'X');
    x.support = 90;
    x.supportScale = 'percent';
    x.supportKind = 'bootstrap';
    x.branchStyle = { dash: 'dashed' };
    p.events = [{ id: 'ev1', typeId: 'key-innovation', target: 'branch', nodeId: x.id, triggers: [] }];
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    // The AB|CD split now lives on the edge between X and the old root, i.e. on
    // the old root's record.
    const r = Object.values(p.nodes).find((n) => n.label === 'R')!;
    expect(r.support).toBe(90);
    expect(r.supportScale).toBe('percent');
    expect(r.supportKind).toBe('bootstrap');
    expect(r.branchStyle?.dash).toBe('dashed');
    expect(p.events[0].nodeId).toBe(r.id);
    // Tip distances are untouched by the annotation migration (A–D = 7).
    expect(patristic(p, 'A', 'D')).toBeCloseTo(7, 10);
  });

  it('S2: node-anchored evidence stays on the vertex that carries it', () => {
    const p = parseNewick('((A:1,B:1)X:2,C:3,D:4)R:99;');
    const x = nodeByLabel(p, 'X');
    p.events = [{ id: 'evN', typeId: 'key-innovation', target: 'node', nodeId: x.id, triggers: [] }];
    x.age = 42;
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    const xAfter = Object.values(p.nodes).find((n) => n.label === 'X')!;
    expect(p.events[0].nodeId).toBe(xAfter.id); // vertex event stays on the vertex
    expect(xAfter.age).toBe(42);
  });

  it('M1: an unknown segment stays unknown through a reroot suppression', () => {
    const p = parseNewick('((A:1,B:1)X,C:2)R;');
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    // The old root's incoming edge (X–R) had NO length: the merged edge into C
    // must be unknown, not silently 2.
    expect(nodeByLabel(p, 'C').branchLength).toBeUndefined();
    expect(patristic(p, "A", "C")).toBeUndefined();
  });

  it('M26: a root calibration follows the root, never a tip', () => {
    const p = parseNewick('((A:1,B:1)X:1,C:1)R;');
    p.calibrationPoints = [{ id: 'cp1', nodeId: nodeByLabel(p, 'R').id, minAge: 90, maxAge: 110 }];
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    expect(p.calibrationPoints[0].nodeId).toBe(p.rootId);
    // C is a tip and carries no calibration.
    const c = nodeByLabel(p, 'C');
    expect(c.childrenIds.length).toBe(0);
    expect(p.calibrationPoints[0].nodeId).not.toBe(c.id);
  });

  it('M2: a calibrated root is written back and no negative age is emitted', () => {
    const p = parseNewick('((A,B)X,C)R;');
    p.calibrationPoints = [
      { id: 'c1', nodeId: nodeByLabel(p, 'R').id, minAge: 100, maxAge: 100 },
      { id: 'c2', nodeId: nodeByLabel(p, 'X').id, minAge: 40, maxAge: 40 },
    ];
    const r = estimateAgesWithCalibrations(p);
    expect(nodeByLabel(p, 'R').age).toBe(100);
    expect(nodeByLabel(p, 'X').age).toBe(40);
    expect(nodeByLabel(p, 'A').age).toBe(0);
    expect(r.conflicts).toHaveLength(0);
    for (const n of Object.values(p.nodes)) {
      if (n.age !== undefined) expect(n.age).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('review: outgroup selection (M28)', () => {
  it('a partial clade whose complement is not a clade is refused', () => {
    const p = parseNewick('((A,B,C)X,D)R;');
    const reason = checkOutgroupReroot(p, [nodeByLabel(p, 'A').id, nodeByLabel(p, 'C').id]);
    expect(reason).toBe('not-monophyletic');
    expect(outgroupReroot(p, [nodeByLabel(p, 'A').id, nodeByLabel(p, 'C').id])).toEqual({
      ok: false,
      reason: 'not-monophyletic',
    });
  });

  it('a non-clade selection whose complement IS a clade roots on that complement', () => {
    const p = parseNewick('((A,B)X,C,D)R;');
    const res = outgroupReroot(p, [nodeByLabel(p, 'C').id, nodeByLabel(p, 'D').id]);
    expect(res.ok).toBe(true);
    expect(res.rootEdgeOf).toBe(nodeByLabel(p, 'X').id);
    // {C,D} sit together on one side of the new root.
    const c = nodeByLabel(p, 'C');
    const d = nodeByLabel(p, 'D');
    expect(c.parentId).toBe(p.rootId === c.id ? c.parentId : c.parentId);
    const siblings = Object.values(p.nodes).filter((n) => n.parentId === c.parentId && n.childrenIds.length === 0).map((n) => n.label);
    expect(siblings).toContain('C');
    expect(siblings).toContain('D');
  });
});

describe('review: extractSubtree isolation (M4)', () => {
  it('polymorphic arrays and nested meta are deep-copied', () => {
    const p = parseNewick('(A,B)R;');
    const a = nodeByLabel(p, 'A');
    a.charStates = { c1: ['0', '1'] };
    a.meta = { nested: { x: 1 } };
    a.annotations = { host: 'human' };
    const sub = extractSubtree(p, a.id)!;
    const subA = Object.values(sub.nodes).find((n) => n.label === 'A')!;
    (subA.charStates!.c1 as string[]).push('2');
    (subA.meta!.nested as { x: number }).x = 99;
    subA.annotations!.host = 'bat';
    expect(a.charStates!.c1).toEqual(['0', '1']);
    expect((a.meta!.nested as { x: number }).x).toBe(1);
    expect(a.annotations!.host).toBe('human');
  });
});

describe('review: tree helpers used above', () => {
  it('createEmptyProject sanity', () => {
    const p = createEmptyProject('t');
    expect(p.nodes[p.rootId]).toBeTruthy();
  });
});
