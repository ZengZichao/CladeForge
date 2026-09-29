import { describe, it, expect } from 'vitest';
import { hierarchy } from 'd3-hierarchy';
import {
  BLOMBERG_MAX_TIPS,
  benjaminiHochberg,
  blombergK,
  blombergKBlockReason,
  ciRiApplies,
  discreteSignal,
  holmAdjustFamily,
  holmBonferroni,
  treeSummary,
} from './stats';
import { createEmptyProject } from './sampleTree';
import { parsimony } from './parsimony';
import { reconstructMk } from './asr';
import { parseNewick } from '../io/newick';
import { computeLayout } from '../layout/autoLayout';
import type { Character, Project, TreeNode } from './types';

/** Deterministic LCG so the statistical test is stable across runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Balanced 8-tip tree with positive branch lengths (heights differ per tip). */
function buildTree(project: Project): Record<string, string> {
  //          r
  //        /   \
  //      n1     n2
  //     /  \   /  \
  //   n3   n4 n5   n6
  //   /|   |  |   |\
  //  a b   c d  e f  g h  (a,b under n3; c,d under n4; e,f under n5; g,h under n6)
  const mk = (label: string, parentId: string, branchLength: number): string => {
    const id = `n_${label}`;
    const node: TreeNode = { id, label, parentId, childrenIds: [], branchLength };
    project.nodes[id] = node;
    project.nodes[parentId].childrenIds.push(id);
    return id;
  };
  const r = project.rootId;
  project.nodes[r].label = 'root';
  const n1 = mk('n1', r, 1.0);
  const n2 = mk('n2', r, 0.6);
  const n3 = mk('n3', n1, 0.5);
  const n4 = mk('n4', n1, 0.3);
  const n5 = mk('n5', n2, 0.7);
  const n6 = mk('n6', n2, 0.4);
  mk('a', n3, 0.4);
  mk('b', n3, 0.2);
  mk('c', n4, 0.5);
  mk('d', n4, 0.2);
  mk('e', n5, 0.3);
  mk('f', n5, 0.4);
  mk('g', n6, 0.1);
  mk('h', n6, 0.3);
  return { n1, n2 };
}

describe('blombergK', () => {
  const project = createEmptyProject();
  buildTree(project);
  const character: Character = {
    id: 'ch1',
    name: 'size',
    type: 'continuous',
    states: [],
  };
  project.characters = [character];

  const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const tipOf = (label: string) =>
    Object.values(project.nodes).find((n) => n.label === label)!.id;

  it('returns a value that depends on the trait data (not the tree alone)', () => {
    const rnd = lcg(7);
    for (const l of labels) {
      project.nodes[tipOf(l)].charStates = { ch1: rnd() };
    }
    const first = blombergK(project, character)!;
    expect(first).not.toBeNull();
    expect(first.n).toBe(8);

    // A constant trait carries no signal — K degenerates toward 0 (guard: finite).
    for (const l of labels) {
      project.nodes[tipOf(l)].charStates = { ch1: 2 };
    }
    const flat = blombergK(project, character)!;
    expect(flat.k).toBeCloseTo(0, 10);

    // Different random draw → different K: the value has to track the trait data,
    // not the tree alone.
    const rnd2 = lcg(99);
    for (const l of labels) {
      project.nodes[tipOf(l)].charStates = { ch1: rnd2() };
    }
    const second = blombergK(project, character)!;
    expect(second.k).not.toBeCloseTo(first.k, 3);
  });

  it('stays within a sane range for Brownian-like data', () => {
    const rnd = lcg(1234);
    // Phylogenetic-signal-bearing data: value correlated with depth.
    for (const l of labels) {
      const node = project.nodes[tipOf(l)];
      node.charStates = { ch1: node.branchLength! * 2 + rnd() * 0.1 };
    }
    const result = blombergK(project, character)!;
    expect(Number.isFinite(result.k)).toBe(true);
    expect(result.k).toBeGreaterThanOrEqual(0);
    expect(result.k).toBeLessThan(50);
  });

  it('returns null for fewer than three scored tips or a singular tree', () => {
    const p2 = createEmptyProject();
    const mk = (label: string, parentId: string, bl: number) => {
      const id = `x_${label}`;
      p2.nodes[id] = { id, label, parentId, childrenIds: [], branchLength: bl };
      p2.nodes[parentId].childrenIds.push(id);
      return id;
    };
    mk('t1', p2.rootId, 1);
    mk('t2', p2.rootId, 1);
    for (const l of ['t1', 't2']) {
      p2.nodes[`x_${l}`].charStates = { ch1: 1.5 };
    }
    expect(blombergK(p2, character)).toBeNull();
  });

  it('returns null for non-continuous characters', () => {
    const disc: Character = { ...character, type: 'discrete', states: [] };
    expect(blombergK(project, disc)).toBeNull();
  });
});

