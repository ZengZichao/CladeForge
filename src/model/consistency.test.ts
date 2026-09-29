import { describe, it, expect } from 'vitest';
import { createEmptyProject, createCetaceanSample, createSampleProject } from './sampleTree';
import { addCharacter, addChildren, setNodeState } from './treeOps';
import { switchLayer } from './layers';
import { newCharacter } from './characters';
import {
  consistenceCheckCategories,
  characterCorrelations,
  characterCorrelationTests,
  checkConsistency,
  correlationPermutationTest,
  parsimonyCostGivenAssertions,
  testableCharacterPairs,
  MAX_TESTED_PAIRS,
} from './consistency';
import { holmAdjustFamily, holmBonferroni } from './stats';
import { parsimony } from './parsimony';
import { setLanguage } from '../ui/strings';
import type { Character, NodeId, Project } from './types';

describe('consistency', () => {
  it('flags a local mismatch when a node conflicts with all its children', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, p.rootId, char.id, s0); // root asserted s0
    setNodeState(p, a, char.id, s1);
    setNodeState(p, b, char.id, s1); // both children s1

    const issues = checkConsistency(p, char);
    expect(issues.some((i) => i.kind === 'local-mismatch' && i.nodeId === p.rootId)).toBe(true);
  });

  it('detects co-varying characters via shared change branches', () => {
    const p = createEmptyProject();
    const [g1, g2] = addChildren(p, p.rootId, 2);
    const [a, b] = addChildren(p, g1, 2);
    const [c, d] = addChildren(p, g2, 2);
    const X = newCharacter('X');
    const Y = newCharacter('Y');
    addCharacter(p, X);
    addCharacter(p, Y);
    const [x0, x1] = X.states.map((s) => s.id);
    const [y0, y1] = Y.states.map((s) => s.id);
    const pattern: [string, string, string][] = [
      [a, x0, y0],
      [b, x1, y1],
      [c, x0, y0],
      [d, x1, y1],
    ];
    for (const [tip, xi, yi] of pattern) {
      setNodeState(p, tip, X.id, xi);
      setNodeState(p, tip, Y.id, yi);
    }

    const cors = characterCorrelations(p);
    expect(cors).toHaveLength(1);
    expect(cors[0].score).toBeCloseTo(1);
    // The descriptive pass exposes the overlap ratio only — never a p-value.
    expect('pValue' in cors[0]).toBe(false);
  });
});

// --- the correlation statistics and their scope ------------------------------

/** Balanced 8-tip tree: root → (L,R), each → two pairs of tips. */
function eightTipTree(): { p: Project; ids: Record<string, string> } {
  const p = createEmptyProject('t8');
  const ids: Record<string, string> = { root: p.rootId };
  const [L, R] = addChildren(p, p.rootId, 2);
  ids.L = L;
  ids.R = R;
  const [L1, L2] = addChildren(p, L, 2);
  const [R1, R2] = addChildren(p, R, 2);
  Object.assign(ids, { L1, L2, R1, R2 });
  const groups: [string, string[]][] = [[L1, ['a', 'b']], [L2, ['c', 'd']], [R1, ['e', 'f']], [R2, ['g', 'h']]];
  for (const [parent, labels] of groups) {
    addChildren(p, parent, 2).forEach((id, i) => {
      ids[labels[i]] = id;
    });
  }
  return { p, ids };
}

/**
 * A character scored over the fixture's tips by label.
 *
 * The id is pinned to the name on purpose. The permutation test puts the two
 * characters of a pair in canonical (lexicographic-by-id) order so its p-value
 * cannot depend on argument order — which means a RANDOM id decides
 * which of the two state vectors is drawn from first, and the exact replicate
 * set (hence a pinned `exceeded` count) would wander by one every time this file
 * ran. Names are unique within each fixture, so the ids are too.
 */
function scoredCharacter(p: Project, ids: Record<string, string>, name: string, pattern: Record<string, 0 | 1>): Character {
  const c = newCharacter(name);
  c.id = `char-${name}`;
  addCharacter(p, c);
  const [s0, s1] = c.states.map((s) => s.id);
  for (const [label, k] of Object.entries(pattern)) setNodeState(p, ids[label], c.id, k === 0 ? s0 : s1);
  return c;
}

/**
 * The one-sided recipe kept as a witness, so the difference between the two nulls
 * stays reproducible instead of living in prose.
 *
 * It freezes `frozen`'s MP change set and re-draws ONLY `permuted`'s tip states, so
 * the null is generated around one character and the p-value becomes a function of
 * which character the caller passed first — the property `correlationPermutationTest`
 * re-drawing both vectors is there to avoid.
 */
