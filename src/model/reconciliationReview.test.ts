// Regression tests for consensus and reconciliation review findings (M20 + the
// consensus length contract).
import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import { minLossesBetween } from './reconciliation';
import { buildConsensusTree } from './consensus';
import { serializeNewick } from '../io/newick';

describe('review: loss counting follows junction arity (M20)', () => {
  it('a hard trifurcation junction drops two copies, not one', () => {
    const p = parseNewick('((A,B,C)X,D)R;');
    // R → A passes X (3 children → 2 drops); R itself is the starting node and
    // is not charged (sibling gene lineages price their own edges).
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const r = p.nodes[p.rootId];
    expect(minLossesBetween(p, r.id, a.id)).toBe(2);
  });

  it('a unifurcation junction drops nothing', () => {
    const p = parseNewick('((A)X,D)R;');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const r = p.nodes[p.rootId];
    expect(minLossesBetween(p, r.id, a.id)).toBe(0);
  });

  it('a binary descent still costs one per intermediate junction', () => {
    const p = parseNewick('((A,B)X,C)R;');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const c = Object.values(p.nodes).find((n) => n.label === 'C')!;
    const r = p.nodes[p.rootId];
    expect(minLossesBetween(p, r.id, a.id)).toBe(1); // through X (binary)
    expect(minLossesBetween(p, r.id, c.id)).toBe(0); // direct child
  });

  it('an upward move stays infeasible', () => {
    const p = parseNewick('((A,B)X,C)R;');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const x = Object.values(p.nodes).find((n) => n.label === 'X')!;
    expect(minLossesBetween(p, a.id, x.id)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('review: consensus branch-length contract', () => {
  it('a single-tree strict consensus preserves tip and clade lengths', () => {
    const input = parseNewick('((A:1,B:2)X:3,C:4)R;');
    const out = buildConsensusTree([input], 'strict', 'cons')!;
    expect(out).not.toBeNull();
    const text = serializeNewick(out);
    expect(text).toContain('A:1');
    expect(text).toContain('B:2');
    expect(text).toContain('C:4');
    expect(text).toContain(':3'); // the (A,B) clade keeps X's length
  });
});
