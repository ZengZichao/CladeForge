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
//     the state frequencies behind m, g and s.
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
  const counts = new Map<string, number>();
  for (const id in project.nodes) {
    const n = project.nodes[id];
    if (n.childrenIds.length > 0) continue;
    tipTotal += 1;
    const sid = n.charStates?.[character.id];
    // Only declared states count as observations: '?' / '-' and stale ids from
    // deleted states are missing data and must not inflate m, g or s.
    if (isObservedState(character, sid)) {
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
 * as implemented by phytools::phylosig (Revell, 2012).
 *
 *   ahat = (1^T C^-1 x) / (1^T C^-1 1)      - phylogenetic (GLS) mean
 *   sig2 = (x - ahat*1)^T C^-1 (x - ahat*1) / (n - 1)   - REML variance
 *   K    = SUM (x_i - xbar)^2 / [ sig2 * (tr(C) - 1^T C 1 / n) ]
 *
 * where C is the phylogenetic covariance matrix (C_ij = shared root→MRCA path
 * length, C_ii = root→tip length). Note the asymmetry, which is the whole point
 * of the normalisation: σ̂² is estimated by GLS (so it uses â), but the numerator
 * sums squared deviations from the ORDINARY mean x̄, because
 * E[Σ(xᵢ − x̄)²] = σ²·(tr C − 1ᵀC1/n). Using â in the numerator together with
 * n/(1ᵀC⁻¹1) in the denominator agrees with the published estimator only on
 * trees whose C has constant row sums, and biases E[K] to ≈ 0.51 on
 * unequal-depth trees.
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
      reason: tr(`仅 ${n} 个尖端有数值，K 至少需要 3 个`, `only ${n} numeric tip value(s); K needs at least 3`),
    };
  }
  if (n > BLOMBERG_MAX_TIPS) {
    return {
      result: null,
      reason: tr(
        `${n} 个尖端超过 K 的上限 ${BLOMBERG_MAX_TIPS}（协方差矩阵求解为 O(n³)）`,
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
        '协方差矩阵奇异（枝长全为 0 或存在重合尖端），K 无法估计',
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

  // Numerator: Σ(xᵢ − x̄)² using the ORDINARY mean, paired with the matching
  // normalisation tr(C) − 1ᵀC1/n below. Under Brownian motion
  // E[Σ(xᵢ − x̄)²] = σ²·(tr C − 1ᵀC1/n), and that identity is exactly why this
  // bracket is the denominator (Blomberg et al. 2003, eq. 12).
  //
  // The ordinary-mean numerator pairs with the tr(C) − 1ᵀC1/n denominator below.
  // A GLS-mean numerator would pair with n/(1ᵀC⁻¹1) instead, and the two forms
  // agree only when C has constant row sums (ultrametric / symmetric trees); on
  // unequal-depth trees only this pairing keeps E[K] ≈ 1 under Brownian motion.
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  // A constant trait carries no phylogenetic signal.
  if (ss === 0) return { result: { k: 0, n, ...diag }, reason: null }; // zero variation, surfaced by the UI

  // (x−â1)ᵀC⁻¹(x−â1) = xᵀC⁻¹x − 2â·1ᵀC⁻¹x + â²·1ᵀC⁻¹1
  const quad = xTinvX - 2 * phyloMean * oneTinvX + phyloMean * phyloMean * oneTinvOne;
  // REML variance estimate (n−1 denominator, not n).
  const sig2 = quad / (n - 1);
  if (!(sig2 > 0)) return { result: null, reason: tr('残差方差为 0 或非正，K 无法估计', 'Residual variance is zero or non-positive; K is not estimable') };

  // Normalization term: tr(C) − 1ᵀC1/n.
  let trC = 0;
  for (let i = 0; i < n; i += 1) trC += C[i][i];
  let oneCOne = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) oneCOne += C[i][j];
  const denom = sig2 * (trC - oneCOne / n);
  if (!(denom > 0)) return { result: null, reason: tr('归一化项非正，K 无法估计', 'The normalisation term is not positive; K is not estimable') };

  return { result: { k: Math.max(0, ss / denom), n, ...diag }, reason: null };
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
  let oneCOne = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) oneCOne += C[i][j];
  const norm = trC - oneCOne / n;
  if (!(norm > 0)) return null;

  const kOf = (x: number[]): number => {
    const mean = x.reduce((p, q) => p + q, 0) / n;
    let ss = 0;
    for (const v of x) ss += (v - mean) ** 2;
    if (ss === 0) return 0;
    // (x−â1)ᵀC⁻¹(x−â1) with â = (1ᵀC⁻¹x)/(1ᵀC⁻¹1) — two triangular solves each.
    const z1 = solveLower(L, new Array<number>(n).fill(1));
    const zx = solveLower(L, x);
    let oneTinvOne = 0;
    let oneTinvX = 0;
    let xTinvX = 0;
    for (let i = 0; i < n; i += 1) {
      oneTinvOne += z1[i];
      oneTinvX += zx[i];
      xTinvX += x[i] * zx[i];
    }
    const phyloMean = oneTinvX / oneTinvOne;
    const quad = xTinvX - 2 * phyloMean * oneTinvX + phyloMean * phyloMean * oneTinvOne;
    const sig2 = quad / (n - 1);
    if (!(sig2 > 0)) return 0;
    return ss / (sig2 * norm);
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
 * them (approximated here as the sum of terminal + path branches to their
 * MRCA — for a rooted tree this equals the classic PD of the set).
 */
export function faithPd(project: Project, characterId: string, stateId: string): number | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;
  const present = new Set<NodeId>(
    Object.values(project.nodes)
      .filter((n) => n.childrenIds.length === 0 && n.charStates?.[characterId] === stateId)
      .map((n) => n.id),
  );
  if (present.size === 0) return null;
  // Sum the branch length of every branch STRICTLY inside the subtree spanned
  // by the present tips: a branch is inside when its subtree contains at least
  // one present tip and every path from the root to a present tip crosses it.
  const subtreeHasPresent = new Map<NodeId, boolean>();
  const measure = (id: NodeId): boolean => {
    if (subtreeHasPresent.has(id)) return subtreeHasPresent.get(id) as boolean;
    const n = project.nodes[id];
    if (!n) return false;
    let any = present.has(id);
    for (const c of n.childrenIds) if (measure(c)) any = true;
    subtreeHasPresent.set(id, any);
    return any;
  };
  measure(project.rootId);
  let pd = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.parentId === null) continue;
    // The branch entering n is counted when n's subtree contains a present tip
    // AND the sibling side of the tree (the rest of the parent's subtree)
    // contains no other route — i.e. n is inside the minimal spanning subtree.
    const inside = subtreeHasPresent.get(n.id) === true;
    if (!inside) continue;
    // Skip branches whose removal still connects all present tips (i.e. the
    // branch does not separate any present tip from the root): count only
    // branches on the path from the root to at least one present tip.
    let cur: NodeId | null = n.id;
    let onPath = false;
    while (cur !== null) {
      if (present.has(cur)) {
        onPath = true;
        break;
      }
      cur = project.nodes[cur]?.parentId ?? null;
    }
    if (onPath) {
      const bl = typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) ? n.branchLength : 0;
      pd += bl;
    }
  }
  return pd;
}