describe('discreteSignal', () => {
  it('computes CI/RI for a discrete character', () => {
    const p = createEmptyProject();
    const r = p.rootId;
    const mk = (label: string, parentId: string) => {
      const id = `d_${label}`;
      p.nodes[id] = { id, label, parentId, childrenIds: [] };
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', r);
    const t1 = mk('t1', n1);
    const t2 = mk('t2', n1);
    const t3 = mk('t3', r);
    const ch: Character = {
      id: 'hc',
      name: 'state',
      type: 'discrete',
      states: [
        { id: 's0', label: 'zero', color: '#000' },
        { id: 's1', label: 'one', color: '#fff' },
      ],
    };
    p.characters = [ch];
    for (const [id, s] of [[t1, 's0'], [t2, 's0'], [t3, 's1']] as const) {
      p.nodes[id].charStates = { hc: s };
    }
    const sig = discreteSignal(p, ch)!;
    expect(sig.tips).toBe(3);
    // Hand-computed rather than read back from `parsimony(p, ch).cost`: comparing
    // a field with the very call that produces it could never fail.
    // t1/t2 share state s0 and t3 has s1, so one change on the branch entering
    // the (t1,t2) clade suffices → 1 step.
    expect(sig.steps).toBe(1);
    expect(sig.minSteps).toBe(1);
    expect(sig.maxSteps).toBe(1);
    expect(sig.ci).toBeCloseTo(1, 10);
    expect(Number.isFinite(sig.ri)).toBe(true);
  });

  it('excludes the missing-data codes ? and - from the state counts', () => {
    const p = createEmptyProject();
    const mk = (label: string, parentId: string) => {
      const id = `q_${label}`;
      p.nodes[id] = { id, label, parentId, childrenIds: [] };
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', p.rootId);
    const t1 = mk('t1', n1);
    const t2 = mk('t2', n1);
    const t3 = mk('t3', p.rootId);
    const t4 = mk('t4', p.rootId);
    const ch: Character = {
      id: 'hc',
      name: 'state',
      type: 'discrete',
      states: [
        { id: 's0', label: 'zero', color: '#000' },
        { id: 's1', label: 'one', color: '#fff' },
      ],
    };
    p.characters = [ch];
    p.nodes[t1].charStates = { hc: 's0' };
    p.nodes[t2].charStates = { hc: 's0' };
    p.nodes[t3].charStates = { hc: 's1' };
    p.nodes[t4].charStates = { hc: '?' }; // standard missing symbol, not a state

    const sig = discreteSignal(p, ch)!;
    // '?' is not a third observed state: counting it would give m = 3 − 1 = 2,
    // inflate CI, and compute g/s over 4 "scored" tips.
    expect(sig.observedStates).toBe(2);
    expect(sig.minSteps).toBe(1);
    expect(sig.tips).toBe(3);
    expect(sig.missingCodes).toBe(1);
    expect(sig.ci).toBeCloseTo(1, 10);
  });

  it('refuses CI/RI for a weighted character', () => {
    const p = createEmptyProject();
    const mk = (label: string, parentId: string) => {
      const id = `w_${label}`;
      p.nodes[id] = { id, label, parentId, childrenIds: [] };
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', p.rootId);
    const t1 = mk('t1', n1);
    const t2 = mk('t2', n1);
    const t3 = mk('t3', p.rootId);
    const weighted: Character = {
      id: 'wc',
      name: 'weighted',
      type: 'discrete',
      states: [
        { id: 's0', label: 'zero', color: '#000' },
        { id: 's1', label: 'one', color: '#fff' },
      ],
      costMatrix: [
        [0, 5],
        [5, 0],
      ],
    };
    p.characters = [weighted];
    p.nodes[t1].charStates = { wc: 's0' };
    p.nodes[t2].charStates = { wc: 's0' };
    p.nodes[t3].charStates = { wc: 's1' };
    expect(ciRiApplies(weighted)).toBe(false);
    expect(discreteSignal(p, weighted)).toBeNull();
    const uniform: Character = { ...weighted, costMatrix: undefined };
    expect(ciRiApplies(uniform)).toBe(true);
    expect(discreteSignal(p, uniform)).not.toBeNull();
  });
});

// --- shared deterministic cost instrumentation ----------

/**
 * Wall-clock ceilings are opt-in: `CLADEFORGE_TIMING_GATE=1` runs them, a normal
 * `npm test` (and CI) does not. They are profiling output, not a verdict — the
 * counted assertions below are what the suite gates on.
 */
const GATE_TIMINGS = process.env.CLADEFORGE_TIMING_GATE === '1';

//
// Both cost guards in this file (the "scaling guards" block and the layout-cost
// tripwire at the end) count operations instead of milliseconds: a ratio of
// sub-millisecond timings is a gate on the scheduler rather than on the code, and
// it can go red on one machine while going green on another. See the block comment
// above `describe('scaling guards …')` for what each counter means.

/**
 * A `project.nodes` stand-in that counts every property read and every
 * enumeration. A stage that walks the tree once reads each node a constant
 * number of times; a stage that re-walks it per node — the shape of an O(n²)
 * Newick scan — reads it n times. The counter therefore separates linear from
 * quadratic without a clock.
 */
function countingNodes(project: Project): { counted: Project; reads: () => number } {
  let reads = 0;
  const counted = new Proxy(project.nodes, {
    get(target, key) {
      reads += 1;
      return (target as Record<string | symbol, unknown>)[key];
    },
    ownKeys(target) {
      reads += 1;
      return Reflect.ownKeys(target);
    },
  });
  return { counted: { ...project, nodes: counted }, reads: () => reads };
}

interface NodeWork {
  /** Node lookups (and record enumerations) the stage performed. */
  visits: number;
  /** Writes to a d3 node's `height`: 1 per node for a bottom-up pass. */
  heightWrites: number;
  /** Reads of a d3 node's `parent`: 1 per step of an ancestor walk. */
  parentHops: number;
}

const NODE_PROTO = Object.getPrototypeOf(hierarchy({ probe: 1 } as unknown)) as object;

/** Count `height` writes / `parent` reads over `walk`, plus node lookups. */
function measureWork(project: Project, walk: (counted: Project) => void): NodeWork {
  const { counted, reads } = countingNodes(project);
  const counts = { heightWrites: 0, parentHops: 0 };
  const heightKey = Symbol('countedHeight');
  const parentKey = Symbol('countedParent');
  const proto = NODE_PROTO as Record<string | symbol, unknown>;
  const savedHeight = Object.getOwnPropertyDescriptor(proto, 'height');
  const savedParent = Object.getOwnPropertyDescriptor(proto, 'parent');
  Object.defineProperty(proto, 'height', {
    configurable: true,
    get(this: unknown) {
      return (this as Record<symbol, unknown>)[heightKey];
    },
    set(this: unknown, value: number) {
      counts.heightWrites += 1;
      (this as Record<symbol, unknown>)[heightKey] = value;
    },
  });
  Object.defineProperty(proto, 'parent', {
    configurable: true,
    get(this: unknown) {
      counts.parentHops += 1;
      return (this as Record<symbol, unknown>)[parentKey];
    },
    set(this: unknown, value: unknown) {
      (this as Record<symbol, unknown>)[parentKey] = value;
    },
  });
  try {
    walk(counted);
    return { visits: reads(), ...counts };
  } finally {
    delete proto.height;
    delete proto.parent;
    if (savedHeight) Object.defineProperty(proto, 'height', savedHeight);
    if (savedParent) Object.defineProperty(proto, 'parent', savedParent);
  }
}

const nodeCount = (project: Project): number => Object.keys(project.nodes).length;

describe('treeSummary — statistical scope', () => {
  const build = (lengths: (number | undefined)[]): Project => {
    const p = createEmptyProject();
    const [n1, n2] = addTwo(p, p.rootId);
    const set = (id: string, bl: number | undefined) => {
      if (bl !== undefined) p.nodes[id].branchLength = bl;
    };
    const [t1, t2] = addTwo(p, n1);
    const [t3, t4] = addTwo(p, n2);
    set(n1, lengths[0]);
    set(n2, lengths[1]);
    set(t1, lengths[2]);
    set(t2, lengths[3]);
    set(t3, lengths[4]);
    set(t4, lengths[5]);
    return p;
  };
  function addTwo(p: Project, parentId: string): [string, string] {
    const ids: string[] = [];
    for (const which of ['a', 'b'] as const) {
      const id = `n_${parentId}_${which}`;
      const node: TreeNode = { id, label: which, parentId, childrenIds: [] };
      p.nodes[id] = node;
      p.nodes[parentId].childrenIds.push(id);
      ids.push(id);
    }
    return [ids[0], ids[1]];
  }

  it('counts zero-length branches in the tree length', () => {
    const p = build([2, 0, 1, 2, 0, undefined]);
    const s = treeSummary(p);
    // 2 + 0 + 1 + 2 + 0 = 5 over the five nodes that recorded a length.
    expect(s.totalBranchLength).toBeCloseTo(5, 10);
    expect(s.branchLengthNodes).toBe(5);
    expect(s.missingBranchLengths).toBe(1);
    expect(s.avgBranchLength).toBeCloseTo(1, 10);
  });

  it('reports the unit of tree height instead of mixing two of them', () => {
    const withLengths = treeSummary(build([2, 3, 1, 2, 3, 4]));
    expect(withLengths.treeHeightUnit).toBe('branch-length');
    expect(withLengths.treeHeight).toBeCloseTo(3 + 4, 10); // longest root→tip path
    const bare = build([undefined, undefined, undefined, undefined, undefined, undefined]);
    const noLengths = treeSummary(bare);
    expect(noLengths.treeHeightUnit).toBe('edges');
    expect(noLengths.treeHeight).toBe(2);
    expect(noLengths.totalBranchLength).toBe(0);
    expect(noLengths.branchLengthNodes).toBe(0);
  });

  it('flags when the Colless index is not defined (rooted binary only)', () => {
    const binary = treeSummary(build([1, 1, 1, 1, 1, 1]));
    expect(binary.collessApplies).toBe(true);
    const p = createEmptyProject();
    addTwo(p, p.rootId);
    p.nodes[p.rootId].childrenIds.push(...addTwo(p, p.rootId)); // root ends up 4-way
    const polytomy = treeSummary(p);
    expect(polytomy.collessApplies).toBe(false);
    expect(polytomy.resolution).toBeLessThan(1);
  });

  it('survives a 5000-deep caterpillar without a stack overflow', () => {
    const p = createEmptyProject('deep');
    let cur = p.rootId;
    for (let i = 0; i < 5000; i += 1) {
      const [tip, next] = addTwo(p, cur);
      p.nodes[tip].label = `T${i}`;
      p.nodes[next].label = `N${i}`;
      cur = next;
    }
    const s = treeSummary(p);
    expect(s.tipCount).toBe(5001); // the terminal node of the chain is a tip too
    expect(s.treeHeight).toBe(5000);
    expect(s.sackinIndex).toBeGreaterThan(0);
  });
});

describe('blombergK — diagnostics', () => {
  const treeWith = (bl: number | undefined): Project => {
    const p = createEmptyProject();
    const mk = (label: string, parentId: string): string => {
      const id = `k_${label}`;
      const node: TreeNode = { id, label, parentId, childrenIds: [] };
      if (bl !== undefined) node.branchLength = bl;
      p.nodes[id] = node;
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', p.rootId);
    const n2 = mk('n2', p.rootId);
    const l1 = mk('l1', n1);
    const l2 = mk('l2', n1);
    const r1 = mk('r1', n2);
    mk('r2', n2);
    return p;
  };

  const traitOf = (p: Project, values: number[]): Character => {
    const ch: Character = { id: 'cont', name: 'size', type: 'continuous', states: [] };
    p.characters = [ch];
    const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
    tips.forEach((n, i) => {
      n.charStates = { cont: values[i] };
    });
    return ch;
  };

  it('counts the branch lengths it had to invent', () => {
    const p = treeWith(undefined);
    const ch = traitOf(p, [1, 2, 4, 8]);
    const noLengths = blombergK(p, ch)!;
    expect(noLengths.totalBranches).toBe(6);
    expect(noLengths.imputedBranches).toBe(6); // every branch is fiction here
    expect(blombergKBlockReason(p, ch)).toBeNull();

    const withLengths = treeWith(1.5);
    traitOf(withLengths, [1, 2, 4, 8]);
    const real = blombergK(withLengths, withLengths.characters[0])!;
    expect(real.imputedBranches).toBe(0);
    // K is invariant to an overall rescaling of the branch lengths.
    const scaled = treeWith(15);
    traitOf(scaled, [1, 2, 4, 8]);
    expect(blombergK(scaled, scaled.characters[0])!.k).toBeCloseTo(real.k, 10);
  });

  it('explains why it refuses to compute', () => {
    const p = treeWith(1);
    const ch: Character = { id: 'cont', name: 'size', type: 'discrete', states: [] };
    expect(blombergKBlockReason(p, ch)).toMatch(/连续|continuous/);

    const sparse = treeWith(1);
    const cont: Character = { id: 'cont', name: 'size', type: 'continuous', states: [] };
    sparse.characters = [cont];
    const tips = Object.values(sparse.nodes).filter((n) => n.childrenIds.length === 0);
    tips[0].charStates = { cont: 1 };
    tips[1].charStates = { cont: 2 };
    expect(blombergK(sparse, cont)).toBeNull();
    expect(blombergKBlockReason(sparse, cont)).toMatch(/至少需要 3|needs at least 3/);
    expect(BLOMBERG_MAX_TIPS).toBeGreaterThan(3);
  });
});

describe('treeSummary', () => {
  it('summarises tip counts and indices', () => {
    const p = createEmptyProject();
    buildTree(p);
    const s = treeSummary(p);
    expect(s.tipCount).toBe(8);
    expect(s.internalCount).toBe(7);
    expect(s.resolution).toBe(1);
    expect(s.collessIndex).toBeGreaterThanOrEqual(0);
    expect(s.totalBranchLength).toBeGreaterThan(0);
  });
});

// --- multiplicity control --------------------------------------

describe('holmBonferroni / benjaminiHochberg', () => {
  /** The family used by the character-correlation screen: many pairs, one α. */
  const family = [0.01, 0.04, 0.03, 0.001];

  it('reproduces the hand-derived Holm–Bonferroni step-down values', () => {
    // Sorted: 0.001 (×4), 0.01 (×3), 0.03 (×2), 0.04 (×1) → 0.004, 0.03, 0.06,
    // 0.06 (the running max keeps the sequence non-decreasing in rank, which is
    // what makes Holm a VALID step-down procedure — 0.04 × 1 alone would be 0.04
    // and would let a larger raw p come out smaller than a smaller one).
    const adj = holmBonferroni(family);
    expect(adj[3]).toBeCloseTo(0.004, 12);
    expect(adj[0]).toBeCloseTo(0.03, 12);
    expect(adj[2]).toBeCloseTo(0.06, 12);
    expect(adj[1]).toBeCloseTo(0.06, 12);
    // Input order is preserved, so a UI can zip raw and adjusted lists directly.
    expect(holmBonferroni([])).toEqual([]);
    expect(holmBonferroni([0.03])).toEqual([0.03]); // m = 1 → no correction
  });

  it('never reports an adjusted p below its raw p and never above 1', () => {
    const rng = lcg(0xbeef);
    for (let trial = 0; trial < 200; trial += 1) {
      const m = 2 + Math.floor(rng() * 9);
      const raw = Array.from({ length: m }, () => rng());
      for (const adjust of [holmBonferroni, benjaminiHochberg]) {
        const adj = adjust(raw);
        expect(adj).toHaveLength(m);
        adj.forEach((a, i) => {
          expect(a).toBeLessThanOrEqual(1);
          expect(a).toBeGreaterThanOrEqual(raw[i] - 1e-12);
          // Monotone in rank: a larger raw p never gets a smaller adjusted p.
          raw.forEach((b, j) => {
            if (b < raw[i] - 1e-12) expect(adj[j]).toBeLessThanOrEqual(a + 1e-12);
          });
        });
      }
    }
  });

  it('treats the Holm number as at least as conservative as Benjamini–Hochberg', () => {
    // Family-wise error control vs. false-discovery-rate control: BH must never
    // hand out a smaller adjusted p than Holm for the same family.
    const rng = lcg(0x51ed);
    for (let trial = 0; trial < 50; trial += 1) {
      const raw = Array.from({ length: 8 }, () => rng());
      const holm = holmBonferroni(raw);
      const bh = benjaminiHochberg(raw);
      bh.forEach((b, i) => expect(b).toBeLessThanOrEqual(holm[i] + 1e-12));
    }
    // Worked BH example: 0.01, 0.02, 0.03 → all collapse to 0.03.
    expect(benjaminiHochberg([0.01, 0.02, 0.03]).every((v) => Math.abs(v - 0.03) < 1e-12)).toBe(true);
  });

  it('is the difference between "one of ten pairs looks significant" and nothing', () => {
    // Ten independent pairs, the best of them at the raw 0.05 boundary: with no
    // correction the screen prints a "significant" pair, with Holm it is 0.5.
    const raw = [0.05, 0.2, 0.31, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9];
    expect(raw.filter((p) => p <= 0.05).length).toBe(1);
    expect(holmBonferroni(raw)[0]).toBeCloseTo(0.5, 12);
    expect(benjaminiHochberg(raw)[0]).toBeCloseTo(0.5, 12);
  });

  it('treats a non-finite p-value as no evidence, not as a crash', () => {
    const adj = holmBonferroni([Number.NaN, 0.01, Infinity]);
    expect(adj).toHaveLength(3);
    adj.forEach((a) => expect(Number.isFinite(a)).toBe(true));
    expect(adj[1]).toBeLessThan(0.05);
    expect(adj[0]).toBe(1);
  });

  it('holmAdjustFamily corrects the family it is handed and says what m was', () => {
    const family = [0.001, 0.01, 0.03, 0.04].map((pValue) => ({ pValue }));
    const adjusted = holmAdjustFamily(family);
    expect(adjusted).toHaveLength(4);
    // Every row carries the family size that was used, so a display can quote
    // "Holm over m = 4 tested pairs" and be held to it.
    expect(adjusted.every((a) => a.familySize === 4)).toBe(true);
    const want = holmBonferroni([0.001, 0.01, 0.03, 0.04]);
    adjusted.forEach((a, i) => {
      expect(a.adjustedP).toBeCloseTo(want[i], 12);
      expect(a.pValue).toBe(family[i].pValue); // input order preserved
    });

    // A ≥0.5 flag is not an input to the correction: attaching one, or moving a
    // row across the threshold, changes no adjusted value.
    const flagged = family.map((f, i) => ({ ...f, score: i === 0 ? 0.9 : 0.1 }));
    const reFlagged = holmAdjustFamily(flagged.map((f, i) => ({ ...f, score: i === 3 ? 0.95 : f.score })));
    reFlagged.forEach((a, i) => {
      expect(a.adjustedP).toBe(adjusted[i].adjustedP);
      expect(a.familySize).toBe(adjusted[i].familySize);
    });

    // For contrast: correcting only what the flag kept shrinks the family to 1.
    expect(holmAdjustFamily(flagged.filter((f) => f.score >= 0.5))).toEqual([
      { pValue: 0.001, score: 0.9, adjustedP: 0.001, familySize: 1 },
    ]);
    expect(adjusted[0].adjustedP).toBeCloseTo(0.004, 12); // 4 × p, not 1 × p
  });

  it('reports m of a capped family honestly, and survives an empty one', () => {
    const rows = holmAdjustFamily([{ pValue: 0.2 }, { pValue: 0.4 }]);
    expect(rows.map((r) => r.familySize)).toEqual([2, 2]);
    expect(rows[0].adjustedP).toBeCloseTo(0.4, 12);
    expect(holmAdjustFamily([])).toEqual([]);
  });
});

// --- known-value fixtures --------------------------------------
//
// A CI/RI assertion that reads a field back from the call producing it
// (`expect(sig.steps).toBe(parsimony(p, ch).cost)`, which is literally how
// `steps` is produced at stats.ts:78), or that only checks a range ("≥ 0",
// "> 0"), passes whatever the formula does. The fixtures below take their expected
// value from OUTSIDE the code under test: both blocks are computed by hand from
// the published definitions, with the arithmetic spelled out so a reader can
// re-check it without running anything.

describe('CI / RI — known values, hand-derived', () => {
  // Six tips, balanced: root → {N1, N2}; N1 → {N3, N4}; N3 = (a,b); N4 = (c,d);
  // N2 = (e,f).
  function sixTipTree(): { p: Project; tip: (l: string) => string } {
    const p = createEmptyProject();
    const mk = (label: string, parentId: string): string => {
      const id = `f_${label}`;
      p.nodes[id] = { id, label, parentId, childrenIds: [] };
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', p.rootId);
    const n2 = mk('n2', p.rootId);
    const n3 = mk('n3', n1);
    const n4 = mk('n4', n1);
    mk('a', n3);
    mk('b', n3);
    mk('c', n4);
    mk('d', n4);
    mk('e', n2);
    mk('f', n2);
    return { p, tip: (l: string) => `f_${l}` };
  }

  const binary = (): Character => ({
    id: 'hc',
    name: 'binary',
    type: 'discrete',
    states: [
      { id: 's0', label: '0', color: '#000' },
      { id: 's1', label: '1', color: '#fff' },
    ],
  });

  function score(p: Project, ch: Character, assign: Record<string, string>) {
    p.characters = [ch];
    for (const [label, s] of Object.entries(assign)) {
      p.nodes[`f_${label}`].charStates = { [ch.id]: s };
    }
    return discreteSignal(p, ch)!;
  }

  it('a clean synapomorphy scores CI = RI = 1 (Farris 1989 lower bound case)', () => {
    // Source of the reference value: Farris, J.S. (1989) "The retention index
    // and the rescaled consistency index", Cladistics 5:417–419, definitions
    //   CI = m / s   and   RI = (g − s) / (g − m)
    // with m = minimum steps for the character on the tree = (#states − 1) for
    // equally weighted changes, g = (#tips − count of the most common state),
    // s = steps actually required. Here a{0} b{0} c{0} d{0} e{1} f{1}: the
    // (e,f) clade is one unreversed change, so s = 1, m = 2 − 1 = 1,
    // g = 6 − 4 = 2 → CI = 1/1 = 1, RI = (2 − 1)/(2 − 1) = 1.
    const { p } = sixTipTree();
    const sig = score(p, binary(), { a: 's0', b: 's0', c: 's0', d: 's0', e: 's1', f: 's1' });
    expect(sig.steps).toBe(1);
    expect(sig.minSteps).toBe(1);
    expect(sig.maxSteps).toBe(2);
    expect(sig.ci).toBeCloseTo(1, 12);
    expect(sig.ri).toBeCloseTo(1, 12);
  });

  it('two independent origins of a binary state give CI = 0.5, RI = 0.5', () => {
    // Same Farris (1989) definitions, on the tree above.
    //   a{0} b{0} | c{1} d{1} | e{1} f{0}
    // Fitch, by hand: N3 = {0}∩{0} → {0}, 0 steps. N4 = {1}∩{1} → {1}, 0 steps.
    //   N1 = {0}∩{1} = ∅ → 1 step, state set {0,1}.
    //   N2 = {1}∩{0} = ∅ → 1 step, {0,1}.
    //   root = {0,1}∩{0,1} ≠ ∅ → 0 steps.
    // so s = 2, m = 2 − 1 = 1, g = 6 − 3 = 3 (state 0 on a,b,f; state 1 on c,d,e).
    //   CI = m/s = 1/2 = 0.5   and   RI = (g − s)/(g − m) = (3 − 2)/(3 − 1) = 0.5.
    const { p } = sixTipTree();
    const sig = score(p, binary(), { a: 's0', b: 's0', c: 's1', d: 's1', e: 's1', f: 's0' });
    expect(sig.steps).toBe(2);
    expect(sig.minSteps).toBe(1);
    expect(sig.maxSteps).toBe(3);
    expect(sig.ci).toBeCloseTo(0.5, 12);
    expect(sig.ri).toBeCloseTo(0.5, 12);
    // Both indices are strictly inside (0,1): neither is the degenerate
    // "everything is perfect / nothing is retained" case a range-only check could
    // not tell apart.
    expect(sig.ci).toBeGreaterThan(0);
    expect(sig.ri).toBeGreaterThan(0);
  });

  it('a three-state unordered character gives CI = 2/3 and RI = 1/2', () => {
    // Same Farris (1989) definitions, three states, on the tree above.
    //   a{0} b{0} | c{1} d{2} | e{1} f{2}
    // Fitch (1971, Syst. Zool. 20:489–496 — the minimum-steps rule an unordered
    // equally weighted character reduces to), post-order:
    //   N3 = {0}∩{0} = {0}                    → 0 steps
    //   N4 = {1}∩{2} = ∅ → {1,2}              → 1 step
    //   N1 = {0}∩{1,2} = ∅ → {0,1,2}          → 1 step
    //   N2 = {1}∩{2} = ∅ → {1,2}              → 1 step
    //   root = {0,1,2}∩{1,2} = {1,2}          → 0 steps
    // so s = 3. m = (#states − 1) = 2. Each of 0/1/2 occurs on exactly two tips,
    // so g = 6 − 2 = 4.
    //   CI = m/s = 2/3,   RI = (g − s)/(g − m) = (4 − 3)/(4 − 2) = 1/2.
    const { p } = sixTipTree();
    const ch: Character = {
      id: 'tri',
      name: 'ternary',
      type: 'discrete',
      states: [
        { id: 't0', label: '0', color: '#000' },
        { id: 't1', label: '1', color: '#888' },
        { id: 't2', label: '2', color: '#fff' },
      ],
    };
    const sig = score(p, ch, { a: 't0', b: 't0', c: 't1', d: 't2', e: 't1', f: 't2' });
    expect(sig.observedStates).toBe(3);
    expect(sig.steps).toBe(3);
    expect(sig.minSteps).toBe(2);
    expect(sig.maxSteps).toBe(4);
    expect(sig.ci).toBeCloseTo(2 / 3, 12);
    expect(sig.ri).toBeCloseTo(0.5, 12);
  });
});

describe("Blomberg's K — known value, hand-derived", () => {
  /**
   * Ultrametric 4-tip tree, every branch exactly 1:
   *        root(0)
   *        /     \
   *      n1(1)   n2(1)
   *      /  \     /  \
   *    t1(2) t2(2) t3(2) t4(2)
   *
   * so the Brownian-motion covariance matrix is
   *      C = [[2,1,0,0],
   *           [1,2,0,0],
   *           [0,0,2,1],
   *           [0,0,1,2]]        (C_ij = root→MRCA depth, C_ii = root→tip depth)
   */
  function ultrametric4(): { p: Project; ch: Character } {
    const p = createEmptyProject();
    const mk = (label: string, parentId: string): string => {
      const id = `u_${label}`;
      p.nodes[id] = { id, label, parentId, childrenIds: [], branchLength: 1 };
      p.nodes[parentId].childrenIds.push(id);
      return id;
    };
    const n1 = mk('n1', p.rootId);
    const n2 = mk('n2', p.rootId);
    mk('t1', n1);
    mk('t2', n1);
    mk('t3', n2);
    mk('t4', n2);
    const ch: Character = { id: 'cont', name: 'size', type: 'continuous', states: [] };
    p.characters = [ch];
    return { p, ch };
  }

  it('K = 63/55 for trait values (1, 2, 3, 5)', () => {
    // Source of the reference value: Blomberg, Garland & Ives (2003) J. Theor.
    // Biol. 223:399–408, eq. for K as implemented by phytools::phylosig
    // (Revell 2012, Methods Ecol. Evol. 3:217–221), i.e. exactly the formula
    // documented at stats.ts:339–341:
    //   â    = (1ᵀC⁻¹x) / (1ᵀC⁻¹1)
    //   σ̂²   = (x − â1)ᵀC⁻¹(x − â1) / (n − 1)
    //   K    = Σ(xᵢ − â)² / [ σ̂² · (tr(C) − n/(1ᵀC⁻¹1)) ]
    // worked out for this tree by hand:
    //   each 2×2 block inverts to (1/3)[[2,−1],[−1,2]], so
    //   1ᵀC⁻¹ = [1/3,1/3,1/3,1/3] ⇒ 1ᵀC⁻¹1 = 4/3 and â = (Σx/3)/(4/3) = Σx/4,
    //   i.e. the phylogenetic mean is the ordinary mean (the tree is
    //   ultrametric and symmetric), = 11/4 for x = (1,2,3,5).
    //   deviations d = (−7/4, −3/4, 1/4, 9/4) ⇒ Σd² = 140/16 = 35/4.
    //   dᵀC⁻¹d = (2/3)(d1²−d1d2+d2²) + (2/3)(d3²−d3d4+d4²)
    //          = (2/3)(37/16) + (2/3)(73/16) = 110/24 = 55/12
    //   ⇒ σ̂² = (55/12)/3 = 55/36.
    //   tr(C) = 8 and n/(1ᵀC⁻¹1) = 4/(4/3) = 3 ⇒ the bracket is 5.
    //   K = (35/4) / ((55/36)·5) = (35/4)·(36/275) = 1260/1100 = 63/55.
    const { p, ch } = ultrametric4();
    const values = [1, 2, 3, 5];
    Object.values(p.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .forEach((n, i) => {
        n.charStates = { [ch.id]: values[i] };
      });
    const result = blombergK(p, ch)!;
    expect(result.n).toBe(4);
    expect(result.totalBranches).toBe(6);
    expect(result.imputedBranches).toBe(0);
    expect(result.k).toBeCloseTo(63 / 55, 10);
  });

  it('K = 3/5 for the alternating trait (1, -1, 1, -1)', () => {
    // Same formula, same tree, worked out again by hand so the ratio is pinned
    // by two independent cases: â = mean = 0, so d = x.
    //   each block contributes (2/3)(d1² − d1d2 + d2²) = (2/3)(1+1+1) = 2
    //   ⇒ dᵀC⁻¹d = 4, σ̂² = 4/3, Σd² = 4, bracket = tr(C) − n/(1ᵀC⁻¹1) = 8 − 3 = 5
    //   ⇒ K = 4 / ((4/3)·5) = 12/20 = 3/5.
    // (Physically: each clade is internally as different as it can be while the
    // clade means coincide, which is exactly the anti-conservative direction, so
    // K sits well below 1.)
    const { p, ch } = ultrametric4();
    const values = [1, -1, 1, -1];
    Object.values(p.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .forEach((n, i) => {
        n.charStates = { [ch.id]: values[i] };
      });
    expect(blombergK(p, ch)!.k).toBeCloseTo(0.6, 10);
  });

  it('is dimensionless: rescaling the trait or the tree leaves 63/55 alone', () => {
    // Property of the DEFINITION (Blomberg et al. 2003): x → c·x multiplies both
    // Σ(x−â)² and σ̂² by c², and C → k·C multiplies σ̂² by 1/k while multiplying
    // the bracket (tr C − n/(1ᵀC⁻¹1)) by k. Either way K is unchanged — which is
    // what makes K comparable across traits measured in different units. It is
    // also the property the pre-fix code broke, by pricing a missing branch
    // length as 1 and so letting the tree's own scale leak into the statistic.
    const { p, ch } = ultrametric4();
    const set = (vs: number[]) => {
      Object.values(p.nodes)
        .filter((n) => n.childrenIds.length === 0)
        .forEach((n, i) => (n.charStates = { [ch.id]: vs[i] }));
    };
    set([1, 2, 3, 5]);
    const base = blombergK(p, ch)!.k;
    expect(base).toBeCloseTo(63 / 55, 10);
    set([2, 4, 6, 10]);
    expect(blombergK(p, ch)!.k).toBeCloseTo(base, 10);
    set([1, 2, 3, 5]);
    for (const n of Object.values(p.nodes)) if (n.branchLength) n.branchLength *= 2;
    expect(blombergK(p, ch)!.k).toBeCloseTo(base, 10);
    // ...but a branch length that is MISSING is imputed to 1, which is a real
    // change of scale, and the result counts it rather than hiding it.
    for (const n of Object.values(p.nodes)) n.branchLength = undefined;
    const imputed = blombergK(p, ch)!;
    expect(imputed.imputedBranches).toBe(6);
    expect(imputed.totalBranches).toBe(6);
  });
});

// --- scaling guards: counted work, plus optional timing ceilings -------------

/**
 * The hot paths of the science core are guarded here, and the guards count
 * operations rather than seconds.
 *
 * This suite does not run `scripts/bench_tips.mjs`, and it measures a different
 * stage set from that script's. A ratio of sub-millisecond timings on a shared
 * machine is a measurement of the scheduler, not of the code, and it can go red on
 * one run and green on the next — so no assertion here gates on wall-clock. Timing
 * is a separate, opt-in ceiling (`CLADEFORGE_TIMING_GATE=1`, off by default), and
 * the complexity claim is carried by counters:
 *
 *   * `project.nodes` behind a counting Proxy — how many node lookups a stage
 *     performs, which is linear in the tree for a traversal and quadratic for a
 *     re-walk;
 *   * d3 node `height` writes / `parent` reads — the ancestor walk that would make
 *     the layout O(nodes × depth) (the same instrumented counter
 *     `hierarchy.test.ts` uses).
 *
 * `scripts/bench_tips.mjs` is the place that reports milliseconds; it reports no
 * verdict.
 */
describe('scaling guards — counted node visits and ancestor walks', () => {
  const seedOf = (shape: string, n: number) =>
    0xc1a7 + n * 7919 + (shape === 'balanced' ? 1 : 2); // identical to the script

  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function balancedNewick(n: number, rnd: () => number): string {
    const labels = Array.from({ length: n }, (_, i) => `Taxon_${i + 1}`);
    const bl = () => `:${(0.02 + rnd() * 0.45).toFixed(4)}`;
    const frag = (lo: number, hi: number): string => {
      const len = hi - lo;
      if (len === 1) return labels[lo] + bl();
      const mid = lo + Math.ceil(len / 2);
      return `(${frag(lo, mid)},${frag(mid, hi)})${bl()}`;
    };
    return `${frag(0, n)};`;
  }

  function pectinateNewick(n: number, rnd: () => number): string {
    const labels = Array.from({ length: n }, (_, i) => `Taxon_${i + 1}`);
    const bl = () => `:${(0.02 + rnd() * 0.45).toFixed(4)}`;
    const parts = [`(${labels[0]}${bl()},${labels[1]}${bl()})${bl()}`];
    for (let i = 2; i < n; i += 1) parts.push(`(${parts.pop()},${labels[i]}${bl()})${bl()}`);
    return `${parts[0]};`;
  }

  /** The same 3-state matrix the script attaches, ~5 % missing data. */
  function attachCharacter(project: Project, rnd: () => number): Character {
    const character: Character = {
      id: 'benchK3',
      name: 'Bench character',
      type: 'discrete',
      states: [
        { id: 'k0', label: 'State 0', color: '#ef4444' },
        { id: 'k1', label: 'State 1', color: '#22c55e' },
        { id: 'k2', label: 'State 2', color: '#3b82f6' },
      ],
    };
    project.characters.push(character);
    for (const node of Object.values(project.nodes)) {
      if (node.childrenIds.length > 0) continue;
      if (rnd() < 0.05) continue;
      node.charStates = { [character.id]: `k${Math.floor(rnd() * 3)}` };
    }
    return character;
  }

  /** One benchmark document: the script's generators, sizes and character. */
  function benchProject(shape: string, n: number): { project: Project; character: Character } {
    const rnd = mulberry32(seedOf(shape, n));
    const newick = shape === 'balanced' ? balancedNewick(n, rnd) : pectinateNewick(n, rnd);
    const project = parseNewick(newick, 'Bench');
    return { project, character: attachCharacter(project, rnd) };
  }

    /** Every stage the guard covers, run over the same document. */
  function workOf(shape: string, n: number): { nodes: number; stages: Record<string, NodeWork> } {
    const { project, character } = benchProject(shape, n);
    // One untimed run first: it resolves `buildHierarchy`'s cached d3 node
    // constructor, whose one-off sanity probe would otherwise be counted.
    computeLayout(project);
    return {
      nodes: nodeCount(project),
      stages: {
        layout: measureWork(project, (p) => computeLayout(p)),
        parsimony: measureWork(project, (p) => void parsimony(p, character).cost),
        mkAsr: measureWork(project, (p) => void reconstructMk(p, character)),
        treeSummary: measureWork(project, (p) => void treeSummary(p)),
      },
    };
  }

  /** Quadrupling the tips may multiply counted work by at most 4× this slack. */
  const LINEAR_SLACK = 1.15;

  for (const shape of ['balanced', 'pectinate'] as const) {
    it(`${shape}: every stage's counted work scales with the tree, not with it squared`, () => {
      // Measured here, both shapes identically: 2 000 → 8 000 tips is 3 999 →
      // 15 999 nodes, and the node visits go layout 7 999 → 31 999, parsimony
      // 11 995 → 47 995, Mk ASR 11 995 → 47 995, treeSummary 7 999 → 31 999:
      // ×4.00 for ×4.00 nodes, with 0 parent hops and 2 height writes per node in
      // the layout. A quadratic stage would have shown ×16 and tripped this test.
      const small = workOf(shape, 2000);
      const big = workOf(shape, 8000);
      const nodeRatio = big.nodes / small.nodes;
      expect(nodeRatio).toBeGreaterThan(3.9);
      for (const stage of Object.keys(small.stages)) {
        const ratio = big.stages[stage].visits / small.stages[stage].visits;
        expect(
          ratio,
          `${stage} on a ${shape} tree: ${small.stages[stage].visits} node visits at 2 000 tips → ` +
            `${big.stages[stage].visits} at 8 000 (×${ratio.toFixed(2)} for ×${nodeRatio.toFixed(2)} nodes)`,
        ).toBeLessThanOrEqual(nodeRatio * LINEAR_SLACK);
      }
      // The layout must not follow a single parent chain on either shape: that is
      // what a comb makes expensive. Two height writes per node (constructor +
      // bottom-up sweep) is the whole bill.
      expect(big.stages.layout.parentHops).toBe(0);
      expect(big.stages.layout.heightWrites).toBe(2 * big.nodes);
    });
  }

  it('counts the ancestor walk the guard exists to keep out', () => {
    // The guard's own sensitivity check: on a pectinate tree, the plain
    // `hierarchy()` construction walks a parent chain per node, which the counter
    // sees; `computeLayout` must not.
    const { project } = benchProject('pectinate', 1000);
    const laid = measureWork(project, (p) => computeLayout(p));
    const d3Built = measureWork(project, (p) =>
      void hierarchy(p.nodes[p.rootId], (node) =>
        node.childrenIds.map((id) => p.nodes[id]).filter(Boolean)),
    );
    expect(laid.parentHops).toBe(0);
    expect(d3Built.parentHops).toBeGreaterThan(2 * nodeCount(project));
  });

  it('parses, lays out and scores a 2 000-tip tree with a linear node budget', () => {
    // Read from the counters rather than a stopwatch: the node budget is what the
    // per-stage ceiling is really about.
    for (const shape of ['balanced', 'pectinate'] as const) {
      const { project, character } = benchProject(shape, 2000);
      const { nodes, stages } = workOf(shape, 2000);
      for (const [stage, work] of Object.entries(stages)) {
        expect(work.visits, `${stage} on ${shape}`).toBeLessThanOrEqual(6 * nodes);
      }
      expect(parsimony(project, character).cost).toBeGreaterThan(0);
      expect(treeSummary(project).tipCount).toBe(2000);
    }
  });

  /**
   * Best-of-N (minimum) rather than median. A wall-clock sample is contaminated by
   * GC, by the OS scheduler and by whatever else is on the machine, and all of that
   * only ever adds time — so the minimum is the estimator that most closely tracks the
   * code's real cost. Kept for profiling runs only.
   */
  function bestMs(fn: () => void, reps: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (let r = 0; r < reps; r += 1) {
      const t0 = process.hrtime.bigint();
      fn();
      const t1 = process.hrtime.bigint();
      const ms = Number(t1 - t0) / 1e6;
      if (ms < best) best = ms;
    }
    return best;
  }

  /** Best-of-N milliseconds for each hot path, for profiling runs only. */
  function measure(shape: string, n: number, reps = 5): Record<string, number> {
    const rnd = mulberry32(seedOf(shape, n));
    const newick = shape === 'balanced' ? balancedNewick(n, rnd) : pectinateNewick(n, rnd);
    const project = parseNewick(newick, 'Bench');
    const character = attachCharacter(project, rnd);
    // Warm every path up individually before timing it: the first call to each
    // helper is dominated by JIT tiering, and a single shared warm-up only fixes
    // the parse.
    for (const f of [
      () => parseNewick(newick, 'Bench'),
      () => computeLayout(project),
      () => parsimony(project, character).cost,
      () => reconstructMk(project, character),
      () => treeSummary(project),
    ]) bestMs(f, 2);
    return {
      parse: bestMs(() => parseNewick(newick, 'Bench'), reps),
      layout: bestMs(() => computeLayout(project), reps),
      parsimony: bestMs(() => parsimony(project, character).cost, reps),
      mkAsr: bestMs(() => reconstructMk(project, character), reps),
      treeSummary: bestMs(() => treeSummary(project), reps),
    };
  }

  // Absolute ceilings, opt-in (see the block comment above): the counted-work tests
  // are what gate CI, and these sit two orders of magnitude above the measured
  // profile — at 2 000 tips, best-of-5: parse 2.9 ms, layout 1.4 ms, Sankoff 5.2 ms,
  // Mk ASR 6.1 ms, treeSummary 1.2 ms. They are still useful on a quiet machine: an
  // O(n²) parse, which measured 447 ms at 2 000 tips, trips the 150 ms line
  // immediately.
  const CAPS: Record<string, number> = {
    parse: 150,
    layout: 150,
    parsimony: 150,
    mkAsr: 400,
    treeSummary: 150,
  };

  for (const shape of ['balanced', 'pectinate'] as const) {
    it.skipIf(!GATE_TIMINGS)(`keeps ${shape} 2 000-tip work inside the interactive budget`, () => {
      const t = measure(shape, 2000);
      for (const [op, cap] of Object.entries(CAPS)) {
        expect(
          t[op],
          `${shape} tree, 2 000 tips: ${op} took ${t[op].toFixed(1)} ms (budget ${cap} ms)`,
        ).toBeLessThanOrEqual(cap);
      }
    }, 120_000);
  }

  it.skipIf(!GATE_TIMINGS)(
    'reports the millisecond profile the counters summarise',
    () => {
      // The 2 000 → 8 000 ratio assertion lives in the counted-work tests.
      // What remains here is the number a profiling run wants to see, bounded
      // generously against a figure derived from the counters (a stage that walks
      // a 8 000-tip tree once has no business taking minutes).
      const small = measure('balanced', 2000, 7);
      const big = measure('balanced', 8000, 7);
      for (const op of Object.keys(CAPS)) {
        expect(big[op], `${op}: ${small[op].toFixed(1)} ms → ${big[op].toFixed(1)} ms`).toBeLessThan(60_000);
      }
    },
    240_000,
  );
});

// ════════════════════════════════════════════════════════════════════════
// Shape and signal indices: Colless counted over TIPS, and Blomberg's K
// calibrated under Brownian motion.
// ════════════════════════════════════════════════════════════════════════

describe('Colless index — imbalance measured in TIPS, not nodes', () => {
  // Hand-derived: sum over internal nodes of |tips(left) - tips(right)|.
  const cases: Array<[string, number]> = [
    ['(((A,B),C),D);', 3], //              0 + |2-1| + |3-1|
    ['((A,B),(C,D));', 0], //              fully symmetric
    ['(((A,B),(C,D)),(E,(F,G)));', 2], //  0 + 0 + |4-3|... = 2
    ['((((A,B),C),D),E);', 6], //          0+1+2+3
  ];
  for (const [nwk, want] of cases) {
    it(`${nwk} -> ${want}`, () => {
      expect(treeSummary(parseNewick(nwk)).collessIndex).toBe(want);
    });
  }
  it('is NOT double the tip-based value on a pectinate tree', () => {
    // Counting subtree NODES instead of tips doubles every term: a binary subtree
    // has 2*tips-1 nodes. The tip-based definition is what is asserted here.
    const p = parseNewick('((((((A,B),C),D),E),F),G);');
    const got = treeSummary(p).collessIndex;
    expect(got).toBe(15); // 0+1+2+3+4+5
    expect(got).not.toBe(30);
  });
});

describe("Blomberg's K — E[K] ~ 1 under Brownian motion", () => {
  /** Deterministic PRNG so the calibration is reproducible in CI. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalGen(seed: number): () => number {
    const rnd = mulberry32(seed);
    let spare: number | null = null;
    return () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
      const m = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * m;
      return u * m;
    };
  }
  function cholesky(A: number[][]): number[][] {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let sum = 0;
        for (let k = 0; k < j; k += 1) sum += L[i][k] * L[j][k];
        L[i][j] = i === j ? Math.sqrt(Math.max(1e-12, A[i][i] - sum)) : (A[i][j] - sum) / L[j][j];
      }
    }
    return L;
  }
  /** C_ij = shared root->MRCA path length; every non-root node carries a length. */
  function bmCovariance(p: Project, tips: string[]): number[][] {
    const rootToNode = (id: string): string[] => {
      const path: string[] = [];
      let cur: string | null = id;
      while (cur) { path.unshift(cur); cur = p.nodes[cur]?.parentId ?? null; }
      return path;
    };
    const depth = (id: string) =>
      rootToNode(id).slice(1).reduce((s, x) => s + (p.nodes[x]?.branchLength ?? 0), 0);
    return tips.map((a) => tips.map((b) => {
      const pa = rootToNode(a);
      const pb = new Set(rootToNode(b));
      let mrca = p.rootId;
      for (const x of pa) if (pb.has(x)) mrca = x;
      return depth(mrca);
    }));
  }

  // Deliberately unequal-depth trees: on a tree whose C has constant row sums the
  // published normalisation agrees with a GLS-based one, so only asymmetric cases
  // can tell the two apart and only these exercise the difference.
  const trees: Array<[string, string]> = [
    ['pectinate, unequal depths', '(t0:0.10,(t1:0.05,(t2:0.30,(t3:0.02,(t4:1.50,t5:0.20)i4:0.03)i3:0.02)i2:0.08)i1:0.20)i0:0.40;'],
    ['two clades, very different ages', '((A:5,B:5)X:0.01,(C:0.2,D:0.2)Y:4)R;'],
    ['comb with long stem', '(((a:0.4,b:0.4)1:0.1,c:0.9)2:0.2,d:1.3)3:0.05;'],
  ];

  for (const [name, nwk] of trees) {
    it(`${name}: mean K over 400 BM replicates lands in [0.75, 1.25]`, () => {
      const base = parseNewick(nwk);
      const tips = Object.values(base.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.id);
      const C = bmCovariance(base, tips);
      const L = cholesky(C);
      const randn = normalGen(20260925);
      const ch: Character = { id: 'cont', name: 'size', type: 'continuous', states: [] };

      let sum = 0;
      let used = 0;
      for (let r = 0; r < 400; r += 1) {
        const z = tips.map(() => randn());
        const x = L.map((row) => row.reduce((s, lij, j) => s + lij * z[j], 0));
        const p = parseNewick(nwk);
        // parseNewick mints fresh nanoids per call, so the tip ids must come
        // from THIS project; the traversal order is deterministic, so the
        // values still line up with the columns of C.
        const liveTips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.id);
        p.characters = [ch];
        liveTips.forEach((id, i) => { p.nodes[id].charStates = { [ch.id]: x[i] }; });
        const k = blombergK(p, ch);
        if (k) { sum += k.k; used += 1; }
      }
      expect(used, 'no replicate produced a K').toBeGreaterThan(350);
      const mean = sum / used;
      // Where the band bites: a GLS-based normalisation scores ~0.51 on a tree of
      // this shape and cannot reach it.
      expect(mean, `${name}: E[K]=${mean.toFixed(3)} should be ~1 under BM`).toBeGreaterThan(0.75);
      expect(mean, `${name}: E[K]=${mean.toFixed(3)} should be ~1 under BM`).toBeLessThan(1.25);
    }, 120_000);
  }

  it('reproduces the published hand-derived value 63/55', () => {
    // The calibration anchor: the ultrametric case has to stay exactly here.
    const p = parseNewick('((A:1,B:1):0,(C:1,D:1):0)R;');
    const ch: Character = { id: 'cont', name: 'size', type: 'continuous', states: [] };
    p.characters = [ch];
    const vals = [1, 2, 3, 5];
    Object.values(p.nodes).filter((n) => n.childrenIds.length === 0).forEach((n, i) => {
      n.charStates = { [ch.id]: vals[i] };
    });
    expect(blombergK(p, ch)!.k).toBeCloseTo(63 / 55, 6);
  });
});

/**
 * Layout cost, stated as counted work.
 *
 * A node tree built with d3-hierarchy's `hierarchy()` ends with a height pass that
 * walks up the ancestors of every node it visits, so the layout costs
 * O(n·depth): a pectinate tree is then ~100x more expensive per node than a
 * balanced one of the same size (measured at 16 000 nodes — 3 546 ms pectinate vs
 * 36 ms balanced). The layout recomputes on every committed edit, so that is the
 * difference between a snappy editor and a frozen window on big comb-shaped trees.
 *
 * The node tree is therefore built iteratively (`src/layout/hierarchy.ts`), leaving
 * d3's `cluster()` — already linear — to do the row assignment. The equivalence of
 * that construction and the correctness of the resulting coordinates are pinned in
 * `src/layout/hierarchy.test.ts`.
 *
 * The assertions below count the operation the quadratic path performs —
 * ancestor-chain hops, i.e. `parent` reads and `height` writes on d3's node
 * objects — which separates O(n) from O(n·depth) with no stopwatch involved. A
 * fitted exponent on a millisecond ratio is a gate on the scheduler: it passes on
 * one machine and fails on another.
 */
describe('layout cost on deep pectinate trees is bounded', () => {
  function pectinate(n: number): string {
    let s = '(t0:1,t1:1)';
    for (let i = 2; i < n; i += 1) s = `(${s},t${i}:1)`;
    return `${s};`;
  }

  function bestMs(fn: () => void, reps = 3): number {
    let best = Infinity;
    for (let r = 0; r < reps; r += 1) {
      const t0 = process.hrtime.bigint();
      fn();
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  }

  it('walks no ancestor chain and writes each height twice per node, on a comb', () => {
    const p = parseNewick(pectinate(8000));
    computeLayout(p); // warm: resolves the cached d3 node constructor
    const work = measureWork(p, (project) => computeLayout(project));
    const nodes = nodeCount(p);
    expect(nodes).toBe(15_999);
    expect(work.parentHops).toBe(0);
    expect(work.heightWrites).toBe(2 * nodes);
    // Every node looked at a constant number of times: a per-node re-walk of the
    // tree would push this to O(n²) and fail here rather than in a profiler.
    expect(work.visits).toBeLessThanOrEqual(4 * nodes);
  });

  it('scales linearly in node count on a comb — counted, not timed', () => {
    const small = parseNewick(pectinate(2000));
    const large = parseNewick(pectinate(8000));
    computeLayout(small);
    computeLayout(large);
    const a = measureWork(small, (project) => computeLayout(project));
    const b = measureWork(large, (project) => computeLayout(project));
    const nodeRatio = nodeCount(large) / nodeCount(small);
    // 4× the nodes, 4× the work: the exponent here is exactly 1, and the comb's
    // depth (2 000 → 8 000 levels) does not enter it at all.
    expect(b.heightWrites / a.heightWrites).toBeLessThanOrEqual(nodeRatio + 0.05);
    expect(b.parentHops).toBe(0);
    expect(a.parentHops).toBe(0);
    // …while the walk the tripwire guards against grows with depth as well:
    // Σ depth over the two combs is ~16× apart, so a quadratic construction
    // cannot hide behind these numbers.
    const hops = (project: Project): number => {
      const root = hierarchy(project.nodes[project.rootId], (node) =>
        node.childrenIds.map((id) => project.nodes[id]).filter(Boolean),
      );
      let total = 0;
      root.each((node) => {
        total += node.depth;
      });
      return total;
    };
    expect(hops(large) / hops(small)).toBeGreaterThan(nodeRatio * 3);
  });

  it.skipIf(!GATE_TIMINGS)(
    'lays out 8 000 pectinate tips inside the interactive budget',
    () => {
      // Opt-in profiling figure, kept because "a layout must not take seconds" is
      // worth watching on a quiet machine. Measured ~6 ms (best of 3 here); the
      // d3 height walk it avoids would put this at 440-505 ms. The bound is
      // generous against the counted work above (16 000 nodes, 2 writes each).
      const p = parseNewick(pectinate(8000));
      const ms = bestMs(() => computeLayout(p));
      expect(ms).toBeLessThan(250);
    },
  );
});
