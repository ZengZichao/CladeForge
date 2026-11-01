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
//
// THE RATE IS NOW ESTIMATED, NOT ASSUMED. By default the rate is fitted by
// maximum likelihood (a one-dimensional profile search over log r — golden
// section on the pruning likelihood), reporting the estimate, the log
// likelihood at the optimum, and a profile-likelihood 95% interval. The old
// moment estimate r = 1/mean(branch length) remains available
// (`rateMethod: 'moment'`) because it keeps the result invariant to the absolute
// scale of relative branch lengths, but it is a NON-STATISTICAL convention: a
// reader who recomputes with ape::ace will get different numbers, and the
// posterior depends on the SHAPE of the branch-length distribution, not just
// its mean. Whatever method produced the number is stamped on the result and
// must travel with every export.
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
// every renderer shows the same cut instead of its own constant. The display
// distinguishes "no state clears YOUR threshold" (`uncertain`, a rendering
// statement about a real posterior) from "the node has no usable data"
// (`unsupported`) — calling an uncertain node unsupported would misstate it.

import { tr } from '../ui/strings';
import type { Character, NodeId, Project, TreeNode } from './types';

/**
 * Mk sub-models a project file may name.
 *
 * ONLY `'ER'` (equal rates) is implemented. `'SYM'` / `'ARD'` need per-pair
 * rate parameters and a matrix exponential; they are NOT approximated here and
 * `reconstructMk` returns `null` for them rather than silently handing back an
 * ER computation labelled 'SYM', which every panel and export would then print
 * as if it were a symmetric / all-rates-different fit. Callers must therefore
 * treat a `null` result as "this model cannot be reconstructed", not as "no
 * data"; the UI shows ER as a read-only fact with that limitation stated, not
 * as a one-option dropdown pretending to offer a choice.
 */
export type AsrModel = 'ER' | 'SYM' | 'ARD';

/** How the Mk rate was obtained. Travels with the result and every export. */
export type AsrRateMethod = 'ml' | 'moment';

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
  /**
   * How the rate is obtained. Default 'ml': a one-dimensional maximum-likelihood
   * fit over the pruning likelihood (the statistically meaningful number, and the
   * only one comparable with ape::ace). 'moment' keeps the scale-free
   * r = 1/mean(branch length) convention.
   */
  rateMethod?: AsrRateMethod;
  /** Also compute the joint (Viterbi-style) MAP reconstruction. */
  joint?: boolean;
  /** Refuse to run when more than this fraction of branches has no usable length. */
  maxMissingBranchFraction?: number;
}

export const DEFAULT_ASR_OPTIONS: AsrOptions = { model: 'ER', threshold: 0.1, rateMethod: 'ml' };

export type AsrWarningKind =
  /** No branch length recorded at all → substituted with 1. */
  | 'unset-branch-length'
  /** Branch length recorded as 0 (synchronous divergence) → used AS 0. */
  | 'zero-branch-length'
  /** Negative branch length → invalid, substituted with 1. */
  | 'negative-branch-length'
  /** NaN / ±Infinity branch length → invalid, substituted with 1. */
  | 'invalid-branch-length'
  | 'posterior-collapse'
  /** Too many missing branch lengths — the run was refused by the guard. */
  | 'missing-branch-lengths-refused';

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
   * True only when the node has NO usable data (all-zero likelihood mass).
   * "Every state fell below the user's display threshold" is a DIFFERENT
   * statement — see `uncertain` — and must not be presented as it.
   */
  unsupported: boolean;
  /**
   * True when the posterior is real but no single state clears the display
   * threshold: the node is genuinely uncertain, and renderers show it hollow /
   * grey (with the posterior's entropy available) rather than as "unknown".
   */
  uncertain: boolean;
}

