// Discrete-character phylogenetic-signal metrics.
//
// For a discrete character we report the classic homoplasy indices derived from
// its parsimony score on the current tree:
//   * steps s   — observed parsimony changes
//   * minSteps m — theoretical minimum (#observed states − 1)
//   * maxSteps g — maximum on a tree (#tips − most-common-state count)
//   * CI = m / s          consistency index (1 = no homoplasy)
//   * RI = (g − s)/(g − m) retention index (1 = perfect synapomorphy)
// Low CI/RI flags a character whose distribution conflicts with the topology —
// a candidate for convergent evolution / a hypothesis worth explaining.
//
// Two scope rules bound where these indices are meaningful:
//   * CI and RI only exist for equally weighted (unweighted) characters — a
//     character with a Sankoff `costMatrix` returns no signal at all.
//   * Only declared states count as observations. '?' / '-' and stale ids of
//     deleted states are missing data and are excluded from #tips, #states and
//     the state frequencies behind m, g and s. A polymorphic tip (a set of
//     declared states) is one tip observing several states: its evidence is
//     split evenly across its members, never counted as a state of its own.
//
// This module also carries the multiplicity control (Holm–Bonferroni / BH) that
// every family of p-values shown side by side must go through.
// `holmAdjustFamily` is the single definition of "the family": it is handed the
// tests that were RUN and is called BEFORE any threshold filtering, so the
// multiplicity count m cannot depend on what the data happened to look like.

import { tr } from '../ui/strings';
import type { Character, NodeId, Project, TreeNode } from './types';
import { parsimony } from './parsimony';
import { isObservedState } from './characters';

export interface DiscreteSignal {
  characterId: string;
  /** Tips carrying a declared state (missing codes / unassigned excluded). */
  tips: number;
  /** Tips with no usable observation for this character, surfaced so the tip count is transparent. */
  unassignedTips: number;
  /** Tips whose value is a '?' / '-' missing-data code (excluded from `tips`). */
  missingCodes: number;
  /** Tips carrying a polymorphic (multi-state) assignment, counted inside `tips`. */
  polymorphicTips: number;
  observedStates: number;
  steps: number;
  minSteps: number;
  maxSteps: number;
  ci: number;
  ri: number;
  /**
   * True when the tree is not fully binary. An unresolved (polytomic) tree lets
   * some changes be shared "for free" across the unresolved branches, which
   * inflates CI/RI — the UI must show the caveat next to the numbers when set.
   */
  unresolvedTree?: boolean;
}

/**
 * CI and RI are defined on the *number of steps* under equally weighted
 * changes: m = (#states − 1) and g = (#tips − largest state count) both
 * presuppose a uniform step matrix. Dividing them by a Sankoff-weighted score
 * yields a quantity that is no longer comparable across characters or trees, so
 * a character that carries a `costMatrix` gets no CI/RI at all;
 * `model/consistency.ts` refuses to compare across matrices for the same
 * reason.
 */
export function ciRiApplies(character: Character): boolean {
  return character.type === 'discrete' && !character.costMatrix;
}

export function discreteSignal(project: Project, character: Character): DiscreteSignal | null {
  if (character.type !== 'discrete' || character.states.length < 2) return null;
  if (!ciRiApplies(character)) return null;

  let tipTotal = 0;
  let missingCodes = 0;
  let polymorphicTips = 0;
  const counts = new Map<string, number>();
  for (const id in project.nodes) {
    const n = project.nodes[id];
    if (n.childrenIds.length > 0) continue;
    tipTotal += 1;
    const sid = n.charStates?.[character.id];
    // Only declared states count as observations: '?' / '-' and stale ids from
    // deleted states are missing data and must not inflate m, g or s.
    if (Array.isArray(sid)) {
      // A polymorphic tip is ONE tip observing SEVERAL states, never a state of
      // its own: the tip's evidence is split evenly across its member states
      // (a 1/k share each, k = set size). Counting the array object itself as a
      // key used to invent a fresh "state" per polymorphic tip — inflating
      // observedStates (hence m, hence CI) and deflating the largest class
      // (hence g, hence RI) — a systematic, silent optimism. Fractional shares
      // keep the tip total honest and stay consistent with the set semantics
      // parsimony itself scores the same tips with.
      if (sid.length > 0 && sid.every((m) => character.states.some((s) => s.id === m))) {
        polymorphicTips += 1;
        const share = 1 / sid.length;
        for (const member of sid) counts.set(member, (counts.get(member) ?? 0) + share);
      }
      // A set referencing deleted states only carries no usable observation.
    } else if (typeof sid === 'string' && isObservedState(character, sid)) {
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    } else if (typeof sid === 'string') {
      missingCodes += 1;
    }
  }
  const tips = [...counts.values()].reduce((a, b) => a + b, 0);
  const observedStates = counts.size;
  if (tips < 3 || observedStates < 2) return null;

  const steps = parsimony(project, character).cost;
  const minSteps = observedStates - 1;
  const maxSteps = tips - Math.max(...counts.values());
  const ci = steps > 0 ? minSteps / steps : 1;
  const ri = maxSteps > minSteps ? (maxSteps - steps) / (maxSteps - minSteps) : 1;

  return {
    characterId: character.id,
    tips,
    unassignedTips: tipTotal - tips - missingCodes,
    missingCodes,
    polymorphicTips,
    observedStates,
    steps,
    minSteps,
    maxSteps,
    ci,
    ri,
    // An unresolved tree shares changes "for free" across polytomies, which
    // inflates CI/RI; the panel shows the caveat when this is set.
    unresolvedTree: treeSummary(project).resolution < 1,
  };
}

// --- multiple-comparison adjustment -----------------------------

/**
 * Adjust a family of p-values for multiple testing.
 *
 * The character-correlation screen loops over EVERY pair of discrete characters
 * (`consistency.ts`), and each pair gets its own permutation test. Testing m
 * hypotheses at α inflates the chance of at least one false positive to roughly
 * 1 − (1 − α)^m (≈ 0.40 for m = 10 at α = 0.05), so an unadjusted per-pair
 * p-value must never be read as "significant" once more than one pair is on
 * screen.
 *
 * Both procedures below take the raw p-values in whatever order the caller has
 * them and return adjusted p-values IN THE SAME ORDER, so a UI can zip the two
 * lists together. Non-finite input is treated as p = 1 (never significant) and
 * still counts towards the family size.
 *
 * @param pValues raw p-values of the tested family — the whole family, not the
 *   subset that happened to look interesting (adjusting a post-hoc selection is
 *   itself a multiplicity violation). Callers that hold a list of test results
 *   rather than bare numbers should go through `holmAdjustFamily`, which cannot
 * be handed a filtered subset by accident.
 */
export function holmBonferroni(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues
    .map((p, i) => ({ i, p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1 }))
    .sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(0);
  let running = 0; // step-down: adjusted values are non-decreasing in rank
  order.forEach((entry, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * entry.p));
    out[entry.i] = running;
  });
  return out;
}

