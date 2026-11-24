// Regression tests for the review findings on rerooting, outgroup selection,
// and subtree extraction. Each test pins one finding from
// 审阅意见-科学正确性与功能测试.md (S1/S2/M1/M26/M28/M4).
import { describe, it, expect, afterEach } from 'vitest';
import { produce } from 'immer';
import { parseNewick } from '../io/newick';
import {
  rerootAtNode,
  rerootOnBranch,
  outgroupReroot,
  checkOutgroupReroot,
  extractSubtree,
  estimateAgesWithCalibrations,
  addCalibrationPoint,
  updateCalibrationPoint,
  setCalibrationForNode,
  validateTimeData,
} from './treeOps';
import { createEmptyProject } from './sampleTree';
import { DEFAULT_EDGE_STYLE, type TreeNode } from './types';

const nodeByLabel = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

/** A three-edge dated path: R(100) → Z(80) → Y(40) → {A,B}(0), plus C(0). */
function deepDatedPath(): ReturnType<typeof parseNewick> {
  const p = parseNewick('(((A:40,B:40)Y:40)Z:20,C:100)R;');
  for (const [label, age] of [['R', 100], ['Z', 80], ['Y', 40], ['A', 0], ['B', 0], ['C', 0]] as const) {
    nodeByLabel(p, label).age = age;
  }
  return p;
}

const rerootModes = [
  { name: 'direct-node', reroot: (p: ReturnType<typeof parseNewick>, id: string) => rerootAtNode(p, id) },
  { name: 'branch-midpoint', reroot: (p: ReturnType<typeof parseNewick>, id: string) => rerootOnBranch(p, id, 0.5) },
] as const;

const prototypePollutionKey = 'cladeForgePrototypePollution';

afterEach(() => {
  Reflect.deleteProperty(Object.prototype, prototypePollutionKey);
});

/** Both reroot modes suppress R and merge its evidence into C. */
function formerRootEvidenceTree(): ReturnType<typeof parseNewick> {
  const p = parseNewick('((A,B)X,C)R;');
  const r = nodeByLabel(p, 'R');
  const x = nodeByLabel(p, 'X');
  const c = nodeByLabel(p, 'C');
  r.age = 100;
  x.age = 100;
  c.age = 20;
  nodeByLabel(p, 'A').age = 0;
  nodeByLabel(p, 'B').age = 0;
  r.annotations = { shared: 'root', rootOnly: 'R-evidence' };
  c.annotations = { shared: 'survivor', survivorOnly: 7 };
  r.meta = {
    rootOnly: { specimen: 'R' },
    shared: { winner: 'root', rootNested: true },
    nested: { root: true },
  };
  c.meta = {
    survivorOnly: { specimen: 'C' },
    shared: { winner: 'survivor', survivorNested: true },
    nested: { survivor: true },
  };
  r.ageMin = 95;
  r.ageMax = 105;
  r.ageSource = 'fossil';
  r.ageCitation = 'root-doi';
  c.ageMin = 18;
  c.ageSource = 'manual';
  p.customEdges = [
    { id: 'ce-r-a', sourceId: r.id, targetId: nodeByLabel(p, 'A').id, label: 'R to A', kind: 'hybridization', note: 'root evidence', style: { ...DEFAULT_EDGE_STYLE, color: '#123456' } },
    { id: 'ce-x-r', sourceId: x.id, targetId: r.id, label: 'X to R', kind: 'association', note: 'incoming evidence', style: { ...DEFAULT_EDGE_STYLE, dash: 'dashed' } },
    { id: 'ce-a-b', sourceId: nodeByLabel(p, 'A').id, targetId: nodeByLabel(p, 'B').id, label: 'unrelated', style: { ...DEFAULT_EDGE_STYLE } },
  ];
  return p;
}

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
  return unknown ? undefined : total;
}