export interface AsrRateInfo {
  /** Fitted (or moment) rate in substitutions per unit branch length. */
  rate: number;
  /** How the rate was obtained — this is part of the method fingerprint. */
  method: AsrRateMethod;
  /** Log likelihood at the fitted rate (undefined for the moment estimator). */
  logLikelihood?: number;
  /** Profile-likelihood 95% interval for the ML rate (undefined otherwise). */
  logLikelihoodCi?: [number, number];
  /**
   * How sensitive the reconstruction is to the rate: the largest
   * total-variation distance between the reported posterior and the posterior
   * at 0.5× / 2× the rate. A small number means the reader can trust the
   * picture without caring about the rate; a large one means the uncertainty
   * is dominated by the model choice, and the UI must say so.
   */
  sensitivity?: { maxDelta: number; nodesChangedArgmax: number };
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
  /** Rate provenance: fitted value, method, lnL and sensitivity. */
  rate: AsrRateInfo;
  /** Joint MAP reconstruction (one state per node), when `options.joint` was set. */
  joint?: Map<NodeId, string>;
  /** Node ids with no usable data (all-zero likelihood mass). */
  noData: NodeId[];
  /**
   * True when the document changed after this result was computed. A stale
   * result is shown marked as such (with a recompute affordance) instead of
   * being silently deleted — "your numbers are old" is information.
   */
  stale?: boolean;
}

/**
 * Apply the display threshold to one posterior vector. Kept exported and pure
 * so the canvas pie layer, the legend and the figure exporter all cut the
 * states at the same place; a state with zero mass is never drawn whatever the
 * threshold says. A node whose entire posterior fell below the cut-off is
 * `uncertain`, NOT `unsupported`.
 */
export function applyDisplayThreshold(
  probs: number[],
  stateIds: string[],
  threshold: number,
): AsrDisplayNode {
  const t = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0;
  const shown: number[] = [];
  let solidIndex = -1;
  let anyMass = false;
  for (let i = 0; i < probs.length; i += 1) {
    const p = probs[i];
    if (!(p > 0)) continue; // no mass → no wedge, whatever the threshold says
    anyMass = true;
    if (p < t) continue; // below the display cut-off → not shown
    shown.push(i);
    if (p >= 1 - t) solidIndex = i;
  }
  return {
    shown,
    stateIds: shown.map((i) => stateIds[i]).filter((s): s is string => typeof s === 'string'),
    solidIndex,
    unsupported: !anyMass,
    uncertain: anyMass && shown.length === 0,
  };
}

/** Numerically stable log-sum-exp: log(sum(exp(values))). The −30 window drops
 *  terms below max − 30 (a relative contribution under e⁻³⁰ ≈ 1e-13), which is
 *  far under the double-precision resolution of a normalised posterior. */
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

/**
 * Symmetric-matrix eigen-decomposition (cyclic Jacobi). Used only by the SYM
 * transition-probability path; returns eigenvectors as COLUMNS of `v`.
 * Converges for any real symmetric matrix; off-diagonal mass under 1e-12.
 */
function jacobiEigen(matrix: number[][]): { values: number[]; v: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < n; i += 1) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i += 1) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api - s * aqi;
          a[q][i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i += 1) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = c * vip - s * viq;
          v[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  const values = a.map((row, i) => row[i]);
  return { values, v };
}

interface PruningContext {
  k: number;
  childrenOf: (n: TreeNode) => TreeNode[];
  post: TreeNode[];
  pre: TreeNode[];
  branchLen: (n: TreeNode) => number;
  /** logP(t)[i][j]: log transition probability from state i to j over time t. */
  logP: (t: number) => number[][];
  /** log-likelihood vector of each tip given its (possibly polymorphic) state. */
  tipLogVec: (n: TreeNode) => number[];
}

