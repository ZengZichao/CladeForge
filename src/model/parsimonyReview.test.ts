// Regression tests for parsimony review findings (M22/M23).
import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import { parsimony, presetCostMatrix } from './parsimony';
import type { Character } from './types';

const tip = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

const binaryChar = (model: Character['model'], costMatrix?: number[][]): Character => ({
  id: 'c',
  name: 'c',
  type: 'discrete',
  model,
  ...(costMatrix ? { costMatrix } : {}),
  states: [
    { id: '0', label: '0', color: '#000000' },
    { id: '1', label: '1', color: '#ffffff' },
  ],
});

const altForbiddingTree = () => {
  const p = parseNewick('(A:1,B:1)R;');
  p.characters = [binaryChar('custom')];
  tip(p, 'A').charStates = { c: '0' };
  tip(p, 'B').charStates = { c: '1' };
  return p;
};

describe('review: infeasible step matrix (M22)', () => {
  it('an infeasible matrix is reported as infeasible, not as cost 0', () => {
    const p = altForbiddingTree();
    p.characters = [binaryChar('custom', [
      [0, Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, 0],
    ])];
    const r = parsimony(p, p.characters[0]);
    expect(r.feasible).toBe(false);
    expect(r.cost).toBe(Number.POSITIVE_INFINITY);
  });

  it('a feasible matrix is unaffected', () => {
    const p = altForbiddingTree();
    p.characters = [binaryChar('custom', [
      [0, 1],
      [1, 0],
    ])];
    const r = parsimony(p, p.characters[0]);
    expect(r.feasible).toBe(true);
    expect(r.cost).toBe(1);
  });
});

describe('review: true Dollo (M23)', () => {
  it('one gain on the whole tree plus losses, not a gain per branch', () => {
    const p = parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');
    p.characters = [binaryChar('dollo')];
    tip(p, 'A').charStates = { c: '1' };
    tip(p, 'B').charStates = { c: '0' };
    tip(p, 'C').charStates = { c: '1' };
    tip(p, 'D').charStates = { c: '0' };
    const r = parsimony(p, binaryChar('dollo'));
    // The 1-tips sit in different subtrees: the single gain must sit at (or
    // above) the root, with one loss down to B and one down to D → 3.
    expect(r.cost).toBe(3);
    expect(r.feasible).toBe(true);
    // Exactly one gain: the number of 0→1 transitions on the chosen path.
    let gains = 0;
    let losses = 0;
    for (const id of r.changeBranches) {
      const child = r.chosen.get(id);
      const parent = p.nodes[id].parentId ? r.chosen.get(p.nodes[id].parentId as string) : undefined;
      if (parent === '0' && child === '1') gains += 1;
      if (parent === '1' && child === '0') losses += 1;
    }
    expect(losses).toBe(2);
    // The gain at the root has no entering branch; it shows as the root being 1.
    expect(r.chosen.get(p.rootId)).toBe('1');
    expect(gains).toBe(0);
  });

  it('unordered scoring of the same data stays at two gains', () => {
    const p = parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');
    p.characters = [binaryChar('unordered')];
    tip(p, 'A').charStates = { c: '1' };
    tip(p, 'B').charStates = { c: '0' };
    tip(p, 'C').charStates = { c: '1' };
    tip(p, 'D').charStates = { c: '0' };
    const r = parsimony(p, binaryChar('unordered'));
    expect(r.cost).toBe(2);
  });

  it('the dollo preset matrix documents its local-cost nature (irreversible gain)', () => {
    const m = presetCostMatrix('dollo', 2);
    expect(m[0][1]).toBe(1);
    expect(m[1][0]).toBe(Number.POSITIVE_INFINITY);
  });
});