describe('review: direct-node reroot identity, distances and evidence', () => {
  it('S1: suppresses a former unifurcate root without adding a fake tip or node', () => {
    const p = parseNewick('((A:1,B:1)X:2)R:99;');
    const idsBefore = Object.keys(p.nodes).sort();
    const oldRootId = nodeByLabel(p, 'R').id;
    const target = nodeByLabel(p, 'A').id;
    const survivingTipIds = Object.values(p.nodes)
      .filter((n) => n.childrenIds.length === 0 && n.id !== target)
      .map((n) => n.id)
      .sort();
    expect(rerootAtNode(p, target)).toBe(true);
    expect(p.rootId).toBe(target);
    expect(p.nodes[target].label).toBe('A');
    const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
    expect(tips.map((n) => n.id).sort()).toEqual(survivingTipIds);
    expect(tips.map((n) => n.label).sort()).toEqual(['B']);
    expect(Object.keys(p.nodes).sort()).toEqual(idsBefore.filter((id) => id !== oldRootId));
    expect(patristic(p, 'A', 'B')).toBe(2);
  });

  it('makes the selected internal node root and conserves all patristic distances and known length', () => {
    const p = parseNewick('((A:1,B:1)X:2,C:3,D:4)R:99;');
    const target = nodeByLabel(p, 'X');
    target.annotations = { accession: 'clade-X', host: 'marine' };
    target.style = { fill: '#123456' };
    target.age = 42;
    target.ageMin = 40;
    target.ageMax = 45;
    target.charStates = { c1: 's0' };
    target.hypothesisNote = 'selected clade';
    p.events = [{ id: 'evN', typeId: 'key-innovation', target: 'node', nodeId: target.id, triggers: [] }];
    p.calibrationPoints = [{ id: 'cpX', nodeId: target.id, minAge: 40, maxAge: 45 }];
    const idsBefore = Object.keys(p.nodes).sort();
    const tipsBefore = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.id).sort();
    const distancesBefore = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
      .map(([a, b]) => [a, b, patristic(p, a, b)] as const);

    expect(rerootAtNode(p, target.id)).toBe(true);
    expect(p.rootId).toBe(target.id);
    expect(p.nodes[target.id].parentId).toBeNull();
    expect(p.nodes[target.id].branchLength).toBeUndefined();
    expect(p.nodes[target.id].label).toBe('X');
    expect(p.nodes[target.id].annotations).toEqual({ accession: 'clade-X', host: 'marine' });
    expect(p.nodes[target.id].style).toEqual({ fill: '#123456' });
    expect(p.nodes[target.id].age).toBe(42);
    expect(p.nodes[target.id].ageMin).toBe(40);
    expect(p.nodes[target.id].ageMax).toBe(45);
    expect(p.nodes[target.id].charStates).toEqual({ c1: 's0' });
    expect(p.nodes[target.id].hypothesisNote).toBe('selected clade');
    expect(p.events[0].nodeId).toBe(target.id);
    expect(p.calibrationPoints[0].nodeId).toBe(target.id);
    expect(Object.keys(p.nodes).sort()).toEqual(idsBefore);
    expect(Object.values(p.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.id).sort()).toEqual(tipsBefore);
    for (const [a, b, expected] of distancesBefore) expect(patristic(p, a, b)).toBeCloseTo(expected as number, 10);
    const total = Object.values(p.nodes).reduce((sum, n) => sum + (n.parentId ? (n.branchLength ?? 0) : 0), 0);
    expect(total).toBe(11);
  });

  it('S2: selected and reversed-edge support, styles and branch events retain their physical edges', () => {
    const p = parseNewick('((A:1,B:1)X:2,C:3,D:4)R:99;');
    const a = nodeByLabel(p, 'A');
    const x = nodeByLabel(p, 'X');
    a.support = 95;
    a.supportKind = 'bootstrap';
    a.supportScale = 'percent';
    a.branchStyle = { color: '#ff0000' };
    x.support = 88;
    x.supportKind = 'posterior';
    x.supportScale = 'fraction';
    x.branchStyle = { dash: 'dashed' };
    p.events = [
      { id: 'evA', typeId: 'key-innovation', target: 'branch', nodeId: a.id, triggers: [] },
      { id: 'evX', typeId: 'speciation', target: 'branch', nodeId: x.id, triggers: [] },
    ];
    expect(rerootAtNode(p, a.id)).toBe(true);
    expect(p.rootId).toBe(a.id);
    expect(p.nodes[a.id].support).toBeUndefined();
    expect(p.nodes[a.id].branchStyle).toBeUndefined();
    const xAfter = nodeByLabel(p, 'X');
    const r = nodeByLabel(p, 'R');
    expect(xAfter).toMatchObject({ support: 95, supportKind: 'bootstrap', supportScale: 'percent' });
    expect(xAfter.branchStyle?.color).toBe('#ff0000');
    expect(r).toMatchObject({ support: 88, supportKind: 'posterior', supportScale: 'fraction' });
    expect(r.branchStyle?.dash).toBe('dashed');
    expect(p.events.find((e) => e.id === 'evA')?.nodeId).toBe(xAfter.id);
    expect(p.events.find((e) => e.id === 'evX')?.nodeId).toBe(r.id);
    expect(patristic(p, 'A', 'D')).toBe(7);
  });

  it('S2: edge riders survive when suppressing the old root merges that edge into C', () => {
    const p = parseNewick('((A:1,B:1)X:2,C:3)R;');
    const a = nodeByLabel(p, 'A');
    const x = nodeByLabel(p, 'X');
    a.support = 95;
    a.branchStyle = { color: '#ff0000' };
    x.support = 88;
    x.branchStyle = { dash: 'dashed' };
    p.events = [
      { id: 'evA', typeId: 'key-innovation', target: 'branch', nodeId: a.id, triggers: [] },
      { id: 'evX', typeId: 'speciation', target: 'branch', nodeId: x.id, triggers: [] },
    ];
    expect(rerootAtNode(p, a.id)).toBe(true);
    const xAfter = nodeByLabel(p, 'X');
    const c = nodeByLabel(p, 'C');
    expect(xAfter).toMatchObject({ support: 95, branchLength: 1 });
    expect(xAfter.branchStyle?.color).toBe('#ff0000');
    expect(c).toMatchObject({ support: 88, branchLength: 5 });
    expect(c.branchStyle?.dash).toBe('dashed');
    expect(p.events.find((e) => e.id === 'evA')?.nodeId).toBe(xAfter.id);
    expect(p.events.find((e) => e.id === 'evX')?.nodeId).toBe(c.id);
  });

  it('M1: an unknown segment stays unknown through direct reroot suppression', () => {
    const p = parseNewick('((A:1,B:1)X,C:2)R;');
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    expect(nodeByLabel(p, 'C').branchLength).toBeUndefined();
    expect(patristic(p, 'A', 'C')).toBeUndefined();
    expect(patristic(p, 'A', 'B')).toBe(2);
  });

  it('M26: a former-root calibration follows the selected root, never a tip', () => {
    const p = parseNewick('((A:1,B:1)X:1,C:1)R;');
    const oldRoot = nodeByLabel(p, 'R').id;
    p.events = [{ id: 'evR', typeId: 'key-innovation', target: 'node', nodeId: oldRoot, triggers: [] }];
    p.calibrationPoints = [{ id: 'cp1', nodeId: oldRoot, minAge: 90, maxAge: 110 }];
    expect(rerootAtNode(p, nodeByLabel(p, 'A').id)).toBe(true);
    expect(p.calibrationPoints[0].nodeId).toBe(p.rootId);
    expect(p.events[0].nodeId).toBe(nodeByLabel(p, 'C').id);
    expect(p.calibrationPoints[0].nodeId).not.toBe(nodeByLabel(p, 'C').id);
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

describe('review: reroot time-ordering preflight (Critical 2)', () => {
  it('direct rooting rejects a finite-age ancestor becoming younger than its descendant without partial mutation', () => {
    const p = deepDatedPath();
    const before = structuredClone(p);
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootAtNode(p, nodeByLabel(p, 'Y').id)).toBe(false);
    expect(p).toEqual(before);
  });

  it('branch rooting rejects the inverted dated path without creating a root or rewiring evidence', () => {
    const p = deepDatedPath();
    const event = { id: 'ev-y', typeId: 'speciation', target: 'branch' as const, nodeId: nodeByLabel(p, 'Y').id, triggers: [] };
    p.events = [event];
    const withEvent = structuredClone(p);
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootOnBranch(p, nodeByLabel(p, 'Y').id, 0.5)).toBe(false);
    expect(p).toEqual(withEvent);
    expect(p.events[0].nodeId).toBe(nodeByLabel(p, 'Y').id);
  });

  it('direct rooting rejects when the former root calibration would move outside the selected root age', () => {
    const p = deepDatedPath();
    const root = nodeByLabel(p, 'R');
    p.calibrationPoints = [{ id: 'cp-root', nodeId: root.id, minAge: 95, maxAge: 105 }];
    const before = structuredClone(p);
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootAtNode(p, nodeByLabel(p, 'Y').id)).toBe(false);
    expect(p).toEqual(before);
  });

  it('branch rooting rejects when the former root calibration would move outside the interpolated root age', () => {
    const p = deepDatedPath();
    const root = nodeByLabel(p, 'R');
    p.calibrationPoints = [{ id: 'cp-root', nodeId: root.id, minAge: 95, maxAge: 105 }];
    const before = structuredClone(p);
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootOnBranch(p, nodeByLabel(p, 'Y').id, 0.5)).toBe(false);
    expect(p).toEqual(before);
  });

  it('still direct-roots a deep dated path when every surviving parent is at least as old as its child', () => {
    const p = deepDatedPath();
    for (const n of Object.values(p.nodes)) delete n.branchLength;
    nodeByLabel(p, 'R').age = 80;
    nodeByLabel(p, 'Z').age = 80;
    nodeByLabel(p, 'Y').age = 80;
    const target = nodeByLabel(p, 'Y').id;
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootAtNode(p, target)).toBe(true);
    expect(p.rootId).toBe(target);
    expect(p.nodes[target].age).toBe(80);
    expect(p.nodes[nodeByLabel(p, 'Z').id].age).toBe(80);
    expect(validateTimeData(p)).toEqual([]);
  });

  it('still branch-roots a deep dated path when the interpolated root preserves time ordering', () => {
    const p = deepDatedPath();
    for (const n of Object.values(p.nodes)) delete n.branchLength;
    nodeByLabel(p, 'R').age = 80;
    const target = nodeByLabel(p, 'Z').id;
    expect(validateTimeData(p)).toEqual([]);

    expect(rerootOnBranch(p, target, 0.5)).toBe(true);
    expect(p.rootId).not.toBe(target);
    expect(p.nodes[p.rootId].age).toBe(80);
    expect(p.nodes[target].parentId).toBe(p.rootId);
    expect(p.nodes[target].age).toBe(80);
    expect(validateTimeData(p)).toEqual([]);
  });
});