/** `holmAdjustFamily` output: the test plus the two numbers that describe it. */
export type HolmAdjusted<T> = T & {
  /** Holm-adjusted p over the family the test was part of. */
  adjustedP: number;
  /**
   * m, the size of THAT family — the number of tests actually run. It is
   * carried on every row so a display can never quote an adjusted p whose
   * multiplicity count came from somewhere else.
   */
  familySize: number;
};

/**
 * THE one place the Holm family is defined: hand it the tests that
 * were RUN and it returns each one with its adjusted p and the m that was used.
 *
 * The family is decided HERE and nowhere else, so the model path and the UI path
 * cannot drift; any threshold filtering (the ≥ 0.5 overlap flag, "show me only
 * the significant ones") has to happen after this call, which is what keeps m a
 * property of the procedure rather than of the data. Handing it the flagged
 * subset instead would let m change whenever an unrelated pair crossed the flag
 * line, and the same pair's adjusted p would move with it.
 *
 * Order is preserved, so a caller can zip the rows back onto its own list.
 */
export function holmAdjustFamily<T extends { pValue: number }>(tested: readonly T[]): HolmAdjusted<T>[] {
  const adjusted = holmBonferroni(tested.map((t) => t.pValue));
  return tested.map((t, i) => ({ ...t, adjustedP: adjusted[i], familySize: tested.length }));
}

/**
 * Benjamini–Hochberg: controls the false-discovery RATE instead of the
 * family-wise error rate, so it is the more powerful (smaller) adjustment when
 * many pairs are screened at once. Offered alongside `holmBonferroni` so the
 * stricter family-wise number and the screening number can both be reported.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues
    .map((p, i) => ({ i, p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1 }))
    .sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(0);
  let running = 1; // step-up from the largest rank: adjusted values stay monotone
  for (let rank = m - 1; rank >= 0; rank -= 1) {
    running = Math.min(running, Math.min(1, (m / (rank + 1)) * order[rank].p));
    out[order[rank].i] = running;
  }
  return out;
}

// --- tree summary statistics ------------------------------------------------

export interface TreeSummary {
  tipCount: number;
  internalCount: number;
  /** Resolution = fraction of internal nodes that are binary (2 children). */
  resolution: number;
  avgBranchLength: number;
  totalBranchLength: number;
  /** Non-root nodes carrying a usable (finite, ≥ 0) branch length. */
  branchLengthNodes: number;
  /** Non-root nodes WITHOUT usable branch length data (0 / unset / invalid). */
  missingBranchLengths: number;
  /** Unit of `treeHeight` — branch lengths when any were recorded, else edges. */
  treeHeightUnit: 'branch-length' | 'edges';
  /** Maximum root-to-tip path length (sum of branch lengths). */
  treeHeight: number;
  /** Sackin index = sum of leaf depths. */
  sackinIndex: number;
  /** Colless index = sum over internal nodes of |L - R| (imbalance). */
  collessIndex: number;
  /**
   * Colless' index is only defined for rooted BINARY trees. When the tree has
   * polytomies the reported figure is the max−min multifurcation variant — one
   * of several possible generalisations, and not comparable with a binary
   * tree's value (no size normalisation is applied here either).
   */
  collessApplies: boolean;
}

export function treeSummary(project: Project): TreeSummary {
  const nodes = Object.values(project.nodes);
  const tips = nodes.filter((n) => n.childrenIds.length === 0);
  const internals = nodes.filter((n) => n.childrenIds.length > 0);
  const tipCount = tips.length;
  const internalCount = internals.length;

  // Resolution: fraction of internal nodes with exactly 2 children.
  const binaryCount = internals.filter((n) => n.childrenIds.length === 2).length;
  const resolution = internalCount > 0 ? binaryCount / internalCount : 0;

  /**
   * Usable branch length. A recorded ZERO is real data (synchronous speciation
   * in a chronogram, a zero-length branch the author deliberately entered) and
   * therefore counts towards the tree length — excluding it would make
   * `totalBranchLength`/`avgBranchLength` systematically too small on time
   * trees. Negative / non-finite values are not lengths at all:
   * they are excluded and surfaced via `missingBranchLengths`.
   */
  const usable = (n: TreeNode): number | null => {
    const bl = n.branchLength;
    return typeof bl === 'number' && Number.isFinite(bl) && bl >= 0 ? bl : null;
  };
  const withBranch = nodes.filter((n) => n.parentId !== null);
  const lengths = withBranch.map(usable);
  const branchLengthNodes = lengths.filter((l): l is number => l !== null).length;
  const missingBranchLengths = withBranch.length - branchLengthNodes;
  const totalBranchLength = lengths.reduce<number>((a, b) => a + (b ?? 0), 0);
  const avgBranchLength = branchLengthNodes > 0 ? totalBranchLength / branchLengthNodes : 0;

  // Iterative traversal from the root (visited-guarded, no recursion): edge
  // depth and cumulative branch-length depth of every reachable node.
  const depth = new Map<NodeId, number>();
  const cumLength = new Map<NodeId, number>();
  const order: TreeNode[] = [];
  const root = project.nodes[project.rootId];
  const seen = new Set<NodeId>();
  if (root) {
    depth.set(root.id, 0);
    cumLength.set(root.id, 0);
    const stack: TreeNode[] = [root];
    seen.add(root.id);
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      order.push(n);
      for (const cid of n.childrenIds) {
        const c = project.nodes[cid];
        if (!c || seen.has(c.id)) continue; // dangling or cyclic reference
        seen.add(c.id);
        depth.set(c.id, (depth.get(n.id) as number) + 1);
        cumLength.set(c.id, (cumLength.get(n.id) as number) + (usable(c) ?? 0));
        stack.push(c);
      }
    }
  }

  // Sackin index = sum of leaf depths (number of edges from the root).
  let sackinIndex = 0;
  for (const t of tips) sackinIndex += depth.get(t.id) ?? 0;

  // Subtree LEAF counts, bottom-up over the pre-order list walked above.
  // Colless is defined on the number of TIPS in each sub-clade; counting nodes
  // instead doubles every term, because a binary sub-tree holds 2·tips − 1
  // nodes.
  const size = new Map<NodeId, number>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    size.set(
      n.id,
      n.childrenIds.length === 0
        ? 1
        : n.childrenIds.reduce((s, c) => s + (size.get(c) ?? 0), 0),
    );
  }
  let collessIndex = 0;
  for (const n of internals) {
    if (n.childrenIds.length < 2) continue;
    const sizes = n.childrenIds.map((c) => size.get(c) ?? 0);
    collessIndex += Math.max(...sizes) - Math.min(...sizes);
  }
  const collessApplies = internalCount > 0 && binaryCount === internalCount;

  // Tree height = deepest root-to-tip path in the unit the data actually
  // provides: branch lengths when recorded, otherwise edge counts. Adding
  // lengths and falling back to edges only when the sum happened to be exactly
  // 0 would report a dimensionless number, so the unit is chosen up front.
  let treeHeight = 0;
  let treeHeightUnit: TreeSummary['treeHeightUnit'] = 'edges';
  if (branchLengthNodes > 0) {
    treeHeightUnit = 'branch-length';
    for (const t of tips) treeHeight = Math.max(treeHeight, cumLength.get(t.id) ?? 0);
  } else {
    for (const t of tips) treeHeight = Math.max(treeHeight, depth.get(t.id) ?? 0);
  }

  return {
    tipCount,
    internalCount,
    resolution,
    avgBranchLength,
    totalBranchLength,
    branchLengthNodes,
    missingBranchLengths,
    treeHeightUnit,
    treeHeight,
    sackinIndex,
    collessIndex,
    collessApplies,
  };
}

