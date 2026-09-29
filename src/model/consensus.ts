// Consensus tree construction from multiple phylogenetic trees.
//
// Two methods are supported:
//   * Strict consensus — a clade is retained only if it appears in ALL trees.
//   * Majority-rule (50%) consensus — a clade is retained if it appears in
//     more than half of the trees.
//
// Both algorithms key on ROOTED CLADES — the descendant tip set of an internal
// node — and NOT on unrooted bipartitions. The trees this application edits are
// rooted, and for a rooted tree the complement of a clade is generally not a
// clade at all. Counting bipartitions canonically by their smaller side while
// re-assembling those same keys as nested clades would let the builder invent
// branches that occur in none of the input trees (reported at 100% support) and
// drop real ones. Counting and assembling therefore go through the same
// rooted-clade key, so every clade of the output is provably a clade of some
// input tree, and a single tree is its own consensus.
//
// Tip labels are the cross-tree identity: they must all be present, unique and
// identical between the trees, which `checkConsensusInputs` enforces before any
// counting happens (collapsing mismatched trees into a star tree would hide user
// error).

import { tr } from '../ui/strings';
import { createEmptyProject } from './sampleTree';
import { newId } from './treeOps';
import type { NodeId, Project, TreeNode } from './types';

/** Separator used to encode tip-index sets into clade keys.
 * Using \u0001 (a control character that cannot appear in a valid taxon name)
 * prevents labels containing commas from being mis-split. */
const SPLIT_SEP = '\u0001';

/** Rooted-clade key of a sorted list of tip indices into `tips`. */
function cladeKey(indexes: number[]): string {
  return indexes.join(SPLIT_SEP);
}

export interface ConsensusInputCheck {
  ok: boolean;
  /** Human-readable reasons the inputs cannot be consensus-ed together. */
  issues: string[];
  /** Shared, sorted tip labels (empty unless `ok`). */
  tips: string[];
}

/** Ordered, unique tip labels of one tree (no id fallback — a UUID never matches
 *  the same taxon in another tree). */
function treeTips(project: Project): { tips: string[]; unlabelled: number } {
  const tips: string[] = [];
  let unlabelled = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    if (!n.label) {
      unlabelled += 1;
      continue;
    }
    tips.push(n.label);
  }
  return { tips: tips.sort(), unlabelled };
}

/**
 * Validate that a set of trees may be combined: every tree has named, unique
 * tips and all trees share exactly the same tip set.
 */
export function checkConsensusInputs(projects: Project[]): ConsensusInputCheck {
  const issues: string[] = [];
  if (projects.length === 0) {
    return { ok: false, issues: [tr('没有可用于构建共识树的树', 'No trees to build a consensus from')], tips: [] };
  }

  const perTree: string[][] = [];
  projects.forEach((project, i) => {
    const { tips, unlabelled } = treeTips(project);
    if (unlabelled > 0) {
      issues.push(
        tr(
          `第 ${i + 1} 棵树有 ${unlabelled} 个未命名尖端；共识树按标签比对分类单元，必须先全部命名`,
          `tree ${i + 1} has ${unlabelled} unnamed tip(s); consensus matches taxa by label, so every tip must be named`,
        ),
      );
    }
    const dupes = tips.filter((t, k) => k > 0 && tips[k - 1] === t);
    if (dupes.length > 0) {
      issues.push(
        tr(
          `第 ${i + 1} 棵树存在重复尖端标签（${dupes.slice(0, 3).join('、')}）`,
          `tree ${i + 1} has repeated tip label(s) (${dupes.slice(0, 3).join(', ')})`,
        ),
      );
    }
    perTree.push([...new Set(tips)]);
  });

  const shared = perTree[0];
  const sharedSet = new Set(shared);
  projects.forEach((project, i) => {
    if (i === 0) return;
    const other = new Set(perTree[i]);
    const missing = shared.filter((t) => !other.has(t));
    const extra = [...other].filter((t) => !sharedSet.has(t)).sort();
    if (missing.length > 0 || extra.length > 0) {
      issues.push(
        tr(
          `第 ${i + 1} 棵树的尖端集与第 1 棵不同（缺少 ${missing.slice(0, 3).join('、') || '—'}；多出 ${extra.slice(0, 3).join('、') || '—'}）`,
          `tree ${i + 1} has a different tip set from tree 1 (missing ${missing.slice(0, 3).join(', ') || '—'}; extra ${extra.slice(0, 3).join(', ') || '—'})`,
        ),
      );
    }
  });

  const ok = issues.length === 0;
  return { ok, issues, tips: ok ? shared : [] };
}

