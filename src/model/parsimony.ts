// Parsimony ancestral-state reconstruction (inference assist).
//
// A generalised Sankoff downpass/uppass over the tree that SUGGESTS ancestral
// states for internal nodes from the observed tip states, honouring an optional
// per-character step (cost) matrix. With a uniform matrix this reduces to Fitch
// parsimony. Only tips constrain the reconstruction; internal user hypotheses
// are deliberately ignored so the result is an independent reference baseline
// the user can accept or override — the tool never decides for the user.
//
// Polymorphic / partially-observed tips ("A or B") are encoded as a state SET
// (TreeNode.charStates value = string[]): the tip constrains the reconstruction
// to the cheapest member of the set, which is the Fitch & McPeek ambiguous-
// encoding semantics. A tip with no entry is fully missing data — a set is NOT
// missing data, and scoring one as the other would under-count steps.

import type { Character, NodeId, Project, TreeNode } from './types';

/**
 * Where the reported single path places its changes. Only meaningful when ties
 * exist (equally cheap reconstructions):
 *  - `sankoff-min` — the documented rule (keep the parent's state when tied,
 *    then the most frequent tip state, then declaration order);
 *  - `acrtran` — accelerated transformation: changes sit as DEEP (close to the
 *    root) as the co-optimal set allows, realised by preferring a state other
 *    than the parent's whenever that is still co-optimal;
 *  - `deltran` — delayed transformation: changes sit as SHALLOW as possible,
 *    realised by keeping the parent's state whenever possible.
 * The homoplasy count, the change-branch set and every downstream statistic
 * depend on this choice, so it is part of the method fingerprint.
 */
export type ParsimonyOptimization = 'sankoff-min' | 'acrtran' | 'deltran';

export interface ParsimonyOptions {
  optimization?: ParsimonyOptimization;
  /**
   * Uniform-random tie-break source. When provided, ties are resolved by
   * sampling instead of by the deterministic rule — this is how MPRs are
   * sampled (see sampleMprBranchRates), never how the UI reports a baseline.
   */
  rng?: () => number;
}

export interface ParsimonyResult {
  /**
   * The states that are equally cheap AT this node, holding the reconstruction
   * already chosen ABOVE it fixed. That qualifier is load-bearing: this is NOT
   * the set of states appearing in some most-parsimonious reconstruction of the
   * whole tree. On `((b,a),(b,a))` with a uniform matrix the minimum is 2
   * changes and each internal node may be `a` or `b` across optimal
   * reconstructions — but once the root is resolved to one of them by the
   * tie-break below, the child's alternatives collapse to that one state.
   * Anything that reports "the possible ancestral states" from this map
   * therefore under-states the ambiguity whenever an ancestor's tie-break
   * forecloses it; the global set is the union over all optimal assignments
   * (what phangorn::MPR returns). The `((b,a),(b,a))` case in parsimony.test.ts
   * pins the two apart.
   */
  states: Map<NodeId, string[]>;
  /**
   * The single state actually used for the reported path at each node, chosen
   * from `states` by the documented tie-break rule (or the optimization
   * variant — see ParsimonyOptions). Consumers that count changes must read
   * this instead of `states…[0]`, which follows declaration order only.
   */
  chosen: Map<NodeId, string>;
  /**
   * The states that occur in SOME most-parsimonious reconstruction of the whole
   * tree: { i : downpass[v][i] + outside[v][i] == cost }. This is the set a
   * reader means by "the ancestral state is ambiguous here" (and what
   * phangorn::MPR returns), and it is a superset of `states` — which is
   * conditional on the single ancestor path the tie-break happened to resolve.
   */
  mpStates: Map<NodeId, string[]>;
  /** Minimum total cost (= number of changes under a uniform matrix). */
  cost: number;
  /**
   * False when NO assignment of states can score a finite cost under the step
   * matrix (e.g. both transition directions forbidden while tips observe two
   * different states). The old reader collapsed that case to `cost = 0` — the
   * best possible score — reporting an infeasible model as a perfect fit.
   */
  feasible: boolean;
  /** Child node ids whose entering branch carries a change in the chosen MP path. */
  changeBranches: Set<NodeId>;
}

