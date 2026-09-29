import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren } from './treeOps';
import { applyDisplayThreshold, reconstructMk } from './asr';
import { discreteSignal } from './stats';
import type { Character, Project } from './types';

function twoState(): Character {
  return {
    id: 'c1',
    name: 'C',
    type: 'discrete',
    states: [
      { id: 'a', label: 'A', color: '#ff0000' },
      { id: 'b', label: 'B', color: '#0000ff' },
    ],
  };
}

describe('asr (Mk marginal reconstruction)', () => {
  it('posteriors sum to 1, tips stay certain, and agreement pulls the root', () => {
    const p = createEmptyProject();
    const [x, y] = addChildren(p, p.rootId, 2);
    const c = twoState();
    p.characters.push(c);
    p.nodes[x].charStates = { c1: 'a' };
    p.nodes[y].charStates = { c1: 'a' };

    const res = reconstructMk(p, c);
    expect(res).not.toBeNull();
    for (const [, v] of res!.probs) {
      expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(res!.probs.get(x)![0]).toBeCloseTo(1, 6); // tip certain at 'a'
    const rootP = res!.probs.get(p.rootId)!;
    expect(rootP[0]).toBeGreaterThan(rootP[1]); // root favours 'a'
  });

  it('a symmetric conflict leaves the root maximally uncertain (~50/50)', () => {
    const p = createEmptyProject();
    const [x, y] = addChildren(p, p.rootId, 2);
    const c = twoState();
    p.characters.push(c);
    p.nodes[x].charStates = { c1: 'a' };
    p.nodes[y].charStates = { c1: 'b' };

    const rootP = reconstructMk(p, c)!.probs.get(p.rootId)!;
    expect(rootP[0]).toBeCloseTo(0.5, 3);
    expect(rootP[1]).toBeCloseTo(0.5, 3);
  });
});

describe('discreteSignal (CI / RI)', () => {
  it('a topology-consistent character has CI = RI = 1', () => {
    const p = createEmptyProject();
    const [left, right] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, left, 2);
    const [b1, b2] = addChildren(p, right, 2);
    const c = twoState();
    p.characters.push(c);
    p.nodes[a1].charStates = { c1: 'a' };
    p.nodes[a2].charStates = { c1: 'a' };
    p.nodes[b1].charStates = { c1: 'b' };
    p.nodes[b2].charStates = { c1: 'b' };

    const sig = discreteSignal(p, c)!;
    expect(sig.steps).toBe(1);
    expect(sig.ci).toBeCloseTo(1, 6);
    expect(sig.ri).toBeCloseTo(1, 6);
  });

  it('a homoplastic character scores CI < 1', () => {
    const p = createEmptyProject();
    // (a,b) and (a,b): the two clades each mix states -> 2 steps, homoplasy.
    const [left, right] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, left, 2);
    const [b1, b2] = addChildren(p, right, 2);
    const c = twoState();
    p.characters.push(c);
    p.nodes[a1].charStates = { c1: 'a' };
    p.nodes[a2].charStates = { c1: 'b' };
    p.nodes[b1].charStates = { c1: 'a' };
    p.nodes[b2].charStates = { c1: 'b' };

    const sig = discreteSignal(p, c)!;
    expect(sig.steps).toBeGreaterThan(1);
    expect(sig.ci).toBeLessThan(1);
  });
});

