// Parsimony ancestral-state reconstruction (inference assist).
//
// A generalised Sankoff downpass/uppass over the tree that SUGGESTS ancestral
// states for internal nodes from the observed tip states, honouring an optional
// per-character step (cost) matrix. With a uniform matrix this reduces to Fitch
// parsimony. Only tips constrain the reconstruction; internal user hypotheses
// are deliberately ignored so the result is an independent reference baseline
// the user can accept or override — the tool never decides for the user.

import type { Character, NodeId, Project, TreeNode } from './types';

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
   * from `states` by the documented tie-break rule (parent-state first, then
   * the most frequently observed tip state, then declaration order). Consumers
   * that count changes must read this instead of `states…[0]`, which follows
   * declaration order only.
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

/** Cost of a state i → j change, defaulting to a uniform (Fitch) matrix. */
export function costOf(matrix: number[][] | undefined, i: number, j: number): number {
  const v = matrix?.[i]?.[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : i === j ? 0 : 1;
}

export function parsimony(project: Project, character: Character): ParsimonyResult {
  if (character.type !== 'discrete' || character.states.length === 0) return EMPTY;
  const root = project.nodes[project.rootId];
  if (!root) return EMPTY;

  const stateIds = character.states.map((s) => s.id);
  const k = stateIds.length;
  const index = new Map(stateIds.map((id, i) => [id, i]));
  const matrix = character.costMatrix;
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];

  // Post-order (children before parents).
  const order: TreeNode[] = [];
  const stack: TreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    order.push(n);
    for (const c of childrenOf(n)) stack.push(c);
  }
  order.reverse();

  // Downpass: g[node][i] = min subtree cost given `node` is in state i.
  const g = new Map<NodeId, number[]>();
  for (const n of order) {
    const children = childrenOf(n);
    const arr = new Array<number>(k).fill(0);
    if (children.length === 0) {
      const sid = n.charStates?.[character.id];
      if (typeof sid === 'string' && index.has(sid)) {
        const si = index.get(sid) as number;
        for (let i = 0; i < k; i += 1) arr[i] = i === si ? 0 : INF;
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
  // Rule, in order:
  //   1. keep the parent's state when it is among the ties (no gratuitous
  //      change on the branch),
  //   2. otherwise the state observed most often at the tips,
  //   3. only as a last resort the earliest declared state.
  // `states` keeps every alternative that survives THIS parent state, so the
  // ambiguity is not hidden by picking one path — but it is a
  // parent-conditional set, not the set of states occurring in some optimal
  // reconstruction of the whole tree (see the `states` field docs).
  const states = new Map<NodeId, string[]>();
  const chosenStates = new Map<NodeId, string>();
  const changeBranches = new Set<NodeId>();

  const tipFreq = new Array<number>(k).fill(0);
  for (const n of order) {
    if (n.childrenIds.length > 0) continue;
    const sid = n.charStates?.[character.id];
    if (typeof sid === 'string' && index.has(sid)) tipFreq[index.get(sid) as number] += 1;
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
      if (costFrom(gn, parentState, j) === best) ties.push(j);
    }
    let chosen = ties[0];
    if (parentState !== null && ties.includes(parentState)) {
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
      if (gd[j] + un[j] === cost) keep.push(stateIds[j]);
    }
    mpStates.set(n.id, keep);
  }

  return { states, chosen: chosenStates, mpStates, cost, changeBranches };
}

/** A fresh uniform step matrix (0 on the diagonal, 1 elsewhere) of size k. */
export function uniformCostMatrix(k: number): number[][] {
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 0 : 1)),
  );
}
