import { describe, it, expect } from 'vitest';
import { parseNewick } from '../io/newick';
import { reparent, rerootAtNode } from '../model/treeOps';
import { parsimony } from '../model/parsimony';
import { characterDataSignature } from './PropertiesPanel';

/**
 * The parsimony memo is keyed on this fingerprint so that dragging a node — which
 * rewrites `project` on every pointer-move — does not re-run the O(N·K²) pass for
 * a result that cannot have changed.
 */
describe('characterDataSignature ignores what parsimony does not read', () => {
  function sample() {
    const p = parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');
    const ch = { id: 'c1', name: 'n', type: 'discrete' as const, states: [
      { id: 's0', label: 'S0', color: '#f00' }, { id: 's1', label: 'S1', color: '#0f0' } ] };
    p.characters = [ch];
    for (const n of Object.values(p.nodes)) {
      if (n.childrenIds.length === 0) n.charStates = { [ch.id]: n.label === 'A' ? 's0' : 's1' };
    }
    return p;
  }

  it('is unchanged by a pure position edit (a drag frame)', () => {
    const p = sample();
    const before = characterDataSignature(p);
    const tip = Object.values(p.nodes).find((n) => n.label === 'A')!;
    p.nodes[tip.id] = { ...tip, position: { x: 321, y: 77 } };
    expect(characterDataSignature(p)).toBe(before);
  });

  it('changes when a state assignment changes', () => {
    const p = sample();
    const before = characterDataSignature(p);
    const tip = Object.values(p.nodes).find((n) => n.label === 'A')!;
    tip.charStates = { c1: 's1' };
    expect(characterDataSignature(p)).not.toBe(before);
  });

  it('changes when the Sankoff cost matrix changes', () => {
    const p = sample();
    const before = characterDataSignature(p);
    p.characters[0].costMatrix = [[0, 1], [2, 0]];
    expect(characterDataSignature(p)).not.toBe(before);
  });

  it('changes when a state is removed', () => {
    const p = sample();
    const before = characterDataSignature(p);
    p.characters[0].states.pop();
    expect(characterDataSignature(p)).not.toBe(before);
  });
});

/**
 * The other half of the same contract.
 *
 * `parsimony` walks the tree, so topology is part of what the memo caches. A
 * fingerprint of the node COUNT plus the state assignments would leave
 * reparenting, mirroring a node's children or re-rooting untouched, and the panel
 * would keep offering the suggestion computed for the previous tree shape.
 */
describe('characterDataSignature tracks tree topology', () => {
  function sample() {
    const p = parseNewick('((A:1,B:1)X:1,(C:1,D:1)Y:1)R;');
    const ch = {
      id: 'c1',
      name: 'n',
      type: 'discrete' as const,
      states: [
        { id: 's0', label: 'S0', color: '#f00' },
        { id: 's1', label: 'S1', color: '#0f0' },
      ],
    };
    p.characters = [ch];
    // States on the TIPS only, each clade uniform: ((s1,s1)X,(s0,s0)Y)R needs a
    // single change (the root split). Move one s1 tip into Y and the optimum
    // becomes 2 — so the answer genuinely depends on topology, not just on which
    // states are assigned. (This pair was searched for exhaustively over tip
    // assignments and every legal reparent, not hand-derived.)
    const set = (label: string, state: string) => {
      const n = Object.values(p.nodes).find((x) => x.label === label)!;
      n.charStates = { [ch.id]: state };
    };
    set('A', 's1');
    set('B', 's1');
    set('C', 's0');
    set('D', 's0');
    return p;
  }

  it('changes when a tip is reparented', () => {
    const p = sample();
    const before = characterDataSignature(p);
    const tip = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const other = Object.values(p.nodes).find((n) => n.label === 'Y')!;
    expect(reparent(p, tip.id, other.id)).toBe(true);
    expect(characterDataSignature(p)).not.toBe(before);
  });

  it('changes when a node is re-rooted', () => {
    const p = sample();
    const before = characterDataSignature(p);
    const tip = Object.values(p.nodes).find((n) => n.label === 'B')!;
    expect(rerootAtNode(p, tip.id)).toBe(true);
    expect(characterDataSignature(p)).not.toBe(before);
  });

  it('changes when a node’s children are mirrored', () => {
    const p = sample();
    const before = characterDataSignature(p);
    const x = Object.values(p.nodes).find((n) => n.label === 'X')!;
    x.childrenIds = [...x.childrenIds].reverse();
    expect(characterDataSignature(p)).not.toBe(before);
  });

  it('the fingerprint really is what the cached answer depends on', () => {
    // Not a tautology: the topology edit must also change `parsimony`'s result,
    // otherwise an invalidation this sensitive would buy nothing.
    const p = sample();
    const ch = p.characters[0];
    expect(parsimony(p, ch).cost).toBe(1);
    const tip = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const other = Object.values(p.nodes).find((n) => n.label === 'Y')!;
    reparent(p, tip.id, other.id);
    expect(parsimony(p, ch).cost).toBe(2);
  });
});