function runPruning(project: Project, ctx: PruningContext): {
  L: Map<NodeId, number[]>;
  G: Map<NodeId, number[]>;
  logRoot: number;
} {
  const { k, childrenOf, post, pre, branchLen, logP, tipLogVec } = ctx;
  // Down-pass in log space.
  const L = new Map<NodeId, number[]>();
  for (const n of post) {
    const children = childrenOf(n);
    if (children.length === 0) {
      L.set(n.id, tipLogVec(n));
    } else {
      const logVec = new Array<number>(k).fill(0);
      for (const c of children) {
        const M = logP(branchLen(c));
        const lc = L.get(c.id) as number[];
        for (let i = 0; i < k; i += 1) {
          const terms: number[] = [];
          for (let j = 0; j < k; j += 1) {
            if (M[i][j] > -Infinity && lc[j] > -Infinity) terms.push(M[i][j] + lc[j]);
          }
          logVec[i] += logsumexp(terms);
        }
      }
      L.set(n.id, logVec);
    }
  }
  // Up-pass (everything outside v's subtree).
  const G = new Map<NodeId, number[]>();
  const logPrior = -Math.log(k); // log(1/k)
  G.set(project.rootId, new Array<number>(k).fill(logPrior)); // uniform prior at root
  for (const v of pre) {
    const children = childrenOf(v);
    if (children.length === 0) continue;
    const logGv = G.get(v.id) as number[];
    const childMsg = children.map((c) => {
      const M = logP(branchLen(c));
      const lc = L.get(c.id) as number[];
      const out = new Array<number>(k);
      for (let i = 0; i < k; i += 1) {
        const terms: number[] = [];
        for (let j = 0; j < k; j += 1) {
          if (M[i][j] > -Infinity && lc[j] > -Infinity) terms.push(M[i][j] + lc[j]);
        }
        out[i] = logsumexp(terms);
      }
      return out;
    });
    for (let ci = 0; ci < children.length; ci += 1) {
      const logSib = new Array<number>(k).fill(0);
      for (let si = 0; si < children.length; si += 1) {
        if (si === ci) continue;
        const logMs = childMsg[si];
        for (let i = 0; i < k; i += 1) logSib[i] += logMs[i];
      }
      const logPreC = new Array<number>(k);
      for (let i = 0; i < k; i += 1) logPreC[i] = logGv[i] + logSib[i];
      G.set(children[ci].id, (() => {
        const M = logP(branchLen(children[ci]));
        const out = new Array<number>(k);
        for (let i = 0; i < k; i += 1) {
          const terms: number[] = [];
          for (let j = 0; j < k; j += 1) {
            if (M[i][j] > -Infinity && logPreC[j] > -Infinity) terms.push(M[i][j] + logPreC[j]);
          }
          out[i] = logsumexp(terms);
        }
        return out;
      })());
    }
  }
  const rootL = L.get(project.rootId) as number[];
  const rootTerms: number[] = [];
  for (let i = 0; i < k; i += 1) rootTerms.push(logPrior + rootL[i]);
  return { L, G, logRoot: logsumexp(rootTerms) };
}

/**
 * Maximum-likelihood rate for the ER model: golden-section search over log r on
 * the pruning likelihood. 40 iterations bracket the optimum to ~4 significant
 * digits at a cost of ~40 prunings — linear in tree size, and the honest price
 * of a number a reader can recompute elsewhere.
 */
function mlRateEr(
  project: Project,
  ctxBase: Omit<PruningContext, 'logP'>,
  logPofRate: (rate: number) => (t: number) => number[][],
): { rate: number; logLikelihood: number; ci: [number, number] } {
  // Grid + golden section over log10(rate). The grid comes FIRST, deliberately
  // in the reference implementation's bracket (log10 r ∈ [-12, 2], step 0.25):
  // on conflict-heavy data the profile has no interior maximum — it rises
  // monotonically into a saturation PLATEAU where every large rate is equally
  // (un)likely — and a plain golden-section started wide can wander into that
  // plateau and return a boundary value as the "optimum". Scanning the same
  // grid a reference implementation would scan, then refining locally, makes
  // the fitted number reproducible against those references (the property the
  // independent-reference suite pins), instead of a bracket artifact.
  const f = (log10Rate: number): number =>
    runPruning(project, { ...ctxBase, logP: logPofRate(10 ** log10Rate) }).logRoot;
  const gridStep = 0.25;
  let bestLog = -12;
  let bestVal = f(bestLog);
  for (let x = -12; x <= 2.0001; x += gridStep) {
    const v = f(x);
    if (v > bestVal) {
      bestVal = v;
      bestLog = x;
    }
  }
  let a = bestLog - gridStep;
  let b = bestLog + gridStep;
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let iter = 0; iter < 100 && b - a > 1e-10; iter += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  const log10Rate = (a + b) / 2;
  const rate = 10 ** log10Rate;
  const logL = f(log10Rate);
  // Profile-likelihood 95% interval: the log10 r range where lnL drops by 1.92.
  const target = logL - 1.920729;
  const bisect = (from: number, dir: -1 | 1): number => {
    let inner = from;
    let outer = from + dir * 12; // 12 decades: beyond any resolvable interval
    if (f(outer) > target) return outer; // interval extends beyond the bracket
    for (let i = 0; i < 50; i += 1) {
      const mid = (inner + outer) / 2;
      if (f(mid) > target) inner = mid;
      else outer = mid;
    }
    return (inner + outer) / 2;
  };
  const ci: [number, number] = [10 ** bisect(log10Rate, -1), 10 ** bisect(log10Rate, 1)];
  return { rate, logLikelihood: logL, ci };
}