// --- continuous character signal: Blomberg's K ------------------------------

/**
 * Tip count cap: the O(n³) linear solves below stay instant within this bound.
 * Above it `blombergK` returns null and `blombergKBlockReason` says why, so the
 * UI can tell "too many tips" apart from "no data" instead of showing one
 * generic line for both.
 */
export const BLOMBERG_MAX_TIPS = 300;

/** Solve C·z = b by Gaussian elimination with partial pivoting (null if singular). */
function solveLinear(C: number[][], b: number[]): number[] | null {
  const m = C.length;
  const A = C.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < m; col += 1) {
    let piv = col;
    for (let r = col + 1; r < m; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < m; r += 1) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= m; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  const z = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r -= 1) {
    let s = A[r][m];
    for (let c = r + 1; c < m; c += 1) s -= A[r][c] * z[c];
    z[r] = s / A[r][r];
  }
  return z;
}

export interface BlombergKResult {
  k: number;
  n: number;
  /** Non-root branches with no usable length, imputed to 1 for this run. */
  imputedBranches: number;
  /**
   * Non-root branches whose recorded length is a REAL zero (synchronous
   * divergence). A zero is data, not a gap: it is used AS 0 and must not be
   * folded into `imputedBranches`, which counts invented scale.
   */
  zeroBranches: number;
  /** All non-root branches of the tree (imputed/total = how much scale is invented). */
  totalBranches: number;
}

/**
 * Blomberg's K statistic for continuous characters on a phylogeny
 * (Blomberg et al. 2003, Journal of Theoretical Biology 223:399–408, eq. 12),
 * as implemented by phytools::phylosig (Revell, 2012):
 *
 *   a  = (1ᵀC⁻¹x) / (1ᵀC⁻¹1)               - phylogenetic (GLS) mean
 *   r  = x − a·1                            - GLS residuals
 *   K  = (rᵀr / rᵀC⁻¹r) / [ (tr C − n/(1ᵀC⁻¹1)) / (n − 1) ]
 *
 * where C is the phylogenetic covariance matrix (C_ij = shared root→MRCA path
 * length, C_ii = root→tip length). Every piece is centred on the GLS mean and
 * scaled by the matching GLS quadratic forms — mixing an ordinary-mean
 * numerator with a GLS variance agrees with this only on trees whose C has
 * constant row sums, and biases K on unequal-depth trees.
 *
 * Under Brownian motion K ≈ 1; K > 1 suggests more conservatism (phylogenetic
 * signal) than BM, K < 1 less.
 *
 * K is invariant to an overall rescaling of the branch lengths, so branches
 * without usable lengths are imputed to 1 — which silently turns the analysis
 * into a TOPOLOGY-only (cladogram) K whenever the user supplied ages but no
 * lengths. That imputation is counted and returned, and a null return is
 * explained by `blombergKBlockReason`.
 */