const INF = Number.POSITIVE_INFINITY;
const EMPTY: ParsimonyResult = {
  states: new Map(),
  chosen: new Map(),
  mpStates: new Map(),
  cost: 0,
  feasible: true,
  changeBranches: new Set(),
};

/** Equality tolerance for co-optimality tests with non-integer step matrices. */
const COST_EPS = 1e-9;
function costEquals(a: number, b: number): boolean {
  // Relative epsilon only over FINITE costs. `a === b` lets the two INF rows
  // (forbidden / unreachable states) stay tied; falling through to the relative
  // test would make |INF − 0| <= 1e-9·max(1, INF, 0) true — every impossible
  // state would then join the tie set and tips would report themselves
  // ambiguous (the oracle suite caught exactly that).
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= COST_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Cost of a state i → j change, defaulting to a uniform (Fitch) matrix.
 * `Infinity` is a LEGAL matrix entry and forbids the transition outright (the
 * DP propagates it naturally); only a NaN cell falls back to the default —
 * silently turning "forbidden" into "cost 1" would invert the user's strongest
 * assumption without a word.
 */
export function costOf(matrix: number[][] | undefined, i: number, j: number): number {
  const v = matrix?.[i]?.[j];
  if (typeof v !== 'number') return i === j ? 0 : 1;
  if (Number.isNaN(v)) return i === j ? 0 : 1;
  return v;
}

/** The tip's observed value as a state-id set, or null when missing/unconstrained. */
function tipStateSet(n: TreeNode, characterId: string): string[] | null {
  const v = n.charStates?.[characterId];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v;
  return null;
}

export function parsimony(
  project: Project,
  character: Character,
  options?: ParsimonyOptions,
): ParsimonyResult {
  if (character.type !== 'discrete' || character.states.length === 0) return EMPTY;
  const root = project.nodes[project.rootId];
  if (!root) return EMPTY;

  const stateIds = character.states.map((s) => s.id);
  const k = stateIds.length;

  // True Dollo (Farris 1977; PHYLIP DOLLOP): the derived state may be GAINED
  // ONCE on the whole tree and lost any number of times. No step matrix can
  // express "at most one gain" — the preset labelled `dollo` used to feed the
  // DP an irreversible LOCAL-cost matrix, which quietly allowed a fresh gain on
  // every branch (a Camin–Sokal-style irreversible model wearing Dollo's name).
  // Binary characters tagged model:'dollo' therefore run a dedicated DP over
  // (trait, gain-used) states instead of the matrix.
  if (character.model === 'dollo' && k === 2) {
    return dolloParsimony(project, character, options);
  }
  const index = new Map(stateIds.map((id, i) => [id, i]));
  const matrix = character.costMatrix;
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];

  // Post-order (children before parents), with an on-stack guard so a corrupt
  // parent/child cycle cannot spin forever — the same invariant the other
  // traversal modules carry.
  const order: TreeNode[] = [];
  const stack: TreeNode[] = [root];
  const onStack = new Set<NodeId>([root.id]);
  const seen = new Set<NodeId>([root.id]);
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    onStack.delete(n.id);
    order.push(n);
    for (const c of childrenOf(n)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      onStack.add(c.id);
      stack.push(c);
    }
  }
  order.reverse();

  // Downpass: g[node][i] = min subtree cost given `node` is in state i.
  const g = new Map<NodeId, number[]>();
  for (const n of order) {
    const children = childrenOf(n);
    const arr = new Array<number>(k).fill(0);
    if (children.length === 0) {
      const observed = tipStateSet(n, character.id);
      if (observed) {
        // Partially observed (a set): the cheapest member constrains; states
        // outside the set are forbidden (INF). Fully-unknown members are
        // ignored rather than poisoning the whole set.
        const members = observed
          .map((sid) => index.get(sid))
          .filter((i): i is number => i !== undefined);
        if (members.length > 0) {
          for (let i = 0; i < k; i += 1) arr[i] = members.includes(i) ? 0 : INF;
        }
      }
      // Unassigned tip = missing data → all zeros (no constraint).
    } else {
      for (let i = 0; i < k; i += 1) {
        let sum = 0;
        for (const c of children) {
          const gc = g.get(c.id) as number[];
          let best = INF;
          for (let j = 0; j < k; j += 1) {
            const v = costOf(matrix, i, j) + gc[j];
            if (v < best) best = v;
          }
          sum += best;
        }
        arr[i] = sum;
      }
    }
    g.set(n.id, arr);
  }

  const rootG = g.get(root.id) as number[];
  let rootMin = INF;
  for (let i = 0; i < k; i += 1) if (rootG[i] < rootMin) rootMin = rootG[i];
  // An infinite root minimum means the matrix admits NO assignment consistent
  // with the observed tips — that must be REPORTED, never flattened to 0 (the
  // best conceivable score).
  const feasible = Number.isFinite(rootMin);
  const cost = feasible ? rootMin : INF;

  // Uppass: assign each node a state minimising cost given its parent's state,
  // recording tie sets for display and change branches for the chosen path.
  //
  // Tie-breaking is explicit and data-driven: taking `ties[0]` hands the answer to
  // whatever order the user happened to add states in, and that single choice then
  // feeds the homoplasy count, the co-change statistic and every "changes" tally.
  // Rule (`sankoff-min`), in order:
  //   1. keep the parent's state when it is among the ties (no gratuitous
  //      change on the branch),
  //   2. otherwise the state observed most often at the tips,
  //   3. only as a last resort the earliest declared state.
  // `optimization` replaces step 1 when the user asks for ACCTRAN / DELTRAN
  // (see ParsimonyOptions); `rng` replaces the whole rule with uniform sampling
  // among the ties (MPR sampling).
  // `states` keeps every alternative that survives THIS parent state, so the
  // ambiguity is not hidden by picking one path — but it is a
  // parent-conditional set, not the set of states occurring in some optimal
  // reconstruction of the whole tree (see the `states` field docs).
  const optimization = options?.optimization ?? 'sankoff-min';
  const rng = options?.rng;
  const states = new Map<NodeId, string[]>();
  const chosenStates = new Map<NodeId, string>();
  const changeBranches = new Set<NodeId>();

  // Tip frequency for the tie-break. A polymorphic tip contributes 1 to EACH
  // of its members (a set is weaker evidence than a single observation, but
  // not zero).
  const tipFreq = new Array<number>(k).fill(0);
  for (const n of order) {
    if (n.childrenIds.length > 0) continue;
    const observed = tipStateSet(n, character.id);
    if (!observed) continue;
    for (const sid of observed) {
      const i = index.get(sid);
      if (i !== undefined) tipFreq[i] += 1;
    }
  }

  const costFrom = (gn: number[], parentState: number | null, j: number): number =>
    (parentState === null ? 0 : costOf(matrix, parentState, j)) + gn[j];

  // Walking the post-order list backwards is a valid pre-order (parents before
  // children), so no recursion is needed — deep trees cannot overflow the stack.
  const parentStateOf = new Map<NodeId, number | null>([[root.id, null]]);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const gn = g.get(n.id) as number[];
    const parentState = parentStateOf.get(n.id) ?? null;
    let best = INF;
    for (let j = 0; j < k; j += 1) {
      const v = costFrom(gn, parentState, j);
      if (v < best) best = v;
    }
    const ties: number[] = [];
    for (let j = 0; j < k; j += 1) {
      if (costEquals(costFrom(gn, parentState, j), best)) ties.push(j);
    }
    let chosen: number | undefined = ties[0];
    if (rng) {
      // Sampled MPR: uniform among the co-optimal states.
      chosen = ties[Math.floor(rng() * ties.length) % ties.length];
    } else if (optimization === 'acrtran' && parentState !== null) {
      // Accelerated: prefer realising the change HERE (deep) when co-optimal —
      // i.e. prefer a state different from the parent's.
      const away = ties.filter((j) => j !== parentState);
      if (away.length > 0) {
        let bestFreq = -1;
        for (const j of away) {
          if (tipFreq[j] > bestFreq) {
            bestFreq = tipFreq[j];
            chosen = j;
          }
        }
        if (bestFreq < 0) chosen = away[0];
      } else {
        chosen = parentState;
      }
    } else if (parentState !== null && ties.includes(parentState)) {
      // Delayed (deltran, and the sankoff-min rule's step 1): keep the parent's
      // state so the change happens further down.
      chosen = parentState;
    } else {
      let bestFreq = -1;
      for (const j of ties) {
        if (tipFreq[j] > bestFreq) {
          bestFreq = tipFreq[j];
          chosen = j;
        }
      }
    }
    states.set(
      n.id,
      ties.map((j) => stateIds[j]),
    );
    if (typeof chosen !== 'undefined') chosenStates.set(n.id, stateIds[chosen]);
    if (parentState !== null && chosen !== parentState) changeBranches.add(n.id);
    for (const c of n.childrenIds) parentStateOf.set(c, chosen);
  }

  // Everything OUTSIDE each subtree, minimised, given that node's state — the
  // mirror of the downpass. `states` above cannot answer "which states occur in
  // SOME optimal reconstruction", because it only ever sees the one ancestor
  // path the tie-break resolved; ((b,a),(b,a)) is the smallest tree where that
  // distinction changes what a reader is told.
  const outside = new Map<NodeId, number[]>();
  outside.set(root.id, new Array<number>(k).fill(0));
  // Walking the post-order list backwards is pre-order, so a node's `outside`
  // row exists before any child needs it — and no recursion is involved.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const children = childrenOf(n);
    if (children.length === 0) continue;
    const un = outside.get(n.id) as number[];
    // best[c][ps] = cheapest cost of child c's subtree given the parent is in
    // state ps. Tabulating it once per child keeps this pass O(degree · k²):
    // excluding one sibling from a running total is cheaper than re-minimising
    // over every sibling for every child.
    const best = children.map((c) => {
      const gc = g.get(c.id) as number[];
      const row = new Array<number>(k).fill(0);
      for (let ps = 0; ps < k; ps += 1) {
        let m = INF;
        for (let j = 0; j < k; j += 1) {
          const v = costOf(matrix, ps, j) + gc[j];
          if (v < m) m = v;
        }
        row[ps] = m;
      }
      return row;
    });
    const totalBest = new Array<number>(k).fill(0);
    for (let ps = 0; ps < k; ps += 1) {
      for (let j = 0; j < children.length; j += 1) totalBest[ps] += best[j][ps];
    }
    for (let ci = 0; ci < children.length; ci += 1) {
      const upToParent = new Array<number>(k).fill(0);
      for (let ps = 0; ps < k; ps += 1) upToParent[ps] = un[ps] + totalBest[ps] - best[ci][ps];
      const out = new Array<number>(k).fill(INF);
      for (let t = 0; t < k; t += 1) {
        let best = INF;
        for (let ps = 0; ps < k; ps += 1) {
          const v = costOf(matrix, ps, t) + upToParent[ps];
          if (v < best) best = v;
        }
        out[t] = best;
      }
      outside.set(children[ci].id, out);
    }
  }
  const mpStates = new Map<NodeId, string[]>();
  for (const n of order) {
    const gd = g.get(n.id) as number[];
    const un = outside.get(n.id) as number[];
    const keep: string[] = [];
    for (let j = 0; j < k; j += 1) {
      // Tolerant equality: non-integer step matrices sum in different orders
      // on the down- and up-pass, and exact `===` could report NO co-optimal
      // state at all, silently emptying the ambiguity set.
      if (costEquals(gd[j] + un[j], cost)) keep.push(stateIds[j]);
    }
    mpStates.set(n.id, keep);
  }

  return { states, chosen: chosenStates, mpStates, cost, feasible, changeBranches };
}

