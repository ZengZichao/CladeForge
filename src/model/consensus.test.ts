import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren, renameNode } from './treeOps';
import { parseNewick } from '../io/newick';
import {
  buildConsensusTree,
  checkConsensusInputs,
  cladeSetsOf,
  cladeSupports,
  type ConsensusMethod,
} from './consensus';
import type { NodeId, Project } from './types';

/** A clade spec is either a tip label or a list of child specs. */
type Spec = string | Spec[];

/** Attach `spec` as a new child of `parentId` ((A,(B,C)) ≡ ['A', ['B','C']]). */
function grow(p: Project, parentId: NodeId, spec: Spec): NodeId {
  if (typeof spec === 'string') {
    const [id] = addChildren(p, parentId, 1);
    renameNode(p, id, spec);
    return id;
  }
  const [id] = addChildren(p, parentId, 1);
  for (const s of spec) grow(p, id, s);
  return id;
}

function tree(name: string, spec: Spec[]): Project {
  const p = createEmptyProject(name);
  for (const s of spec) grow(p, p.rootId, s);
  return p;
}

/** Clades of a project as sorted 'A+B' strings — order-independent comparison. */
function cladeStrings(p: Project): Set<string> {
  return new Set(cladeSetsOf(p).clades.map((c) => [...c].sort().join('+')));
}

/** Deterministic LCG so every randomised property test is replayable. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Random rooted binary tree over `labels` (random nested partitions). */
function randomTree(labels: string[], rnd: () => number): Project {
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const build = (set: string[]): Spec => {
    if (set.length === 1) return set[0];
    const mixed = shuffle(set);
    const cut = 1 + Math.floor(rnd() * (mixed.length - 1));
    return [build(mixed.slice(0, cut)), build(mixed.slice(cut))];
  };
  const spec = build(shuffle(labels));
  return tree('random', Array.isArray(spec) ? spec : [spec]);
}

describe('consensus — input validation', () => {
  it('rejects trees that do not share the same tip set, with a readable reason', () => {
    const a = tree('t1', [['A', 'B'], 'C']);
    const b = tree('t2', [['A', 'B'], 'D']);
    const issues: string[][] = [];
    expect(buildConsensusTree([a, b], 'strict', 'x', (i) => issues.push(i))).toBeNull();
    expect(issues[0].join(' ')).toMatch(/尖端集|tip set/);
  });

  it('rejects duplicate and unnamed tips instead of silently collapsing to a star', () => {
    const dup = tree('t', [['A', 'A'], 'B']);
    expect(checkConsensusInputs([dup]).ok).toBe(false);

    const p = createEmptyProject('unnamed');
    addChildren(p, p.rootId, 3); // three tips with empty labels
    expect(checkConsensusInputs([p]).ok).toBe(false);
    expect(buildConsensusTree([p], 'strict')).toBeNull();
  });

  it('accepts identical tip sets in any order', () => {
    const a = tree('t1', [['A', 'B'], ['C', 'D']]);
    const b = tree('t2', [['C', 'D'], ['B', 'A']]);
    expect(checkConsensusInputs([a, b]).ok).toBe(true);
  });
});