function kAnalysis(project: Project, character: Character): {
  result: BlombergKResult | null;
  reason: string | null;
} {
  if (character.type !== 'continuous') {
    return { result: null, reason: tr('该性状不是连续型（数值）性状', 'This character is not continuous/numeric') };
  }

  const tipIds: NodeId[] = [];
  const values: number[] = [];
  for (const t of Object.values(project.nodes)) {
    if (t.childrenIds.length !== 0) continue;
    const v = t.charStates?.[character.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      tipIds.push(t.id);
      values.push(v);
    }
  }
  const n = values.length;
  if (n < 3) {
    return {
      result: null,
      reason: tr(`仅 ${n} 个末端有数值，K 至少需要 3 个`, `only ${n} numeric tip value${n === 1 ? '' : 's'}; K needs at least 3`),
    };
  }
  if (n > BLOMBERG_MAX_TIPS) {
    return {
      result: null,
      reason: tr(
        `${n} 个末端超过 K 的上限 ${BLOMBERG_MAX_TIPS}（协方差矩阵求解为 O(n³)）`,
        `${n} tips exceed the K cap of ${BLOMBERG_MAX_TIPS} (the covariance solve is O(n³))`,
      ),
    };
  }

  // Branch entering a node. A recorded ZERO is real data (synchronous
  // divergence in a chronogram) and is used AS 0 — the same convention asr.ts
  // holds, and the one phylosig implements; folding zeros into the "imputed"
  // bucket made every contemporaneous radiation look like invented scale.
  // Missing / negative / non-finite lengths stay imputed to 1 and counted.
  const imputed = new Set<NodeId>();
  const zeroBranch = new Set<NodeId>();
  let totalBranches = 0;
  const branchOf = (id: NodeId): number => {
    const node = project.nodes[id];
    if (!node || node.parentId === null) return 0;
    totalBranches += 1;
    const bl = node.branchLength;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl > 0) return bl;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl === 0) {
      zeroBranch.add(id);
      return 0;
    }
    imputed.add(id);
    return 1;
  };

  // depth(v) = sum of entering branches from the root down to v (inclusive).
  // Iterative and visited-guarded: a dangling child reference or a cyclic
  // parentId must not throw or spin forever.
  const depth = new Map<NodeId, number>([[project.rootId, 0]]);
  const queue: NodeId[] = [project.rootId];
  const walked = new Set<NodeId>([project.rootId]);
  while (queue.length) {
    const id = queue.shift() as NodeId;
    const node = project.nodes[id];
    if (!node) continue;
    for (const c of node.childrenIds) {
      if (!project.nodes[c] || walked.has(c)) continue;
      walked.add(c);
      depth.set(c, (depth.get(id) as number) + branchOf(c));
      queue.push(c);
    }
  }

  // C_ii = root→tip depth; C_ij = depth of the MRCA (shared path from root).
  const C: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    C[i][i] = depth.get(tipIds[i]) ?? 0;
  }
  for (let i = 0; i < n; i += 1) {
    // Ancestors of tip i (its path to the root).
    const ancestors = new Set<NodeId>();
    let cur: NodeId | null = tipIds[i];
    while (cur !== null && !ancestors.has(cur)) {
      ancestors.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    for (let j = i + 1; j < n; j += 1) {
      let m: NodeId | null = tipIds[j];
      const hops = new Set<NodeId>();
      while (m !== null && !ancestors.has(m) && !hops.has(m)) {
        hops.add(m);
        m = project.nodes[m]?.parentId ?? null;
      }
      const cij = m !== null ? (depth.get(m) ?? 0) : 0;
      C[i][j] = cij;
      C[j][i] = cij;
    }
  }

  const ones = new Array<number>(n).fill(1);
  const z1 = solveLinear(C, ones);
  const zx = solveLinear(C, values);
  const diag = { imputedBranches: imputed.size, zeroBranches: zeroBranch.size, totalBranches };
  if (!z1 || !zx) {
    return {
      result: null,
      reason: tr(
        '协方差矩阵奇异（枝长全为 0 或存在重合末端），K 无法估计',
        'The phylogenetic covariance matrix is singular (zero-length or coincident tips); K is not estimable',
      ),
    };
  }

  let oneTinvOne = 0;
  let oneTinvX = 0;
  let xTinvX = 0;
  for (let i = 0; i < n; i += 1) {
    oneTinvOne += ones[i] * z1[i];
    oneTinvX += ones[i] * zx[i];
    xTinvX += values[i] * zx[i];
  }
  if (!(oneTinvOne > 0)) return { result: null, reason: tr('协方差矩阵非正定，K 无法估计', 'The covariance matrix is not positive definite; K is not estimable') };
  const phyloMean = oneTinvX / oneTinvOne;

  // The published estimator (Blomberg et al. 2003 eq. 12, as implemented by
  // phytools::phylosig) centres EVERYTHING on the GLS mean â:
  //
  //   r    = x − â1
  //   K    = (rᵀr / rᵀC⁻¹r) / [ (tr C − n/(1ᵀC⁻¹1)) / (n − 1) ]
  //
  // Both pairings matter on unequal-depth trees. The previous implementation
  // summed squared deviations from the ORDINARY mean while keeping a GLS
  // variance — the two forms agree only when C has constant row sums, and on
  // asymmetric trees the mixture biased E[K] (e.g. (A:1,B:2,C:3) with
  // x=(1,2,4) gives the standard 661/600 ≈ 1.1017, not 77/75 ≈ 1.0267).
  const r = values.map((v) => v - phyloMean);
  let rTr = 0;
  for (const v of r) rTr += v * v;
  // A constant trait (under the GLS centreing) carries no phylogenetic signal.
  if (rTr === 0) return { result: { k: 0, n, ...diag }, reason: null }; // zero variation, surfaced by the UI

  // rᵀC⁻¹r = xᵀC⁻¹x − 2â·1ᵀC⁻¹x + â²·1ᵀC⁻¹1
  const rTinvR = xTinvX - 2 * phyloMean * oneTinvX + phyloMean * phyloMean * oneTinvOne;
  if (!(rTinvR > 0)) return { result: null, reason: tr('残差方差为 0 或非正，K 无法估计', 'Residual variance is zero or non-positive; K is not estimable') };

  // Normalisation: tr(C) − n/(1ᵀC⁻¹1), the expectation identity that pairs
  // with the GLS residuals (E[rᵀr] = σ²·(tr C − n/(1ᵀC⁻¹1))).
  let trC = 0;
  for (let i = 0; i < n; i += 1) trC += C[i][i];
  const norm = trC - n / oneTinvOne;
  if (!(norm > 0)) return { result: null, reason: tr('归一化项非正，K 无法估计', 'The normalisation term is not positive; K is not estimable') };

  const k = (rTr / rTinvR) / (norm / (n - 1));
  return { result: { k: Math.max(0, k), n, ...diag }, reason: null };
}

export function blombergK(project: Project, character: Character): BlombergKResult | null {
  return kAnalysis(project, character).result;
}

/**
 * Why `blombergK` refuses to report a value for this character (null when K is
 * computable). The UI showed one generic "no data" line for "not scored",
 * "too many tips" and "singular matrix" alike.
 */
export function blombergKBlockReason(project: Project, character: Character): string | null {
  return kAnalysis(project, character).reason;
}

// --- K's null distribution: a simulated BM reference --------------------------
// A bare K = 0.73 says nothing by itself; the reader needs to know how far from
// 1 it has to fall before the tree's branching pattern stops explaining it. The
// simulation below draws traits from Brownian motion ON THIS TREE (Cholesky of
// the same covariance matrix the point estimate used) and reports the two-sided
// p-value P(|K_sim − 1| ≥ |K_obs − 1|) — no external service, fully seeded.

/** Cholesky–Banachiewicz lower triangle of a symmetric positive-definite matrix. */
function cholesky(C: number[][]): number[][] | null {
  const n = C.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = C[i][j];
      for (let k = 0; k < j; k += 1) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 1e-12)) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Solve L·z = b (forward) for a lower-triangular L. */
function solveLower(L: number[][], b: number[]): number[] {
  const n = L.length;
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let j = 0; j < i; j += 1) s -= L[i][j] * z[j];
    z[i] = s / L[i][i];
  }
  return z;
}

export interface BlombergKNullTest {
  k: BlombergKResult;
  /** Two-sided p-value against a Brownian-motion null on this tree. */
  pValue: number;
  /** Replicates actually simulated. */
  replicates: number;
  /** PRNG seed — replayable. */
  seed: number;
}

/**
 * Simulated BM null for Blomberg's K (seeded, fully local). Returns null when
 * the point estimate itself is unavailable or the covariance matrix is not
 * positive definite. The p-value is two-sided on |K − 1|, and the UI must print
 * it next to K rather than letting the bare statistic stand alone.
 */