describe('review: former-root evidence suppression (Important 4)', () => {
  it.each(rerootModes)('$name reroot merges annotations and nested meta with survivor-winning conflicts', ({ reroot }) => {
    const p = formerRootEvidenceTree();
    const r = nodeByLabel(p, 'R').id;
    const c = nodeByLabel(p, 'C').id;
    expect(validateTimeData(p)).toEqual([]);

    expect(reroot(p, nodeByLabel(p, 'X').id)).toBe(true);
    expect(p.nodes[r]).toBeUndefined();
    expect(p.nodes[c].annotations).toEqual({ shared: 'survivor', survivorOnly: 7, rootOnly: 'R-evidence' });
    expect(p.nodes[c].meta).toEqual({
      survivorOnly: { specimen: 'C' },
      rootOnly: { specimen: 'R' },
      shared: { winner: 'survivor', survivorNested: true, rootNested: true },
      nested: { survivor: true, root: true },
    });
  });

  it.each(rerootModes)('$name reroot routes former-root age evidence to the new root while new-root values win', ({ reroot }) => {
    const p = formerRootEvidenceTree();
    const x = nodeByLabel(p, 'X').id;
    const c = nodeByLabel(p, 'C').id;
    expect(reroot(p, x)).toBe(true);

    expect(p.rootId).not.toBe(c);
    expect(p.nodes[p.rootId]).toMatchObject({
      age: 100,
      ageMax: 105,
      ageSource: 'fossil',
      ageCitation: 'root-doi',
    });
    expect(p.nodes[c]).toMatchObject({
      age: 20,
      ageMin: 18,
      ageSource: 'manual',
    });
    expect(p.nodes[c].ageMax).toBeUndefined();
    expect(p.nodes[c].ageCitation).toBeUndefined();
    expect(validateTimeData(p)).toEqual([]);
  });

  it.each(rerootModes)('$name reroot fills missing new-root age evidence without transferring it to the survivor', ({ reroot }) => {
    const p = formerRootEvidenceTree();
    const x = nodeByLabel(p, 'X');
    const c = nodeByLabel(p, 'C');
    delete x.age;
    delete x.ageMin;
    delete x.ageMax;
    delete x.ageSource;
    delete x.ageCitation;
    delete nodeByLabel(p, 'A').age;
    delete nodeByLabel(p, 'B').age;

    expect(reroot(p, x.id)).toBe(true);
    expect(p.rootId).not.toBe(c.id);
    expect(p.nodes[p.rootId]).toMatchObject({
      age: 100,
      ageMin: 95,
      ageMax: 105,
      ageSource: 'fossil',
      ageCitation: 'root-doi',
    });
    expect(p.nodes[c.id]).toMatchObject({
      age: 20,
      ageMin: 18,
      ageSource: 'manual',
    });
    expect(p.nodes[c.id].ageMax).toBeUndefined();
    expect(p.nodes[c.id].ageCitation).toBeUndefined();
    expect(validateTimeData(p)).toEqual([]);
  });

  it.each(rerootModes)('$name reroot remaps every incident custom edge before deleting the former root', ({ reroot }) => {
    const p = formerRootEvidenceTree();
    const r = nodeByLabel(p, 'R').id;
    const x = nodeByLabel(p, 'X').id;
    const a = nodeByLabel(p, 'A').id;
    const b = nodeByLabel(p, 'B').id;
    const c = nodeByLabel(p, 'C').id;

    expect(reroot(p, x)).toBe(true);
    expect(p.nodes[r]).toBeUndefined();
    expect(p.customEdges.map((e) => [e.id, e.sourceId, e.targetId])).toEqual([
      ['ce-r-a', c, a],
      ['ce-x-r', x, c],
      ['ce-a-b', a, b],
    ]);
    expect(p.customEdges[0]).toMatchObject({ label: 'R to A', kind: 'hybridization', note: 'root evidence' });
    expect(p.customEdges[1]).toMatchObject({ label: 'X to R', kind: 'association', note: 'incoming evidence' });
  });
});

