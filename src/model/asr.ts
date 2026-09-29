// Probabilistic ancestral-state reconstruction for discrete characters under
// the equal-rates Mk (Markov-k) model.
//
// Unlike the parsimony baseline (a single suggested state per node), this yields
// a full state-PROBABILITY distribution per node, so the UI can show WHERE the
// reconstruction is confident and where it is not — the uncertain nodes are
// exactly the ones a hypothesis has to explain.
//
// Method: Felsenstein pruning (down-pass) + a sibling/parent up-pass, i.e.
// belief propagation on the tree, giving marginal posterior probabilities.
// The equal-rates model has a closed-form transition probability, so no matrix
// exponential is needed:
//   P_ii(t) = 1/k + (k-1)/k · e^(-k r t)
//   P_ij(t) = 1/k − 1/k · e^(-k r t)   (i ≠ j)
// The rate r is normalised by the mean branch length, making the result
// invariant to the absolute scale of the (often relative) branch lengths.
//
// Numerical stability: all likelihood computations are performed in log-space
// (log-sum-exp) to prevent underflow on large trees. Branch lengths are resolved
// once per node and every degradation class (unset / zero / negative /
// non-finite) is reported separately as a set of node ids, so a warning can
// never count the same node twice. Posterior collapse (all-zero
// likelihood) is caught and reported rather than silently producing a uniform
// distribution.
//
// Output: the full posterior per node (`probs`) plus the threshold-filtered
// DISPLAY set (`display`) — the display threshold is applied here, once, so
// every renderer shows the same cut instead of its own constant.

import { tr } from '../ui/strings';
import type { Character, NodeId, Project, TreeNode } from './types';

/**
 * Mk sub-models a project file may name.
 *
 * ONLY `'ER'` (equal rates) is implemented: it is the one with the closed-form
 * transition probability used in the module header. `'SYM'` and `'ARD'` need a
 * matrix exponential and are NOT approximated here — `reconstructMk` returns
 * `null` for them rather than silently handing back an ER computation
 * labelled 'SYM', which every panel and export would then print as if it were a
 * symmetric / all-rates-different fit. Callers must therefore treat a `null`
 * result as "this model cannot be reconstructed", not as "no data".
 */
export type AsrModel = 'ER' | 'SYM' | 'ARD';

export interface AsrOptions {
  model: AsrModel;
  /**
   * Only display states with posterior probability at or above this threshold. A
   * presentation parameter: it must never touch the likelihood computation, and it
   * is *applied* by `reconstructMk` into `AsrResult.display`, so every renderer
   * that draws the reconstruction gets the same filtered set instead of inventing
   * its own cut-off — a pie layer with a hard-coded 0.001 / 0.999 pair would draw
   * the same picture whatever this slider is set to.
   */
  threshold: number;
}

export const DEFAULT_ASR_OPTIONS: AsrOptions = { model: 'ER', threshold: 0.1 };

export type AsrWarningKind =
  /** No branch length recorded at all → substituted with 1. */
  | 'unset-branch-length'
  /** Branch length recorded as 0 (synchronous divergence) → used AS 0. */
  | 'zero-branch-length'
  /** Negative branch length → invalid, substituted with 1. */
  | 'negative-branch-length'
  /** NaN / ±Infinity branch length → invalid, substituted with 1. */
  | 'invalid-branch-length'
  | 'posterior-collapse';

export interface AsrWarning {
  kind: AsrWarningKind;
  message: string;
  count: number;
  /** Ids of the affected nodes (the count is `nodeIds.length`, never a tally
   *  of lookups — see the resolution block below). */
  nodeIds: NodeId[];
}

export interface AsrDisplayNode {
  /** State indices (into `character.states`) that survive the threshold. */
  shown: number[];
  /** Same set as state ids, in declaration order. */
  stateIds: string[];
  /**
   * Index of a state holding at least `1 − threshold` of the posterior mass:
   * every other state is then under the cut-off by definition, so the node is
   * drawn as a solid disc rather than a pie. −1 when there is no such state.
   */
  solidIndex: number;
  /**
   * True when NO state clears the threshold — the node is too uncertain to
   * support any single statement at the level the reader asked for. Renderers
   * must show it as empty/hollow, not as a full pie.
   */
  unsupported: boolean;
}