describe('asr — branch-length degradation warnings', () => {
  /** A 15-node binary tree (7 internal incl. root, 8 tips), all lengths = 1. */
  function fifteenNodeTree(): { p: Project; tips: string[]; nonRoot: string[] } {
    const p = createEmptyProject();
    const tips: string[] = [];
    const nonRoot: string[] = [];
    const build = (parent: string, depth: number) => {
      const [x, y] = addChildren(p, parent, 2);
      nonRoot.push(x, y);
      p.nodes[x].branchLength = 1;
      p.nodes[y].branchLength = 1;
      if (depth === 1) {
        tips.push(x, y);
        return;
      }
      build(x, depth - 1);
      build(y, depth - 1);
    };
    build(p.rootId, 3);
    return { p, tips, nonRoot };
  }

  const warn = (p: Project, c: Character) => reconstructMk(p, c)!.warnings;

  it('counts NODES, not branch-length lookups', () => {
    // The count is of NODES, not of lookups: a 15-node tree with 4 unset branch
    // lengths has to warn about 4 — bumping a counter at every one of the four
    // lookup sites would report 16.
    const { p, tips } = fifteenNodeTree();
    const c = twoState();
    p.characters.push(c);
    const unsetIds = tips.slice(0, 4);
    for (const id of unsetIds) delete p.nodes[id].branchLength;
    for (const id of tips.slice(4)) p.nodes[id].charStates = { c1: 'a' };

    const w = warn(p, c).find((x) => x.kind === 'unset-branch-length')!;
    expect(w).toBeDefined();
    expect(w.count).toBe(4);
    expect([...w.nodeIds].sort()).toEqual([...unsetIds].sort());
    expect(w.message).toMatch(/^4 个节点未设置枝长|^4 node\(s\) have no branch length/);
    expect(w.message).not.toMatch(/16/);
  });

  it('separates unset / zero / negative / non-finite', () => {
    const { p, tips } = fifteenNodeTree();
    const c = twoState();
    p.characters.push(c);
    p.nodes[tips[0]].branchLength = undefined;
    p.nodes[tips[1]].branchLength = 0;
    p.nodes[tips[2]].branchLength = -3;
    p.nodes[tips[3]].branchLength = Number.NaN;
    for (const id of tips.slice(4)) p.nodes[id].charStates = { c1: 'a' };

    const kinds = warn(p, c).map((w) => `${w.kind}:${w.count}`);
    expect(kinds).toContain('unset-branch-length:1');
    expect(kinds).toContain('zero-branch-length:1');
    expect(kinds).toContain('negative-branch-length:1');
    expect(kinds).toContain('invalid-branch-length:1');
    // The unset list must not contain the three explicitly-flagged oddities.
    const unset = warn(p, c).find((w) => w.kind === 'unset-branch-length')!;
    expect(unset.nodeIds).toEqual([tips[0]]);
  });

  it('uses a recorded zero as a real zero-length branch', () => {
    // root → n1 → (t1 = a, t2 = b) with BOTH tip branches 0. Under Mk a
    // zero-length branch is the identity matrix, so "a" and "b" at the same
    // instant is contradictory data: the likelihood collapses (and says so).
    // Substituting 1 for a non-positive length would hide this completely.
    const p = createEmptyProject();
    const [n1] = addChildren(p, p.rootId, 1);
    p.nodes[n1].branchLength = 1;
    const [t1, t2] = addChildren(p, n1, 2);
    p.nodes[t1].branchLength = 0;
    p.nodes[t2].branchLength = 0;
    const c = twoState();
    p.characters.push(c);
    p.nodes[t1].charStates = { c1: 'a' };
    p.nodes[t2].charStates = { c1: 'b' };
    const res = reconstructMk(p, c)!;
    expect(res.warnings.some((w) => w.kind === 'zero-branch-length')).toBe(true);
    expect(res.warnings.some((w) => w.kind === 'unset-branch-length')).toBe(false);
    const rootP = res.probs.get(p.rootId)!;
    expect(rootP[0]).toBeCloseTo(0.5, 6); // collapsed to uniform, reported
    expect(res.warnings.some((w) => w.kind === 'posterior-collapse')).toBe(true);
  });

  it('is invariant to the absolute scale of the branch lengths', () => {
    const { p, tips, nonRoot } = fifteenNodeTree();
    const c = twoState();
    p.characters.push(c);
    const rnd = (i: number) => 0.5 + (i % 4);
    nonRoot.forEach((id, i) => {
      p.nodes[id].branchLength = rnd(i);
    });
    tips.forEach((id, i) => {
      p.nodes[id].charStates = { c1: i % 3 === 0 ? 'a' : 'b' };
    });
    const base = reconstructMk(p, c)!;
    for (const id of nonRoot) {
      const bl = p.nodes[id].branchLength;
      if (typeof bl === 'number') p.nodes[id].branchLength = bl * 10;
    }
    const scaled = reconstructMk(p, c)!;
    for (const [id, probs] of base.probs) {
      probs.forEach((v, i) => expect(scaled.probs.get(id)![i]).toBeCloseTo(v, 9));
    }
  });

  it('refuses a model it has not implemented instead of mislabelling the result', () => {
    const { p, tips } = fifteenNodeTree();
    const c = twoState();
    p.characters.push(c);
    tips.forEach((id) => {
      p.nodes[id].charStates = { c1: 'a' };
    });
    expect(reconstructMk(p, c, { model: 'SYM', threshold: 0.1 })).toBeNull();
    expect(reconstructMk(p, c, { model: 'ARD', threshold: 0.1 })).toBeNull();
    expect(reconstructMk(p, c, { model: 'ER', threshold: 0.1 })?.model).toBe('ER');
  });
});

// --- the display threshold has to change the RESULT -------------------------
//
// `threshold` is applied inside the reconstruction instead of being left to the
// pie layer's own cut-offs: the filtered display set is part of the
// reconstruction result, so raising the threshold is observable here (and
// therefore testable) rather than only on screen.

