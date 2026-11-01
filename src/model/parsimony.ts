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
  /** Child node ids whose entering branch carries a change in the chosen MP path. */
  changeBranches: Set<NodeId>;
}

const INF = Number.POSITIVE_INFINITY;
const EMPTY: ParsimonyResult = {
  states: new Map(),
  chosen: new Map(),
  mpStates: new Map(),
  cost: 0,
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
  const cost = Number.isFinite(rootMin) ? rootMin : 0;

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

  return { states, chosen: chosenStates, mpStates, cost, changeBranches };
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
 * The UI exposes these so a user does not have to hand-fill the matrix.
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