describe('review: Important 1 — safe merging of imported evidence', () => {
  function importedEvidence(): Record<string, unknown> {
    return JSON.parse(`{
      "safe": { "root": true },
      "nested": { "root": true },
      "__proto__": { "${prototypePollutionKey}": "polluted" },
      "constructor": { "prototype": { "${prototypePollutionKey}": "polluted" } },
      "prototype": { "${prototypePollutionKey}": "polluted" }
    }`);
  }

  function evidenceTree(): ReturnType<typeof parseNewick> {
    const p = parseNewick('((A,B)X,C)R;');
    nodeByLabel(p, 'R').meta = importedEvidence();
    nodeByLabel(p, 'C').meta = { nested: { survivor: true } };
    return p;
  }

  function expectSafeMerge(p: ReturnType<typeof parseNewick>, survivorId: string): void {
    expect(Object.hasOwn(Object.prototype, prototypePollutionKey)).toBe(false);
    const meta = p.nodes[survivorId].meta!;
    expect(meta).toEqual({ safe: { root: true }, nested: { survivor: true, root: true } });
    for (const record of [meta, meta.nested as Record<string, unknown>]) {
      expect(Object.hasOwn(record, '__proto__')).toBe(false);
      expect(Object.hasOwn(record, 'constructor')).toBe(false);
      expect(Object.hasOwn(record, 'prototype')).toBe(false);
    }
  }

  it.each(rerootModes)('$name direct mutation skips prototype keys from JSON evidence', ({ reroot }) => {
    const p = evidenceTree();
    const survivorId = nodeByLabel(p, 'C').id;
    expect(Object.hasOwn(Object.prototype, prototypePollutionKey)).toBe(false);

    expect(reroot(p, nodeByLabel(p, 'X').id)).toBe(true);
    expectSafeMerge(p, survivorId);
  });

  it.each(rerootModes)('$name Immer reroot skips prototype keys from JSON evidence', ({ reroot }) => {
    const original = evidenceTree();
    const survivorId = nodeByLabel(original, 'C').id;
    let ok = false;
    const p = produce(original, (draft) => {
      ok = reroot(draft, nodeByLabel(draft, 'X').id);
    });

    expect(ok).toBe(true);
    expect(Object.hasOwn(Object.prototype, prototypePollutionKey)).toBe(false);
    expectSafeMerge(p, survivorId);
    expect(original.nodes[nodeByLabel(original, 'R').id]).toBeDefined();
  });
});