/**
 * True-Dollo DP for binary characters tagged model:'dollo' (see parsimony()).
 *
 * The derived state is GAINED once on the whole tree (on one branch, or at the
 * root) and may be LOST any number of times afterwards. A (trait, gain-used)
 * per-node state cannot express this — the flag is a GLOBAL resource, and a
 * path-local copy lets every sibling subtree buy its own gain. The exact
 * decomposition instead enumerates the gain position: with the gain on the
 * branch entering `c`, everything outside c's subtree is forced trait 0 (no
 * gain is left there), c enters at trait 1, and c's subtree follows the
 * post-gain model (1→0 losses allowed, 0→1 forbidden):
 *
 *   cost(gain at c) = 1 + down_post[c][1]    if every forced-1 tip is inside c
 *                   = INF                    otherwise
 *   cost(no gain)   = 0                      when no tip forces trait 1
 *
 * `down_post` is one O(n) bottom-up pass, so the whole analysis is O(n).
 * Reconstruction picks the SHALLOWEST optimal gain position (ties only occur
 * along unifurcation chains, where the extra segments carry no tips and cannot
 * change any cost); `mpStates` reports the traits co-optimal under that gain
 * position, plus trait 1 for any node that is itself an optimal gain position.
 * A gain AT THE ROOT contributes to `cost` but has no entering branch, so it
 * does not appear in `changeBranches`.
 */