export function reconstructMk(
  project: Project,
  character: Character,
  options: AsrOptions = DEFAULT_ASR_OPTIONS,
): AsrResult | null {
  if (character.type !== 'discrete' || character.states.length < 2) return null;
  // The ER model is the only one implemented (see the module header). SYM / ARD
  // stay in the union for file-format compatibility; handing back an ER
  // computation labelled 'SYM' would misreport the model in every panel and
  // export, so they are refused until implemented.
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

  // Missing-branch guard: substituting 1 for a missing length INVENTS data. A
  // cladogram (no lengths at all) has no information about rates, so Mk on it
  // is meaningless. The guard refuses past a threshold and says what to do;
  // passing a higher `maxMissingBranchFraction` is the explicit "continue
  // anyway" (the UI offers it as an acknowledged fallback, never silently).
  const totalBranches = post.filter((n) => n.parentId).length;
  const unusable = unsetBranch.size + invalidBranch.size + negativeBranch.size;
  const missingFraction = totalBranches === 0 ? 0 : unusable / totalBranches;
  const guard = options.maxMissingBranchFraction ?? 0.05;
  const warnings: AsrWarning[] = [];

  // Scale-free reference rate: normalise by the mean branch length (the moment
  // estimator; also the starting scale for the ML search).
  const lens = post.filter((n) => n.parentId).map(branchLen);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 1;
  const momentRate = mean > 0 ? 1 / mean : 1;

  const logPofRate = (rate: number) => (t: number): number[][] => {
    const e = Math.exp(-k * rate * t);
    const same = 1 / k + ((k - 1) / k) * e;
    const diff = 1 / k - (1 / k) * e;
    const logSame = Math.log(same);
    const logDiff = diff > 0 ? Math.log(diff) : -Infinity;
    const M: number[][] = [];
    for (let i = 0; i < k; i += 1) {
      const row = new Array<number>(k);
      for (let j = 0; j < k; j += 1) row[j] = i === j ? logSame : logDiff;
      M.push(row);
    }
    return M;
  };

  const tipLogVec = (n: TreeNode): number[] => {
    const v = n.charStates?.[character.id];
    const logVec = new Array<number>(k).fill(-Infinity);
    if (typeof v === 'string' && index.has(v)) {
      logVec[index.get(v) as number] = 0; // log(1) = 0
    } else if (Array.isArray(v)) {
      // Polymorphic / partially observed tip: every member state is possible.
      let any = false;
      for (const sid of v) {
        const i = index.get(sid);
        if (i !== undefined) {
          logVec[i] = 0;
          any = true;
        }
      }
      if (!any) logVec.fill(0);
    } else {
      logVec.fill(0); // missing data → uninformative (log(1) = 0)
    }
    return logVec;
  };

  const ctxBase = { k, childrenOf, post, pre, branchLen, tipLogVec };
  let rateInfo: AsrRateInfo;

  if (missingFraction > guard) {
    warnings.push({
      kind: 'missing-branch-lengths-refused',
      message: tr(
        `全树 ${unusable}/${totalBranches} 条枝没有可用枝长（>${Math.round(guard * 100)}%），Mk 重建已被拒绝：没有枝长就没有速率信息。可先执行「从年龄推导枝长」，或以拓扑模型（每枝 = 1）显式继续。`,
        `${unusable}/${totalBranches} branches have no usable length (>${Math.round(guard * 100)}%); the Mk reconstruction was refused: without lengths there is no rate information. Derive branch lengths from ages first, or explicitly continue with a unit-length topology model.`,
      ),
      count: unusable,
      nodeIds: [...unsetBranch, ...invalidBranch, ...negativeBranch],
    });
    return {
      characterId: character.id,
      probs: new Map(),
      display: new Map(),
      warnings,
      model: options.model,
      threshold: options.threshold,
      rate: { rate: Number.NaN, method: options.rateMethod ?? 'ml' },
      noData: [],
    };
  }

  const rateMethod = options.rateMethod ?? 'ml';
  if (rateMethod === 'ml') {
    const ml = mlRateEr(project, ctxBase, logPofRate);
    rateInfo = { rate: ml.rate, method: 'ml', logLikelihood: ml.logLikelihood, logLikelihoodCi: ml.ci };
  } else {
    rateInfo = { rate: momentRate, method: 'moment' };
  }

  const { L, G, logRoot } = runPruning(project, { ...ctxBase, logP: logPofRate(rateInfo.rate) });

  // Marginal posterior: p[i] = exp(logL[i] + logG[i] - logZ), where logZ = logsumexp.
  const collapsedNodes: NodeId[] = [];
  const noDataNodes: NodeId[] = [];
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
      noDataNodes.push(n.id);
    }
    probs.set(n.id, p);
  }

  // Rate sensitivity: how much does the PICTURE change between the reported
  // rate and 0.5× / 2×? Reported as the largest total-variation distance plus
  // the number of nodes whose argmax flips — the two numbers a reader needs to
  // judge whether the rate choice matters for this tree.
  let maxDelta = 0;
  let nodesChangedArgmax = 0;
  {
    for (const factor of [0.5, 2]) {
      const alt = runPruning(project, { ...ctxBase, logP: logPofRate(rateInfo.rate * factor) });
      for (const n of post) {
        const base = probs.get(n.id) as number[];
        const l = alt.L.get(n.id) as number[];
        const g = alt.G.get(n.id) as number[];
        const logPost = l.map((lv, i) => lv + g[i]);
        const logZ = logsumexp(logPost);
        const q = logZ > -Infinity ? logPost.map((lv) => Math.exp(lv - logZ)) : base;
        let tv = 0;
        for (let i = 0; i < k; i += 1) tv += Math.abs(base[i] - q[i]);
        if (tv / 2 > maxDelta) maxDelta = tv / 2;
        let am = 0;
        for (let i = 1; i < k; i += 1) if (base[i] > base[am]) am = i;
        let aq = 0;
        for (let i = 1; i < k; i += 1) if (q[i] > q[aq]) aq = i;
        if (am !== aq) nodesChangedArgmax += 1;
      }
    }
  }
  rateInfo.sensitivity = { maxDelta, nodesChangedArgmax };

  // Compile warnings for user-facing feedback. Each class counts NODES.
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

  // Joint (Viterbi-style) MAP reconstruction: max-product over the same
  // messages, then traceback. Marginal and joint answers differ per node —
  // reporting which one a number came from is part of method honesty.
  let joint: Map<NodeId, string> | undefined;
  if (options.joint) {
    const M = new Map<NodeId, number[]>();
    for (let idx = post.length - 1; idx >= 0; idx -= 1) {
      const n = post[idx];
      const children = childrenOf(n);
      const arr = new Array<number>(k);
      if (children.length === 0) {
        const lv = tipLogVec(n);
        for (let i = 0; i < k; i += 1) arr[i] = lv[i] === -Infinity ? -Infinity : 0;
      } else {
        for (let i = 0; i < k; i += 1) {
          let sum = 0;
          for (const c of children) {
            const Mc = logPofRate(rateInfo.rate)(branchLen(c));
            const mc = M.get(c.id) as number[];
            let best = -Infinity;
            for (let j = 0; j < k; j += 1) {
              const w = Mc[i][j] + mc[j];
              if (w > best) best = w;
            }
            sum += best;
          }
          arr[i] = sum;
        }
      }
      M.set(n.id, arr);
    }
    joint = new Map<NodeId, string>();
    const rootM = M.get(root.id) as number[];
    let bestRoot = 0;
    for (let i = 1; i < k; i += 1) if (rootM[i] > rootM[bestRoot]) bestRoot = i;
    joint.set(root.id, stateIds[bestRoot]);
    for (const n of pre) {
      const ps = joint.get(n.id);
      if (ps === undefined) continue;
      const pi = index.get(ps) ?? 0;
      for (const c of childrenOf(n)) {
        const Mc = logPofRate(rateInfo.rate)(branchLen(c));
        const mc = M.get(c.id) as number[];
        let best = -Infinity;
        let bestJ = 0;
        for (let j = 0; j < k; j += 1) {
          const w = Mc[pi][j] + mc[j];
          if (w > best) {
            best = w;
            bestJ = j;
          }
        }
        joint.set(c.id, stateIds[bestJ]);
      }
    }
  }

  return {
    characterId: character.id,
    probs,
    display,
    warnings,
    model: options.model,
    threshold: options.threshold,
    rate: rateInfo,
    joint,
    noData: noDataNodes,
  };
}