describe('asr — display threshold', () => {
  /** root → (x = a, y = b): the root is a textbook 50/50, the tips are certain. */
  function conflictTree(): { p: Project; c: Character; x: string; y: string } {
    const p = createEmptyProject();
    const [x, y] = addChildren(p, p.rootId, 2);
    const c = twoState();
    p.characters.push(c);
    p.nodes[x].charStates = { c1: 'a' };
    p.nodes[y].charStates = { c1: 'b' };
    return { p, c, x, y };
  }

  it('a raised threshold strictly shrinks the displayed state set', () => {
    const { p, c, x, y } = conflictTree();
    const low = reconstructMk(p, c, { model: 'ER', threshold: 0.1 })!;
    const high = reconstructMk(p, c, { model: 'ER', threshold: 0.6 })!;

    // At 0.1 the uncertain root still shows both states…
    expect(low.display.get(p.rootId)!.shown).toEqual([0, 1]);
    expect(low.display.get(p.rootId)!.stateIds).toEqual(['a', 'b']);
    expect(low.display.get(p.rootId)!.unsupported).toBe(false);
    // …at 0.6 neither half of a 50/50 survives, so the node claims nothing.
    expect(high.display.get(p.rootId)!.shown).toEqual([]);
    expect(high.display.get(p.rootId)!.unsupported).toBe(true);
    // Strictly monotone: every node shows at least as much at the lower cut.
    for (const [id, node] of low.display) {
      expect(high.display.get(id)!.shown.length).toBeLessThanOrEqual(node.shown.length);
    }
    expect(high.threshold).toBe(0.6);
    // Certain tips are unaffected — the threshold filters, it does not distort.
    expect(high.display.get(x)!.shown).toEqual([0]);
    expect(high.display.get(y)!.shown).toEqual([1]);
  });

  it('does not alter the posterior: the threshold is presentation-only', () => {
    const { p, c, x, y } = conflictTree();
    const low = reconstructMk(p, c, { model: 'ER', threshold: 0.05 })!;
    const high = reconstructMk(p, c, { model: 'ER', threshold: 0.9 })!;
    expect([...high.display.keys()].sort()).toEqual([...high.probs.keys()].sort());
    for (const [id, probs] of low.probs) {
      expect(high.probs.get(id)).toEqual(probs); // identical numbers, not rescaled
      expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(low.probs.get(p.rootId)![0]).toBeCloseTo(0.5, 6);
    expect(low.probs.get(p.rootId)![1]).toBeCloseTo(0.5, 6);
    expect(low.probs.get(x)).toEqual([1, 0]);
    expect(low.probs.get(y)).toEqual([0, 1]);
    // …while the display set did move, so the threshold is not a no-op.
    expect(low.display.get(p.rootId)!.shown).toHaveLength(2);
    expect(high.display.get(p.rootId)!.shown).toHaveLength(0);
  });

  it('turns a majority-but-contested node into a solid disc as the cut rises', () => {
    // Four tips, all state a: the root is only weakly pulled to 'a' (the rate is
    // normalised by the mean branch length, so 0.536 / 0.464 is what the data
    // supports) — exactly the node whose drawing the slider is meant to change.
    const p = createEmptyProject();
    const [l, r] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, l, 2);
    const [b1, b2] = addChildren(p, r, 2);
    const c = twoState();
    p.characters.push(c);
    for (const id of [a1, a2, b1, b2]) p.nodes[id].charStates = { c1: 'a' };

    const low = reconstructMk(p, c, { model: 'ER', threshold: 0.1 })!;
    const rootLow = low.display.get(p.rootId)!;
    expect(low.probs.get(p.rootId)![1]).toBeGreaterThan(0.4); // real rival mass
    expect(rootLow.shown).toEqual([0, 1]); // drawn as a split pie
    expect(rootLow.solidIndex).toBe(-1);

    const high = reconstructMk(p, c, { model: 'ER', threshold: 0.5 })!;
    const rootHigh = high.display.get(p.rootId)!;
    expect(rootHigh.shown).toEqual([0]); // the 0.46 contender is cut
    expect(rootHigh.solidIndex).toBe(0); // ≥ 1 − 0.5 of the mass → solid disc
    expect(high.probs.get(p.rootId)).toEqual(low.probs.get(p.rootId));
  });

  it('treats a non-finite threshold as no cut-off rather than as everything', () => {
    const { p, c } = conflictTree();
    const res = reconstructMk(p, c, { model: 'ER', threshold: Number.NaN })!;
    expect(res.display.get(p.rootId)!.shown).toEqual([0, 1]);
    expect(applyDisplayThreshold([0.7, 0.3], ['a', 'b'], Number.POSITIVE_INFINITY).shown).toEqual([0, 1]);
    expect(applyDisplayThreshold([0.7, 0.3], ['a', 'b'], 0.5).shown).toEqual([0]);
    expect(applyDisplayThreshold([0.7, 0.3], ['a', 'b'], 0.5).solidIndex).toBe(0);
    // Zero mass is never drawn, however permissive the threshold is.
    expect(applyDisplayThreshold([1, 0], ['a', 'b'], 0).shown).toEqual([0]);
  });
});