function dolloParsimony(
  project: Project,
  character: Character,
  options?: ParsimonyOptions,
): ParsimonyResult {
  const root = project.nodes[project.rootId];
  if (!root) return EMPTY;
  const stateIds = character.states.map((s) => s.id);
  const zero = stateIds[0];
  const one = stateIds[1];
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];

  // Post-order with the same cycle guard as the matrix path.
  const order: TreeNode[] = [];
  {
    const stack: TreeNode[] = [root];
    const seen = new Set<NodeId>([root.id]);
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      order.push(n);
      for (const c of childrenOf(n)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        stack.push(c);
      }
    }
    // The DFS above yields a PRE-order; reversing makes it a post-order
    // (children before parents), which the downpass requires.
    order.reverse();
  }

  // Observed trait set of a tip: members of {zero, one}, or null when the tip
  // is unconstrained (missing / an empty observation).
  const observedOf = (n: TreeNode): string[] | null => {
    const observed = tipStateSet(n, character.id);
    if (!observed) return null;
    const members = observed.filter((s) => s === zero || s === one);
    return members.length > 0 ? members : null;
  };

  // Post-gain subtree cost: down[node][t] = min subtree cost with the node in
  // trait t, losses allowed, re-gains forbidden. M[0][1] = INF is the whole
  // constraint.
  const M_POST = [
    [0, INF],
    [1, 0],
  ];
  const down = new Map<NodeId, number[]>();
  const forcedOneBelow = new Map<NodeId, number>();
  for (const n of order) {
    const children = childrenOf(n);
    const observed = observedOf(n);
    const forced1 = observed !== null && !observed.includes(zero) ? 1 : 0;
    const arr = new Array<number>(2).fill(0);
    if (children.length === 0) {
      if (observed !== null) {
        for (let t = 0; t < 2; t += 1) arr[t] = observed.includes(t === 1 ? one : zero) ? 0 : INF;
      }
    } else {
      for (let t = 0; t < 2; t += 1) {
        let sum = 0;
        for (const c of children) {
          const gc = down.get(c.id) as number[];
          let best = INF;
          for (let u = 0; u < 2; u += 1) {
            const v = M_POST[t][u] + gc[u];
            if (v < best) best = v;
          }
          sum += best;
        }
        arr[t] = sum;
      }
    }
    down.set(n.id, arr);
    forcedOneBelow.set(
      n.id,
      forced1 + children.reduce((a, c) => a + (forcedOneBelow.get(c.id) ?? 0), 0),
    );
  }

  // Enumerate gain positions. Every forced-1 tip must lie inside the chosen
  // subtree; otherwise the outside would need a second gain.
  const totalForced1 = forcedOneBelow.get(root.id) ?? 0;
  const noGainCost = totalForced1 === 0 ? 0 : INF;
  interface GainCandidate {
    nodeId: NodeId | null; // null = the gain at the root itself
    cost: number;
    depth: number;
  }
  const candidates: GainCandidate[] = [];
  if (Number.isFinite(noGainCost)) candidates.push({ nodeId: null, cost: 0, depth: -1 });
  {
    // depth of each node (edges from the root), iterative.
    const depth = new Map<NodeId, number>([[root.id, 0]]);
    const queue: NodeId[] = [root.id];
    while (queue.length) {
      const id = queue.shift() as NodeId;
      const n = project.nodes[id];
      if (!n) continue;
      for (const c of n.childrenIds) {
        if (!project.nodes[c] || depth.has(c)) continue;
        depth.set(c, (depth.get(id) as number) + 1);
        queue.push(c);
      }
    }
    // The gain AT THE ROOT: the whole tree is post-gain. The root has no
    // entering branch, so this candidate carries the gain cost without ever
    // showing up in `changeBranches`.
    const rootSubtreeCost = (down.get(root.id) as number[])[1];
    if (Number.isFinite(rootSubtreeCost)) {
      candidates.push({ nodeId: root.id, cost: 1 + rootSubtreeCost, depth: 0 });
    }
    for (const n of Object.values(project.nodes)) {
      if (n.parentId === null) continue;
      if ((forcedOneBelow.get(n.id) ?? 0) !== totalForced1) continue;
      const subtreeCost = (down.get(n.id) as number[])[1];
      if (!Number.isFinite(subtreeCost)) continue;
      candidates.push({ nodeId: n.id, cost: 1 + subtreeCost, depth: depth.get(n.id) ?? 0 });
    }
  }
  let best = noGainCost;
  for (const c of candidates) if (c.cost < best) best = c.cost;
  if (!Number.isFinite(best)) {
    // Unreachable in practice (the all-0 assignment always exists), guarded so
    // the contract cannot silently break.
    return {
      states: new Map(),
      chosen: new Map(),
      mpStates: new Map(),
      cost: INF,
      feasible: false,
      changeBranches: new Set(),
    };
  }
  // Shallowest optimal gain position; ties only occur along unifurcation
  // chains, where the choice cannot change any cost.
  const chosenGain = candidates
    .filter((c) => c.cost === best)
    .sort((a, b) => a.depth - b.depth)[0];

  const states = new Map<NodeId, string[]>();
  const chosenStates = new Map<NodeId, string>();
  const changeBranches = new Set<NodeId>();

  const optimization = options?.optimization ?? 'sankoff-min';
  const rng = options?.rng;

  if (chosenGain.nodeId === null) {
    // No gain anywhere: every node is trait 0.
    for (const n of order) {
      states.set(n.id, [zero]);
      chosenStates.set(n.id, zero);
    }
    return { states, chosen: chosenStates, mpStates: new Map(states), cost: 0, feasible: true, changeBranches };
  }

  // Nodes outside the gain subtree (above it): forced trait 0.
  const gainId = chosenGain.nodeId;
  const inside = new Set<NodeId>(collectSubtreeIds(project, gainId));

  // Reconstruct: outside all 0; at the gain node trait 1 (the gain itself);
  // below it the post-gain uppass with the shared tie-break family.
  const parentTrait = new Map<NodeId, number | null>([[root.id, null]]);
  // Process in pre-order (parents before children).
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const pt = parentTrait.get(n.id) ?? null;
    if (!inside.has(n.id) || (pt === 0 && n.id !== gainId)) {
      // Outside the gained subtree, or on a 0-path inside it that cannot
      // re-gain: trait 0 is the only reachable trait when the subtree cost
      // under 0 is finite; if the node is INSIDE and its parent is 0 but the
      // node is not below the gain, it can only be 0 as well.
      const dn = down.get(n.id) as number[];
      const t = Number.isFinite(dn[0]) ? 0 : 1;
      states.set(n.id, [t === 1 ? one : zero]);
      chosenStates.set(n.id, t === 1 ? one : zero);
      if (pt !== null && t !== pt) changeBranches.add(n.id);
      for (const c of n.childrenIds) parentTrait.set(c, t);
      continue;
    }
    if (n.id === gainId) {
      // The gain: trait 1 by construction.
      states.set(n.id, [one]);
      chosenStates.set(n.id, one);
      if (pt !== null && pt !== 1) changeBranches.add(n.id);
      for (const c of n.childrenIds) parentTrait.set(c, 1);
      continue;
    }
    // Below the gain: post-gain uppass.
    const dn = down.get(n.id) as number[];
    const costFrom = (t: number): number => (pt === null ? 0 : M_POST[pt][t]) + dn[t];
    let localBest = INF;
    for (let t = 0; t < 2; t += 1) {
      const v = costFrom(t);
      if (v < localBest) localBest = v;
    }
    const ties: number[] = [];
    for (let t = 0; t < 2; t += 1) if (costEquals(costFrom(t), localBest)) ties.push(t);
    let chosen: number = ties[0];
    if (rng) {
      chosen = ties[Math.floor(rng() * ties.length) % ties.length];
    } else if (optimization === 'acrtran' && pt !== null) {
      const away = ties.filter((t) => t !== pt);
      chosen = away.length > 0 ? away[0] : pt;
    } else if (pt !== null && ties.includes(pt)) {
      chosen = pt; // delayed / sankoff-min step 1: keep the parent's trait
    }
    states.set(n.id, ties.map((t) => (t === 1 ? one : zero)));
    chosenStates.set(n.id, chosen === 1 ? one : zero);
    if (pt !== null && chosen !== pt) changeBranches.add(n.id);
    for (const c of n.childrenIds) parentTrait.set(c, chosen);
  }

  // Global MPR set. For nodes inside the gained subtree an exact outside pass
  // over the post-gain model says which traits are co-optimal; for nodes above
  // the gain only trait 0 is reachable — except where the gain itself can
  // slide up an optimal unifurcation chain (`canOne` marks every node that is
  // an optimal gain position).
  const subtreeTotal = (down.get(gainId) as number[])[1];
  const canOne = new Set<NodeId>();
  for (const c of candidates) {
    if (c.cost === best && c.nodeId !== null) canOne.add(c.nodeId);
  }
  // Pre-order walk from the gain node down (parents before children).
  const outside2 = new Map<NodeId, number[]>();
  outside2.set(gainId, [0, 0]);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    if (n.id === gainId || !inside.has(n.id)) continue;
    const parent = n.parentId !== null ? project.nodes[n.parentId] : null;
    const un = parent ? outside2.get(parent.id) : undefined;
    if (!parent || !un) continue;
    const siblings = childrenOf(parent).filter((c) => c.id !== n.id);
    const out = new Array<number>(2).fill(INF);
    for (let t = 0; t < 2; t += 1) {
      for (let p = 0; p < 2; p += 1) {
        if (!Number.isFinite(un[p]) || !Number.isFinite(M_POST[p][t])) continue;
        let sib = 0;
        for (const sibNode of siblings) {
          const gd = down.get(sibNode.id) as number[];
          let m = INF;
          for (let u = 0; u < 2; u += 1) {
            const v = M_POST[p][u] + gd[u];
            if (v < m) m = v;
          }
          sib += m;
        }
        const v = un[p] + M_POST[p][t] + sib;
        if (v < out[t]) out[t] = v;
      }
    }
    outside2.set(n.id, out);
  }
  const mpStates = new Map<NodeId, string[]>();
  for (const n of order) {
    const keep: string[] = [];
    const dn = down.get(n.id) as number[];
    if (!inside.has(n.id)) {
      // Above the gained subtree: trait 0 forced, trait 1 only when the node
      // is itself an optimal gain position (the gain slides up the chain).
      keep.push(zero);
      if (canOne.has(n.id) && Number.isFinite(dn[1])) keep.push(one);
    } else {
      const un = outside2.get(n.id) ?? [0, 0];
      if (Number.isFinite(dn[0]) && costEquals(dn[0] + un[0], subtreeTotal)) keep.push(zero);
      if (Number.isFinite(dn[1]) && costEquals(dn[1] + un[1], subtreeTotal)) keep.push(one);
      // The gain node itself is trait 1 by construction; keep 1 visible even
      // when the outside pass ties it with a slid-down gain.
      if (n.id === gainId && !keep.includes(one)) keep.push(one);
    }
    if (keep.length === 0) keep.push(chosenStates.get(n.id) ?? zero);
    mpStates.set(n.id, keep);
  }

  return { states, chosen: chosenStates, mpStates, cost: best, feasible: true, changeBranches };
}