describe('review: Important 3 — former-root age evidence belongs to the new root', () => {
  it.each(rerootModes)('$name keeps an undated surviving tip undated and preserves direct/midpoint length semantics', ({ reroot, name }) => {
    const p = parseNewick('((A:80,B:80)X:20,C:20)R;');
    const oldRoot = nodeByLabel(p, 'R');
    const x = nodeByLabel(p, 'X');
    const c = nodeByLabel(p, 'C');
    oldRoot.age = 100;
    oldRoot.ageMin = 95;
    oldRoot.ageMax = 105;
    oldRoot.ageSource = 'fossil';
    oldRoot.ageCitation = 'root-doi';
    x.age = 80;
    x.ageMin = 75;
    nodeByLabel(p, 'A').age = 0;
    nodeByLabel(p, 'B').age = 0;
    p.calibrationPoints = [{ id: 'cp-root', nodeId: oldRoot.id, minAge: 75, maxAge: 105 }];
    expect(validateTimeData(p)).toEqual([]);

    expect(reroot(p, x.id)).toBe(true);
    expect(p.nodes[oldRoot.id]).toBeUndefined();
    expect(p.calibrationPoints[0].nodeId).toBe(p.rootId);
    expect(p.nodes[p.rootId]).toMatchObject({
      age: name === 'direct-node' ? 80 : 90,
      ageMin: name === 'direct-node' ? 75 : 95,
      ageMax: 105,
      ageSource: 'fossil',
      ageCitation: 'root-doi',
    });
    expect(p.nodes[c.id].age).toBeUndefined();
    expect(p.nodes[c.id].ageMin).toBeUndefined();
    expect(p.nodes[c.id].ageMax).toBeUndefined();
    expect(p.nodes[c.id].ageSource).toBeUndefined();
    expect(p.nodes[c.id].ageCitation).toBeUndefined();
    if (name === 'direct-node') {
      expect(p.rootId).toBe(x.id);
      expect(p.nodes[x.id].branchLength).toBeUndefined();
      expect(p.nodes[c.id].branchLength).toBe(40);
    } else {
      expect(p.rootId).not.toBe(x.id);
      expect(p.nodes[x.id].branchLength).toBe(10);
      expect(p.nodes[c.id].branchLength).toBe(30);
    }
    expect(validateTimeData(p)).toEqual([]);
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

describe('calibration mutation boundary (CF-B-004)', () => {
  it('refuses to add a reversed 60–55 Ma interval', () => {
    const p = createEmptyProject();
    addCalibrationPoint(p, { id: 'cp', nodeId: p.rootId, minAge: 60, maxAge: 55 });
    expect(p.calibrationPoints).toEqual([]);
  });

  it('keeps an existing 50–55 Ma interval unchanged when Min is edited to 60', () => {
    const p = createEmptyProject();
    p.calibrationPoints = [{ id: 'cp', nodeId: p.rootId, minAge: 50, maxAge: 55 }];
    updateCalibrationPoint(p, 'cp', { minAge: 60 });
    expect(p.calibrationPoints[0]).toMatchObject({ minAge: 50, maxAge: 55 });
  });

  it('keeps a node-bound interval unchanged when setCalibrationForNode reverses it', () => {
    const p = createEmptyProject();
    p.calibrationPoints = [{ id: 'cp', nodeId: p.rootId, minAge: 50, maxAge: 55 }];
    setCalibrationForNode(p, p.rootId, 60, 55);
    expect(p.calibrationPoints[0]).toMatchObject({ minAge: 50, maxAge: 55 });
  });

  it('still accepts equal bounds and a valid replacement', () => {
    const p = createEmptyProject();
    setCalibrationForNode(p, p.rootId, 55, 55);
    expect(p.calibrationPoints[0]).toMatchObject({ minAge: 55, maxAge: 55 });
    setCalibrationForNode(p, p.rootId, 40, 60);
    expect(p.calibrationPoints[0]).toMatchObject({ minAge: 40, maxAge: 60 });
  });
});

describe('review: tree helpers used above', () => {
  it('createEmptyProject sanity', () => {
    const p = createEmptyProject('t');
    expect(p.nodes[p.rootId]).toBeTruthy();
  });
});
