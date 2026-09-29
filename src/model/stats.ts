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

  // Branch entering a node (0 at the root; missing/zero/invalid → 1, counted).
  const imputed = new Set<NodeId>();
  let totalBranches = 0;
  const branchOf = (id: NodeId): number => {
    const node = project.nodes[id];
    if (!node || node.parentId === null) return 0;
    totalBranches += 1;
    const bl = node.branchLength;
    if (typeof bl === 'number' && Number.isFinite(bl) && bl > 0) return bl;
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
  const diag = { imputedBranches: imputed.size, totalBranches };
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
  if (ss === 0) return { result: { k: 0, n, ...diag }, reason: null };

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