export interface AsrResult {
  characterId: string;
  /** Posterior state-probability vector per node, aligned to character.states. */
  probs: Map<NodeId, number[]>;
  /**
   * The per-node DISPLAY set produced by applying `threshold` to `probs`.
   * Derived data: raising the threshold strictly shrinks it, so the
   * control has an effect that is observable here rather than only on screen.
   */
  display: Map<NodeId, AsrDisplayNode>;
  /** Degradation warnings (missing branch lengths, posterior collapse, etc.). */
  warnings: AsrWarning[];
  /** Model used for the reconstruction. */
  model: AsrModel;
  /** Display threshold applied to the visualization (also carried on `display`). */
  threshold: number;
}

/**
 * Apply the display threshold to one posterior vector. Kept exported and pure
 * so the canvas pie layer, the legend and the figure exporter all cut the
 * states at the same place (`src/canvas/AsrPieLayer.tsx` mirrors it); a state
 * with zero mass is never drawn whatever the threshold says.
 */
export function applyDisplayThreshold(
  probs: number[],
  stateIds: string[],
  threshold: number,
): AsrDisplayNode {
  const t = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0;
  const shown: number[] = [];
  let solidIndex = -1;
  for (let i = 0; i < probs.length; i += 1) {
    const p = probs[i];
    if (!(p > 0)) continue; // no mass → no wedge, whatever the threshold says
    if (p < t) continue; // below the display cut-off → not shown
    shown.push(i);
    if (p >= 1 - t) solidIndex = i;
  }
  return {
    shown,
    stateIds: shown.map((i) => stateIds[i]).filter((s): s is string => typeof s === 'string'),
    solidIndex,
    unsupported: shown.length === 0,
  };
}

/** Numerically stable log-sum-exp: log(sum(exp(values))). */
function logsumexp(values: number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const v of values) {
    const d = v - max;
    if (d > -30) sum += Math.exp(d);
  }
  return max + Math.log(sum);
}

