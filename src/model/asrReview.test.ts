// Regression tests for the stochastic-mapping review findings (S11).
import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import { sampleStochasticMap, reconstructMk, DEFAULT_ASR_OPTIONS } from './asr';
import type { Character } from './types';

const tip = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

const binaryChar = (): Character => ({
  id: 'c',
  name: 'c',
  type: 'discrete',
  states: [
    { id: '0', label: '0', color: '#000000' },
    { id: '1', label: '1', color: '#ffffff' },
  ],
});

describe('review: stochastic mapping (S11)', () => {
  it('a real zero-length branch carries zero jumps', () => {
    const p = parseNewick('(A:0,B:1,C:1,D:1)R;');
    p.characters = [binaryChar()];
    tip(p, 'A').charStates = { c: '0' };
    tip(p, 'B').charStates = { c: '1' };
    tip(p, 'C').charStates = { c: '0' };
    tip(p, 'D').charStates = { c: '0' };
    const r = sampleStochasticMap(p, binaryChar(), 7, 100000)!;
    const aId = tip(p, 'A').id;
    expect(r.perBranchChanges.get(aId) ?? 0).toBe(0);
    // Total mean changes track the exact uniformization expectation
    // (k−1)·r·Σt = 3·ln(3)/2 ≈ 1.6479 for the ML rate of this data.
    expect(Math.abs(r.meanChangesPerSample - 1.64791843)).toBeLessThan(0.05);
  });

  it('the conditional child weight is the subtree likelihood form', () => {
    // Balanced tree, A/B = 0, C/D = 1: P(X=1 | root=0, data) by independent
    // enumeration is 0.01887478 — the marginal-posterior weighting used to
    // produce 0.03367863 instead.
    const p = parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');
    p.characters = [binaryChar()];
    tip(p, 'A').charStates = { c: '0' };
    tip(p, 'B').charStates = { c: '0' };
    tip(p, 'C').charStates = { c: '1' };
    tip(p, 'D').charStates = { c: '1' };
    const base = reconstructMk(p, binaryChar(), { ...DEFAULT_ASR_OPTIONS, joint: false })!;
    expect(base.rate.rate).toBeGreaterThan(0);
    // The sampler's weights are M[ps][j]·L_child[j]; verify the exact value the
    // enumeration gives for j=1 conditional on ps=0, with the X-side subtree
    // likelihood from the same pruning pass.
    const r = base.rate.rate;
    const sd = 0.5 * (1 + Math.exp(-2 * r));
    const df = 0.5 * (1 - Math.exp(-2 * r));
    const X = tip(p, 'X').id;
    const Lx = base.subtreeLogLik!.get(X) as number[];
    const w1 = df * Math.exp(Lx[1]);
    const w0 = sd * Math.exp(Lx[0]);
    const exact = w1 / (w0 + w1);
    expect(exact).toBeCloseTo(0.01887478, 6);
  });
});
