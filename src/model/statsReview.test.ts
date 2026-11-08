// Regression tests for the statistics review findings (S7/S8/S13/M24).
import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import { faithPd, blombergK, blombergKNullTest, fritzPurvisD, communityPhyloStats } from './stats';

const tip = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

const continuousChar = { id: 'v', name: 'v', type: 'continuous', states: [] } as const;
const binaryChar = {
  id: 'b',
  name: 'b',
  type: 'discrete',
  states: [
    { id: '0', label: '0', color: '#000000' },
    { id: '1', label: '1', color: '#ffffff' },
  ],
} as const;

const balancedTree = () => parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');

describe('review: Faith PD (S7)', () => {
  it('counts the internal branches connecting a cross-clade selection', () => {
    const p = balancedTree();
    p.characters = [binaryChar as never];
    for (const [label, state] of [
      ['A', '1'],
      ['B', '0'],
      ['C', '1'],
      ['D', '0'],
    ] as const) {
      tip(p, label).charStates = { b: state };
    }
    // A and C connect through A, X, Y, C — four unit branches under both root
    // conventions (the set's MRCA is the root here).
    expect(faithPd(p, 'b', '1')).toBe(4);
    expect(faithPd(p, 'b', '1', true)).toBe(4);
  });

  it('stops at the set MRCA by default and reaches the root on request', () => {
    const p = balancedTree();
    p.characters = [binaryChar as never];
    tip(p, 'A').charStates = { b: '1' };
    tip(p, 'B').charStates = { b: '1' };
    tip(p, 'C').charStates = { b: '0' };
    tip(p, 'D').charStates = { b: '0' };
    expect(faithPd(p, 'b', '1')).toBe(2); // A + B only: X's edge is above the set MRCA
    expect(faithPd(p, 'b', '1', true)).toBe(3); // + the branch entering X
  });
});

describe('review: Fritz–Purvis D (S8)', () => {
  it('stays computable and scale-invariant for declared-state binary traits', () => {
    const p = balancedTree();
    p.characters = [binaryChar as never];
    tip(p, 'A').charStates = { b: '1' };
    tip(p, 'B').charStates = { b: '1' };
    tip(p, 'C').charStates = { b: '0' };
    tip(p, 'D').charStates = { b: '0' };
    const d1 = fritzPurvisD(p, 'b', 500, 7)!;
    expect(d1).not.toBeNull();
    for (const n of Object.values(p.nodes)) {
      if (n.branchLength !== undefined) n.branchLength *= 0.1;
    }
    const d2 = fritzPurvisD(p, 'b', 500, 7)!;
    expect(d2.d).toBe(d1.d); // thresholded BM keeps its sign pattern under rescaling
    expect(d1.d).toBeLessThan(0.2); // clustered trait: D near 0, not near 1
  });
});

describe('review: Blomberg K (S13)', () => {
  it('matches the published estimator on an unequal-depth tree', () => {
    const p = parseNewick('(A:1,B:2,C:3)R;');
    p.characters = [continuousChar as never];
    tip(p, 'A').charStates = { v: 1 };
    tip(p, 'B').charStates = { v: 2 };
    tip(p, 'C').charStates = { v: 4 };
    const k = blombergK(p, continuousChar as never)?.k;
    expect(k).toBeCloseTo(661 / 600, 9); // 1.10166…, the standard GLS value
  });

  it('the BM null p-value is invariant to a change of branch-length units', () => {
    const p = balancedTree();
    p.characters = [continuousChar as never];
    tip(p, 'A').charStates = { v: 0 };
    tip(p, 'B').charStates = { v: 0 };
    tip(p, 'C').charStates = { v: 1 };
    tip(p, 'D').charStates = { v: 1 };
    const before = blombergKNullTest(p, continuousChar as never, 400, 7)?.pValue;
    for (const n of Object.values(p.nodes)) {
      if (n.branchLength !== undefined) n.branchLength *= 10000;
    }
    const after = blombergKNullTest(p, continuousChar as never, 400, 7)?.pValue;
    expect(before).toBeCloseTo(1 / 401, 6); // the analytic two-sided extreme
    expect(after).toBe(before);
  });
});

describe('review: NRI/NTI sign (M24)', () => {
  it('a clustered set gets a POSITIVE standardised effect size', () => {
    const p = balancedTree();
    p.characters = [binaryChar as never];
    tip(p, 'A').charStates = { b: '1' };
    tip(p, 'B').charStates = { b: '1' };
    tip(p, 'C').charStates = { b: '0' };
    tip(p, 'D').charStates = { b: '0' };
    const s = communityPhyloStats(p, 'b', '1', 200, 7)!;
    expect(s.nri).toBeCloseTo(1.2607202641, 6);
    expect(s.nti).toBeCloseTo(1.2607202641, 6);
    expect(s.nri).toBeGreaterThan(0);
  });
});