function legacyOneSidedPermutationP(
  project: Project,
  frozen: Character,
  permuted: Character,
  permutations: number,
  seed: number,
): number {
  const A = parsimony(project, frozen).changeBranches;
  const B = parsimony(project, permuted).changeBranches;
  let observedShared = 0;
  for (const x of A) if (B.has(x)) observedShared += 1;
  const observedUnion = A.size + B.size - observedShared;
  const observed = observedUnion > 0 ? observedShared / observedUnion : 0;

  const tips: NodeId[] = [];
  const states: string[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    const v = n.charStates?.[permuted.id];
    if (typeof v === 'string' && permuted.states.some((s) => s.id === v)) {
      tips.push(n.id);
      states.push(v);
    }
  }
  const scratch: Project = { ...project, nodes: { ...project.nodes } };
  for (const id of tips) scratch.nodes[id] = { ...project.nodes[id] };

  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = states.map((_, i) => i);
  let exceeded = 0;
  for (let rep = 0; rep < permutations; rep += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    tips.forEach((tipId, i) => {
      const node = scratch.nodes[tipId];
      node.charStates = { ...node.charStates, [permuted.id]: states[order[i]] };
    });
    const Bp = parsimony(scratch, permuted).changeBranches;
    let shared = 0;
    for (const x of A) if (Bp.has(x)) shared += 1;
    const u = A.size + Bp.size - shared;
    const stat = u > 0 ? shared / u : 0;
    if (stat >= observed - 1e-12) exceeded += 1;
  }
  return (1 + exceeded) / (permutations + 1);
}