export function blombergKNullTest(
  project: Project,
  character: Character,
  replicates = 400,
  seed = 20260919,
): BlombergKNullTest | null {
  const point = kAnalysis(project, character);
  if (!point.result) return null;
  const k = point.result;
  // Rebuild the covariance matrix the same way kAnalysis does, by re-deriving
  // depths from the same imputation rules.
  const tipIds: NodeId[] = [];
  const values: number[] = [];
  for (const t of Object.values(project.nodes)) {
    if (t.childrenIds.length !== 0) continue;
    const v = t.charStates?.[character.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      tipIds.push(t.id);
      values.push(v);
    }
  }
  const n = values.length;
  if (n < 3) return null;
  const branchOf = (id: NodeId): number => {
    const node = project.nodes[id];
    if (!node || node.parentId === null) return 0;
    const bl = node.branchLength;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl >= 0) return bl;
    return 1;
  };
  const depth = new Map<NodeId, number>([[project.rootId, 0]]);
  const queue: NodeId[] = [project.rootId];
  const walked = new Set<NodeId>([project.rootId]);
  while (queue.length) {
    const id = queue.shift() as NodeId;
    const node = project.nodes[id];
    if (!node) continue;
    for (const c of node.childrenIds) {
      if (!project.nodes[c] || walked.has(c)) continue;
      walked.add(c);
      depth.set(c, (depth.get(id) as number) + branchOf(c));
      queue.push(c);
    }
  }
  const C: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) C[i][i] = depth.get(tipIds[i]) ?? 0;
  for (let i = 0; i < n; i += 1) {
    const ancestors = new Set<NodeId>();
    let cur: NodeId | null = tipIds[i];
    while (cur !== null && !ancestors.has(cur)) {
      ancestors.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    for (let j = i + 1; j < n; j += 1) {
      let m: NodeId | null = tipIds[j];
      const hops = new Set<NodeId>();
      while (m !== null && !ancestors.has(m) && !hops.has(m)) {
        hops.add(m);
        m = project.nodes[m]?.parentId ?? null;
      }
      const cij = m !== null ? (depth.get(m) ?? 0) : 0;
      C[i][j] = cij;
      C[j][i] = cij;
    }
  }
  const L = cholesky(C);
  if (!L) return null;

  // Standard normal via Box–Muller on a seeded uniform stream.
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (): number => {
    const u1 = Math.max(uniform(), 1e-12);
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  let trC = 0;
  for (let i = 0; i < n; i += 1) trC += C[i][i];
  // z1 = L⁻¹1 ⇒ 1ᵀC⁻¹1 = z1·z1 (C⁻¹ = L⁻ᵀL⁻¹). The normalisation of the
  // simulated K must be the SAME expression the point estimate uses:
  // tr(C) − n/(1ᵀC⁻¹1).
  const z1 = solveLower(L, new Array<number>(n).fill(1));
  let oneTinvOne = 0;
  for (let i = 0; i < n; i += 1) oneTinvOne += z1[i] * z1[i];
  const norm = trC - n / oneTinvOne;
  if (!(norm > 0)) return null;

  // The simulated statistic must be the SAME K as the point estimate: GLS
  // residuals r = x − â1 with â = (1ᵀC⁻¹x)/(1ᵀC⁻¹1), K = (rᵀr / rᵀC⁻¹r) /
  // [ (tr C − n/(1ᵀC⁻¹1)) / (n − 1) ]. With z1 = L⁻¹1, zx = L⁻¹x the needed
  // quadratic forms are the DOT PRODUCTS z1·z1, z1·zx, zx·zx — summing the
  // solve outputs directly treated L⁻¹b as C⁻¹b and made the simulated values
  // a different statistic from the observed one (a change of units then moved
  // the p-value from significance to 1).
  const kOf = (x: number[]): number => {
    const zx = solveLower(L, x);
    let oneTinvX = 0;
    let xTinvX = 0;
    for (let i = 0; i < n; i += 1) {
      oneTinvX += z1[i] * zx[i];
      xTinvX += zx[i] * zx[i];
    }
    if (!(oneTinvOne > 0)) return 0;
    const phyloMean = oneTinvX / oneTinvOne;
    const r = x.map((v) => v - phyloMean);
    let rTr = 0;
    for (const v of r) rTr += v * v;
    if (rTr === 0) return 0;
    const rTinvR = xTinvX - 2 * phyloMean * oneTinvX + phyloMean * phyloMean * oneTinvOne;
    if (!(rTinvR > 0)) return 0;
    return (rTr / rTinvR) / (norm / (n - 1));
  };

  const observedDev = Math.abs(k.k - 1);
  let exceeded = 0;
  for (let r = 0; r < replicates; r += 1) {
    const x = Array.from({ length: n }, () => normal());
    // Correlate: x_sim = L·z.
    const sim = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j2 = 0; j2 <= i; j2 += 1) s += L[i][j2] * x[j2];
      sim[i] = s;
    }
    const kk = kOf(sim);
    if (Math.abs(kk - 1) >= observedDev - 1e-12) exceeded += 1;
  }
  return { k, pValue: (1 + exceeded) / (replicates + 1), replicates, seed };
}

// --- tree balance against the Yule null --------------------------------------

export interface BalanceZScores {
  tips: number;
  /** Sackin index against a Yule null: observed, null mean, null sd, z. */
  sackin: { observed: number; nullMean: number; nullSd: number; z: number };
  /** Colless index against a Yule null (binary trees only; else z = NaN). */
  colless: { observed: number; nullMean: number; nullSd: number; z: number };
  replicates: number;
  seed: number;
}

/**
 * Yule-null standardisation of the raw Sackin / Colless indices. Raw indices
 * grow with n (Sackin ~ n·log n, Colless ~ n^{3/2}), so two raw numbers are not
 * comparable across trees of different sizes; the z-score against 200 simulated
 * Yule trees of the SAME tip count is.
 */
export function yuleBalanceZScores(project: Project, replicates = 200, seed = 20260919): BalanceZScores | null {
  const summary = treeSummary(project);
  const nTips = summary.tipCount;
  if (nTips < 4) return null;
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sackins: number[] = [];
  const collesses: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    // Yule simulation with full topology tracking (kept simple and correct
    // over clever): start at the root; repeatedly split a uniformly random
    // leaf into two until nTips tips exist, then score Sackin/Colless.
    const sizes = new Map<number, number>([[0, 1]]);
    let nid = 1;
    let collessSim = 0;
    let sackinSim = 0;
    const depthOf = new Map<number, number>([[0, 0]]);
    const parentOf = new Map<number, number>();
    const kidsOf = new Map<number, number[]>([]);
    while (sizes.size < 2 * nTips - 1) {
      const leaves: number[] = [];
      for (const [id, size] of sizes) if (!kidsOf.has(id)) leaves.push(id);
      const pick = leaves[Math.floor(uniform() * leaves.length)];
      const kids = [nid, nid + 1];
      nid += 2;
      kidsOf.set(pick, kids);
      parentOf.set(kids[0], pick);
      parentOf.set(kids[1], pick);
      sizes.set(kids[0], 1);
      sizes.set(kids[1], 1);
      depthOf.set(kids[0], (depthOf.get(pick) ?? 0) + 1);
      depthOf.set(kids[1], (depthOf.get(pick) ?? 0) + 1);
    }
    // Bottom-up subtree sizes and balance.
    const subtree = new Map<number, number>();
    const order = [...sizes.keys()].sort((x, y) => (depthOf.get(y) ?? 0) - (depthOf.get(x) ?? 0));
    for (const id of order) {
      const kids = kidsOf.get(id);
      if (!kids) {
        subtree.set(id, 1);
        sackinSim += depthOf.get(id) ?? 0;
        continue;
      }
      const s1 = subtree.get(kids[0]) ?? 1;
      const s2 = subtree.get(kids[1]) ?? 1;
      subtree.set(id, s1 + s2);
      collessSim += Math.abs(s1 - s2);
    }
    sackins.push(sackinSim);
    collesses.push(collessSim);
  }
  const stats = (arr: number[]): { mean: number; sd: number } => {
    const mean = arr.reduce((p, q) => p + q, 0) / arr.length;
    const varr = arr.reduce((p, q) => p + (q - mean) ** 2, 0) / Math.max(1, arr.length - 1);
    return { mean, sd: Math.sqrt(varr) };
  };
  const sStats = stats(sackins);
  const cStats = stats(collesses);
  // A degenerate null (sd = 0 — every simulated tree identical) makes the
  // z-score 0/0 = NaN, which used to travel into the result object and then
  // into the UI (M18). With no variance there is no standardisation: report
  // the null as unusable instead of printing NaN.
  if (!(sStats.sd > 0) || !(cStats.sd > 0)) return null;
  return {
    tips: nTips,
    sackin: {
      observed: summary.sackinIndex,
      nullMean: sStats.mean,
      nullSd: sStats.sd,
      z: sStats.sd > 0 ? (summary.sackinIndex - sStats.mean) / sStats.sd : Number.NaN,
    },
    colless: {
      observed: summary.collessIndex,
      nullMean: cStats.mean,
      nullSd: cStats.sd,
      z: cStats.sd > 0 && summary.collessApplies ? (summary.collessIndex - cStats.mean) / cStats.sd : Number.NaN,
    },
    replicates,
    seed,
  };
}