export function reconstructMk(
  project: Project,
  character: Character,
  options: AsrOptions = DEFAULT_ASR_OPTIONS,
): AsrResult | null {
  if (character.type !== 'discrete' || character.states.length < 2) return null;
  // The ER model is the only one with a closed-form transition probability here
  // (see the module header). SYM / ARD stay in the union for file-format
  // compatibility; handing back an ER computation labelled 'SYM' would misreport
  // the model in every panel and export, so they are refused until implemented.
  if (options.model !== 'ER') return null;
  const root = project.nodes[project.rootId];
  if (!root) return null;

  const k = character.states.length;
  const index = new Map(character.states.map((s, i) => [s.id, i]));
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];

  // Branch-length degradation, classified per NODE.
  //
  // The class is recorded where a node's length is RESOLVED, not inside the helper
  // that reads it: a length is looked up at least four times per node (mean length,
  // down-pass, up-pass, child message), so a counter there reports call counts
  // instead of nodes — a 15-node tree with 4 unset branches would warn about 16.
  // Each node is resolved exactly once and the four classes are separated: an
  // UNSET length is not the same statement as a legitimate ZERO (a synchronous
  // divergence in a time tree), a NEGATIVE one, or a NaN.
  const unsetBranch = new Set<NodeId>();
  const zeroBranch = new Set<NodeId>();
  const negativeBranch = new Set<NodeId>();
  const invalidBranch = new Set<NodeId>();
  const lengthOf = new Map<NodeId, number>();

  // Post-order (children before parents) and pre-order (parents first).
  const post: TreeNode[] = [];
  const stack: TreeNode[] = [root];
  const reached = new Set<NodeId>([root.id]);
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    post.push(n);
    for (const c of childrenOf(n)) {
      if (reached.has(c.id)) continue; // cyclic / duplicated child reference
      reached.add(c.id);
      stack.push(c);
    }
  }
  const pre = post.slice();
  post.reverse();

  for (const n of post) {
    if (!n.parentId) continue; // the root has no incoming branch
    const bl = n.branchLength;
    if (bl === undefined) {
      unsetBranch.add(n.id);
      lengthOf.set(n.id, 1);
    } else if (typeof bl !== 'number' || Number.isNaN(bl) || !Number.isFinite(bl)) {
      invalidBranch.add(n.id);
      lengthOf.set(n.id, 1);
    } else if (bl < 0) {
      negativeBranch.add(n.id);
      lengthOf.set(n.id, 1);
    } else if (bl === 0) {
      // Real data: the Mk closed form degenerates to the identity matrix, which
      // is exactly what "these two lineages split at the same instant" means.
      zeroBranch.add(n.id);
      lengthOf.set(n.id, 0);
    } else {
      lengthOf.set(n.id, bl);
    }
  }
  const branchLen = (n: TreeNode): number => lengthOf.get(n.id) ?? 1;

  // Scale-free rate: normalise by the mean branch length.
  const lens = post.filter((n) => n.parentId).map(branchLen);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 1;
  const rate = mean > 0 ? 1 / mean : 1;

  // Log-space transition: logOut[i] = log Σ_j P_ij(t) · exp(logVec[j]).
  // Uses log-sum-exp for numerical stability (prevents underflow on large trees).
  const applyPLog = (t: number, logVec: number[]): number[] => {
    const e = Math.exp(-k * rate * t);
    const same = 1 / k + ((k - 1) / k) * e;
    const diff = 1 / k - (1 / k) * e;
    const logSame = Math.log(same);
    const logDiff = diff > 0 ? Math.log(diff) : -Infinity;
    const logOut = new Array<number>(k);
    for (let i = 0; i < k; i += 1) {
      const terms: number[] = [];
      for (let j = 0; j < k; j += 1) {
        const logP = i === j ? logSame : logDiff;
        const term = logP + logVec[j];
        if (term > -Infinity) terms.push(term);
      }
      logOut[i] = logsumexp(terms);
    }
    return logOut;
  };

  // Down-pass: logL[v][i] = log-likelihood of the subtree below v given v = i.
  const L = new Map<NodeId, number[]>();
  for (const n of post) {
    const children = childrenOf(n);
    if (children.length === 0) {
      const sid = n.charStates?.[character.id];
      const logVec = new Array<number>(k).fill(-Infinity);
      if (typeof sid === 'string' && index.has(sid)) {
        logVec[index.get(sid) as number] = 0; // log(1) = 0
      } else {
        logVec.fill(0); // missing data → uninformative (log(1) = 0)
      }
      L.set(n.id, logVec);
    } else {
      // Start at log(1)=0 (identity for addition in log-space = multiplication).
      const logVec = new Array<number>(k).fill(0);
      for (const c of children) {
        const logM = applyPLog(branchLen(c), L.get(c.id) as number[]);
        for (let i = 0; i < k; i += 1) logVec[i] += logM[i]; // add = multiply
      }
      L.set(n.id, logVec);
    }
  }

  // Up-pass: logG[v][i] = log-likelihood of everything OUTSIDE v's subtree given v = i.
  const G = new Map<NodeId, number[]>();
  const logPrior = -Math.log(k); // log(1/k)
  G.set(root.id, new Array<number>(k).fill(logPrior)); // uniform prior at root
  for (const v of pre) {
    const children = childrenOf(v);
    if (children.length === 0) continue;
    const logGv = G.get(v.id) as number[];
    const childMsg = children.map((c) => applyPLog(branchLen(c), L.get(c.id) as number[]));
    for (let ci = 0; ci < children.length; ci += 1) {
      // Sibling product = sum of sibling log-messages.
      const logSib = new Array<number>(k).fill(0); // log(1) = 0
      for (let si = 0; si < children.length; si += 1) {
        if (si === ci) continue;
        const logMs = childMsg[si];
        for (let i = 0; i < k; i += 1) logSib[i] += logMs[i];
      }
      // Pre-child message = G_parent · sibling_product (in log-space: add).
      const logPreC = new Array<number>(k);
      for (let i = 0; i < k; i += 1) logPreC[i] = logGv[i] + logSib[i];
      G.set(children[ci].id, applyPLog(branchLen(children[ci]), logPreC));
    }
  }

  // Marginal posterior: p[i] = exp(logL[i] + logG[i] - logZ), where logZ = logsumexp.
  const collapsedNodes: NodeId[] = [];
  const probs = new Map<NodeId, number[]>();
  for (const n of post) {
    const l = L.get(n.id) as number[];
    const g = G.get(n.id) as number[];
    const logPost = new Array<number>(k);
    for (let i = 0; i < k; i += 1) logPost[i] = l[i] + g[i];
    const logZ = logsumexp(logPost);
    const p = new Array<number>(k);
    if (logZ > -Infinity) {
      for (let i = 0; i < k; i += 1) p[i] = Math.exp(logPost[i] - logZ);
    } else {
      // Posterior collapsed — all states have -Infinity log-likelihood.
      p.fill(1 / k);
      collapsedNodes.push(n.id);
    }
    probs.set(n.id, p);
  }

  // Compile warnings for user-facing feedback. Each class counts NODES.
  const warnings: AsrWarning[] = [];
  const pushNodeWarning = (
    kind: AsrWarningKind,
    ids: Set<NodeId>,
    zh: (n: number) => string,
    en: (n: number) => string,
  ) => {
    if (ids.size === 0) return;
    warnings.push({ kind, message: tr(zh(ids.size), en(ids.size)), count: ids.size, nodeIds: [...ids] });
  };
  pushNodeWarning(
    'unset-branch-length',
    unsetBranch,
    (n) => `${n} 个节点未设置枝长，已按 1 替代（可能影响重建精度）`,
    (n) => `${n} node(s) have no branch length recorded and were treated as 1 (may affect accuracy)`,
  );
  pushNodeWarning(
    'zero-branch-length',
    zeroBranch,
    (n) => `${n} 个节点枝长为 0（同期分化），已按 0 参与计算`,
    (n) => `${n} node(s) have a branch length of 0 (synchronous divergence) and were used as 0`,
  );
  pushNodeWarning(
    'negative-branch-length',
    negativeBranch,
    (n) => `${n} 个节点枝长为负值，非合法长度，已按 1 替代`,
    (n) => `${n} node(s) have a negative branch length, which is not a length; replaced by 1`,
  );
  pushNodeWarning(
    'invalid-branch-length',
    invalidBranch,
    (n) => `${n} 个节点枝长无效（NaN/Infinity），已替代为 1`,
    (n) => `${n} node(s) with invalid branch lengths (NaN/Infinity) replaced by 1`,
  );
  if (collapsedNodes.length > 0) {
    warnings.push({
      kind: 'posterior-collapse',
      message: tr(`${collapsedNodes.length} 个节点的后验概率因数值下溢塌缩为均匀分布`, `${collapsedNodes.length} node posterior(s) collapsed to uniform due to numerical underflow`),
      count: collapsedNodes.length,
      nodeIds: collapsedNodes,
    });
  }

  // Display set: the threshold the reader asked for is applied HERE, once,
  // so the slider changes the reconstruction's output and not just some layer's
  // private constants. `probs` above stays the full posterior — the threshold is
  // presentation-only and must never alter the likelihood computation.
  const stateIds = character.states.map((s) => s.id);
  const display = new Map<NodeId, AsrDisplayNode>();
  for (const [id, p] of probs) display.set(id, applyDisplayThreshold(p, stateIds, options.threshold));

  return {
    characterId: character.id,
    probs,
    display,
    warnings,
    model: options.model,
    threshold: options.threshold,
  };
}
