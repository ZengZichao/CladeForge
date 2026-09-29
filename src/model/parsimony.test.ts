import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addCharacter, addChildren, setNodeState } from './treeOps';
import { newCharacter } from './characters';
import { parsimony } from './parsimony';

describe('parsimony', () => {
  it('reconstructs a single change with a tie at the root (uniform cost)', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, a, char.id, s0);
    setNodeState(p, b, char.id, s1);

    const r = parsimony(p, char);
    expect(r.cost).toBe(1);
    expect(r.states.get(p.rootId)?.length).toBe(2); // s0 / s1 tie
    expect(r.changeBranches.size).toBe(1);
  });

  it('an asymmetric step matrix breaks the tie toward the cheaper origin', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, a, char.id, s0);
    setNodeState(p, b, char.id, s1);
    // cost s0->s1 = 10, s1->s0 = 1: root should be s1 (one cheap loss to s0).
    char.costMatrix = [
      [0, 10],
      [1, 0],
    ];

    const r = parsimony(p, char);
    expect(r.cost).toBe(1);
    expect(r.states.get(p.rootId)).toEqual([s1]);
  });

  // ── what `states` is, and what it is not ──
  it('states is the parent-conditional tie set, not the set of states in some MP reconstruction', () => {
    // ((s0,s1),(s0,s1)) — the smallest tree where the two differ. Minimum is 2
    // changes, and every internal node can be s0 OR s1 across optimal
    // reconstructions; but the root's tie is broken one way, and from there each
    // child's alternatives collapse to a single state. Pinned by enumerating the
    // optimal assignments here rather than by trusting the prose, so the
    // distinction survives a future refactor of either side.
    const p = createEmptyProject();
    const [l, r] = addChildren(p, p.rootId, 2);
    const [l1, l2] = addChildren(p, l, 2);
    const [r1, r2] = addChildren(p, r, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, l1, char.id, s0);
    setNodeState(p, l2, char.id, s1);
    setNodeState(p, r1, char.id, s0);
    setNodeState(p, r2, char.id, s1);

    const res = parsimony(p, char);
    expect(res.cost).toBe(2);
    // The app's own claim at the two children: one state each.
    const leftTies = res.states.get(l) ?? [];
    expect(leftTies.length).toBe(1);

    // Ground truth: enumerate all 2^3 assignments of the three internal nodes.
    const ids = Object.keys(p.nodes);
    const tips = new Map<string, number>([[l1, 0], [l2, 1], [r1, 0], [r2, 1]]);
    const free = ids.filter((id) => !tips.has(id));
    const stateOf = new Map<string, number>([...tips]);
    const costOf = () =>
      ids.reduce((acc, id) => {
        const par = p.nodes[id].parentId;
        return !par ? acc : acc + (stateOf.get(par) === stateOf.get(id) ? 0 : 1);
      }, 0);
    const optimal: Array<Map<string, number>> = [];
    let best = Infinity;
    for (let code = 0; code < 1 << free.length; code += 1) {
      free.forEach((id, i) => stateOf.set(id, (code >> i) & 1));
      const c = costOf();
      if (c < best) { best = c; optimal.length = 0; }
      if (c === best) optimal.push(new Map(stateOf));
    }
    expect(best).toBe(res.cost);
    const globalAtLeft = new Set(optimal.map((a) => char.states[a.get(l) as number].id));
    expect(globalAtLeft.size).toBe(2); // both are optimal somewhere
    expect(new Set(leftTies).size).toBe(1); // the parent-conditional set reports one
    // ...and `mpStates` is the field that tells the truth about ambiguity: it
    // must equal the enumerated union, not the conditional set.
    expect([...(res.mpStates.get(l) ?? [])].sort()).toEqual([...globalAtLeft].sort());
    expect((res.mpStates.get(l) ?? []).length).toBeGreaterThan(leftTies.length);

    // And the chosen path is genuinely one of those optimal reconstructions —
    // the tie-break narrows the report, it does not mis-score the tree.
    const chosenCost = ids.reduce((acc, id) => {
      const par = p.nodes[id].parentId;
      if (!par) return acc;
      const a = char.states.findIndex((s) => s.id === res.chosen.get(par));
      const b = char.states.findIndex((s) => s.id === res.chosen.get(id));
      return acc + (a === b ? 0 : 1);
    }, 0);
    expect(chosenCost).toBe(res.cost);
  });

});
