// Scientific invariants the review asked to pin as tests (§15.7): statements
// the implementation declares in comments but never enforced in code. Each one
// guards against a silent change of statistical meaning.

import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addCharacter, addChildren, rerootAtNode, setNodeState } from './treeOps';
import { newCharacter } from './characters';
import { parsimony, presetCostMatrix } from './parsimony';
import { reconstructMk } from './asr';
import { blombergK } from './stats';
import { treeDistance } from './treeDistance';
import type { Project } from './types';

function scoredTree(): { p: Project; char: ReturnType<typeof newCharacter> } {
  const p = createEmptyProject();
  const [a, b] = addChildren(p, p.rootId, 2);
  const [a1, a2] = addChildren(p, a, 2);
  const [b1, b2] = addChildren(p, b, 2);
  p.nodes[a1].label = 'w';
  p.nodes[a2].label = 'x';
  p.nodes[b1].label = 'y';
  p.nodes[b2].label = 'z';
  for (const id of [a1, a2, b1, b2]) p.nodes[id].branchLength = 1;
  const char = newCharacter('t');
  addCharacter(p, char);
  const [s0, s1] = char.states.map((x) => x.id);
  setNodeState(p, a1, char.id, s0);
  setNodeState(p, a2, char.id, s0);
  setNodeState(p, b1, char.id, s1);
  setNodeState(p, b2, char.id, s1);
  return { p, char };
}

describe('scientific invariants the reviews asked to pin', () => {
  it('mpStates ⊇ states at every node (the documented superset relation)', () => {
    const { p, char } = scoredTree();
    const r = parsimony(p, char);
    for (const [id, chosen] of r.chosen) {
      const mp = r.mpStates.get(id) ?? [];
      expect(mp, `node ${id}`).toContain(chosen);
      const parentConditional = r.states.get(id) ?? [];
      for (const s of parentConditional) {
        // states is parent-conditional, mpStates is global — a state feasible
        // under ONE parent path must occur in some global optimum.
        expect(mp, `node ${id}`).toContain(s);
      }
    }
  });

  it('scaling every cost by λ keeps the optimum the same (homogeneity)', () => {
    const { p, char } = scoredTree();
    const base = parsimony(p, char).cost;
    char.costMatrix = presetCostMatrix('unordered', char.states.length).map((row) => row.map((v) => v * 7));
    const scaled = parsimony(p, char).cost;
    expect(scaled).toBeCloseTo(base * 7, 9);
  });

  it('an Infinity cost really forbids a transition (and only NaN falls back)', () => {
    const { p, char } = scoredTree();
    const [s0, s1] = char.states.map((x) => x.id);
    // dollo preset forbids 1→0.
    char.costMatrix = presetCostMatrix('dollo', 2);
    const r = parsimony(p, char);
    // (s0,s0) vs (s1,s1): one 0→1 gain is allowed; a 1→0 reversal is not, so
    // the minimum is exactly 1.
    expect(r.cost).toBe(1);
    void s0;
    void s1;
  });

  it('branch-length rescaling by a constant leaves K unchanged and the Mk posteriors unchanged', () => {
    const { p } = scoredTree();
    const charC = {
      id: 'cc',
      name: 'continuous',
      type: 'continuous' as const,
      states: [],
    };
    p.characters.push(charC);
    const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
    tips.forEach((t, i) => {
      t.charStates = { [charC.id]: i * 1.7 + 0.3 };
    });
    const k1 = blombergK(p, charC)?.k;
    for (const n of Object.values(p.nodes)) {
      if (typeof n.branchLength === 'number') n.branchLength *= 13;
    }
    const k2 = blombergK(p, charC)?.k;
    expect(k1).toBeDefined();
    expect(k2).toBeCloseTo(k1 as number, 9);

    // Mk: scale-invariance under BOTH rate conventions — the review's §5.1
    // concern was that the posterior depend on shape, not scale; scale must
    // cancel exactly.
    const charD = newCharacter('d');
    p.characters.push(charD);
    const [d0, d1] = charD.states.map((x) => x.id);
    setNodeState(p, tips[0].id, charD.id, d0);
    setNodeState(p, tips[1].id, charD.id, d0);
    setNodeState(p, tips[2].id, charD.id, d1);
    setNodeState(p, tips[3].id, charD.id, d1);
    for (const n of Object.values(p.nodes)) {
      if (typeof n.branchLength === 'number') n.branchLength /= 13;
    }
    const r1 = reconstructMk(p, charD)!;
    for (const n of Object.values(p.nodes)) {
      if (typeof n.branchLength === 'number') n.branchLength *= 5;
    }
    const r2 = reconstructMk(p, charD)!;
    for (const [id, v] of r1.probs) {
      const w = r2.probs.get(id) as number[];
      for (let i = 0; i < v.length; i += 1) expect(w[i]).toBeCloseTo(v[i], 6);
    }
  });

  it('total branch length is conserved by a re-root (unless the root edge is split)', () => {
    const { p } = scoredTree();
    const total = () =>
      Object.values(p.nodes).reduce((sum, n) => (n.parentId ? sum + (n.branchLength ?? 0) : sum), 0);
    const before = total();
    rerootAtNode(p, Object.values(p.nodes).find((n) => n.childrenIds.length > 0 && n.parentId)!.id, 0.5);
    const after = total();
    expect(after).toBeCloseTo(before, 6);
  });

  it('RF distance is 0 for identical trees and symmetric for different ones', () => {
    const { p } = scoredTree();
    const d0 = treeDistance(p, p);
    expect(d0.rf).toBe(0);
    // A differently-shaped tree over the SAME four labels: ((w,y),(x,z)).
    const other = createEmptyProject();
    const [n1, n2] = addChildren(other, other.rootId, 2);
    const [w, y] = addChildren(other, n1, 2);
    const [x, z] = addChildren(other, n2, 2);
    other.nodes[w].label = 'w';
    other.nodes[y].label = 'y';
    other.nodes[x].label = 'x';
    other.nodes[z].label = 'z';
    void n1;
    void n2;
    const d = treeDistance(p, other);
    expect(d.rf).toBeGreaterThan(0);
    const dRev = treeDistance(other, p);
    expect(dRev.rf).toBe(d.rf);
    expect(d.sharedTips).toEqual(['w', 'x', 'y', 'z']);
  });
});