describe('character correlations — descriptive pass', () => {
  it('reports the overlap ratio with the whole-tree expectation, and no p-value', () => {
    const { p, ids } = eightTipTree();
    // X switches twice: whole clades L2 and R2 carry the derived state.
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const Y = scoredCharacter(p, ids, 'Y', { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 });
    void X;
    void Y;
    const Z = scoredCharacter(p, ids, 'Z', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const cors = characterCorrelations(p);
    const xz = cors.find((c) => (c.aId === X.id && c.bId === Z.id) || (c.aId === Z.id && c.bId === X.id));
    expect(xz).toBeDefined();
    expect(xz!.score).toBeCloseTo(1);
    expect(xz!.shared).toBe(2);
    expect(xz!.aBranches).toBe(2);
    expect(xz!.bBranches).toBe(2);
    // N = every branch of the tree (15 nodes, the root has no incoming branch).
    expect(xz!.totalBranches).toBe(14);
    expect(xz!.expectedShared).toBeCloseTo((2 * 2) / 14, 6);
    expect('pValue' in (xz as object)).toBe(false);
  });
});

describe('character correlations — tree-constrained permutation test', () => {
  it('gives a small p for perfectly co-varying characters and a large one for independent ones', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const same = scoredCharacter(p, ids, 'same', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const everyOther = scoredCharacter(p, ids, 'everyOther', { a: 0, b: 1, c: 0, d: 1, e: 0, f: 1, g: 0, h: 1 });

    const cov = correlationPermutationTest(p, X, same)!;
    expect(cov).not.toBeNull();
    expect(cov.score).toBeCloseTo(1);
    // p is a real permutation count, not a made-up floor: (1 + exceeded) / (1 + perms).
    expect(cov.pValue).toBeCloseTo((1 + cov.exceeded) / (cov.permutations + 1), 12);
    expect(cov.permutations).toBe(999);
    // Measured: 18 of 999 JOINT replicates reach Jaccard 1. A one-sided null that
    // froze one character and shuffled only the other gives 12; re-drawing both
    // vectors widens the null slightly, which is the honest cost of a
    // symmetric test — the fixture's ids are pinned so this count is exact.
    expect(cov.exceeded).toBe(18);
    expect(cov.pValue).toBeGreaterThan(cov.resolution); // never a fabricated 0
    expect(cov.pValue).toBeLessThan(0.1);
    expect(cov.nullMean).toBeLessThan(0.2); // the null sits far below the observed 1
    expect(cov.nullMean).toBeLessThan(cov.score);
    expect(cov.method).toMatch(/置换|permutation/);

    const ind = correlationPermutationTest(p, X, everyOther)!;
    expect(ind).not.toBeNull();
    expect(ind.score).toBe(0);
    expect(ind.pValue).toBeGreaterThan(0.2);
    // A bare `≤ 1` would pass whatever the implementation returned. An observation
    // of 0 is the worst case by construction, so EVERY permutation ties it: p is 1.
    expect(ind.exceeded).toBe(ind.permutations);
    expect(ind.pValue).toBe(1);
  });

  it('is deterministic for a fixed seed and respects the permutation count', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const Y = scoredCharacter(p, ids, 'Y', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const a = correlationPermutationTest(p, X, Y, { permutations: 200, seed: 11 })!;
    const b = correlationPermutationTest(p, X, Y, { permutations: 200, seed: 11 })!;
    expect(a.pValue).toBe(b.pValue);
    expect(a.exceeded).toBe(b.exceeded);
    expect(a.permutations).toBe(200);
    expect(a.resolution).toBeCloseTo(1 / 201, 10);
    // p must be a multiple of the resolution: a real permutation count.
    expect(Math.abs(a.pValue * (a.permutations + 1) - Math.round(a.pValue * (a.permutations + 1)))).toBeLessThan(1e-9);
  });

  /**
   * Freezing character A and permuting only B draws the replicate cloud around A's
   * observed change set, which makes the p-value a property of the ARGUMENT ORDER:
   * the same pair measured both ways comes out 0.038 / 0.052 for the A↔C pair
   * below. Under the null the two characters are exchangeable, so both vectors are
   * re-drawn and the pair is put in a canonical, declaration-order-free order
   * first.
   */
  it('reports the same p-value whichever way round the two characters are passed', () => {
    const { p, ids } = eightTipTree();
    const A = scoredCharacter(p, ids, 'A', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const C = scoredCharacter(p, ids, 'C', { a: 0, b: 0, c: 1, d: 1, e: 1, f: 1, g: 0, h: 0 });
    const E = scoredCharacter(p, ids, 'E', { a: 0, b: 0, c: 1, d: 0, e: 0, f: 0, g: 1, h: 0 });
    const pairs: [Character, Character][] = [[A, C], [A, E], [C, E], [A, A]];
    const options = { permutations: 499, seed: 8 };
    let asymmetricalUnderTheOldNull = 0;

    for (const [x, y] of pairs) {
      const fwd = correlationPermutationTest(p, x, y, options);
      const rev = correlationPermutationTest(p, y, x, options);
      const label = `${x.name}/${y.name}`;
      if (x === y) {
        // A character cannot co-vary with itself: refused, not tested.
        expect(fwd, label).toBeNull();
        expect(rev, label).toBeNull();
        continue;
      }
      expect(fwd, label).not.toBeNull();
      expect(rev, label).not.toBeNull();
      // The statistic and the whole inferential half of the row are symmetric.
      expect(rev!.pValue, label).toBe(fwd!.pValue);
      expect(rev!.exceeded, label).toBe(fwd!.exceeded);
      expect(rev!.nullMean, label).toBe(fwd!.nullMean);
      expect(rev!.permutations, label).toBe(fwd!.permutations);
      expect(rev!.score, label).toBe(fwd!.score);
      expect(rev!.shared, label).toBe(fwd!.shared);
      expect(rev!.expectedShared, label).toBe(fwd!.expectedShared);
      expect(rev!.sampleSize, label).toBe(fwd!.sampleSize);
      // The identity half follows the caller, so the panels keep matching their
      // rows by (aId, bId).
      expect(rev!.aId, label).toBe(y.id);
      expect(rev!.bId, label).toBe(x.id);
      expect(rev!.aBranches + rev!.bBranches, label).toBe(fwd!.aBranches + fwd!.bBranches);
      // The witness: the same pair under the one-sided null, same seed.
      const legacyFwd = legacyOneSidedPermutationP(p, x, y, options.permutations, options.seed);
      const legacyRev = legacyOneSidedPermutationP(p, y, x, options.permutations, options.seed);
      if (legacyFwd !== legacyRev) asymmetricalUnderTheOldNull += 1;
    }
    // The asymmetry is real in this fixture, so the equality above is not vacuous:
    // A↔C under the one-sided null comes out p = 0.038 one way and p = 0.052
    // the other (same seed, same document); the two-sided null answers 0.184 in
    // both directions, and A↔E / C↔E answer 1 either way.
    expect(asymmetricalUnderTheOldNull).toBeGreaterThan(0);
    // Not a vacuous symmetry: the three real pairs differ from each other.
    const pAC = correlationPermutationTest(p, A, C, options)!;
    const pAE = correlationPermutationTest(p, A, E, options)!;
    expect(pAC.pValue).not.toBe(pAE.pValue);
  });

  it('refuses to test a pair whose changes are too sparse to mean anything', () => {
    const p = createEmptyProject();
    const [g1, g2] = addChildren(p, p.rootId, 2);
    const [a, b] = addChildren(p, g1, 2);
    const [c] = addChildren(p, g2, 1);
    const X = scoredCharacter(p, { a, b, c }, 'X', { a: 0, b: 1, c: 0 });
    const Y = scoredCharacter(p, { a, b, c }, 'Y', { a: 0, b: 1, c: 0 });
    expect(correlationPermutationTest(p, X, Y)).toBeNull();
    // Both vectors are re-drawn, so a side with fewer than three scored tips
    // is refused too: permuting two observations is not a null distribution.
    const { p: q, ids: qids } = eightTipTree();
    const W = scoredCharacter(q, qids, 'W', { a: 0, b: 1, c: 0, d: 1, e: 0, f: 1, g: 0, h: 1 });
    const V = scoredCharacter(q, qids, 'V', { a: 0, b: 0, c: 1, d: 1, e: 1, f: 1, g: 0, h: 0 });
    expect(correlationPermutationTest(q, W, V)).not.toBeNull(); // 8 scored tips each
    for (const t of ['c', 'd', 'e', 'f', 'g', 'h']) setNodeState(q, qids[t], W.id, '?');
    expect(correlationPermutationTest(q, W, V)).toBeNull(); // W holds 2 observations
  });

  it('is unaffected by the order the characters were declared in', () => {
    const { p, ids } = eightTipTree();
    const A = scoredCharacter(p, ids, 'A', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const C = scoredCharacter(p, ids, 'C', { a: 0, b: 0, c: 1, d: 1, e: 1, f: 1, g: 0, h: 0 });
    const E = scoredCharacter(p, ids, 'E', { a: 0, b: 0, c: 1, d: 0, e: 0, f: 0, g: 1, h: 0 });
    const options = { permutations: 199, seed: 4 };
    const asDeclared = characterCorrelationTests(p, options);
    // Same document, characters declared in the opposite order.
    p.characters = [E, C, A];
    const reversed = characterCorrelationTests(p, options);
    p.characters = [A, C, E];

    const keyOf = (t: { aId: string; bId: string }) => [t.aId, t.bId].sort().join('|');
    const byPair = (rows: typeof asDeclared) => new Map(rows.map((t) => [keyOf(t), t]));
    const left = byPair(asDeclared);
    const right = byPair(reversed);
    expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
    expect(left.size).toBe(3); // A-C, A-E, C-E — the family did not change either
    for (const [key, row] of left) {
      const other = right.get(key)!;
      expect(other.pValue, key).toBe(row.pValue);
      expect(other.adjustedP, key).toBe(row.adjustedP);
      expect(other.familySize, key).toBe(row.familySize);
      expect(other.score, key).toBe(row.score); // the observed Jaccard is unchanged
    }
  });
});

// --- the Holm family is the TESTED family, once and everywhere ---------------

/** The 8-tip fixture's clades, as tip labels. */
const CLADE_TIPS: Record<string, string[]> = {
  L1: ['a', 'b'],
  L2: ['c', 'd'],
  R1: ['e', 'f'],
  R2: ['g', 'h'],
};

/** A character whose derived state covers whole clades of the 8-tip fixture. */
function cladeCharacter(
  p: Project,
  ids: Record<string, string>,
  name: string,
  clades: string[],
): Character {
  const pattern = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((t) => [
      t,
      clades.some((k) => CLADE_TIPS[k].includes(t)) ? 1 : 0,
    ]),
  ) as Record<string, 0 | 1>;
  return scoredCharacter(p, ids, name, pattern);
}

/**
 * Four characters, two projects. A↔B is perfectly co-varying (flagged at
 * Jaccard 1) in both. C↔D is DISJOINT in `alpha` — so the ≥0.5 screen drops it —
 * and IDENTICAL in `beta`, so the same screen keeps it. Everything else about
 * the two documents is the same, so the flag crossing is the only variable: the
 * correction must not let m move with it.
 */
function flagCrossingPair(flagged: boolean): { p: Project; chars: Character[] } {
  const { p, ids } = eightTipTree();
  const A = cladeCharacter(p, ids, 'A', ['L2', 'R2']);
  const B = cladeCharacter(p, ids, 'B', ['L2', 'R2']);
  const C = cladeCharacter(p, ids, 'C', ['L2', 'R1']);
  const D = cladeCharacter(p, ids, 'D', flagged ? ['L2', 'R1'] : ['L1', 'R2']);
  return { p, chars: [A, B, C, D] };
}

describe('Holm correction — one family definition for model and UI', () => {
  const options = { permutations: 199, seed: 6, maxPairs: 99 };

  it('m is the number of tested pairs, not the number of flagged pairs', () => {
    const { p } = flagCrossingPair(false);
    expect(testableCharacterPairs(p)).toHaveLength(6); // 4 characters → C(4,2)
    const rows = characterCorrelationTests(p, options);
    const flagged = rows.filter((r) => r.score >= 0.5);
    expect(rows).toHaveLength(6);
    expect(flagged).toHaveLength(1); // the ≥0.5 screen would have shrunk the family
    expect(new Set(rows.map((r) => r.familySize))).toEqual(new Set([6]));

    // Every row's partner came out of the WHOLE family.
    const whole = holmBonferroni(rows.map((r) => r.pValue));
    rows.forEach((row, i) => expect(row.adjustedP).toBeCloseTo(whole[i], 12));

    // Holm over the flagged subset alone silently un-corrects everything:
    // m = 1 means "no correction at all".
    const oldRecipe = holmBonferroni(flagged.map((r) => r.pValue));
    expect(oldRecipe).toHaveLength(1);
    expect(oldRecipe[0]).toBeCloseTo(flagged[0].pValue, 12);
    expect(flagged[0].adjustedP).toBeGreaterThan(flagged[0].pValue);
    // Hand-derived: the most significant pair of a 6-pair family is m × p.
    const min = rows.reduce((a, b) => (b.pValue < a.pValue ? b : a));
    expect(min.adjustedP).toBeCloseTo(6 * min.pValue, 12);
  });

  it('keeps every adjusted p fixed when an unrelated pair crosses the flag threshold', () => {
    const { p } = flagCrossingPair(false);
    const rows = characterCorrelationTests(p, options);
    const target = rows.find((r) => [r.aName, r.bName].sort().join('|') === 'A|B')!;
    expect(target).toBeDefined();

    // Move a DIFFERENT pair across the ≥0.5 line. The flag is a display
    // attribute of the row — it is not an input to the correction — so m and
    // every adjusted p are untouched, including the crossing pair's own.
    const crossed = rows.map((r) =>
      [r.aName, r.bName].sort().join('|') === 'C|D' ? { ...r, score: 0.9 } : r,
    );
    const reAdjusted = holmAdjustFamily(crossed);
    const after = reAdjusted.find((r) => [r.aName, r.bName].sort().join('|') === 'A|B')!;
    expect(after.adjustedP).toBe(target.adjustedP);
    expect(after.familySize).toBe(target.familySize);
    expect(after.pValue).toBe(target.pValue);
    // …and the pair that crossed keeps the number it had before it was flagged.
    const before = rows.find((r) => [r.aName, r.bName].sort().join('|') === 'C|D')!;
    const moved = reAdjusted.find((r) => [r.aName, r.bName].sort().join('|') === 'C|D')!;
    expect(moved.adjustedP).toBe(before.adjustedP);

    // Filtering the returned family for display cannot re-tune m either.
    const flaggedOnly = rows.filter((r) => r.score >= 0.5);
    expect(flaggedOnly.length).toBe(1);
    expect(flaggedOnly[0].familySize).toBe(rows.length);
    expect(flaggedOnly[0].adjustedP).toBe(target.adjustedP);
  });

  it('does not change m when a pair stops being flagged by the ≥0.5 screen', () => {
    const unflagged = characterCorrelationTests(flagCrossingPair(false).p, options);
    const flagged = characterCorrelationTests(flagCrossingPair(true).p, options);
    // The screen's output differs (1 pair vs 2)…
    expect(unflagged.filter((r) => r.score >= 0.5)).toHaveLength(1);
    expect(flagged.filter((r) => r.score >= 0.5)).toHaveLength(2);
    // …the family it is corrected against does not: same size, and A↔B's own
    // raw p is identical because nothing it depends on changed.
    expect(unflagged).toHaveLength(6);
    expect(flagged).toHaveLength(6);
    expect(new Set(flagged.map((r) => r.familySize))).toEqual(new Set([6]));
    const ab = (rows: typeof unflagged) => rows.find((r) => [r.aName, r.bName].sort().join('|') === 'A|B')!;
    expect(ab(flagged).pValue).toBe(ab(unflagged).pValue);
    // Stated as a number: a family taken from the flagged subset would correct A↔B
    // with m = 1 in one project and m = 2 in the other, and neither is the 6 pairs
    // actually tested — so its correction depends on whether an unrelated pair
    // clears 0.5.
    const oldFamilySize = (rows: typeof unflagged) => rows.filter((r) => r.score >= 0.5).length;
    expect([oldFamilySize(unflagged), oldFamilySize(flagged)]).toEqual([1, 2]);
    // Each project's adjusted values are Holm over its own 6-pair family.
    for (const rows of [unflagged, flagged]) {
      const whole = holmBonferroni(rows.map((r) => r.pValue));
      rows.forEach((row, i) => expect(row.adjustedP).toBeCloseTo(whole[i], 12));
    }
  });

  it('hands the UI the same family the model tested', () => {
    const { p } = flagCrossingPair(false);
    // The descriptive screen is a filter over the family, never the family: what
    // it flags must not be what the correction is told to count.
    const descriptive = characterCorrelations(p);
    const family = testableCharacterPairs(p);
    expect(descriptive.length).toBeLessThan(family.length);
    const pairKey = (aId: string, bId: string) => [aId, bId].sort().join('|');
    const tested = characterCorrelationTests(p, options);
    expect(family.map((f) => pairKey(f.a.id, f.b.id)).sort()).toEqual(
      tested.map((t) => pairKey(t.aId, t.bId)).sort(),
    );
    // …and nothing that was dropped by the flag is missing from the test family.
    const testedKeys = new Set(tested.map((t) => pairKey(t.aId, t.bId)));
    for (const row of descriptive) expect(testedKeys.has(pairKey(row.aId, row.bId))).toBe(true);
  });

  it('tests every pair of the shipped sample projects it can', () => {
    // The demo documents a reader actually opens. The family is whatever
    // carries a statistic, m is that family, and the ≥0.5 flag only filters the
    // rows afterwards — never the correction.
    for (const make of [createCetaceanSample, createSampleProject]) {
      const p = make();
      const family = testableCharacterPairs(p);
      expect(family.length, p.name).toBeGreaterThan(0);
      const rows = characterCorrelationTests(p, { permutations: 199, seed: 12 });
      expect(rows, p.name).toHaveLength(family.length);
      expect(rows.every((r) => r.familySize === family.length), p.name).toBe(true);
      const want = holmBonferroni(rows.map((r) => r.pValue));
      rows.forEach((row, i) => expect(row.adjustedP, p.name).toBeCloseTo(want[i], 12));
      // The descriptive screen flags a subset of exactly this family.
      const descriptive = characterCorrelations(p);
      expect(descriptive.length).toBeLessThanOrEqual(family.length);
      const keys = new Set(family.map((f) => [f.a.id, f.b.id].sort().join('|')));
      for (const d of descriptive) expect(keys.has([d.aId, d.bId].sort().join('|'))).toBe(true);
    }
  });

  it('states m of the family it actually ran when the work cap bites', () => {
    const { p } = flagCrossingPair(false);
    expect(testableCharacterPairs(p)).toHaveLength(6);
    const capped = characterCorrelationTests(p, { ...options, maxPairs: 3 });
    expect(capped).toHaveLength(3);
    expect(new Set(capped.map((r) => r.familySize))).toEqual(new Set([3]));
    const whole = holmBonferroni(capped.map((r) => r.pValue));
    capped.forEach((row, i) => expect(row.adjustedP).toBeCloseTo(whole[i], 12));
    // The cap is the shared constant the UI path is pointed at too, and a run
    // never reports more rows than its own m.
    const defaultRun = characterCorrelationTests(p, { permutations: 99, seed: 2 });
    expect(defaultRun.length).toBeLessThanOrEqual(MAX_TESTED_PAIRS);
    expect(defaultRun.every((r) => r.familySize === defaultRun.length)).toBe(true);
  });
});

describe('consistency categories — all five exist and can fire', () => {
  it('declares exactly five categories, matching the union type', () => {
    expect(consistenceCheckCategories().map((c) => c.kind).sort()).toEqual([
      'ambiguous',
      'excess-changes',
      'homoplasy',
      'local-mismatch',
      'missing-data',
    ]);
    expect(consistenceCheckCategories().every((c) => c.tag.length > 0)).toBe(true);
  });

  it('re-translates its tags after a language switch', () => {
    // The categories are built per call rather than as a module-level array from
    // `tr(...)` at import time: an array built at import freezes the tags in
    // whatever language happened to be active when the module first loaded.
    setLanguage('zh');
    const zh = consistenceCheckCategories().map((c) => c.tag);
    setLanguage('en');
    const en = consistenceCheckCategories().map((c) => c.tag);
    setLanguage('zh');
    expect(zh).toContain('同塑');
    expect(en).toContain('Homoplasy');
    expect(en.some((t) => /[一-鿿]/.test(t))).toBe(false);
  });

  it('C2 excess-changes fires on the shipped project under its own step matrix', () => {
    // C2 must not be gated on "character has no cost matrix": the demo project's
    // fully assigned character Habitat carries a Sankoff matrix, so the check could
    // never fire there. Both sides of the comparison use that same matrix.
    const p = createCetaceanSample();
    const habitat = p.characters.find((c) => c.costMatrix)!;
    expect(habitat).toBeDefined();
    const issues = checkConsistency(p, habitat);
    expect(issues.some((i) => i.kind === 'excess-changes')).toBe(true);
    expect(issues.find((i) => i.kind === 'excess-changes')?.tag).toBe('过多变化');
    // The competing layer's hypothesis is parsimony-consistent → no C2 there.
    switchLayer(p, p.layers[1].id);
    const alt = p.characters.find((c) => c.costMatrix)!;
    expect(checkConsistency(p, alt).some((i) => i.kind === 'excess-changes')).toBe(false);
  });

  it('C2 stays quiet as long as the assertions cost nothing beyond the tip data', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    // Internal nodes unassigned: the hypothesis cannot be costed at all, and the
    // asserted set is exactly the tips, so the constrained minimum must equal
    // the tip-only bound — the evidence-based baseline adds no bias of its own.
    expect(parsimonyCostGivenAssertions(p, X)).toBe(parsimony(p, X).cost);
    expect(checkConsistency(p, X).some((i) => i.kind === 'excess-changes')).toBe(false);
    for (const id of [ids.L, ids.R, ids.L1, ids.L2, ids.R1, ids.R2, ids.root]) {
      setNodeState(p, id, X.id, X.states[0].id);
    }
    expect(checkConsistency(p, X).some((i) => i.kind === 'excess-changes')).toBe(true);
  });

  it('C3 homoplasy fires when the MP reconstruction gains a state twice', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    const issues = checkConsistency(p, X);
    const hom = issues.filter((i) => i.kind === 'homoplasy');
    // A bare "length > 0" would also pass when every other node was flagged. This
    // tree gains state 2 exactly twice (clades L2 and R2), in exactly one report.
    expect(hom).toHaveLength(1);
    expect(hom[0].message).toMatch(/状态 2/);
    expect(hom[0].message).toMatch(/独立出现约 2 次/);
    expect(hom[0].severity).toBe('info'); // a homoplasy hint, not an error
  });

  it('C4 ambiguous fires on an equally parsimonious alternative', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, a, char.id, s0);
    setNodeState(p, b, char.id, s1);
    const issues = checkConsistency(p, char);
    expect(issues.some((i) => i.kind === 'ambiguous' && i.nodeId === p.rootId)).toBe(true);
  });

  it('C5 missing-data reports unscored tips and values that are not states', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1 });
    const missing = checkConsistency(p, X).filter((i) => i.kind === 'missing-data');
    expect(missing.length).toBe(1);
    expect(missing[0].message).toMatch(/4\/8|4 of 8/);

    // The matrix dialog's '?' code must be named, not counted as an observation.
    setNodeState(p, ids.e, X.id, '?');
    const withCode = checkConsistency(p, X).filter((i) => i.kind === 'missing-data');
    expect(withCode.some((i) => i.severity === 'warning')).toBe(true);
    expect(withCode.map((i) => i.message).join(' ')).toMatch(/不是本性状的状态|not states of this character/);

    // A state id that no longer exists (deleted state still referenced by a
    // stored layer or a hand-edited file) is reported the same way.
    const { p: p2, ids: ids2 } = eightTipTree();
    const C = scoredCharacter(p2, ids2, 'C', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    p2.nodes[ids2.a].charStates = { [C.id]: 'state-lost-long-ago' };
    const stale = checkConsistency(p2, p2.characters.find((c) => c.id === C.id)!);
    expect(stale.some((i) => i.kind === 'missing-data' && i.severity === 'warning')).toBe(true);
  });

  it('never treats a missing-data code as an observation in C1', () => {
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    setNodeState(p, ids.a, X.id, '?');
    setNodeState(p, ids.b, X.id, '?');
    setNodeState(p, ids.L1, X.id, X.states[1].id);
    // Both children of L1 are '?': no "all children are X" verdict.
    const issues = checkConsistency(p, X).filter((i) => i.kind === 'local-mismatch');
    expect(issues.some((i) => i.nodeId === ids.L1)).toBe(false);
  });
});