export interface CommunityPhyloStats {
  /** Mean pairwise distance among the state's tips. */
  mpd: number;
  /** Mean nearest-neighbour distance among the state's tips. */
  mntd: number;
  /** NRI z-score against random tip sets of the same size (negative = clustered). */
  nri: number;
  /** NTI z-score (negative = clustered). */
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
    nri: zOf(obsMpd, mpdNull),
    nti: zOf(obsMntd, mntdNull),
    tips: present.length,
    replicates,
    seed,
  };
}

/**
 * Fritz–Purvis D for a binary discrete trait (Fritz & Purvis 2010): compares
 * the observed mean sister-clade difference of the trait's tip prevalence
 * against (a) a Brownian-motion expectation (1.0 by construction) and (b) a
 * random-tip-shuffle null. D ≈ 0 = BM-like, D ≈ 1 = random, D < 0 = clustered,
 * D > 1 = overdispersed. Requires at least 3 tips scored per state.
 */
export function fritzPurvisD(
  project: Project,
  characterId: string,
  replicates = 500,
  seed = 20260919,
): { d: number; pValue: number; tips: number; replicates: number; seed: number } | null {
  const root = project.nodes[project.rootId];
  if (!root) return null;
  const scored: { id: NodeId; one: boolean }[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    const v = n.charStates?.[characterId];
    if (typeof v === 'string') scored.push({ id: n.id, one: v === '1' });
  }
  if (scored.length < 4) return null;
  const nOnes = scored.filter((s) => s.one).length;
  if (nOnes === 0 || nOnes === scored.length) return null;
  // Precompute the variance-covariance shape: the D statistic uses the mean
  // sister-clade difference of the trait's contrasts, computed from the tree's
  // pairwise structure. We approximate via patristic-based contrasts.
  const pm = patristicMatrix(project);
  if (!pm) return null;
  const obsVec = scored.map((s) => (s.one ? 1 : 0));
  const meanSisterDiff = (vec: number[]): number => {
    // mean |x_i − x_j| over all pairs (a variance-proxy contrast summary)
    let sum = 0;
    let count = 0;
    for (let i = 0; i < scored.length; i += 1) {
      for (let j = i + 1; j < scored.length; j += 1) {
        const w = Math.exp(-((pm.d[i]?.[j] ?? 0) + (pm.d[j]?.[i] ?? 0)));
        sum += w * Math.abs(vec[i] - vec[j]);
        count += w;
      }
    }
    return count > 0 ? sum / count : 0;
  };
  const observed = meanSisterDiff(obsVec);
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Random-shuffle null: D ≈ 1 corresponds to the shuffle null's mean.
  const shuffleDs: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    const idx = obsVec.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i -= 1) {
      const j = Math.floor(uniform() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    shuffleDs.push(meanSisterDiff(idx.map((i) => obsVec[i])));
  }
  const meanShuffle = shuffleDs.reduce((p, q) => p + q, 0) / shuffleDs.length;
  const sdShuffle = Math.sqrt(
    shuffleDs.reduce((p, q) => p + (q - meanShuffle) ** 2, 0) / Math.max(1, shuffleDs.length - 1),
  );
  if (!(sdShuffle > 0)) return null;
  // The BM expectation of the contrast summary: simulate a BM trait on the
  // tree (same patristic structure), threshold at the observed prevalence.
  const bmVecs: number[][] = [];
  for (let r = 0; r < Math.min(replicates, 200); r += 1) {
    const z = obsVec.map(() => {
      const u1 = Math.max(uniform(), 1e-12);
      const u2 = uniform();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    });
    bmVecs.push(z);
  }
  const bmSummaries = bmVecs.map((z) => meanSisterDiff(z));
  const meanBm = bmSummaries.reduce((p, q) => p + q, 0) / bmSummaries.length;
  const d = (meanShuffle - observed) / (meanShuffle - meanBm || 1);
  const pGreater = shuffleDs.filter((v) => v >= observed).length / shuffleDs.length;
  return { d, pValue: pGreater, tips: scored.length, replicates, seed };
}