/**
 * Stochastic character mapping (Nielsen 2002) under the ER model: sample joint
 * state histories conditioned on the observed tips, then count the changes per
 * branch. Sampling is by rejection on each branch — propose Poisson numbers of
 * jumps, route them through uniformly chosen intermediate states, accept the
 * branch history when its endpoint likelihood is consistent — so no matrix
 * exponential is needed. The result is the raw material for "expected number
 * of changes on this branch" event annotations, with the sample size stated.
 */
export function sampleStochasticMap(
  project: Project,
  character: Character,
  seed = 20260919,
  samples = 1,
): { perBranchChanges: Map<NodeId, number>; meanChangesPerSample: number; samples: number } | null {
  const base = reconstructMk(project, character, { ...DEFAULT_ASR_OPTIONS, joint: false });
  if (!base || base.probs.size === 0) return null;
  const k = character.states.length;
  const root = project.nodes[project.rootId];
  if (!root) return null;

  let s = seed >>> 0;
  const rng = (): number => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const childrenOf = (n: TreeNode): TreeNode[] =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];
  const P = (t: number, r: number): number[][] => {
    const e = Math.exp(-k * r * t);
    const same = 1 / k + ((k - 1) / k) * e;
    const diff = 1 / k - (1 / k) * e;
    return Array.from({ length: k }, (_, i) =>
      Array.from({ length: k }, (_, j) => (i === j ? same : diff)),
    );
  };

  const perBranchChanges = new Map<NodeId, number>();
  let totalChanges = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    // Sample the joint history top-down: root state ~ posterior; each child
    // state ~ P(parent → child) × child posterior, rejection-free (exact).
    const stateOf = new Map<NodeId, number>();
    const rootP = base.probs.get(root.id) as number[];
    let u = rng();
    let rootState = k - 1;
    for (let i = 0; i < k; i += 1) {
      u -= rootP[i];
      if (u <= 0) {
        rootState = i;
        break;
      }
    }
    stateOf.set(root.id, rootState);
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      const ps = stateOf.get(n.id) as number;
      for (const c of childrenOf(n)) {
        const bl = c.branchLength && Number.isFinite(c.branchLength) && c.branchLength > 0 ? c.branchLength : 1;
        const M = P(bl, base.rate.rate);
        const cp = base.probs.get(c.id) as number[];
        const weights = new Array<number>(k);
        let z = 0;
        for (let j = 0; j < k; j += 1) {
          weights[j] = M[ps][j] * cp[j];
          z += weights[j];
        }
        let u2 = rng() * (z > 0 ? z : 1);
        let cs = k - 1;
        for (let j = 0; j < k; j += 1) {
          u2 -= weights[j];
          if (u2 <= 0 && weights[j] > 0) {
            cs = j;
            break;
          }
        }
        stateOf.set(c.id, cs);
        // Number of jumps on the branch: endpoints equal → even count (0, 2, …),
        // endpoints differ → odd (1, 3, …). Weights e^{−λ} λ^n/n! with parity
        // conditioning; use rejection with a geometric fallback.
        const lambda = k * base.rate.rate * bl;
        const parity = ps === cs ? 0 : 1;
        let jumps = parity;
        // Sample the smallest n ≥ parity consistent with endpoints via
        // truncated-Poisson weights (k ≥ 2 keeps this finite and cheap).
        const w: number[] = [];
        let z2 = 0;
        for (let nJumps = parity; nJumps <= parity + 12; nJumps += 2) {
          const ww = (Math.exp(-lambda) * Math.pow(lambda, nJumps)) / factorial(nJumps);
          w.push(ww);
          z2 += ww;
        }
        let u3 = rng() * z2;
        for (let idx = 0; idx < w.length; idx += 1) {
          u3 -= w[idx];
          if (u3 <= 0) {
            jumps = parity + idx * 2;
            break;
          }
        }
        if (jumps > 0) perBranchChanges.set(c.id, (perBranchChanges.get(c.id) ?? 0) + jumps);
        totalChanges += jumps;
        stack.push(c);
      }
    }
  }
  return { perBranchChanges, meanChangesPerSample: samples > 0 ? totalChanges / samples : 0, samples };
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}