// --- root-to-tip regression (root-to-tip dating signal, RHD) ------------------

export interface RootToTipRegression {
  tips: number;
  slope: number;
  intercept: number;
  r2: number;
  /** Two-sided p-value for the slope from the t statistic (normal approx). */
  pValue: number;
  /** Tips excluded for lacking a usable age or path length, with reasons counted. */
  excludedNoAge: number;
  excludedNoLength: number;
  /** Root-to-tip path length per included tip (same order as `points`). */
  points: { pathLength: number; age: number }[];
  method: string;
}

/**
 * Root-to-tip regression: path length from root to each tip against sampling
 * age. A clock-like dataset lines up on a straight line whose slope estimates
 * the rate and whose R² measures clock signal — the number every tip-dated
 * (virus / microbial) dataset is expected to report. Ages run BACKWARD in this
 * app (root oldest, tips at 0), so the regression uses `pathLength` against
 * `rootAge − age` (time since the root); a strong clock gives a positive slope
 * ≈ rate.
 */
export function rootToTipRegression(project: Project): RootToTipRegression | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;
  let excludedNoAge = 0;
  let excludedNoLength = 0;
  const points: { pathLength: number; age: number }[] = [];
  const cum = new Map<NodeId, number>([[root.id, 0]]);
  const stack: TreeNode[] = [root];
  const seen = new Set<NodeId>([root.id]);
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    for (const cid of n.childrenIds) {
      const c = project.nodes[cid];
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      const bl = typeof c.branchLength === 'number' && Number.isFinite(c.branchLength) && c.branchLength >= 0
        ? c.branchLength
        : undefined;
      if (bl === undefined) {
        excludedNoLength += 1;
        continue; // an unmeasured segment makes every descendant path meaningless
      }
      cum.set(c.id, (cum.get(n.id) as number) + bl);
      stack.push(c);
    }
  }
  for (const t of Object.values(project.nodes)) {
    if (t.childrenIds.length > 0) continue;
    if (typeof t.age !== 'number' || !Number.isFinite(t.age)) {
      excludedNoAge += 1;
      continue;
    }
    if (!cum.has(t.id)) continue; // its path crossed an unmeasured branch
    points.push({ pathLength: cum.get(t.id) as number, age: t.age });
  }
  if (points.length < 5) return null;
  const rootAge = typeof root.age === 'number' && Number.isFinite(root.age)
    ? root.age
    : Math.max(...points.map((p) => p.age));
  const xs = points.map((p) => rootAge - p.age); // time since the root
  const ys = points.map((p) => p.pathLength);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  // t = slope / SE(slope); SE uses the residual variance. p from the normal
  // approximation to t (n ≥ 5 keeps this honest enough for a screening number;
  // the UI labels it as a normal-approximation p).
  const residSs = syy - slope * sxy;
  const df = Math.max(1, n - 2);
  const se = Math.sqrt(residSs / df / sxx);
  const tStat = se > 0 ? slope / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(tStat)));
  return {
    tips: n,
    slope,
    intercept,
    r2,
    pValue,
    excludedNoAge,
    excludedNoLength,
    points,
    method: tr(
      '根到尖回归（路径长度 vs 根后时间；p 为正态近似）',
      'Root-to-tip regression (path length vs time since root; normal-approximation p)',
    ),
  };
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? p : 1 - p;
}

// --- diversity & phylogenetic-community statistics -----------------------------

/** Pairwise path (cophenetic) distance between tips, from cumulative lengths. */
function patristicMatrix(project: Project): { ids: NodeId[]; d: number[][] } | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;
  const tips = Object.values(project.nodes).filter((n) => n.childrenIds.length === 0);
  if (tips.length < 3) return null;
  const cum = new Map<NodeId, number>([[root.id, 0]]);
  const stack: TreeNode[] = [root];
  const seen = new Set<NodeId>([root.id]);
  let unmeasured = 0;
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    for (const cid of n.childrenIds) {
      const c = project.nodes[cid];
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      const bl = typeof c.branchLength === 'number' && Number.isFinite(c.branchLength) && c.branchLength >= 0
        ? c.branchLength
        : undefined;
      if (bl === undefined) {
        unmeasured += 1;
        continue;
      }
      cum.set(c.id, (cum.get(n.id) as number) + bl);
      stack.push(c);
    }
  }
  if (unmeasured > 0) return null; // honest refusal rather than a silently wrong matrix
  const mrcaDepth = (a: NodeId, b: NodeId): number => {
    const anc = new Set<NodeId>();
    let cur: NodeId | null = a;
    while (cur !== null && !anc.has(cur)) {
      anc.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    let m: NodeId | null = b;
    const hops = new Set<NodeId>();
    while (m !== null && !anc.has(m) && !hops.has(m)) {
      hops.add(m);
      m = project.nodes[m]?.parentId ?? null;
    }
    return m !== null ? (cum.get(m) ?? 0) : 0;
  };
  const d: number[][] = [];
  for (let i = 0; i < tips.length; i += 1) {
    d.push(new Array(tips.length).fill(0));
    for (let j = 0; j < tips.length; j += 1) {
      if (i === j) continue;
      const di = cum.get(tips[i].id) ?? 0;
      const dj = cum.get(tips[j].id) ?? 0;
      const shared = mrcaDepth(tips[i].id, tips[j].id);
      d[i][j] = di + dj - 2 * shared;
    }
  }
  return { ids: tips.map((t) => t.id), d };
}

