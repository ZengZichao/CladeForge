// Tree-to-tree distance metrics.
//
// A workbench whose core claim is "compare competing hypotheses" must be able
// to QUANTIFY how far two trees are apart — until this module existed the app
// could build a consensus yet could not answer "how different are these two
// topologies?", which made the comparison claim decorative.
//
// Implemented (all computed on ROOTED clade keys from model/consensus.ts, so
// the metrics share one definition of "split" with the consensus builder):
//   * Robinson–Foulds (symmetric difference of clade sets; rooted, with the
//     trivial whole-tree clade excluded — standard practice for rooted RF);
//   * weighted RF (Σ |length_a − length_b| over all splits, unmatched splits
//     contributing their own length — the classic branch-length RF);
//   * the clade support matrix (which clades are shared / unique), the raw
//     material for extended-consensus reporting.
//
// Tip sets must match exactly: comparing trees over different taxon samples is
// a different question (subset matching) and is refused with a readable error.

import { tr } from '../ui/strings';
import { rootedCladeKeys, SPLIT_SEP } from './consensus';
import type { NodeId, Project, TreeNode } from './types';

export interface TreeDistanceResult {
  /** Raw Robinson–Foulds count: |S(a) Δ S(b)| over non-trivial clades. */
  rf: number;
  /** Maximum possible RF for two trees with this tip count (the normaliser). */
  rfMax: number;
  /** Normalised RF in [0, 1]: rf / rfMax (0 = identical, 1 = maximally different). */
  rfNormalized: number;
  /**
   * Weighted RF: Σ over all clades of |len_a − len_b|, with a clade missing
   * from one tree contributing that tree's accumulated path length for it.
   * Only meaningful when both trees carry branch lengths (null otherwise).
   */
  wrf: number | null;
  /** Shared tip labels (the two trees must agree for a distance to exist). */
  sharedTips: string[];
  /** Clades present only in tree A / only in tree B, as tip-label lists. */
  onlyA: string[][];
  onlyB: string[][];
}

function cladeMap(project: Project, tips: string[]): Map<string, string[]> {
  const keys = rootedCladeKeys(project, tips);
  const out = new Map<string, string[]>();
  for (const key of keys) out.set(key, key.split(SPLIT_SEP).map((i) => tips[Number(i)]));
  return out;
}

/** Total incoming branch length per clade key of one tree (null lengths skipped). */
function cladeLengths(project: Project, tips: string[]): Map<string, number> {
  const indexOf = new Map(tips.map((t, i) => [t, i] as const));
  const root = project.nodes[project.rootId];
  const lengths = new Map<string, number>();
  if (!root) return lengths;
  const order: TreeNode[] = [];
  const seen = new Set<NodeId>([root.id]);
  const stack: TreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    order.push(n);
    for (const cid of n.childrenIds) {
      const c = project.nodes[cid];
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      stack.push(c);
    }
  }
  const members = new Map<NodeId, number[]>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    if (n.childrenIds.length === 0) {
      const idx = n.label ? indexOf.get(n.label) : undefined;
      members.set(n.id, idx === undefined ? [] : [idx]);
      continue;
    }
    let acc: number[] = [];
    for (const cid of n.childrenIds) {
      const childMembers = members.get(cid) ?? [];
      acc = [...new Set([...acc, ...childMembers])].sort((a, b) => a - b);
    }
    members.set(n.id, acc);
    if (n.id === project.rootId) continue;
    if (acc.length > 1 && acc.length < tips.length) {
      const bl = typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) ? n.branchLength : 0;
      lengths.set(acc.join(SPLIT_SEP), bl);
    }
  }
  return lengths;
}

function sortedTips(project: Project): string[] {
  const tips: string[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0 && n.label) tips.push(n.label);
  }
  return [...new Set(tips)].sort();
}

/**
 * Robinson–Foulds (and weighted RF) between two rooted trees with identical
 * tip sets. Throws a readable Error when the tip sets differ — comparing trees
 * over different samples silently would produce a meaningless number.
 */
export function treeDistance(a: Project, b: Project): TreeDistanceResult {
  const tipsA = sortedTips(a);
  const tipsB = sortedTips(b);
  const sameSet = tipsA.length === tipsB.length && tipsA.every((t, i) => t === tipsB[i]);
  if (!sameSet) {
    throw new Error(
      tr(
        `两棵树的末端集合不同（${tipsA.length} vs ${tipsB.length} 个末端），树间距离未定义`,
        `The two trees have different tip sets (${tipsA.length} vs ${tipsB.length} tips); tree distance is undefined`,
      ),
    );
  }
  const tips = tipsA;
  const cladesA = cladeMap(a, tips);
  const cladesB = cladeMap(b, tips);
  const onlyA: string[][] = [];
  const onlyB: string[][] = [];
  let rf = 0;
  for (const key of cladesA.keys()) {
    if (!cladesB.has(key)) {
      rf += 1;
      onlyA.push(cladesA.get(key) as string[]);
    }
  }
  for (const key of cladesB.keys()) {
    if (!cladesA.has(key)) {
      rf += 1;
      onlyB.push(cladesB.get(key) as string[]);
    }
  }
  // For rooted trees over n tips the non-trivial clade count per tree is at
  // most n − 2 (internal nodes minus the root, excluding stem nodes), so the
  // symmetric difference is bounded by 2(n − 2).
  const rfMax = 2 * Math.max(0, tips.length - 2);
  const lensA = cladeLengths(a, tips);
  const lensB = cladeLengths(b, tips);
  const haveLengths = lensA.size > 0 && lensB.size > 0;
  let wrf: number | null = null;
  if (haveLengths) {
    let w = 0;
    for (const [key, la] of lensA) w += Math.abs(la - (lensB.get(key) ?? 0));
    for (const [key, lb] of lensB) if (!lensA.has(key)) w += lb;
    wrf = w;
  }
  return {
    rf,
    rfMax,
    rfNormalized: rfMax > 0 ? rf / rfMax : 0,
    wrf,
    sharedTips: tips,
    onlyA,
    onlyB,
  };
}

/**
 * Average normalised RF of every input tree against the FIRST one — the
 * "how far does the sample spread" summary a tree-set import should show.
 */
export function treeSetSpread(projects: Project[]): { pairwiseMean: number; max: number; pairs: number } | null {
  if (projects.length < 2) return null;
  let sum = 0;
  let max = 0;
  let pairs = 0;
  try {
    for (let i = 1; i < projects.length; i += 1) {
      const d = treeDistance(projects[0], projects[i]);
      sum += d.rfNormalized;
      max = Math.max(max, d.rfNormalized);
      pairs += 1;
    }
  } catch {
    return null; // differing tip sets — the caller reports the error itself
  }
  return { pairwiseMean: pairs > 0 ? sum / pairs : 0, max, pairs };
}