// --- C2 must not judge an evidenced hypothesis by a tips-only bar -----------

describe('C2 excess-changes — the baseline shares the hypothesis\'s evidence', () => {
  /** Fully assigned ancestral hypothesis: `asserted` internal states override. */
  function completeHypothesis(
    pattern: Record<string, 0 | 1>,
    internal: Record<string, 0 | 1>,
  ): { p: Project; ids: Record<string, string>; c: Character } {
    const { p, ids } = eightTipTree();
    const c = scoredCharacter(p, ids, 'H', pattern);
    const internals = ['root', 'L', 'R', 'L1', 'L2', 'R1', 'R2'];
    for (const key of internals) {
      setNodeState(p, ids[key], c.id, c.states[(internal[key] ?? 0) as 0 | 1].id);
    }
    return { p, ids, c };
  }

  const excess = (p: Project, c: Character) =>
    checkConsistency(p, c).filter((i) => i.kind === 'excess-changes');

  it('prices the constrained optimum where the plain one is, and never below it', () => {
    // Tips only (no internal assertions): the constrained minimum IS the
    // tip-only bound — the constrained reference adds no bias of its own.
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 1, h: 1 });
    expect(parsimony(p, X).cost).toBe(2);
    expect(parsimonyCostGivenAssertions(p, X)).toBe(2);

    // Pinning one internal node to a state the tips do not support can only
    // RAISE the achievable cost (measured: 2 → 3 here).
    setNodeState(p, ids.L1, X.id, X.states[1].id);
    expect(parsimonyCostGivenAssertions(p, X)).toBe(3);
    expect(parsimonyCostGivenAssertions(p, X)).toBeGreaterThanOrEqual(parsimony(p, X).cost);
  });

  it('is silent for a complete hypothesis that already attains the tip-only optimum', () => {
    // Derived state on clade L2 only; the hypothesis asserts exactly that.
    const { p, c } = completeHypothesis({ a: 0, b: 0, c: 1, d: 1, e: 0, f: 0, g: 0, h: 0 }, { L2: 1 });
    expect(parsimony(p, c).cost).toBe(1);
    expect(parsimonyCostGivenAssertions(p, c)).toBe(1);
    expect(excess(p, c)).toHaveLength(0);
  });

  it('does not call an evidenced, fully assigned hypothesis redundant', () => {
    // Every tip is ancestral; ONE internal node (clade L1) is asserted derived
    // on independent evidence — a classic fossil-bearing stem. Cost of the
    // hypothesis: 3 (the branch into L1 plus both its children). Judging 3 against
    // the tips-only minimum 0 is what would tell the user to simplify.
    const all0: Record<string, 0 | 1> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 };
    const { p, c } = completeHypothesis(all0, { L1: 1 });
    expect(parsimony(p, c).cost).toBe(0);
    expect(parsimonyCostGivenAssertions(p, c)).toBe(3);

    const issues = excess(p, c);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info'); // a prompt, never a verdict
    expect(issues[0].tag).toBe('过多变化');
    // The message attributes the whole gap to the assertions…
    expect(issues[0].message).toMatch(/由你断言的 7 个内部状态本身要求|demanded by the 7 internal state/);
    expect(issues[0].message).toMatch(/没有可省的空间|nothing to shave off/);
    // …and no "consider simplifying" verdict is attached.
    expect(issues[0].message).not.toMatch(/可考虑简化|consider simplifying/);
    // C1 still reports the genuine local tension, independently and as a warning.
    const local = checkConsistency(p, c).filter((i) => i.kind === 'local-mismatch');
    expect(local).toHaveLength(1);
    expect(local[0].severity).toBe('warning');
  });

  it('reports an assertion-raised floor even when the hypothesis is only partly assigned', () => {
    // Refusing to price anything without a complete assignment would skip the most
    // common real situation — a few asserted internal nodes — so a partial one is
    // costed too.
    const { p, ids } = eightTipTree();
    const X = scoredCharacter(p, ids, 'X', { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 });
    setNodeState(p, ids.L1, X.id, X.states[1].id);
    expect(parsimony(p, X).cost).toBe(0);
    const issues = excess(p, X);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toMatch(/尚未完整赋值|not fully assigned/);
    expect(issues[0].message).toMatch(/0 抬高到 3|from 0 \(tips only\) to 3/);
  });
});