/**
 * Faith's phylogenetic diversity (PD) of the tips carrying a given discrete
 * state: the total branch length of the minimum spanning subtree connecting
 * them.
 *
 * Root convention (`includeRootPath`, mirroring picante::pd's `include.root`):
 * the branches counted are always the CONNECTING ones — every branch whose
 * subtree carries at least one present tip. With `includeRootPath = false`
 * (default) the walk stops at the set's MRCA: the branch ENTERING that MRCA
 * and everything above it is excluded, so a pair of sister tips contributes
 * their two terminal branches only. With `includeRootPath = true` the path
 * from the tips up to the root is included as well (the root's own stem has no
 * branch and is never counted). The earlier implementation counted only the
 * present tips' TERMINAL branches — an ancestor-of-a-present-tip test that no
 * internal branch can pass — so the internal branches connecting the set were
 * silently dropped.
 */
export function faithPd(
  project: Project,
  characterId: string,
  stateId: string,
  includeRootPath = false,
): number | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;
  const present = new Set<NodeId>(
    Object.values(project.nodes)
      .filter((n) => n.childrenIds.length === 0 && n.charStates?.[characterId] === stateId)
      .map((n) => n.id),
  );
  if (present.size === 0) return null;

  // Whether any present tip sits in the subtree of `id` (iterative post-order
  // so a deep tree cannot overflow the stack).
  const subtreeHasPresent = new Map<NodeId, boolean>();
  {
    const order: NodeId[] = [];
    const stack: NodeId[] = [project.rootId];
    while (stack.length) {
      const id = stack.pop() as NodeId;
      const n = project.nodes[id];
      if (!n) continue;
      order.push(id);
      for (const c of n.childrenIds) stack.push(c);
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const n = project.nodes[order[i]];
      if (!n) continue;
      let any = present.has(n.id);
      for (const c of n.childrenIds) {
        if (subtreeHasPresent.get(c)) any = true;
      }
      subtreeHasPresent.set(n.id, any);
    }
  }

  // The MRCA of the present set: fold pairwise MRCAs. Iterative ancestor walks
  // with cycle guards.
  const mrcaOfPair = (a: NodeId, b: NodeId): NodeId => {
    const anc = new Set<NodeId>();
    let cur: NodeId | null = a;
    while (cur !== null && !anc.has(cur)) {
      anc.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    cur = b;
    const seen = new Set<NodeId>();
    while (cur !== null && !seen.has(cur)) {
      if (anc.has(cur)) return cur;
      seen.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    return project.rootId;
  };
  let setMrca: NodeId | null = null;
  for (const id of present) setMrca = setMrca === null ? id : mrcaOfPair(setMrca, id);
  if (setMrca === null) return null;

  // A single present tip spans only its own terminal branch.
  if (present.size === 1) {
    const only = [...present][0];
    const n = project.nodes[only];
    const bl = n && typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) ? n.branchLength : 0;
    return bl;
  }

  // Is `id` a strict descendant of the set MRCA (used to stop at the MRCA)?
  const belowMrca = (id: NodeId): boolean => {
    const seen = new Set<NodeId>();
    let cur: NodeId | null = project.nodes[id]?.parentId ?? null;
    while (cur !== null && !seen.has(cur)) {
      if (cur === setMrca) return true;
      seen.add(cur);
      cur = project.nodes[cur]?.parentId ?? null;
    }
    return false;
  };

  let pd = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.parentId === null) continue; // the root has no incoming branch
    // A branch is connecting exactly when its subtree carries a present tip:
    // every path from the root to that tip crosses it, and no other branch is
    // needed to keep the set connected.
    if (subtreeHasPresent.get(n.id) !== true) continue;
    if (!includeRootPath && !belowMrca(n.id)) continue;
    const bl = typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) ? n.branchLength : 0;
    pd += bl;
  }
  return pd;
}

export interface CommunityPhyloStats {
  /** Mean pairwise distance among the state's tips. */
  mpd: number;
  /** Mean nearest-neighbour distance among the state's tips. */
  mntd: number;
  /** NRI against random tip sets of the same size (positive = clustered). */
  nri: number;
  /** NTI (positive = clustered). */
  nti: number;
  tips: number;
  replicates: number;
  seed: number;
}

/**
 * MPD / MNTD / NRI / NTI (Webb et al. 2002) for one discrete state's tips,
 * against a random-tip null of the same size. This is the community-phylogenetics
 * read of "are the carriers of this trait clustered on the tree" — the same
 * question Blomberg's K answers for continuous traits.
 *
 * NRI/NTI are the NEGATED z-scores, per the published convention:
 * NRI = −(MPD_obs − mean(MPD_null)) / sd(MPD_null) — so a set of close
 * relatives (small MPD against the null) yields a POSITIVE index, and an
 * overdispersed set a negative one. Returning the bare z-score flipped the
 * sign of every conclusion the reader would draw.
 */
export function communityPhyloStats(
  project: Project,
  characterId: string,
  stateId: string,
  replicates = 200,
  seed = 20260919,
): CommunityPhyloStats | null {
  const pm = patristicMatrix(project);
  if (!pm) return null;
  const present: number[] = [];
  pm.ids.forEach((id, i) => {
    if (project.nodes[id]?.charStates?.[characterId] === stateId) present.push(i);
  });
  if (present.length < 2) return null;
  const mpdOf = (idx: number[]): number => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < idx.length; i += 1) {
      for (let j = i + 1; j < idx.length; j += 1) {
        sum += pm.d[idx[i]][idx[j]];
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  };
  const mntdOf = (idx: number[]): number => {
    let sum = 0;
    for (const i of idx) {
      let best = Number.POSITIVE_INFINITY;
      for (const j of idx) {
        if (i === j) continue;
        best = Math.min(best, pm.d[i][j]);
      }
      if (Number.isFinite(best)) sum += best;
    }
    return sum / idx.length;
  };
  const obsMpd = mpdOf(present);
  const obsMntd = mntdOf(present);
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const all = pm.ids.map((_, i) => i);
  const mpdNull: number[] = [];
  const mntdNull: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    const pool = [...all];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(uniform() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const draw = pool.slice(0, present.length);
    mpdNull.push(mpdOf(draw));
    mntdNull.push(mntdOf(draw));
  }
  const zOf = (obs: number, nulls: number[]): number => {
    const mean = nulls.reduce((p, q) => p + q, 0) / nulls.length;
    const sd = Math.sqrt(nulls.reduce((p, q) => p + (q - mean) ** 2, 0) / Math.max(1, nulls.length - 1));
    return sd > 0 ? (obs - mean) / sd : Number.NaN;
  };
  return {
    mpd: obsMpd,
    mntd: obsMntd,
    // Negated z-scores: the standard NRI/NTI sign (positive = clustered).
    nri: -zOf(obsMpd, mpdNull),
    nti: -zOf(obsMntd, mntdNull),
    tips: present.length,
    replicates,
    seed,
  };
}