describe('consensus — rooted-clade correctness', () => {
  it("a single tree's strict consensus reproduces that tree (no lost clades)", () => {
    // ((A,(B,C)),D): re-assembling clade keys without their nesting would yield
    // (A,D,(B,C)), losing the A+B+C grouping.
    const t = tree('t', [[['A', ['B', 'C']]], 'D']);
    const c = buildConsensusTree([t], 'strict')!;
    expect(c).not.toBeNull();
    expect(cladeStrings(c)).toEqual(cladeStrings(t));
    expect(cladeStrings(c)).toEqual(new Set(['A+B+C', 'B+C']));
  });

  it('a single tree in a 5-tip asymmetric shape round-trips too', () => {
    // (A,B,(C,(D,E))) — (A,B) is NOT a clade of the input and must never appear
    // in the consensus.
    const t = tree('t', ['A', 'B', ['C', ['D', 'E']]]);
    const c = buildConsensusTree([t], 'majority')!;
    expect(cladeStrings(c)).toEqual(new Set(['C+D+E', 'D+E']));
    expect(cladeStrings(c).has('A+B')).toBe(false);
  });

  it('three identical trees give a 100%-supported copy of the input', () => {
    const trees = [1, 2, 3].map(() => tree('t', [['A', ['B', 'C']], 'D']));
    const c = buildConsensusTree(trees, 'majority')!;
    expect(cladeStrings(c)).toEqual(new Set(['A+B+C', 'B+C']));
    for (const n of Object.values(c.nodes)) {
      if (n.childrenIds.length > 0 && n.id !== c.rootId) expect(n.support).toBe(100);
    }
  });

  it('never invents a clade absent from every input tree (property)', () => {
    const rnd = lcg(20260919);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (let trial = 0; trial < 40; trial += 1) {
      const trees = Array.from({ length: 2 + Math.floor(rnd() * 5) }, () =>
        randomTree(labels, rnd),
      );
      const union = new Set<string>();
      for (const t of trees) for (const c of cladeStrings(t)) union.add(c);
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        const cons = buildConsensusTree(trees, method)!;
        const produced = cladeStrings(cons);
        for (const c of produced) {
          expect(union.has(c)).toBe(true); // no phantom branches
        }
        // And no tip is lost or invented.
        expect(cladeSetsOf(cons).tips.slice().sort()).toEqual(labels.slice().sort());
      }
    }
  });

  it('single-tree consensus is idempotent for random trees (property)', () => {
    const rnd = lcg(4242);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (let trial = 0; trial < 25; trial += 1) {
      const t = randomTree(labels, rnd);
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        expect(cladeStrings(buildConsensusTree([t], method)!)).toEqual(cladeStrings(t));
      }
    }
  });

  it('support is monotone: strict clades ⊆ majority clades (property)', () => {
    const rnd = lcg(77);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (let trial = 0; trial < 25; trial += 1) {
      const trees = Array.from({ length: 3 + Math.floor(rnd() * 4) }, () =>
        randomTree(labels, rnd),
      );
      const strict = cladeStrings(buildConsensusTree(trees, 'strict')!);
      const majority = cladeStrings(buildConsensusTree(trees, 'majority')!);
      for (const c of strict) expect(majority.has(c)).toBe(true);

      // Support percentages must equal the observed clade frequencies.
      const tips = cladeSetsOf(trees[0]).tips;
      for (const rec of cladeSupports(trees, tips)) {
        const observed = trees.filter((t) => cladeStrings(t).has([...rec.tips].sort().join('+')));
        expect(rec.count).toBe(observed.length);
        expect(rec.support).toBe(Math.round((100 * observed.length) / trees.length));
      }
    }
  });
});

describe('consensus — robustness', () => {
  it('handles a 1000-deep caterpillar without overflowing the stack', () => {
    const p = createEmptyProject('deep');
    let cur = p.rootId;
    for (let i = 0; i < 1000; i += 1) {
      const [tip, next] = addChildren(p, cur, 2);
      renameNode(p, tip, `T${i}`);
      cur = next;
    }
    renameNode(p, cur, 'T1000');
    const cons = buildConsensusTree([p], 'strict')!;
    expect(cladeStrings(cons).size).toBe(cladeStrings(p).size);
    expect(cladeSetsOf(cons).tips.length).toBe(1001);
  });

  it('ignores cyclic child references instead of looping forever', () => {
    const p = tree('t', [['A', 'B'], 'C']);
    const [a] = p.nodes[p.rootId].childrenIds;
    const tipA = p.nodes[a].childrenIds[0];
    p.nodes[tipA].childrenIds.push(p.rootId); // tip points back at the root
    p.nodes[p.rootId].parentId = tipA;
    expect(() => cladeSetsOf(p)).not.toThrow();
  });
});

// ── a stem (single-child) node is not a clade ──
describe('unary nodes do not fabricate incompatible clades', () => {
  it('emits no singleton clade for a one-child internal node', () => {
    // (D)X is a stem lineage: its "clade" is the single tip D, which groups
    // nothing and cannot be placed by buildTreeFromClades.
    const { clades } = cladeSetsOf(parseNewick('((A,B),(C,(D)X)Y);'));
    expect(clades.some((c) => c.length === 1)).toBe(false);
  });

  it('does not warn about incompatibility on a tree with no conflict', () => {
    const r = buildConsensusTree([parseNewick('((A,B),(C,(D)X)Y);')], 'strict');
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/互不相容|incompatible/);
  });
});