/** Merge two ascending index lists into one (deduplicated). */
function mergeSorted(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) {
      out.push(a[i++]);
    } else {
      out.push(b[j++]);
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/**
 * Every non-trivial rooted clade of a tree: for each internal node except the
 * root, the sorted index set of the tips beneath it, keyed by `cladeKey`.
 * Iterative with a visited guard, so a deep (caterpillar) tree cannot overflow
 * the stack and a cyclic child reference cannot loop forever.
 */
export function rootedCladeKeys(project: Project, tips: string[]): Set<string> {
  const indexOf = new Map(tips.map((t, i) => [t, i] as const));
  const out = new Set<string>();
  const root = project.nodes[project.rootId];
  if (!root) return out;

  // Pre-order walk (visited-guarded), then consume in reverse = post-order.
  const order: TreeNode[] = [];
  const seen = new Set<NodeId>([root.id]);
  const stack: TreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    order.push(n);
    for (const cid of n.childrenIds) {
      const c = project.nodes[cid];
      if (!c || seen.has(c.id)) continue; // dangling / duplicate / cyclic reference
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
    for (const cid of n.childrenIds) acc = mergeSorted(acc, members.get(cid) ?? []);
    members.set(n.id, acc);
    if (n.id === project.rootId) continue; // the root clade is the whole tree
    // A single-child (stem) node yields a ONE-TIP "clade". Such a key groups
    // nothing, is trivially compatible with everything, and `buildTreeFromClades`
    // cannot place it — so it would surface as a bogus "incompatible clade"
    // warning on trees that had no conflict at all. Excluding it here keeps the
    // degenerate key out of support counts and reported issues alike.
    if (acc.length > 1 && acc.length < tips.length) out.add(cladeKey(acc));
  }
  return out;
}

/** Clades as label lists: `{ tips, clades }` for reports, tests and the UI. */
export function cladeSetsOf(project: Project): { tips: string[]; clades: string[][] } {
  const { tips } = treeTips(project);
  const unique = [...new Set(tips)].sort();
  const keys = rootedCladeKeys(project, unique);
  return {
    tips: unique,
    clades: [...keys]
      .map((k) => k.split(SPLIT_SEP).map((i) => unique[Number(i)]))
      .sort((a, b) => a.length - b.length || a.join().localeCompare(b.join())),
  };
}

export interface CladeSupport {
  /** Rooted-clade key (sorted tip indices into `tips`, SPLIT_SEP-joined). */
  key: string;
  /** Tip labels of the clade, ascending. */
  tips: string[];
  /** Number of input trees carrying this clade. */
  count: number;
  /** `count / treeCount` as a percentage (the value written to node.support). */
  support: number;
}

/** Count how many of the input trees carry each rooted clade. */
export function cladeSupports(projects: Project[], tips: string[]): CladeSupport[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    for (const key of rootedCladeKeys(p, tips)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const treeCount = Math.max(1, projects.length);
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      tips: key.split(SPLIT_SEP).map((i) => tips[Number(i)]),
      count,
      support: Math.round((100 * count) / treeCount),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Assemble a rooted tree from a compatible (laminar) set of clades. Clades are
 * placed largest-first, so when a clade is created all of its tips are direct
 * children of exactly one node — its parent. Support percentages land on
 * `TreeNode.support` using the 0–100 convention of consensus trees.
 */
function buildTreeFromClades(
  tips: string[],
  clades: CladeSupport[],
  name: string,
  onIssues?: (issues: string[]) => void,
): Project {
  const project = createEmptyProject(name);
  const nodes = project.nodes;
  const rootId = project.rootId;
  const root = nodes[rootId];

  // Leaves, in sorted label order (deterministic: the same input always yields
  // the same child ordering).
  const tipIdOf = new Map<number, NodeId>();
  const parentOf = new Map<NodeId, NodeId>();
  tips.forEach((label, i) => {
    const id = newId();
    nodes[id] = { id, label, parentId: rootId, childrenIds: [] };
    tipIdOf.set(i, id);
    parentOf.set(id, rootId);
    root.childrenIds.push(id);
  });

  const placed = [...clades].sort(
    (a, b) => b.tips.length - a.tips.length || a.key.localeCompare(b.key),
  );
  const unplaced: string[] = [];
  for (const clade of placed) {
    const children = clade.key.split(SPLIT_SEP).map((i) => tipIdOf.get(Number(i)) as NodeId);
    if (children.length < 2) {
      unplaced.push(clade.tips.join(', '));
      continue;
    }
    const holder = parentOf.get(children[0]);
    if (holder === undefined || !children.every((c) => parentOf.get(c) === holder)) {
      // Incompatible with an already-placed clade (cannot happen for clades
      // shared by >50% of the trees, but never invent a branch to hide it).
      unplaced.push(clade.tips.join(', '));
      continue;
    }
    const id = newId();
    nodes[id] = {
      id,
      label: '',
      parentId: holder,
      childrenIds: children,
      support: clade.support,
    };
    const inClade = new Set(children);
    nodes[holder].childrenIds = nodes[holder].childrenIds.filter((c) => !inClade.has(c));
    nodes[holder].childrenIds.push(id);
    for (const c of children) {
      parentOf.set(c, id);
      nodes[c].parentId = id;
    }
  }

  if (unplaced.length > 0) {
    onIssues?.([
      tr(
        `${unplaced.length} 个分枝与已选分枝互不相容，未能嵌套（已跳过）：${unplaced.slice(0, 3).join('；')}`,
        `${unplaced.length} clade(s) were incompatible with the selected set and were skipped: ${unplaced
          .slice(0, 3)
          .join('; ')}`,
      ),
    ]);
  }
  return project;
}

export type ConsensusMethod = 'strict' | 'majority';

/**
 * Build a consensus tree from multiple projects.
 *
 * @param projects - Tree projects; they must all carry the same, complete,
 *   unique set of tip labels (see `checkConsensusInputs`).
 * @param method - 'strict' (all trees) or 'majority' (>50% of trees).
 * @param name - Name for the resulting tree.
 * @param onIssues - Optional sink for the human-readable reason a consensus
 *   could not be built (validation issues, or skipped incompatible clades).
 * @returns the consensus tree, or null when the inputs are not consensusable.
 */
export function buildConsensusTree(
  projects: Project[],
  method: ConsensusMethod,
  name = 'Consensus tree',
  onIssues?: (issues: string[]) => void,
): Project | null {
  const check = checkConsensusInputs(projects);
  if (!check.ok) {
    onIssues?.(check.issues);
    return null;
  }
  const tips = check.tips;
  const supports = cladeSupports(projects, tips);

  // Select clades based on the method. Majority rule uses a strict >50% count,
  // which also guarantees the selected clades are mutually compatible (any two
  // of them co-occur in at least one input tree).
  const threshold = method === 'strict' ? projects.length : Math.floor(projects.length / 2) + 1;
  const selected = supports.filter((s) => s.count >= threshold);
  return buildTreeFromClades(tips, selected, name, onIssues);
}