/**
 * Fritz–Purvis D for a binary discrete trait (Fritz & Purvis 2010, Methods in
 * Ecology and Evolution 1:319–329; caper::phylo.d). The statistic compares the
 * observed mean difference across SISTER TIPS (internal nodes whose two
 * children are both tips) against two nulls simulated on the same tree:
 *
 *   mean_BM      — traits drawn from Brownian motion on the tree, thresholded
 *                  at 0 (a binary trait with the same phylogenetic structure
 *                  BM would give); D = 0 means BM-like.
 *   mean_random  — tip values randomly permuted across the tips; D = 1 means
 *                  phylogeny-independent.
 *
 *   D = (mean_obs − mean_BM) / (mean_random − mean_BM)
 *
 * so D < 0 = more clustered than BM, D > 1 = overdispersed. The binarisation
 * uses the character's DECLARED state order (first state → 0, second → 1), so
 * a bijective renaming of the state ids cannot change computability — reading
 * only the literal id '1' used to return null for every trait whose states
 * were named anything else. Branch lengths are scaled inside the simulation
 * only through their sign effect: a uniform rescaling of the tree rescales the
 * BM draws, and the 0-threshold keeps their sign pattern, so D is invariant to
 * the branch-length unit.
 */
export function fritzPurvisD(
  project: Project,
  characterId: string,
  replicates = 500,
  seed = 20260919,
): { d: number; pValue: number; tips: number; replicates: number; seed: number } | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;

  // Binarise by DECLARED state order. A character with exactly two discrete
  // states maps first → 0, second → 1; without one, the two distinct observed
  // string values (in sorted order) are used. Any tip with another value is
  // not scored.
  const character = project.characters.find((c) => c.id === characterId);
  let stateZero: string | null = null;
  let stateOne: string | null = null;
  if (character && character.type === 'discrete' && character.states.length === 2) {
    stateZero = character.states[0].id;
    stateOne = character.states[1].id;
  } else {
    const distinct = new Set<string>();
    for (const n of Object.values(project.nodes)) {
      if (n.childrenIds.length > 0) continue;
      const v = n.charStates?.[characterId];
      if (typeof v === 'string') distinct.add(v);
    }
    if (distinct.size === 2) [stateZero, stateOne] = [...distinct].sort();
  }
  if (stateZero === null || stateOne === null) return null;

  const scored: { id: NodeId; one: boolean }[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    const v = n.charStates?.[characterId];
    if (v === stateOne) scored.push({ id: n.id, one: true });
    else if (v === stateZero) scored.push({ id: n.id, one: false });
  }
  if (scored.length < 4) return null;
  const nOnes = scored.filter((s) => s.one).length;
  if (nOnes === 0 || nOnes === scored.length) return null;

  // Sister tips: internal nodes whose two children are both tips. The statistic
  // is the mean |x1 − x2| across those pairs — the caper::phylo.d contrast.
  const tipIds = new Set(scored.map((s) => s.id));
  const sisterPairs: [NodeId, NodeId][] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length !== 2) continue;
    const [a, b] = n.childrenIds;
    if (tipIds.has(a) && tipIds.has(b)) sisterPairs.push([a, b]);
  }
  if (sisterPairs.length === 0) return null;
  const valueOf = new Map(scored.map((s) => [s.id, s.one ? 1 : 0] as const));
  const meanSisterDiff = (vec: Map<NodeId, number>): number => {
    let sum = 0;
    for (const [a, b] of sisterPairs) {
      sum += Math.abs((vec.get(a) ?? 0) - (vec.get(b) ?? 0));
    }
    return sum / sisterPairs.length;
  };
  const observed = meanSisterDiff(valueOf);

  // Branch length entering each node; missing/negative imputed to 1 (the same
  // rule K uses), zero kept as a real zero.
  const branchOf = (id: NodeId): number => {
    const n = project.nodes[id];
    if (!n || n.parentId === null) return 0;
    const bl = n.branchLength;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl >= 0) return bl;
    return 1;
  };

  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (): number => {
    const u1 = Math.max(uniform(), 1e-12);
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  // Root→tip depth per scored tip (iterative, cycle-guarded).
  const depthOf = new Map<NodeId, number>();
  {
    depthOf.set(project.rootId, 0);
    const queue: NodeId[] = [project.rootId];
    const seen = new Set<NodeId>([project.rootId]);
    while (queue.length) {
      const id = queue.shift() as NodeId;
      const n = project.nodes[id];
      if (!n) continue;
      for (const c of n.childrenIds) {
        if (!project.nodes[c] || seen.has(c)) continue;
        seen.add(c);
        depthOf.set(c, (depthOf.get(id) as number) + branchOf(c));
        queue.push(c);
      }
    }
  }

  // Randomisation null: permute the observed tip values across the tips.
  const shuffleStats: number[] = [];
  const ids = scored.map((s) => s.id);
  for (let r = 0; r < replicates; r += 1) {
    const perm = [...ids];
    for (let i = perm.length - 1; i > 0; i -= 1) {
      const j = Math.floor(uniform() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const vec = new Map<NodeId, number>();
    ids.forEach((id, i) => vec.set(id, valueOf.get(perm[i]) ?? 0));
    shuffleStats.push(meanSisterDiff(vec));
  }
  const meanRandom = shuffleStats.reduce((p, q) => p + q, 0) / shuffleStats.length;
  const sdRandom = Math.sqrt(
    shuffleStats.reduce((p, q) => p + (q - meanRandom) ** 2, 0) / Math.max(1, shuffleStats.length - 1),
  );
  if (!(sdRandom > 0)) return null;

  // BM null: draw a continuous trait root→tip (root 0, each branch adds
  // N(0, sqrt(length))), threshold at 0. Thresholding keeps the draw's SIGN,
  // so a uniform rescaling of the tree leaves the null — and D — unchanged.
  const bmStats: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    const vec = new Map<NodeId, number>();
    for (const s of scored) {
      const draw = normal() * Math.sqrt(Math.max(0, depthOf.get(s.id) ?? 0));
      vec.set(s.id, draw > 0 ? 1 : 0);
    }
    bmStats.push(meanSisterDiff(vec));
  }
  const meanBm = bmStats.reduce((p, q) => p + q, 0) / bmStats.length;
  const denom = meanRandom - meanBm;
  if (!(Math.abs(denom) > 1e-12)) return null;
  const d = (observed - meanBm) / denom;
  // Two-sided randomisation p: how often the shuffle null is at least as far
  // from its own mean as the observation is.
  const dev = Math.abs(observed - meanRandom);
  const pValue = shuffleStats.filter((v) => Math.abs(v - meanRandom) >= dev - 1e-12).length / shuffleStats.length;
  return { d, pValue, tips: scored.length, replicates, seed };
}