/** Collect the ids of the subtree rooted at `id` (iterative, cycle-guarded). */
function collectSubtreeIds(project: Project, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [id];
  const seen = new Set<NodeId>([id]);
  while (stack.length) {
    const cur = stack.pop() as NodeId;
    const n = project.nodes[cur];
    if (!n) continue;
    out.push(cur);
    for (const c of n.childrenIds) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}


/**
 * Sample MPRs and report, per branch, the fraction of sampled optimal
 * reconstructions that carry a change on it. Counting MPRs exactly is #P-hard,
 * so this is a sampling estimate — with `samples` draws the per-branch rate has
 * standard error ≤ 0.5/√samples. The UI must label the numbers as sampled
 * approximations ("≈", with the sample size), never as exact probabilities.
 */
export function sampleMprBranchRates(
  project: Project,
  character: Character,
  samples = 100,
  seed = 20260919,
): { rates: Map<NodeId, number>; samples: number; cost: number } {
  let s = seed >>> 0;
  const rng = (): number => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tally = new Map<NodeId, number>();
  let cost = 0;
  let used = 0;
  for (let i = 0; i < samples; i += 1) {
    const r = parsimony(project, character, { rng });
    if (!r.feasible) continue;
    if (r.cost === 0 && r.changeBranches.size === 0 && r.chosen.size === 0) continue;
    used += 1;
    cost = r.cost;
    for (const id of r.changeBranches) tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  const rates = new Map<NodeId, number>();
  if (used > 0) {
    for (const [id, n] of tally) rates.set(id, n / used);
  }
  return { rates, samples: used, cost };
}

/** A fresh uniform step matrix (0 on the diagonal, 1 elsewhere) of size k. */
export function uniformCostMatrix(k: number): number[][] {
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 0 : 1)),
  );
}

/**
 * Model presets for a k-state character (Farris 1989 terminology):
 *  - unordered (Fitch): every change costs 1;
 *  - wagner: ordered — cost = |i − j| (adjacent states are cheapest);
 *  - dollo: irreversible — the 0→1 gain costs 1, everything else is forbidden.
 *
 * NOTE the limit of what a matrix can say: a step matrix prices LOCAL changes,
 * so this preset is an irreversible (Camin–Sokal-style) model that permits a
 * fresh gain on every branch. The whole-tree single-gain constraint that
 * defines true DOLLO is not expressible as a matrix — `parsimony()` enforces
 * it with a dedicated (trait, gain-used) DP whenever a binary character is
 * tagged model:'dollo', which supersedes this matrix for that tag.
 */
export function presetCostMatrix(
  model: 'unordered' | 'wagner' | 'dollo',
  k: number,
): number[][] {
  const m = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => 0));
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      if (i === j) continue;
      if (model === 'unordered') m[i][j] = 1;
      else if (model === 'wagner') m[i][j] = Math.abs(i - j);
      else m[i][j] = i === 0 && j === 1 ? 1 : INF; // dollo: single irreversible gain
    }
  }
  return m;
}
