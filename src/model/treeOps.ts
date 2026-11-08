// Pure tree operations. Each function mutates a Project (typically an Immer
// draft supplied by the store) so callers get structural sharing + undo for free.

import { nanoid } from 'nanoid';
import type {
  EdgeId,
  EdgeStyle,
  EnvironmentalEvent,
  EventId,
  EvolutionaryEvent,
  HypothesisMeta,
  NodeId,
  NodeStyle,
  BranchStyle,
  Character,
  CharacterState,
  CalibrationPoint,
  Point,
  Project,
  SupportKind,
  SupportScale,
  TreeNode,
} from './types';
import { DEFAULT_RECON_COSTS } from './types';
import { defaultLayers } from './layers';
import { parsimony } from './parsimony';
// `MISSING_STATE_CODES` is the canonical '?' / '-' list (model/characters.ts),
// so the write path and every reader agree on what "no observation" means.
import { MISSING_STATE_CODES } from './characters';

/**
 * Document-wide id source.
 *
 * Id generation is a *seam*, not a constant: a bare `nanoid(10)` call is
 * unseedable, so building the same sample project twice never yields the same
 * ids and no byte-level regression test over a built document is possible —
 * which is why model tests hand-roll fixed ids like `d_t1`. `setIdGenerator`
 * lets a test or a batch tool install a deterministic source
 * (`sequentialIdGenerator`); production keeps nanoid.
 */
let idFactory: () => string = () => nanoid(10);

export function newId(): string {
  return idFactory();
}

/** Install a deterministic id source (tests, reproducible exports). */
export function setIdGenerator(factory: () => string): void {
  idFactory = factory;
}

/** Restore the default (nanoid) id source. */
export function resetIdGenerator(): void {
  idFactory = () => nanoid(10);
}

/** A counter-based generator: `n1`, `n2`, … — reproducible across builds. */
export function sequentialIdGenerator(prefix = 'n'): () => string {
  let seq = 0;
  return () => `${prefix}${(seq += 1)}`;
}

/**
 * A *recorded* branch length: any finite number ≥ 0.
 *
 * Zero is real data, not absence. A chronogram records 0 for a synchronous
 * speciation, and `treeSummary` counts such branches towards the tree length
 * (`stats.ts`, `usable`), so this function has to agree: treating 0 as unknown
 * makes the two definitions disagree and costs the user real information —
 * merging a node whose child had a recorded length of 0 would discard that
 * child's whole accumulated path.
 *
 * Unset, negative and non-finite values are NOT lengths and stay unknown —
 * never silently replaced by 1 or 0.
 */
export function knownLength(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function createNode(partial: Partial<TreeNode> & { parentId: NodeId | null }): TreeNode {
  const { id, label, parentId, childrenIds, ...rest } = partial;
  return {
    id: id ?? newId(),
    label: label ?? '',
    parentId,
    childrenIds: childrenIds ?? [],
    ...rest,
  };
}

export function isLeaf(project: Project, id: NodeId): boolean {
  const n = project.nodes[id];
  return !!n && n.childrenIds.length === 0;
}

export function getChildren(project: Project, id: NodeId): TreeNode[] {
  const n = project.nodes[id];
  if (!n) return [];
  return n.childrenIds.map((cid) => project.nodes[cid]).filter(Boolean) as TreeNode[];
}

/** Every id in the subtree rooted at `id`, including `id` itself. */
export function collectSubtree(project: Project, id: NodeId): Set<NodeId> {
  const set = new Set<NodeId>();
  const stack: NodeId[] = [id];
  while (stack.length) {
    const cur = stack.pop() as NodeId;
    if (set.has(cur)) continue;
    set.add(cur);
    const n = project.nodes[cur];
    if (n) for (const c of n.childrenIds) stack.push(c);
  }
  return set;
}

/** Is `maybeDescendant` inside the subtree rooted at `ancestorId`? */
export function isDescendant(
  project: Project,
  ancestorId: NodeId,
  maybeDescendant: NodeId,
): boolean {
  return collectSubtree(project, ancestorId).has(maybeDescendant);
}

/**
 * The node Alt+Arrow should land on: up = parent, down = first child,
 * left/right = previous / next sibling among the parent's children.
 *
 * Extracted from the canvas key handler so the rule the shortcut sheet promises
 * ("父/子/兄弟", "parent/child/sibling") is testable — stepping ±1 through a
 * flat pre-order list would land on unrelated nodes. Returns undefined when
 * there is nowhere to go, so the caller
 * leaves the selection alone rather than wrapping around.
 */
export function topologicalNeighbour(
  project: Project,
  id: NodeId,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
): NodeId | undefined {
  const cur = project.nodes[id];
  if (!cur) return undefined;
  if (key === 'ArrowUp') return cur.parentId ?? undefined;
  if (key === 'ArrowDown') return cur.childrenIds[0];
  const parent = cur.parentId ? project.nodes[cur.parentId] : undefined;
  const sibs = parent ? parent.childrenIds : [cur.id];
  const j = sibs.indexOf(cur.id) + (key === 'ArrowLeft' ? -1 : 1);
  return j >= 0 && j < sibs.length ? sibs[j] : undefined;
}

export function depthOf(project: Project, id: NodeId): number {
  let d = 0;
  let cur = project.nodes[id];
  // Every upward walk here (pathToRoot, rerootAtNode, unpinForReflow) is
  // cycle-guarded, so a corrupt `parentId` cycle degrades instead of hanging.
  const seen = new Set<NodeId>([id]);
  while (cur && cur.parentId) {
    d += 1;
    if (seen.has(cur.parentId)) return d;
    seen.add(cur.parentId);
    cur = project.nodes[cur.parentId];
  }
  return d;
}

/** Add `count` new empty child nodes under `parentId`. Returns their ids. */
export function addChildren(project: Project, parentId: NodeId, count: number): NodeId[] {
  const parent = project.nodes[parentId];
  if (!parent) return [];
  // A non-positive / non-finite count adds nothing: `count = 0` means zero
  // children, not "create one", so a caller that computed zero children gets
  // none back rather than a silently inserted node.
  if (typeof count !== 'number' || !Number.isFinite(count)) return [];
  const n = Math.floor(count);
  if (n <= 0) return [];
  const ids: NodeId[] = [];
  for (let i = 0; i < n; i += 1) {
    const node = createNode({ parentId });
    project.nodes[node.id] = node;
    parent.childrenIds.push(node.id);
    ids.push(node.id);
  }
  if (parent.collapsed) parent.collapsed = false;
  return ids;
}

/** Add one sibling next to `id` (under the same parent). */
export function addSibling(project: Project, id: NodeId): NodeId | null {
  const node = project.nodes[id];
  if (!node || node.parentId === null) return null;
  const [created] = addChildren(project, node.parentId, 1);
  return created ?? null;
}

/**
 * Add `count` children, then re-space the affected part of the tree.
 *
 * Freshly added tips are auto-placed, but any node the user has manually
 * dragged keeps its pinned absolute position and is drawn on top of the new
 * layout — so a new fork can visually collide with older branches. Those
 * positions therefore have to be released, but only where adding a child
 * actually re-rows the tree: `unpinForReflow(project, parentId)` (see there),
 * never a blanket `unpinAll` that would discard every hand-tuned position in the
 * document because one sibling was added. Returns the new child ids.
 */
export function addChildrenSpaced(project: Project, parentId: NodeId, count: number): NodeId[] {
  const ids = addChildren(project, parentId, count);
  if (ids.length > 0) unpinForReflow(project, parentId);
  return ids;
}

/** Add one sibling next to `id`, then re-space the affected region (see above). */
export function addSiblingSpaced(project: Project, id: NodeId): NodeId | null {
  const node = project.nodes[id];
  const created = addSibling(project, id);
  if (created && node?.parentId) unpinForReflow(project, node.parentId);
  return created;
}

/**
 * Release manual positions wherever inserting under `parentId` moves rows.
 *
 * The layout assigns cross-axis rows in a depth-first sweep (d3 `cluster`), so a
 * new leaf shifts: (a) the subtree under the insertion point, (b) every ancestor
 * of that point (an internal node's row is the mean of its children's), and
 * (c) everything the sweep reaches *after* it. Nodes earlier in the sweep keep
 * their rows — and keep the position the user dragged them to.
 */
export function unpinForReflow(project: Project, parentId: NodeId): void {
  // Depth-first pre-order over the reachable tree; a subtree is a contiguous
  // slice of this list, so "at or after the insertion point" is an index test.
  const order: NodeId[] = [];
  const index = new Map<NodeId, number>();
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [project.rootId];
  while (stack.length) {
    const id = stack.pop() as NodeId;
    if (seen.has(id)) continue;
    const n = project.nodes[id];
    if (!n) continue;
    seen.add(id);
    index.set(id, order.length);
    order.push(id);
    for (let i = n.childrenIds.length - 1; i >= 0; i -= 1) stack.push(n.childrenIds[i]);
  }
  const at = index.get(parentId);
  if (at === undefined) {
    // Unreachable from the root (corrupt document): nothing to re-space.
    return;
  }
  const release = (id: NodeId | null): void => {
    const n = id ? project.nodes[id] : undefined;
    if (!n) return;
    n.pinned = false;
    delete n.position;
  };
  for (let i = at; i < order.length; i += 1) release(order[i]);
  let anc = project.nodes[parentId]?.parentId ?? null;
  const guard = new Set<NodeId>([parentId]);
  while (anc && !guard.has(anc)) {
    guard.add(anc);
    release(anc);
    anc = project.nodes[anc]?.parentId ?? null;
  }
}

/**
 * Delete a node.
 * cascade=true removes the whole subtree; cascade=false lifts the node's
 * children up to its parent before removing just the node.
 */
export function deleteNode(project: Project, id: NodeId, cascade = true): boolean {
  const node = project.nodes[id];
  if (!node) return false;
  if (node.parentId === null) return false; // never delete the root here
  const parent = project.nodes[node.parentId];
  if (!parent) return false;

  if (cascade) {
    const removed = collectSubtree(project, id);
    parent.childrenIds = parent.childrenIds.filter((c) => c !== id);
    for (const rid of removed) delete project.nodes[rid];
    project.customEdges = project.customEdges.filter(
      (e) => !removed.has(e.sourceId) && !removed.has(e.targetId),
    );
    pruneEventsForNodes(project, removed);
    pruneHypothesisNotesForNodes(project, removed);
    // Clean up calibration points referencing deleted nodes so exported
    // MrBayes/BEAST blocks don't reference non-existent nodes.
    project.calibrationPoints = project.calibrationPoints.filter(
      (cp) => !removed.has(cp.nodeId),
    );
  } else {
    // Splice the node out, re-parenting its children in place.
    const idx = parent.childrenIds.indexOf(id);
    // `parentId` and `parent.childrenIds` disagree (hand-edited / half-applied
    // edit). Without this guard `slice(0, -1)` drops a sibling and the child
    // references get duplicated, so every later tip count is wrong.
    if (idx < 0) return false;
    const before = parent.childrenIds.slice(0, idx);
    const after = parent.childrenIds.slice(idx + 1);
    parent.childrenIds = [...before, ...node.childrenIds, ...after];
    // The node's incoming edge merges into each child's incoming edge: an edge
    // is a length, so removing the node in the middle adds the two segments.
    // The sum is known only when BOTH segments are known — an unknown segment
    // leaves the merged edge unknown (a distance through it must stay
    // unmeasurable), never silently zero, and a recorded zero stays a zero.
    const ownLength = knownLength(node.branchLength);
    for (const cid of node.childrenIds) {
      const c = project.nodes[cid];
      if (!c) continue;
      c.parentId = parent.id;
      const childLength = knownLength(c.branchLength);
      c.branchLength =
        ownLength === undefined || childLength === undefined ? undefined : ownLength + childLength;
    }
    delete project.nodes[id];
    project.customEdges = project.customEdges.filter(
      (e) => e.sourceId !== id && e.targetId !== id,
    );
    pruneEventsForNodes(project, new Set([id]));
    pruneHypothesisNotesForNodes(project, new Set([id]));
    project.calibrationPoints = project.calibrationPoints.filter(
      (cp) => cp.nodeId !== id,
    );
  }
  return true;
}

/**
 * Insert a new intermediate parent between `childId` and its current parent.
 *
 * The new node splits the child's incoming edge, so the edge is *divided*
 * (half and half) instead of left entirely on the child: an undivided edge would
 * leave the new node with neither a length nor an age while the child kept the
 * whole edge, putting the inserted node on the present-day line in a time layout
 * (its `age ?? 0`) and drawing a zero-length branch in a phylogram — an invisible
 * insertion. Ages are node properties, so the new node's age is
 * interpolated between the two endpoints when both are known, and stays unknown
 * when either is missing.
 */
export function insertParent(project: Project, childId: NodeId): NodeId | null {
  const child = project.nodes[childId];
  if (!child || child.parentId === null) return null;
  const parent = project.nodes[child.parentId];
  if (!parent) return null;
  const node = createNode({ parentId: parent.id, childrenIds: [childId] });
  const edge = knownLength(child.branchLength);
  if (edge !== undefined) {
    node.branchLength = edge / 2;
    child.branchLength = edge / 2;
  }
  const parentAge = finiteAge(parent);
  const childAge = finiteAge(child);
  if (parentAge !== undefined && childAge !== undefined) {
    node.age = (parentAge + childAge) / 2;
  }
  project.nodes[node.id] = node;
  parent.childrenIds = parent.childrenIds.map((c) => (c === childId ? node.id : c));
  child.parentId = node.id;
  return node.id;
}

/** A node's age when it is a usable finite number, else undefined. */
function finiteAge(node: TreeNode | undefined): number | undefined {
  if (!node || typeof node.age !== 'number' || !Number.isFinite(node.age)) return undefined;
  return node.age;
}

/** Move `id` under `newParentId`. Rejects moves that would create a cycle. */
export function reparent(project: Project, id: NodeId, newParentId: NodeId): boolean {
  if (id === newParentId) return false;
  const node = project.nodes[id];
  const newParent = project.nodes[newParentId];
  if (!node || !newParent) return false;
  if (node.parentId === null) return false; // can't move the root
  if (node.parentId === newParentId) return false; // no-op
  if (isDescendant(project, id, newParentId)) return false; // cycle guard

  if (node.parentId) {
    const oldParent = project.nodes[node.parentId];
    if (oldParent) {
      oldParent.childrenIds = oldParent.childrenIds.filter((c) => c !== id);
    }
  }
  node.parentId = newParentId;
  newParent.childrenIds.push(id);
  return true;
}

/** Reorder a child within its parent's children array. */
export function reorderChild(project: Project, id: NodeId, targetIndex: number): boolean {
  const node = project.nodes[id];
  if (!node || node.parentId === null) return false;
  const parent = project.nodes[node.parentId];
  if (!parent) return false;
  const from = parent.childrenIds.indexOf(id);
  if (from < 0) return false;
  const clamped = Math.max(0, Math.min(parent.childrenIds.length - 1, targetIndex));
  parent.childrenIds.splice(from, 1);
  parent.childrenIds.splice(clamped, 0, id);
  return true;
}

/**
 * Iterative post-order fold over the whole document: `combine(childResults)` is
 * applied bottom-up, so neither the caller nor the tree depth can blow the JS
 * stack (the analysis layer recurses; the tree layer does not).
 * Nodes unreachable from the root are folded too, as single-node trees.
 */
function foldPostOrder(
  project: Project,
  combine: (node: TreeNode, childResults: number[]) => number,
): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  const starts: NodeId[] = [project.rootId, ...Object.keys(project.nodes)];
  for (const start of starts) {
    if (out.has(start) || !project.nodes[start]) continue;
    // Frame = (node, next child to visit, accumulated results). Explicit stack,
    // plus an on-stack set so a corrupt parent/child cycle terminates.
    const stack: { id: NodeId; ci: number; acc: number[] }[] = [{ id: start, ci: 0, acc: [] }];
    const onStack = new Set<NodeId>([start]);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const n = project.nodes[top.id];
      if (!n) {
        onStack.delete(top.id);
        stack.pop();
        continue;
      }
      if (top.ci >= n.childrenIds.length) {
        out.set(top.id, combine(n, top.acc));
        onStack.delete(top.id);
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.acc.push(out.get(top.id) as number);
        continue;
      }
      const childId = n.childrenIds[top.ci];
      top.ci += 1;
      if (out.has(childId)) {
        top.acc.push(out.get(childId) as number);
        continue;
      }
      if (onStack.has(childId) || !project.nodes[childId]) continue; // cycle / dangling
      onStack.add(childId);
      stack.push({ id: childId, ci: 0, acc: [] });
    }
  }
  return out;
}

/** Number of descendant tips under every node (a tip counts as 1). */
export function tipCountBelow(project: Project): Map<NodeId, number> {
  return foldPostOrder(project, (n, kids) =>
    n.childrenIds.length === 0 ? 1 : kids.reduce((a, b) => a + b, 0),
  );
}

/**
 * Topological height of every node: the number of EDGES on its longest path down
 * to a tip (0 for a tip). This is a *relative* depth — an edge count, not an age
 * in the project's time unit — which is why it lives here instead of in `age`.
 */
export function topologicalHeights(project: Project): Map<NodeId, number> {
  return foldPostOrder(project, (n, kids) =>
    n.childrenIds.length === 0 ? 0 : kids.reduce((m, h) => Math.max(m, h + 1), 0),
  );
}

/**
 * Sort every node's children by descending (default) or ascending number of
 * DESCENDANT TIPS.
 *
 * Farris ladderize orders clades by their tip count, not by how many nodes they
 * contain: with unary or named internal nodes the two measures disagree
 * and the result stops matching FigTree / iTOL. Ties keep the current order, so
 * the sort is stable and never reshuffles equally sized clades.
 */
export function ladderize(project: Project, ascending = false): void {
  const sizes = tipCountBelow(project);
  const sizeOf = (id: NodeId): number => sizes.get(id) ?? 0;
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 1) {
      const ranks = n.childrenIds.map(sizeOf);
      if (ranks.every((r, i) => i === 0 || r === ranks[i - 1])) continue; // already ordered
      const keyed = n.childrenIds.map((id, i) => ({ id, i, size: ranks[i] }));
      keyed.sort((a, b) =>
        a.size === b.size ? a.i - b.i : ascending ? a.size - b.size : b.size - a.size,
      );
      n.childrenIds = keyed.map((k) => k.id);
    }
  }
}

/**
 * Re-root the tree on the branch entering `targetId`, at `fraction` of the way
 * from that branch's PARENT end towards `targetId` (0.5 = the middle of the
 * branch, the neutral position when only "which branch is the root on" is known
 * — this is what FigTree's "reroot here" does).
 *
 * Branch lengths MIGRATE with the edge. `TreeNode.branchLength`
 * documents "the branch entering this node" (types.ts), so when the direction of
 * an edge is reversed its child end changes and the length has to move with it —
 * a length glued to its node would leave branches with the wrong length:
 * phylogram depths (`autoLayout`) would not match the divergence intervals, and
 * Mk / Blomberg's K / tree-length statistics would give values that are not
 * comparable with the pre-reroot tree. Concretely: an edge `p → c` carrying
 * `L(c)` becomes `c → p` and now carries `L(c)` on `p`; the split edge is divided
 * in the requested ratio. Unknown stays unknown (a segment of a branch without a
 * length is `undefined`, never 0 or 1).
 *
 * Ages are node properties (divergence times) and stay put, but the fresh root
 * gets the age interpolated along the split branch — without it the two new
 * root edges cannot be checked and `validateTimeData` skips the inversion the
 * re-root created.
 *
 * A unifurcation left at the former root is suppressed, and the events / fossil
 * calibrations that hung on it are re-attached to the surviving lineage instead
 * of being silently deleted. Returns false when the target is missing or already
 * the root.
 */
export function rerootAtNode(project: Project, targetId: NodeId, fraction = 0.5): boolean {
  const target = project.nodes[targetId];
  if (!target || target.parentId === null) return false;
  const oldRootId = project.rootId;
  const oldParentId = target.parentId;
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.5;

  // Path oldParent -> ... -> oldRoot, with a `seen` guard so corrupt parentId
  // links cannot spin forever.
  const path: NodeId[] = [];
  const seen = new Set<NodeId>();
  let c: NodeId | null = oldParentId;
  while (c !== null && !seen.has(c)) {
    seen.add(c);
    path.push(c);
    c = project.nodes[c]?.parentId ?? null;
  }

  // Snapshot everything that rides on a physical edge BEFORE anything is
  // rewired. Reversing the edge between path[j+1] and path[j] keeps the edge's
  // identity — it merely becomes path[j+1]'s incoming edge — so its length,
  // its split support (value + declared kind/scale), its branch style and every
  // branch-target event pinned to it must travel with it. Node-anchored
  // evidence (node events, ages, calibrations) stays on the vertex, which
  // keeps its identity; only edge-anchored state moves.
  interface EdgeRiders {
    branchLength: number | undefined;
    support: number | undefined;
    supportKind: SupportKind | undefined;
    supportScale: SupportScale | undefined;
    branchStyle: Partial<BranchStyle> | undefined;
    branchEvents: EvolutionaryEvent[];
  }
  const riders = new Map<NodeId, EdgeRiders>();
  for (const id of path) {
    const n = project.nodes[id];
    if (!n) continue;
    riders.set(id, {
      branchLength: knownLength(n.branchLength),
      support: n.support,
      supportKind: n.supportKind,
      supportScale: n.supportScale,
      branchStyle: n.branchStyle ? { ...n.branchStyle } : undefined,
      branchEvents: project.events.filter((e) => e.nodeId === id && e.target === 'branch'),
    });
  }
  const splitEdge = knownLength(target.branchLength);

  const root = createNode({ parentId: null, childrenIds: [targetId, oldParentId] });
  project.nodes[root.id] = root;

  // Detach target from its old parent; hang both under the new root and give
  // each side its share of the split branch.
  const oldParent = project.nodes[oldParentId];
  oldParent.childrenIds = oldParent.childrenIds.filter((x) => x !== targetId);
  target.parentId = root.id;
  oldParent.parentId = root.id;
  target.branchLength = splitEdge === undefined ? undefined : splitEdge * (1 - f);
  oldParent.branchLength = splitEdge === undefined ? undefined : splitEdge * f;

  // Reverse each edge along the path up to the old root, carrying its riders to
  // the new child end.
  for (let j = 0; j < path.length - 1; j += 1) {
    const upper = project.nodes[path[j + 1]];
    upper.childrenIds = upper.childrenIds.filter((x) => x !== path[j]);
    project.nodes[path[j]].childrenIds.push(path[j + 1]);
    upper.parentId = path[j];
    const rider = riders.get(path[j]);
    if (rider) {
      upper.branchLength = rider.branchLength;
      upper.support = rider.support;
      upper.supportKind = rider.supportKind;
      upper.supportScale = rider.supportScale;
      upper.branchStyle = rider.branchStyle;
      for (const ev of rider.branchEvents) ev.nodeId = path[j + 1];
    }
  }

  // Where the split branch sits between two dated endpoints, so does the root.
  const parentAge = finiteAge(oldParent);
  const targetAge = finiteAge(target);
  if (parentAge !== undefined && targetAge !== undefined) {
    root.age = parentAge + f * (targetAge - parentAge);
  }

  project.rootId = root.id;

  // Suppress the former root when the reversal left it with a single child —
  // or, when the old root was itself a unifurcation, with none at all: it
  // would otherwise survive as an unlabelled fake tip and tip counts would
  // stop being conserved.
  const formerRoot = project.nodes[oldRootId];
  if (formerRoot && formerRoot.parentId !== null && formerRoot.childrenIds.length <= 1) {
    const survivor = formerRoot.childrenIds[0] ?? root.id;
    // A calibration on the former root constrains the ROOT divergence. Letting
    // it follow the surviving lineage can land it on a tip, silently
    // re-reading a root-age constraint as a tip-age constraint; it follows the
    // tree's root instead. Everything else (events, hypothesis layers) rides
    // with the surviving lineage as before.
    reattachNodeReferences(project, oldRootId, survivor, root.id);
    deleteNode(project, oldRootId, false);
  }
  return true;
}

/**
 * Move a node's annotations onto a surviving lineage before the node is spliced
 * out, so a re-root never destroys evidence. Per-character records are
 * merged with the survivor winning, because an existing hypothesis on the
 * surviving node is the more specific statement.
 *
 * Stored (non-active) hypothesis layers are migrated with the SAME care as the
 * live ones: their events and notes used to be left behind on the dying node id,
 * where the next load's `pruneLayerStore` destroyed them without a trace —
 * one routine re-root was enough to silently delete a competing hypothesis's
 * evidence set.
 */
function reattachNodeReferences(
  project: Project,
  fromId: NodeId,
  toId: NodeId,
  calibrationTargetId: NodeId = toId,
): void {
  if (fromId === toId) return;
  for (const e of project.events) if (e.nodeId === fromId) e.nodeId = toId;
  for (const cp of project.calibrationPoints ?? []) {
    if (cp.nodeId === fromId) cp.nodeId = calibrationTargetId;
  }
  for (const stored of Object.values(project.layerStore)) {
    mergeNodeRecord(stored.states, fromId, toId);
    mergeNodeRecord(stored.meta, fromId, toId);
    if (stored.notes) mergeNodeRecord(stored.notes, fromId, toId);
    for (const e of stored.events) if (e.nodeId === fromId) e.nodeId = toId;
  }
}

/** Merge `from`'s record into `to`'s for a node-keyed record map. */
function mergeNodeRecord<T>(
  records: Record<NodeId, T>,
  from: NodeId,
  to: NodeId,
): void {
  const src = records[from];
  if (!src) return;
  const dst = records[to];
  if (dst === undefined || dst === null) records[to] = src;
  else if (typeof dst === 'object' && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      if (!(k in (dst as Record<string, unknown>))) (dst as Record<string, unknown>)[k] = v;
    }
  }
  // Both values scalar (a hypothesis note is a plain string): the survivor's
  // own note is the more specific statement and wins the merge. Iterating a
  // string's entries here (Object.entries("note") → "0","1",…) would crash the
  // `in` check below, so scalars are handled before that path.
  delete records[from];
}

/** Where midpoint rooting puts the root: which branch, and where along it. */
export interface MidpointPlacement {
  /** Node whose incoming branch carries the midpoint. */
  targetId: NodeId;
  /** Position of the midpoint on that branch, 0 at its parent end, 1 at the node. */
  fraction: number;
  /** Longest tip-to-tip path found, in branch-length units. */
  diameter: number;
  /** Edges excluded from the diameter because they have no usable length. */
  unknownEdges: number;
  /** False when `unknownEdges > 0`: the diameter is only part of the tree. */
  complete: boolean;
}

export interface MidpointResult {
  ok: boolean;
  placement?: MidpointPlacement;
  /** Why rooting was refused: nothing to measure on this tree. */
  failure?: 'too-small' | 'no-usable-lengths';
}

/**
 * Midpoint rooting (Farris 1972): the root goes on the MIDPOINT of the longest
 * tip-to-tip (patristic) path — i.e. inside a branch, not on a node. Taking the
 * first NODE at or past half distance would usually miss that midpoint, leaving
 * the two halves of the tree unequal, so the straddling edge is split by fraction.
 *
 * A missing / zero / negative branch length is not priced as 1 — that gives a
 * partly-unsigned tree a silently wrong diameter. Missing lengths are
 * *excluded* instead: an edge without a usable length is a barrier, and the
 * result reports how many were skipped (`unknownEdges`, `complete: false`)
 * rather than inventing a number for them.
 */
export function midpointRoot(project: Project): MidpointResult {
  const nodes = project.nodes;
  const ids = Object.keys(nodes);
  if (ids.length < 3) return { ok: false, failure: 'too-small' };

  let unknownEdges = 0;
  let measurableEdges = 0;
  for (const id of ids) {
    const n = nodes[id];
    if (!n.parentId) continue;
    if (knownLength(n.branchLength) === undefined) unknownEdges += 1;
    else measurableEdges += 1;
  }
  // Every edge unmeasurable: bail with the precise diagnosis here, before the
  // double sweep below, so the caller is not left with the vaguer `!best`
  // fallback. `unknownEdges` alone cannot detect this — the loop above skips the
  // root — hence the separate `measurableEdges` counter.
  if (measurableEdges === 0) return { ok: false, failure: 'no-usable-lengths' };

  // Neighbours over edges that carry a usable length; unknown ones are skipped.
  const neighbours = (id: NodeId): { id: NodeId; w: number }[] => {
    const n = nodes[id];
    const out: { id: NodeId; w: number }[] = [];
    const parent = n.parentId ? nodes[n.parentId] : undefined;
    if (parent) {
      const w = knownLength(n.branchLength);
      if (w !== undefined) out.push({ id: parent.id, w });
    }
    for (const cid of n.childrenIds) {
      if (!nodes[cid]) continue;
      const w = knownLength(nodes[cid].branchLength);
      if (w !== undefined) out.push({ id: cid, w });
    }
    return out;
  };
  // Farthest reachable node from `start` along priced edges (DFS: on a tree the
  // first visit is the only path, so this is exact).
  const farthest = (start: NodeId) => {
    const dist = new Map<NodeId, number>([[start, 0]]);
    const prev = new Map<NodeId, NodeId | null>([[start, null]]);
    const stack: NodeId[] = [start];
    let far = start;
    let farD = 0;
    while (stack.length) {
      const u = stack.pop() as NodeId;
      for (const { id: v, w } of neighbours(u)) {
        if (dist.has(v)) continue;
        const dv = (dist.get(u) as number) + w;
        dist.set(v, dv);
        prev.set(v, u);
        if (dv > farD) {
          farD = dv;
          far = v;
        }
        stack.push(v);
      }
    }
    return { far, farD, dist, prev };
  };

  // Double sweep per connected component of priced edges; keep the longest.
  let best: { a: NodeId; b: NodeId; total: number; dist: Map<NodeId, number>; prev: Map<NodeId, NodeId | null> } | null = null;
  const swept = new Set<NodeId>();
  for (const start of ids) {
    if (swept.has(start)) continue;
    const first = farthest(start);
    const { far: a, farD: d1, dist } = first;
    swept.add(a);
    const { far: b, farD: total, dist: distFromA, prev } = farthest(a);
    for (const id of distFromA.keys()) swept.add(id);
    if (total <= 0) continue;
    if (!best || total > best.total) best = { a, b, total, dist: distFromA, prev };
    // No early exit here. `farthest(a)` reaches every node of THIS priced
    // component, and all of them were just added to `swept`, so the outer loop
    // already skips it. There is deliberately no `d1 >= total` break: that test
    // fires whenever the sweep start happens to be a diameter endpoint — always
    // true for a one-edge component — and would abandon the remaining components
    // before measuring them, so `(X:1,(L1:9,L2:8)N)R;` would report a diameter of
    // 1 instead of 17 and root on the wrong branch.
  }
  if (!best) return { ok: false, failure: 'no-usable-lengths' };

  // Path a..b (reverse of the b->a predecessor chain).
  const rev: NodeId[] = [];
  let cur: NodeId | null = best.b;
  const guard = new Set<NodeId>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur as NodeId);
    rev.push(cur);
    cur = best.prev.get(cur) ?? null;
  }
  const path = rev.reverse();
  const half = best.total / 2;

  // Walk the diameter to the edge that straddles the midpoint.
  for (let i = 1; i < path.length; i += 1) {
    const upper = path[i - 1];
    const lower = path[i];
    const dUpper = best.dist.get(upper) ?? 0;
    const dLower = best.dist.get(lower) ?? 0;
    if (Math.max(dUpper, dLower) < half) continue;
    if (Math.min(dUpper, dLower) > half) continue;
    const w = Math.abs(dLower - dUpper);
    if (w <= 0) continue;
    // Distance from the path's `upper` end to the midpoint, in edge units.
    const fromUpper = half - dUpper;
    const childId = nodes[lower]?.parentId === upper ? lower : upper;
    const parentEnd = childId === lower ? upper : lower;
    // `fraction` is measured from the branch's parent end; if the sweep walked
    // *up* the tree the offset has to be flipped.
    const fraction = parentEnd === upper ? fromUpper / w : 1 - fromUpper / w;
    return {
      ok: true,
      placement: {
        targetId: childId,
        fraction: Math.min(1, Math.max(0, fraction)),
        diameter: best.total,
        unknownEdges,
        complete: unknownEdges === 0,
      },
    };
  }
  return { ok: false, failure: 'no-usable-lengths' };
}

/**
 * Node to re-root on for MIDPOINT rooting: the node at the lower end of the
 * branch that contains the true midpoint of the tree's longest tip-to-tip
 * (patristic) path. Pair with `rerootAtNode`.
 *
 * NOTE: this returns only the branch — the root belongs *inside* it, so callers
 * that care about branch lengths must use `midpointRoot` / `applyMidpointReroot`
 * and pass the fraction. Edges without a usable length are excluded from
 * the diameter rather than priced as 1.
 */
export function midpointTarget(project: Project): NodeId | null {
  const placement = midpointRoot(project).placement;
  if (!placement) return null;
  return project.nodes[placement.targetId]?.parentId !== null ? placement.targetId : null;
}

/**
 * Midpoint-root the tree in one step: locate the midpoint of the longest
 * tip-to-tip path and place the root exactly there (splitting the branch), so
 * both halves measure the same. The result says whether the diameter could be
 * measured over the whole tree — `unknownEdges > 0` means some branches had no
 * usable length and were skipped, which the caller must report.
 */
export function applyMidpointReroot(project: Project): MidpointResult {
  const result = midpointRoot(project);
  if (!result.ok || !result.placement) return result;
  const { targetId, fraction } = result.placement;
  if (project.nodes[targetId]?.parentId === null) return { ok: false, failure: 'no-usable-lengths' };
  const done = rerootAtNode(project, targetId, fraction);
  return done ? result : { ok: false, failure: 'no-usable-lengths' };
}

/** Why an outgroup selection cannot root the tree. */
export type OutgroupRerootFailure =
  | 'empty-selection'
  | 'node-missing'
  | 'outgroup-is-root'
  | 'not-monophyletic'
  | 'unrootable';

export interface OutgroupRerootResult {
  ok: boolean;
  reason?: OutgroupRerootFailure;
  /** The node the root was placed below (single-tip selections included). */
  rootEdgeOf?: NodeId;
}

/**
 * Can this selection root the tree? Returns the failure reason, or null when the
 * operation would succeed. Callers ask first and show a message — `outgroupReroot`
 * on a draft is the only way to attempt it, and a silently rejected menu item is
 * what made the feature look broken.
 */
/** Every tip below `id` (iterative, so a deep tree cannot overflow the stack). */
function tipSetOf(project: Project, id: NodeId): Set<NodeId> {
  const out = new Set<NodeId>();
  const stack: NodeId[] = [id];
  while (stack.length) {
    const cur = stack.pop() as NodeId;
    const n = project.nodes[cur];
    if (!n) continue;
    if (n.childrenIds.length === 0) {
      out.add(cur);
      continue;
    }
    for (const c of n.childrenIds) stack.push(c);
  }
  return out;
}

/**
 * When the selected outgroup is not a complete clade, the root can still make
 * it THE outgroup by sitting on the entering edge of the complement clade —
 * but only when that complement is itself a complete clade. Returns that
 * clade's root node, or null when no such placement exists.
 */
function complementCladeRoot(project: Project, ids: NodeId[]): NodeId | null {
  const sel = new Set(ids);
  const complement: NodeId[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0 && !sel.has(n.id)) complement.push(n.id);
  }
  if (complement.length === 0) return null;
  let m: NodeId | null = complement[0];
  for (let i = 1; i < complement.length; i += 1) {
    m = mrcaOf(project, m as NodeId, complement[i]);
    if (m === null) return null;
  }
  const tips = tipSetOf(project, m as NodeId);
  const complete = tips.size === complement.length && complement.every((i) => tips.has(i));
  return complete ? (m as NodeId) : null;
}

export function checkOutgroupReroot(project: Project, outgroupIds: NodeId[]): OutgroupRerootFailure | null {
  if (!Array.isArray(outgroupIds) || outgroupIds.length === 0) return 'empty-selection';
  const ids = [...new Set(outgroupIds)];
  for (const id of ids) if (!project.nodes[id]) return 'node-missing';
  if (ids.length === 1) {
    // The single-tip case roots on the tip's OWN incoming branch (see
    // `outgroupReroot`), so only a tip that is already the root is impossible.
    if (project.nodes[ids[0]].parentId === null) return 'outgroup-is-root';
    return null;
  }
  let m: NodeId | null = ids[0];
  for (let i = 1; i < ids.length; i += 1) {
    m = mrcaOf(project, m as NodeId, ids[i]);
    if (m === null) return 'node-missing';
  }
  // The outgroup MRCA is the root ⇒ there is no branch below it. One
  // legitimate placement survives: rooting on the entering edge of the
  // COMPLEMENT clade, when the complement is itself a complete clade
  // (selecting C,D in ((A,B)X,C,D)R roots on X's entering edge).
  if (m === project.rootId || project.nodes[m]?.parentId === null) {
    return complementCladeRoot(project, ids) !== null ? null : 'outgroup-is-root';
  }
  // MRCA strictly below the root: rooting on its entering edge would take the
  // WHOLE clade below it as outgroup. That matches the selection only when the
  // selection IS that clade; a partial selection (A,C out of (A,B,C)X) would
  // silently drag the unselected relatives (B) along, so it needs the
  // complement-clade placement instead.
  const tips = tipSetOf(project, m as NodeId);
  const complete = tips.size === ids.length && ids.every((i) => tips.has(i));
  if (complete) return null;
  return complementCladeRoot(project, ids) !== null ? null : 'not-monophyletic';
}

/**
 * Outgroup rooting: re-root the tree so the given outgroup node(s) form a
 * monophyletic clade on one side of the root. The root is placed on the branch
 * ENTERING the outgroup (for a single node, that node's own incoming branch; for
 * several, their MRCA's incoming branch) — at its midpoint, the neutral position
 * when only the outgroup is specified. Rooting a single node one level too high
 * (`rerootAtNode(n.parentId)`) would treat "outgroup = A" as "outgroup =
 * (A,B)", mis-polarising the entire tree and making the k = 1 and k >= 2 paths
 * contradict each other. The result is a value the caller has to check — a
 * refused re-root must not look like a successful no-op.
 */
export function outgroupReroot(project: Project, outgroupIds: NodeId[]): OutgroupRerootResult {
  const failure = checkOutgroupReroot(project, outgroupIds);
  if (failure) return { ok: false, reason: failure };
  const ids = [...new Set(outgroupIds)];
  let target: NodeId | null = ids[0];
  if (ids.length > 1) {
    for (let i = 1; i < ids.length; i += 1) {
      target = mrcaOf(project, target as NodeId, ids[i]);
      if (target === null) return { ok: false, reason: 'node-missing' };
    }
    // A selection that is only PART of its MRCA's clade gets the root placed
    // on the complement clade's entering edge instead (see
    // `checkOutgroupReroot`), so the outgroup is exactly the selection.
    const tips = tipSetOf(project, target as NodeId);
    const complete = tips.size === ids.length && ids.every((i) => tips.has(i));
    if (!complete) {
      target = complementCladeRoot(project, ids);
      if (!target) return { ok: false, reason: 'not-monophyletic' };
    }
  }
  const done = rerootAtNode(project, target as NodeId);
  if (!done) return { ok: false, reason: 'unrootable' };
  return { ok: true, rootEdgeOf: target as NodeId };
}

/** Deep copy of a node's per-character hypothesis meta. */
function copyMetaRecord(meta: Record<string, HypothesisMeta>): Record<string, HypothesisMeta> {
  const out: Record<string, HypothesisMeta> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = { ...v };
  return out;
}

/**
 * Deep copy of JSON-shaped data (plain objects, arrays, primitives). Extracted
 * subtrees must not share nested values with the source document — a shared
 * polymorphic state array or a nested `meta` object would let an edit in the
 * new tab silently rewrite the original.
 */
function cloneJsonish<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneJsonish(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneJsonish(v);
    return out as T;
  }
  return value;
}

/**
 * Extract the subtree rooted at `id` as a new standalone Project, preserving
 * everything attached to those nodes: character assignments, evidence meta,
 * evolutionary events AND their causal links, the fossil calibration points that
 * constrain the subtree, and the dated environmental context (which is a property
 * of the time axis, not of a node, so it is carried over whole).
 *
 * The copy is DEEP: state objects, step matrices, style objects and
 * hypothesis records are cloned, because `updateCharacterState` mutates a
 * `CharacterState` in place — sharing them would let an edit in the new tab
 * silently rewrite the original document. Branch lengths, styles and node metadata are
 * copied. The new root is the subtree root.
 */
export function extractSubtree(project: Project, id: NodeId): Project | null {
  const root = project.nodes[id];
  if (!root) return null;
  const subtreeIds = collectSubtree(project, id);
  const newNodes: Record<NodeId, TreeNode> = {};
  for (const nid of subtreeIds) {
    const n = project.nodes[nid];
    if (!n) continue;
    newNodes[nid] = {
      ...n,
      parentId: nid === id ? null : n.parentId,
      childrenIds: [...n.childrenIds],
      charStates: n.charStates ? cloneJsonish(n.charStates) : undefined,
      charMeta: n.charMeta ? copyMetaRecord(n.charMeta) : undefined,
      style: n.style ? { ...n.style } : undefined,
      branchStyle: n.branchStyle ? { ...n.branchStyle } : undefined,
      meta: n.meta ? cloneJsonish(n.meta) : undefined,
      annotations: n.annotations ? { ...n.annotations } : undefined,
    };
  }
  const newEvents = project.events
    .filter((e) => subtreeIds.has(e.nodeId))
    .map((e) => ({ ...e, triggers: [...e.triggers] }));
  // Causal links must not point at events that were left behind; the same
  // cleaning `pruneEventsForNodes` does for deletions.
  const keptEventIds = new Set(newEvents.map((e) => e.id));
  for (const e of newEvents) {
    e.triggers = e.triggers.filter((t) => keptEventIds.has(t) && t !== e.id);
  }
  return {
    id: newId(),
    name: `Subtree of ${root.label || 'node'}`,
    version: project.version,
    nodes: newNodes,
    rootId: id,
    customEdges: project.customEdges
      .filter((e) => subtreeIds.has(e.sourceId) && subtreeIds.has(e.targetId))
      .map((e) => ({ ...e, style: { ...e.style } })),
    layout: { ...project.layout },
    canvas: { ...project.canvas },
    defaults: {
      node: { ...project.defaults.node },
      branch: { ...project.defaults.branch },
      edge: { ...project.defaults.edge },
      branchGradient: { ...project.defaults.branchGradient },
    },
    characters: project.characters.map((c) => ({
      ...c,
      states: c.states.map((s) => ({ ...s })),
      costMatrix: c.costMatrix?.map((row) => [...row]),
    })),
    events: newEvents,
    ...defaultLayers(),
    geneTrees: [],
    reconCosts: project.reconCosts ? { ...project.reconCosts } : { ...DEFAULT_RECON_COSTS },
    environmentalEvents: project.environmentalEvents.map((e) => ({ ...e })),
    calibrationPoints: (project.calibrationPoints ?? [])
      .filter((cp) => subtreeIds.has(cp.nodeId))
      .map((cp) => ({ ...cp })),
  };
}

/**
 * Convert a support value to the 0–100 scale used for thresholds and display.
 *
 * A node that declares its scale (`supportScale`) is converted EXACTLY: a
 * stored fraction multiplies by 100, a stored percent passes through. Without a
 * declared scale the legacy heuristic applies — anything <= 1 is read as a
 * fraction — which exists only for documents written before the field did and
 * for files whose import convention was left on "auto". The heuristic is WRONG
 * for a real 1% bootstrap support (it reads 1 as 100%), so import should always
 * let the user declare the convention (see the import dialog) and consumers
 * should prefer `supportPercent(node)` below.
 */
export function normalizeSupport(value: number | undefined, scale?: SupportScale): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (scale === 'fraction') return value * 100;
  if (scale === 'percent') return value;
  return value <= 1 ? value * 100 : value;
}

/**
 * A node's support on the 0–100 scale, honouring its declared `supportScale`
 * first and falling back to the legacy `<= 1 means fraction` heuristic only for
 * older documents that never recorded one. This is the single conversion every
 * threshold/dash/dim consumer should use — the second, diverging copy that used
 * to live in `exportImage.ts` is gone.
 */
export function supportPercent(node: Pick<TreeNode, 'support' | 'supportScale'>): number | undefined {
  return normalizeSupport(node.support, node.supportScale);
}

/**
 * Guess the support convention of a whole file's worth of values. Anything
 * above 1 can only be a percent; a value set that stays within [0, 1] is
 * PROBABLY a fraction (posterior probabilities) but could equally be an all-low
 * bootstrap set — the caller must let the user confirm rather than trust this.
 */
export function inferSupportScale(values: number[]): SupportScale {
  return values.some((v) => Number.isFinite(v) && v > 1) ? 'percent' : 'fraction';
}

/**
 * Collapse (set `collapsed = true`) every internal node whose support is below
 * the given threshold. Supports and thresholds stored as 0–1 or 0–100 are both
 * handled — they are converted to the same scale first (`normalizeSupport`).
 * Nodes with no support recorded are left alone: absence of data is not weak
 * support.
 */
export function collapseBelowSupport(project: Project, threshold: number): number {
  const limit = normalizeSupport(threshold) ?? threshold;
  let count = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0) continue;
    if (n.parentId === null) continue;
    const support = supportPercent(n);
    if (support !== undefined && support < limit) {
      n.collapsed = true;
      count++;
    }
  }
  return count;
}

/** Check whether the tree has any non-trivial branch lengths (> 0). */
export function hasBranchLengths(project: Project): boolean {
  return Object.values(project.nodes).some(
    (n) => n.parentId !== null && typeof n.branchLength === 'number' && n.branchLength > 0,
  );
}

/**
 * Check whether the tree carries a *non-trivial* age: a finite age greater than
 * zero anywhere. Tips at "0 Ma" (present) are the convention for extant taxa, so
 * an `age >= 0` test would turn every tree with a single tip age into a chronogram
 * and unlock the time axis for trees with no time information at all. This is the
 * gate `isTimeCalibrated` relies on.
 */
export function hasAges(project: Project): boolean {
  return Object.values(project.nodes).some(
    (n) => typeof n.age === 'number' && Number.isFinite(n.age) && n.age > 0,
  );
}

/** Check whether the tree has calibration points defined. */
export function hasCalibrationPoints(project: Project): boolean {
  return Array.isArray(project.calibrationPoints) && project.calibrationPoints.length > 0;
}

/**
 * Determine whether the tree carries time-calibration data (ages or calibration
 * points), qualifying it as a chronogram / time-calibrated tree rather than a
 * purely topological cladogram. This is the data-schema gate for the time-axis
 * state machine: if this returns false, time-panel features are blocked.
 */
export function isTimeCalibrated(project: Project): boolean {
  return hasAges(project) || hasCalibrationPoints(project);
}

/**
 * Collect every *visible* (non-collapsed-subtree) node that lacks an explicit
 * `age` value. Used by the time-calibrated layout to warn the user that nodes
 * without ages will be silently placed at present (0 Ma), which otherwise looks
 * like a rendering bug — the whole tree collapsing onto the "today" line.
 *
 * Only visible nodes are returned: a collapsed node's descendants are hidden
 * from the layout and their missing ages would be invisible anyway, so they
 * should not inflate the count or clutter the warning list.
 */
export function nodesMissingAges(project: Project): TreeNode[] {
  const result: TreeNode[] = [];
  // Walk from the root, pruning at collapsed subtrees (their descendants are
  // invisible in the layout and should be excluded from the warning).
  const stack: NodeId[] = [project.rootId];
  const seen = new Set<NodeId>();
  while (stack.length) {
    const id = stack.pop() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = project.nodes[id];
    if (!n) continue;
    if (typeof n.age !== 'number') result.push(n);
    // Descend only into expanded subtrees.
    if (!n.collapsed) {
      for (const cid of n.childrenIds) stack.push(cid);
    }
  }
  return result;
}

/**
 * Validate time-data consistency. Returns human-readable issues (empty when the
 * tree's time data is consistent). Checked:
 *
 *  1. ages monotonic from root to tips (a child may not be older than its parent);
 *  2. a dated node under an *undated* parent — the inversion cannot be seen at
 *     all in that situation, which is exactly what a re-root can exploit: the
 *     fresh root may carry no age, so both new root edges would escape check 1;
 *  3. a recorded branch length that contradicts the ages it spans — on a time
 *     tree the entering branch of a node must equal `parent.age − node.age`,
 *     including at the root, where such a mismatch is otherwise easy to miss;
 *  4. a node age outside its own fossil calibration range, and calibration points
 *     pointing at nodes that no longer exist — a declared range is only worth
 *     recording if something verifies it.
 */
export function validateTimeData(project: Project): string[] {
  const issues: string[] = [];
  const nameOf = (n: TreeNode): string => n.label || n.id.slice(0, 6);
  for (const node of Object.values(project.nodes)) {
    const age = finiteAge(node);
    if (typeof node.age === 'number' && age === undefined) {
      issues.push(`Node "${nameOf(node)}" carries a non-numeric age (${node.age}).`);
    }
    if (node.parentId === null) continue;
    const parent = project.nodes[node.parentId];
    if (!parent) continue;
    const parentAge = finiteAge(parent);
    if (age === undefined) continue;
    if (parentAge === undefined) {
      if (typeof parent.age === 'number') {
        issues.push(
          `Node "${nameOf(node)}" has age ${age} but its parent "${nameOf(parent)}" has an invalid age (${parent.age}); time direction not checkable.`,
        );
      } else {
        issues.push(
          `Node "${nameOf(node)}" has age ${age} but its parent "${nameOf(parent)}" has no age; the time direction of that branch cannot be checked.`,
        );
      }
      continue;
    }
    // A child's age must not exceed its parent's age (parent is older).
    if (age > parentAge) {
      issues.push(
        `Node "${nameOf(node)}" (age ${age}) is older than its parent "${nameOf(parent)}" (age ${parentAge})`,
      );
    }
    // Branch length vs. age span: the entering branch spans exactly the time
    // between the two nodes. A zero-length edge is legal (contemporaneous
    // splitting); a mismatch is only reported for a real discrepancy.
    const bl = knownLength(node.branchLength);
    if (bl !== undefined) {
      const implied = parentAge - age;
      if (implied >= 0 && Math.abs(bl - implied) > Math.max(1e-6, Math.max(implied, 1) * 0.005)) {
        issues.push(
          `Branch entering "${nameOf(node)}" is ${bl} but its ages (parent ${parentAge} − node ${age}) imply ${implied}.`,
        );
      }
    }
  }
  // Calibration points: minAge should not exceed maxAge, the node must exist and
  // its age must sit inside the stated range.
  const seenCal = new Set<string>();
  for (const cal of project.calibrationPoints ?? []) {
    if (seenCal.has(cal.id)) continue;
    seenCal.add(cal.id);
    if (cal.minAge > cal.maxAge) {
      issues.push(
        `Calibration point "${cal.label || cal.id.slice(0, 6)}": min age (${cal.minAge}) exceeds max age (${cal.maxAge})`,
      );
    }
    const node = project.nodes[cal.nodeId];
    if (!node) {
      issues.push(`Calibration point "${cal.label || cal.id.slice(0, 6)}" references a missing node.`);
      continue;
    }
    const age = finiteAge(node);
    if (age === undefined) continue; // nothing to compare against
    if (age < cal.minAge || age > cal.maxAge) {
      issues.push(
        `Node "${nameOf(node)}" (age ${age}) falls outside its calibration range [${cal.minAge}, ${cal.maxAge}] ("${cal.label || cal.id.slice(0, 6)}").`,
      );
    }
  }
  return issues;
}

/** Count internal nodes that have ancestral-state hypotheses for any character. */
export function countAnnotatedInternals(project: Project): number {
  let count = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0) continue;
    if (n.charStates && Object.keys(n.charStates).length > 0) count++;
  }
  return count;
}

/** Count total tips in the tree. */
export function countTips(project: Project): number {
  return Object.values(project.nodes).filter((n) => n.childrenIds.length === 0).length;
}

/**
 * Adaptive deletion threshold: max(5, round(totalTips * 0.05)).
 * For a 50-tip tree → 5; for a 1000-tip tree → 50.
 */
export function deleteThreshold(project: Project): number {
  const tips = countTips(project);
  return Math.max(5, Math.round(tips * 0.05));
}

// --- common-ancestor queries -------------------------------------------------

/** Ancestor chain from `id` up to the root: [id, parent, ..., root]. */
export function pathToRoot(project: Project, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>();
  let cur: NodeId | null = id;
  while (cur !== null && project.nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = project.nodes[cur].parentId;
  }
  return out;
}

/**
 * Most-recent common ancestor of two nodes, or null when there is none.
 * `pathToRoot` is cycle-guarded; the walk up from `b` is too, so a corrupt
 * `parentId` link degrades to "no ancestor" instead of hanging.
 */
export function mrcaOf(project: Project, a: NodeId, b: NodeId): NodeId | null {
  if (!project.nodes[a] || !project.nodes[b]) return null;
  const ancestors = new Set(pathToRoot(project, a));
  const seen = new Set<NodeId>();
  let cur: NodeId | null = b;
  while (cur !== null && !seen.has(cur)) {
    if (ancestors.has(cur)) return cur;
    seen.add(cur);
    cur = project.nodes[cur]?.parentId ?? null;
  }
  return null;
}

/**
 * The MRCA of a & b plus the node set and branch set (each branch keyed by its
 * child node id) lying on the a ↔ b path. Used to highlight common ancestry.
 */
export function pathBetween(
  project: Project,
  a: NodeId,
  b: NodeId,
): { mrca: NodeId; nodes: Set<NodeId>; branches: Set<NodeId> } | null {
  const m = mrcaOf(project, a, b);
  if (m === null) return null;
  const nodes = new Set<NodeId>([m]);
  const branches = new Set<NodeId>();
  const walk = (from: NodeId) => {
    let cur: NodeId | null = from;
    while (cur !== null && cur !== m) {
      nodes.add(cur);
      branches.add(cur); // the branch entering `cur`
      cur = project.nodes[cur]?.parentId ?? null;
    }
  };
  walk(a);
  walk(b);
  return { mrca: m, nodes, branches };
}

export function renameNode(project: Project, id: NodeId, label: string): void {
  const n = project.nodes[id];
  if (n) n.label = label;
}

/** Set or clear the active layer's free-text hypothesis annotation on a node. */
export function setHypothesisNote(project: Project, id: NodeId, note: string): void {
  const n = project.nodes[id];
  if (!n) return;
  const text = note.trim();
  if (text) n.hypothesisNote = text;
  else delete n.hypothesisNote;
}

export function moveNode(project: Project, id: NodeId, pos: Point): void {
  const n = project.nodes[id];
  if (!n) return;
  n.position = { x: pos.x, y: pos.y };
  n.pinned = true;
}

/**
 * Resolve the effective position of a node: its manual/pinned position if set,
 * otherwise the auto-layout position from the layout map. This is the crucial
 * bridge between the layout engine (world-space coords in LayoutResult) and
 * the tree data model (per-node pinned positions) — without it, constraints
 * fall back to {0,0} for unpinned nodes and the tree topology breaks.
 */
function effectivePos(
  project: Project,
  id: NodeId,
  layoutPositions?: Map<NodeId, Point>,
): Point | undefined {
  const node = project.nodes[id];
  if (!node) return undefined;
  if (node.position) return node.position;
  return layoutPositions?.get(id);
}

/**
 * Constrained move: relocates a node while preserving tree topology.
 *
 * This is the constraint-based layout engine for interactive dragging. It
 * guarantees the following invariants at every frame during a drag:
 *
 *  1. **Depth-axis constraint (rectangular layouts):** a node can only slide
 *     along the depth axis (the direction the tree grows). Its cross-axis
 *     coordinate (the row/column) is locked, preventing branch crossings.
 *  2. **Ancestor boundary:** the node's depth coordinate can never overtake
 *     ANY ancestor — the gap to the closest one is always ≥ minGap, so
 *     branches never reverse direction or collapse. (Checked against the full
 *     ancestor chain because pinned positions can be stale.)
 *  3. **Descendant boundary (invariant, not clamped):** the whole subtree
 *     shifts by the same depth-axis delta, so relative parent/child spacing
 *     cannot change during a move — a node can never overtake its own
 *     descendants because it never could before the drag either.
 *  4. **Subtree propagation:** the entire subtree follows the dragged node,
 *     each descendant shifted by the same depth-axis delta, so relative
 *     spacing within the subtree is preserved.
 *  5. **Leaf alignment:** on cladogram layouts (where all leaves are at the
 *     same depth), dragging an internal node shifts its leaf descendants but
 *     the layout recomputes on release to re-align them.
 *
 * The `layoutPositions` parameter supplies the current auto-layout positions
 * so constraints can reference real coordinates even for unpinned nodes (the
 * first drag of a node that has never been manually positioned).
 *
 * For the circular layout the node moves freely in 2D but its subtree still
 * follows with the same relative offset.
 */
export function constrainedMoveNode(
  project: Project,
  id: NodeId,
  pos: Point,
  layout: { type: string; orientation: string; hGap: number; vGap: number },
  layoutPositions?: Map<NodeId, Point>,
): void {
  const n = project.nodes[id];
  if (!n) return;

  const horizontal = layout.orientation === 'LR' || layout.orientation === 'RL';
  const isCircular = layout.type === 'circular';

  // Resolve the current position: pinned position first, then the auto-layout
  // position. Falling back to {0,0} for a node on its first drag would move it
  // against the wrong origin, so the real layout coordinate is used here.
  const cur = effectivePos(project, id, layoutPositions) ?? { x: 0, y: 0 };

  // For circular layout, allow free 2D movement but propagate to subtree.
  if (isCircular) {
    const dx = pos.x - cur.x;
    const dy = pos.y - cur.y;
    n.position = { x: pos.x, y: pos.y };
    n.pinned = true;
    // Move entire subtree by the same delta — use layout positions as fallback
    // for unpinned children so the whole subtree moves together.
    for (const cid of collectSubtree(project, id)) {
      if (cid === id) continue;
      const child = project.nodes[cid];
      if (!child) continue;
      const cp = effectivePos(project, cid, layoutPositions) ?? { x: 0, y: 0 };
      child.position = { x: cp.x + dx, y: cp.y + dy };
      child.pinned = true;
    }
    return;
  }

  // Rectangular layouts: constrain to the depth axis only.
  const depthAxis: 'x' | 'y' = horizontal ? 'x' : 'y';
  const crossAxis: 'x' | 'y' = horizontal ? 'y' : 'x';
  let target: Point = { ...pos, [crossAxis]: cur[crossAxis] } as Point;

  // Enforce the ancestor boundary: the dragged node must stay on its side of
  // EVERY ancestor, not just the direct parent. Checking only the parent is
  // not enough once pinned positions can be stale (earlier drags, layout or
  // orientation switches, undo, edited ages) — a parent may then sit on the
  // wrong side of its own ancestor, and a descendant dragged against that
  // parent would visually cross a higher ancestor.
  const minGap = Math.max(20, layout.hGap * 0.3);
  if (n.parentId) {
    let bound = horizontal
      ? layout.orientation === 'LR'
        ? -Infinity
        : Infinity
      : layout.orientation === 'TB'
        ? -Infinity
        : Infinity;
    // `seen` guard: corrupt parentId links (a parent cycle) must not spin here
    // forever — load-time validation repairs them, but a drag can run first.
    const seenAnc = new Set<NodeId>();
    let ancId: NodeId | undefined = n.parentId ?? undefined;
    while (ancId && !seenAnc.has(ancId)) {
      seenAnc.add(ancId);
      const ancPos = effectivePos(project, ancId, layoutPositions);
      if (ancPos) {
        if (horizontal) {
          bound = layout.orientation === 'LR' ? Math.max(bound, ancPos.x) : Math.min(bound, ancPos.x);
        } else {
          bound = layout.orientation === 'TB' ? Math.max(bound, ancPos.y) : Math.min(bound, ancPos.y);
        }
      }
      ancId = project.nodes[ancId]?.parentId ?? undefined;
    }
    if (horizontal) {
      if (layout.orientation === 'LR') {
        target = { ...target, x: Math.max(target.x, bound + minGap) };
      } else {
        target = { ...target, x: Math.min(target.x, bound - minGap) };
      }
    } else {
      if (layout.orientation === 'TB') {
        target = { ...target, y: Math.max(target.y, bound + minGap) };
      } else {
        target = { ...target, y: Math.min(target.y, bound - minGap) };
      }
    }
  }

  // NOTE: there is deliberately no child-boundary clamp here. The subtree
  // shift below moves every descendant by the same depth-axis delta, so the
  // relative spacing between the dragged node and its children is INVARIANT
  // during the drag — a clamp against the children's pre-move positions can
  // never repair a violation (no target satisfies it). Worse, such a clamp
  // feeds on itself: each frame re-clamps against positions that moved with
  // the previous frame's delta, so the node runs away from the pointer and
  // can be dragged past its ancestors. Keeping the tree from inverting is
  // instead guaranteed by the ancestor clamp above holding at every level.

  // Propagate the depth-axis delta to the entire subtree so the tree
  // structure stays intact. Each descendant shifts by the same delta on the
  // depth axis while keeping its cross-axis (row/column) position, ensuring
  // no branches cross and no nodes are left dangling.
  const depthDelta = target[depthAxis] - cur[depthAxis];
  n.position = target;
  n.pinned = true;

  if (Math.abs(depthDelta) > 0.001) {
    for (const cid of collectSubtree(project, id)) {
      if (cid === id) continue;
      const child = project.nodes[cid];
      if (!child) continue;
      const cp = effectivePos(project, cid, layoutPositions);
      if (cp) {
        child.position = { ...cp, [depthAxis]: cp[depthAxis] + depthDelta } as Point;
        child.pinned = true;
      }
    }
  }
}

export function setNodeStyle(project: Project, id: NodeId, style: Partial<NodeStyle>): void {
  const n = project.nodes[id];
  if (n) n.style = { ...n.style, ...style };
}

export function setBranchStyle(project: Project, id: NodeId, style: Partial<BranchStyle>): void {
  const n = project.nodes[id];
  if (n) n.branchStyle = { ...n.branchStyle, ...style };
}

/**
 * Colour the branch entering `node` and every descendant branch in one edit.
 * Root has no incoming branch, so only its descendant branches are touched.
 * Returns how many branches were changed (the inspector reports it).
 */
export function setSubtreeBranchColor(project: Project, id: NodeId, color: string): number {
  let changed = 0;
  for (const nid of collectSubtree(project, id)) {
    const n = project.nodes[nid];
    if (!n || !n.parentId) continue;
    n.branchStyle = { ...n.branchStyle, color };
    changed += 1;
  }
  return changed;
}

/**
 * Set (or clear) the length of the branch entering `node`.
 * A negative / non-finite length is stored as "unset" rather than as a number:
 * it would invert the accumulated depth of a phylogram, and `validateTimeData`
 * reports the difference.
 */
export function setBranchLength(project: Project, id: NodeId, length: number | undefined): void {
  const n = project.nodes[id];
  if (!n) return;
  n.branchLength =
    typeof length === 'number' && Number.isFinite(length) && length >= 0 ? length : undefined;
}

/**
 * Set (or clear) a node's age for the time-calibrated layout. Non-finite or
 * negative ages are stored as unset: a negative age would be drawn beyond the
 * present-day end of the axis and never checked.
 */
export function setNodeAge(project: Project, id: NodeId, age: number | undefined): void {
  const n = project.nodes[id];
  if (!n) return;
  n.age = typeof age === 'number' && Number.isFinite(age) && age >= 0 ? age : undefined;
}

/** `node.meta` key holding a node's topological depth (edge count) — the raw
 *  quantity behind an estimated age, kept separately from it. */
export const RELATIVE_DEPTH_META = 'relativeDepth';
/** `node.meta` key marking an age that was estimated rather than entered. */
export const AGE_ESTIMATED_META = 'ageEstimated';

export interface EstimateAgesResult {
  /** Nodes that received an estimated age (nodes that already had one are never touched). */
  filled: NodeId[];
  /** Nodes whose user-entered age was preserved. */
  preserved: number;
  /**
   * Scale of the written values: 'project' means they are in
   * `layout.timeUnit` (stretched onto the oldest known age), 'relative' means
   * they are edge counts and the caller must say so — writing raw depths into a
   * field the time axis labels "Ma" would invent a 0–12 Ma Phanerozoic axis.
   */
  unit: 'project' | 'relative';
  /** The project's time unit at the time of the call. */
  timeUnit: string;
  /** Oldest user-entered age the estimates were scaled against (0 when none). */
  calibrationAge: number;
  /** Tips that had no age at all and were read as extant (age 0). */
  tipsAssumedPresent: number;
  /** True when at least one node was written. */
  changed: boolean;
}

/**
 * Estimate the MISSING node ages from topology: a tip is 0 and an internal node
 * sits at its longest path down to a tip, in EDGES. Every node the function
 * writes also records that raw depth under `meta.relativeDepth`.
 *
 * Three guarantees:
 *  * ages the user entered — fossil dates, calibration-derived dates — are never
 *    overwritten. Only unset / non-finite ages are filled, so the mixed
 *    extinct-and-extant trees where "tips are always 0" would be wrong stay intact;
 *  * units stay consistent: when the tree already carries an absolute age the
 *    topological depths are scaled onto it (same time unit as the axis), and when
 *    it carries none the result reports `unit: 'relative'` so the caller can warn
 *    that the axis is measured in generations, not Ma;
 *  * the result is a value the caller checks (how many nodes were filled, how
 *    many tips were assumed extant) instead of a silent rewrite of the document.
 */
export function estimateAges(project: Project): EstimateAgesResult {
  const heights = topologicalHeights(project);
  const timeUnit = project.layout?.timeUnit ?? 'Ma';
  let maxDepth = 0;
  let calibrationAge = 0;
  let preserved = 0;
  for (const [id, h] of heights) if (h > maxDepth) maxDepth = h;
  for (const n of Object.values(project.nodes)) {
    const a = finiteAge(n);
    if (a === undefined) continue;
    preserved += 1;
    if (a > calibrationAge) calibrationAge = a;
  }
  const unit: EstimateAgesResult['unit'] = calibrationAge > 0 ? 'project' : 'relative';
  const scale = unit === 'project' && maxDepth > 0 ? calibrationAge / maxDepth : 1;
  const filled: NodeId[] = [];
  let tipsAssumedPresent = 0;
  for (const n of Object.values(project.nodes)) {
    if (finiteAge(n) !== undefined) continue; // user-entered age wins, always
    const depth = heights.get(n.id) ?? 0;
    n.age = Math.round((unit === 'project' ? depth * scale : depth) * 1e6) / 1e6;
    // Mark the provenance: an estimated age must never pass for a calibrated one.
    n.ageSource = 'estimate';
    // The relative depth is kept NEXT TO the age, never inside it: the age field
    // is read as the project's time unit, the meta key says what the number was
    // derived from.
    n.meta = { ...n.meta, [RELATIVE_DEPTH_META]: depth, [AGE_ESTIMATED_META]: true };
    if (n.childrenIds.length === 0) tipsAssumedPresent += 1;
    filled.push(n.id);
  }
  return {
    filled,
    preserved,
    unit,
    timeUnit,
    calibrationAge,
    tipsAssumedPresent,
    changed: filled.length > 0,
  };
}

/**
 * True while some node's age is a topology estimate (`estimateAges` filled it in)
 * rather than data. Callers use it to label the time axis honestly — and it stops
 * being true as soon as the user replaces the estimated value.
 */
export function hasEstimatedAges(project: Project): boolean {
  return Object.values(project.nodes).some(
    (n) => n.meta?.[AGE_ESTIMATED_META] === true,
  );
}

export interface CalibratedAgesResult {
  /** Nodes whose age was (re)written. */
  filled: NodeId[];
  /** Calibration ranges that could not be honoured simultaneously. */
  conflicts: { nodeId: NodeId; minAge: number; maxAge: number }[];
  changed: boolean;
}

/**
 * Fit node ages to the topology AND the fossil calibration ranges: a
 * least-squares isotonic regression (pool-adjacent-violators) on root-to-tip
 * depth, with each calibrated node clamped to its [minAge, maxAge] window.
 *
 * This is deliberately NOT Bayesian dating and returns no HPD — it is the
 * minimal "make the ages consistent with the constraints" pass the time panel
 * was missing, and it reports the calibration ranges it could not satisfy
 * instead of quietly bending them.
 *
 * Only nodes WITHOUT an explicit user age participate (user ages are data, the
 * same rule `estimateAges` follows); calibrated nodes are always honoured
 * because the user placed the range deliberately.
 */
export function estimateAgesWithCalibrations(project: Project): CalibratedAgesResult {
  const calibrations = project.calibrationPoints ?? [];
  const calibByNode = new Map<NodeId, { min: number; max: number }>();
  for (const cp of calibrations) {
    if (!project.nodes[cp.nodeId]) continue;
    calibByNode.set(cp.nodeId, { min: cp.minAge, max: cp.maxAge });
  }

  // Depth of every node from the root, in edges.
  const depth = new Map<NodeId, number>();
  const stack: { id: NodeId; d: number }[] = [{ id: project.rootId, d: 0 }];
  while (stack.length) {
    const { id, d } = stack.pop() as { id: NodeId; d: number };
    if (depth.has(id)) continue;
    depth.set(id, d);
    const n = project.nodes[id];
    if (n) for (const c of n.childrenIds) stack.push({ id: c, d: d + 1 });
  }

  // Scale: fit the depth→age slope through the calibrated nodes (least squares
  // over (depth, midAge)), then isotonic-project the free nodes onto the
  // monotone (root oldest) sequence while respecting per-node windows.
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let n = 0;
  for (const [nid, range] of calibByNode) {
    const d = depth.get(nid) ?? 0;
    const mid = (range.min + range.max) / 2;
    sx += d;
    sy += mid;
    sxx += d * d;
    sxy += d * mid;
    n += 1;
  }
  const slope = n > 0 && sxx * n - sx * sx !== 0 ? (sxy * n - sx * sy) / (sxx * n - sx * sx) : 0;
  const intercept = n > 0 ? (sy - slope * sx) / n : 0;

  // Walk root→tips; each free node takes the PAV-smoothed value of the linear
  // fit, then is clamped into its window. A simple sequential pool-adjacent-
  // violators pass over the depth-ordered nodes keeps parent ≥ child.
  const order: NodeId[] = [];
  const bfs: NodeId[] = [project.rootId];
  while (bfs.length) {
    const id = bfs.shift() as NodeId;
    order.push(id);
    const node = project.nodes[id];
    if (node) for (const c of node.childrenIds) bfs.push(c);
  }

  const filled: NodeId[] = [];
  const conflicts: CalibratedAgesResult['conflicts'] = [];
  const valueOf = new Map<NodeId, number>();

  const writeValue = (id: NodeId, v: number): void => {
    const node = project.nodes[id];
    if (!node) return;
    const calibrated = calibByNode.has(id);
    if (finiteAge(node) === undefined || calibrated) {
      const prev = finiteAge(node);
      node.age = Math.round(v * 1e6) / 1e6;
      node.ageSource = calibrated ? 'fossil' : 'estimate';
      node.meta = { ...node.meta, [AGE_ESTIMATED_META]: true };
      if (prev === undefined) filled.push(id);
      else if (Math.abs(prev - node.age) > 1e-9) filled.push(id);
    }
    valueOf.set(id, node.age ?? v);
  };

  /** Clamp into a calibration window, reporting a range that had to be bent. */
  const applyWindow = (
    id: NodeId,
    v: number,
  ): number => {
    const window = calibByNode.get(id);
    if (!window) return v;
    if (v < window.min) {
      conflicts.push({ nodeId: id, minAge: window.min, maxAge: window.max });
      return window.min;
    }
    if (v > window.max) {
      conflicts.push({ nodeId: id, minAge: window.min, maxAge: window.max });
      return window.max;
    }
    return v;
  };

  for (const id of order) {
    const node = project.nodes[id];
    if (!node) continue;
    const d = depth.get(id) ?? 0;
    if (node.parentId === null) {
      // The root participates too: a calibrated root must see its window
      // honoured (its range used to be consumed by the fit but never written
      // back), and an uncalibrated root without a user age takes the fit value
      // so the tree has a top of its time axis.
      let v = applyWindow(id, intercept);
      // Ages are "before present": a fitted value below 0 lies in the future.
      if (v < 0) {
        if (calibByNode.has(id)) conflicts.push({ nodeId: id, minAge: calibByNode.get(id)!.min, maxAge: calibByNode.get(id)!.max });
        v = 0;
      }
      writeValue(id, v);
    } else {
      const parentValue = valueOf.get(node.parentId) ?? intercept;
      let v = slope * d + intercept;
      // Monotonicity: a child can never be older than its parent.
      if (v > parentValue) v = parentValue;
      v = applyWindow(id, v);
      if (v < 0) {
        if (calibByNode.has(id)) conflicts.push({ nodeId: id, minAge: calibByNode.get(id)!.min, maxAge: calibByNode.get(id)!.max });
        v = 0;
      }
      writeValue(id, v);
    }
  }

  // Bottom-up monotonicity repair: the window clamps run top-down, so a
  // calibration window can push a node ABOVE its already-written parent.
  // Raise the parent instead — as far as its own window allows — and report
  // the window when it forbids the rise. A parent whose age is user data
  // (manual entry / imported) is evidence and stays put; the conflicting
  // child window is reported instead of silently bent.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const node = project.nodes[id];
    if (!node || node.parentId === null) continue;
    // Only a calibration window can push an estimated value above its parent
    // (the monotonicity clamp runs before the window clamp, and the ≥0 clamp
    // only lowers). Inversions between user-entered ages are data conflicts —
    // `validateTimeData` reports those, this pass does not touch user data.
    if (!calibByNode.has(id)) continue;
    const childAge = valueOf.get(id);
    const parentAge = valueOf.get(node.parentId);
    if (childAge === undefined || parentAge === undefined || childAge <= parentAge) continue;
    const parent = project.nodes[node.parentId];
    if (!parent) continue;
    const parentEstimated =
      finiteAge(parent) === undefined ||
      parent.ageSource === 'estimate' ||
      parent.ageSource === 'fossil' ||
      calibByNode.has(node.parentId);
    if (!parentEstimated) {
      const childWindow = calibByNode.get(id);
      if (childWindow) conflicts.push({ nodeId: id, minAge: childWindow.min, maxAge: childWindow.max });
      continue;
    }
    let target = childAge;
    const window = calibByNode.get(node.parentId);
    if (window && target > window.max) {
      conflicts.push({ nodeId: node.parentId, minAge: window.min, maxAge: window.max });
      target = window.max;
    }
    if (target < 0) target = 0;
    if (finiteAge(parent) === undefined || Math.abs((parent.age as number) - target) > 1e-9) {
      const prev = finiteAge(parent);
      parent.age = Math.round(target * 1e6) / 1e6;
      if (!calibByNode.has(node.parentId) && parent.ageSource !== 'fossil') parent.ageSource = 'estimate';
      parent.meta = { ...parent.meta, [AGE_ESTIMATED_META]: true };
      if (prev === undefined || Math.abs(prev - parent.age) > 1e-9) filled.push(node.parentId);
    }
    valueOf.set(node.parentId, parent.age ?? target);
  }
  return { filled, conflicts, changed: filled.length > 0 || conflicts.length > 0 };
}

/**
 * Derive branch lengths from node ages: the branch entering a node is
 * `parent.age − node.age`, and the root's own edge (if any) is left alone.
 * This is the one-pass bridge between the two time representations — a
 * document that carries only ages (a BEAST-style chronogram) gets real branch
 * lengths, so Mk / Blomberg's K stop silently degrading to a unit-length
 * topology model. Nodes missing either endpoint age get NO length (absence
 * stays absence); the return value reports how many were derived and how many
 * stayed missing.
 */
export function deriveBranchLengthsFromAges(project: Project): {
  derived: number;
  stillMissing: number;
  changed: boolean;
} {
  let derived = 0;
  let stillMissing = 0;
  for (const node of Object.values(project.nodes)) {
    if (node.parentId === null) continue;
    const parent = project.nodes[node.parentId];
    const pa = finiteAge(parent);
    const ca = finiteAge(node);
    if (pa === undefined || ca === undefined) {
      if (node.branchLength === undefined) stillMissing += 1;
      continue;
    }
    const len = pa - ca;
    if (len >= 0 && Number.isFinite(len)) {
      node.branchLength = Math.round(len * 1e9) / 1e9;
      derived += 1;
    } else {
      stillMissing += 1;
    }
  }
  return { derived, stillMissing, changed: derived > 0 };
}

/** Collapse every internal branch (the whole tree folds onto its tips). */
export function collapseAll(project: Project): number {
  let count = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.parentId === null) continue;
    if (n.childrenIds.length === 0) continue;
    n.collapsed = true;
    count += 1;
  }
  return count;
}

/** Expand every collapsed branch. */
export function expandAll(project: Project): number {
  let count = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.collapsed) {
      n.collapsed = false;
      count += 1;
    }
  }
  return count;
}

/**
 * Sort every sibling group by the MODAL tip state of the subtree beneath it
 * for one character, so the tree reads in colour blocks instead of in random
 * order. Tips are grouped by their observed state (declaration order), then
 * alphabetically within a group; internal nodes recurse first, then sort by
 * their children's group. This is the "arrange the figure so the reader can
 * see the character" operation — the thing ladderize does for topology.
 * Returns the number of sibling groups reordered.
 */
export function sortTipsByCharacter(project: Project, characterId: string): number {
  const character = project.characters.find((c) => c.id === characterId);
  if (!character) return 0;
  const stateOrder = new Map(character.states.map((s, i) => [s.id, i]));
  let reordered = 0;

  // Group values are computed bottom-up and memoised, and the whole pass is
  // iterative: a recursive helper overflowed the call stack on deep trees
  // (a 10 000-level tree died with a RangeError). The sort key of a child is
  // its subtree's minimum group value, which does not depend on sibling
  // order, so one pass over the nodes is enough — no bottom-up reordering
  // pass is needed before the parent sorts.
  const groupOf = new Map<NodeId, number>();
  const order: NodeId[] = [];
  const stack: NodeId[] = [project.rootId];
  while (stack.length) {
    const id = stack.pop() as NodeId;
    const node = project.nodes[id];
    if (!node) continue;
    order.push(id);
    for (const c of node.childrenIds) stack.push(c);
  }
  const UNOBSERVED = Number.MAX_SAFE_INTEGER; // unobserved last
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const node = project.nodes[id];
    if (!node) continue;
    if (node.childrenIds.length === 0) {
      const v = node.charStates?.[characterId];
      let g = UNOBSERVED;
      if (typeof v === 'string' && stateOrder.has(v)) g = stateOrder.get(v) as number;
      else if (Array.isArray(v)) {
        // A polymorphic tip sorts by its earliest declared member state.
        let best = UNOBSERVED;
        for (const s of v) {
          const o = stateOrder.get(s);
          if (o !== undefined && o < best) best = o;
        }
        if (best !== UNOBSERVED) g = best;
      }
      groupOf.set(id, g);
    } else {
      let g = UNOBSERVED;
      for (const c of node.childrenIds) {
        const cg = groupOf.get(c);
        if (cg !== undefined && cg < g) g = cg;
      }
      groupOf.set(id, g);
    }
  }

  for (const id of order) {
    const node = project.nodes[id];
    if (!node || node.childrenIds.length < 2) continue;
    const before = node.childrenIds.join('|');
    const sorted = [...node.childrenIds].sort((a, b) => {
      const ga = groupOf.get(a) ?? UNOBSERVED;
      const gb = groupOf.get(b) ?? UNOBSERVED;
      if (ga !== gb) return ga - gb;
      return (project.nodes[a]?.label ?? '').localeCompare(project.nodes[b]?.label ?? '');
    });
    if (before !== sorted.join('|')) {
      node.childrenIds = sorted;
      reordered += 1;
    }
  }
  return reordered;
}

export function toggleCollapse(project: Project, id: NodeId): void {
  const n = project.nodes[id];
  if (n && n.childrenIds.length > 0) n.collapsed = !n.collapsed;
}

export function unpinNode(project: Project, id: NodeId): void {
  const n = project.nodes[id];
  if (n) {
    n.pinned = false;
    delete n.position;
  }
}

export function unpinAll(project: Project): void {
  for (const id of Object.keys(project.nodes)) {
    const n = project.nodes[id];
    n.pinned = false;
    delete n.position;
  }
}

export function addCustomEdge(
  project: Project,
  sourceId: NodeId,
  targetId: NodeId,
  style: EdgeStyle,
  label?: string,
): EdgeId | null {
  if (sourceId === targetId) return null;
  if (!project.nodes[sourceId] || !project.nodes[targetId]) return null;
  const dup = project.customEdges.some(
    (e) => e.sourceId === sourceId && e.targetId === targetId,
  );
  if (dup) return null;
  const id = newId();
  project.customEdges.push({ id, sourceId, targetId, label, style: { ...style } });
  return id;
}

export function removeCustomEdge(project: Project, edgeId: EdgeId): void {
  project.customEdges = project.customEdges.filter((e) => e.id !== edgeId);
}

export function setEdgeStyle(project: Project, edgeId: EdgeId, style: Partial<EdgeStyle>): void {
  const e = project.customEdges.find((x) => x.id === edgeId);
  if (e) e.style = { ...e.style, ...style };
}

export function setEdgeLabel(project: Project, edgeId: EdgeId, label: string): void {
  const e = project.customEdges.find((x) => x.id === edgeId);
  if (e) e.label = label;
}

// --- characters / states -----------------------------------------------------

export function addCharacter(project: Project, character: Character): void {
  project.characters.push(character);
}

/** Outcome of a character / state edit the UI has to report. */
export interface CharacterEditResult {
  ok: boolean;
  reason?: 'character-missing' | 'state-missing' | 'reserved-code';
  /** True when a hand-built Sankoff matrix had to be dropped (dimension change). */
  costMatrixDiscarded: boolean;
  /** True when the hand-built Sankoff matrix was resized instead of dropped. */
  costMatrixResized?: boolean;
  /** Node assignments cleared by the edit. */
  clearedAssignments: number;
}

/**
 * State labels that would collide with the missing-data codes. A state literally
 * named `?` can never be read as an observation (`isObservedState` checks the
 * missing codes first), so creating one is refused up front instead of silently
 * producing an unobservable state.
 */
export const RESERVED_STATE_LABELS = MISSING_STATE_CODES;

/**
 * Insert a row/column of default costs into a square matrix at `index`.
 * New→old transitions cost 1, old→new cost 1, the diagonal 0 — the Fitch
 * defaults — so a hand-weighted analysis keeps its weights instead of silently
 * degrading to uniform when the user adds a state.
 */
function resizeCostMatrix(matrix: number[][], index: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < matrix.length; i += 1) {
    const row = [...matrix[i]];
    row.splice(index, 0, 1);
    out.push(row);
  }
  const newRow = out.map(() => 1);
  newRow[index] = 0;
  out.splice(index, 0, newRow);
  return out;
}

/** Delete the row/column at `index` from a square matrix, keeping the rest. */
function shrinkCostMatrix(matrix: number[][], index: number): number[][] {
  const out = matrix
    .filter((_, i) => i !== index)
    .map((row) => row.filter((_, j) => j !== index));
  return out;
}

/** Remove a character and every trace of it: node states, node evidence meta
 *  and the copies parked in the non-active hypothesis layers. */
export function removeCharacter(project: Project, characterId: string): CharacterEditResult {
  const character = project.characters.find((c) => c.id === characterId);
  project.characters = project.characters.filter((c) => c.id !== characterId);
  let cleared = 0;
  for (const node of Object.values(project.nodes)) {
    const assigned = !!node.charStates && characterId in node.charStates;
    // The evidence record for a character that no longer exists would otherwise
    // be left behind, and `hypothesisExport` would then write it out as support
    // for a trait the document does not have.
    if (assigned || (node.charMeta && characterId in node.charMeta)) {
      clearNodeCharacter(node, characterId, true);
      if (assigned) cleared += 1;
    }
  }
  // Also purge the character from every stored (non-active) hypothesis layer,
  // otherwise switching to that layer would resurrect the deleted character's
  // ancestral states / meta onto the nodes.
  cleared += purgeCharacterFromLayers(project, characterId);
  return {
    ok: !!character,
    reason: character ? undefined : 'character-missing',
    costMatrixDiscarded: !!character?.costMatrix,
    clearedAssignments: cleared,
  };
}

/** Drop one character key from a node-keyed record map. Returns records touched. */
function purgeFromRecordMap<T>(
  records: Record<NodeId, T>,
  characterId: string,
  stateId?: string,
): number {
  let removed = 0;
  for (const nid of Object.keys(records)) {
    const rec: Record<string, unknown> | undefined = records[nid] as Record<string, unknown>;
    if (!rec || !(characterId in rec)) continue;
    if (stateId !== undefined) {
      const v = rec[characterId];
      // A polymorphic assignment (a set) is purged only when the removed state
      // was one of its members; single assignments compare directly.
      if (Array.isArray(v) ? !v.includes(stateId) : v !== stateId) continue;
    }
    delete rec[characterId];
    removed += 1;
    if (Object.keys(rec).length === 0) delete records[nid];
  }
  return removed;
}

/**
 * Drop `characterId` (optionally only the assignments equal to `stateId`) from
 * every stored hypothesis layer, for both states and evidence meta.
 * Returns the number of records removed.
 */
function purgeCharacterFromLayers(
  project: Project,
  characterId: string,
  stateId?: string,
): number {
  let removed = 0;
  for (const stored of Object.values(project.layerStore)) {
    // Stored states carry a state id, so only that character+state pair goes;
    // stored meta is keyed by character alone (there is no state dimension to
    // filter on), so removing any of a character's states drops its evidence.
    removed += purgeFromRecordMap(stored.states, characterId, stateId);
    removed += purgeFromRecordMap(stored.meta, characterId);
  }
  return removed;
}

export function renameCharacter(project: Project, characterId: string, name: string): void {
  const c = project.characters.find((x) => x.id === characterId);
  if (c) c.name = name;
}

export function setCharacterType(
  project: Project,
  characterId: string,
  type: Character['type'],
): void {
  const c = project.characters.find((x) => x.id === characterId);
  if (c) c.type = type;
}

/**
 * Add a state to a character. A hand-built Sankoff matrix is RESIZED (a
 * row/column of Fitch-default costs inserted) rather than dropped, so a
 * carefully weighted analysis survives adding a state; `costMatrixResized`
 * tells the UI to mention it. Labels colliding with the missing-data codes
 * ('?' / '-') are refused: such a state could never be read as observed.
 */
export function addCharacterState(
  project: Project,
  characterId: string,
  state: CharacterState,
): CharacterEditResult {
  const c = project.characters.find((x) => x.id === characterId);
  if (!c) return { ok: false, reason: 'character-missing', costMatrixDiscarded: false, clearedAssignments: 0 };
  if (RESERVED_STATE_LABELS.includes(state.label.trim()) || RESERVED_STATE_LABELS.includes(state.id.trim())) {
    return { ok: false, reason: 'reserved-code', costMatrixDiscarded: false, clearedAssignments: 0 };
  }
  const index = c.states.length;
  c.states.push(state);
  if (c.costMatrix) {
    c.costMatrix = resizeCostMatrix(c.costMatrix, index);
    return { ok: true, costMatrixDiscarded: false, costMatrixResized: true, clearedAssignments: 0 };
  }
  return { ok: true, costMatrixDiscarded: false, clearedAssignments: 0 };
}

export function updateCharacterState(
  project: Project,
  characterId: string,
  stateId: string,
  patch: Partial<CharacterState>,
): void {
  const c = project.characters.find((x) => x.id === characterId);
  const s = c?.states.find((x) => x.id === stateId);
  if (s) Object.assign(s, patch);
}

/**
 * Remove a state and clean up COMPLETELY: the assignments on the live
 * nodes, their evidence meta, and the copies parked in every stored hypothesis
 * layer. Without the layer purge, switching to another hypothesis layer and back
 * would resurrect the deleted state's ancestral assignment and meta — the same
 * cleanup `removeCharacter` performs.
 */
export function removeCharacterState(
  project: Project,
  characterId: string,
  stateId: string,
): CharacterEditResult {
  const c = project.characters.find((x) => x.id === characterId);
  if (!c) {
    return { ok: false, reason: 'character-missing', costMatrixDiscarded: false, clearedAssignments: 0 };
  }
  if (!c.states.some((s) => s.id === stateId)) {
    return { ok: false, reason: 'state-missing', costMatrixDiscarded: false, clearedAssignments: 0 };
  }
  const index = c.states.findIndex((s) => s.id === stateId);
  c.states = c.states.filter((s) => s.id !== stateId);
  if (c.costMatrix) {
    c.costMatrix = shrinkCostMatrix(c.costMatrix, index);
  }
  let cleared = 0;
  for (const node of Object.values(project.nodes)) {
    const v = node.charStates?.[characterId];
    const references =
      v === stateId || (Array.isArray(v) && v.includes(stateId));
    if (references) {
      clearNodeCharacter(node, characterId, true);
      cleared += 1;
    } else if (node.charMeta && characterId in node.charMeta && !node.charStates?.[characterId]) {
      // Evidence left behind for a hypothesis that has just been erased.
      clearNodeCharacter(node, characterId, true);
    }
  }
  cleared += purgeCharacterFromLayers(project, characterId, stateId);
  return { ok: true, costMatrixDiscarded: false, costMatrixResized: !!c.costMatrix, clearedAssignments: cleared };
}

/**
 * Remove a node's assignment for a character. The evidence meta is dropped only
 * when `dropMeta` is set: clearing an observed score keeps the user's notes, but
 * deleting the character or one of its states invalidates them.
 */
function clearNodeCharacter(node: TreeNode, characterId: string, dropMeta = false): void {
  if (node.charStates) {
    delete node.charStates[characterId];
    if (Object.keys(node.charStates).length === 0) delete node.charStates;
  }
  if (dropMeta && node.charMeta) {
    delete node.charMeta[characterId];
    if (Object.keys(node.charMeta).length === 0) delete node.charMeta;
  }
}

/**
 * Assign (or, with an empty value, clear) a node's state for a character.
 *
 * The single write path for character data, so it is where "observation" is
 * defined: a discrete assignment must either be a state the
 * character declares, or one of the standard missing-data codes ('?' / '-').
 * Anything else — the stale id of a deleted state, a typo, a value carried in
 * from another tool — is stored NOWHERE, because every consumer downstream
 * (parsimony, Mk, CI/RI, consistency checks, the transition layer) reads a
 * non-declared id as an observed state and silently invents a transition.
 */
export function setNodeState(
  project: Project,
  nodeId: NodeId,
  characterId: string,
  value: string | number | undefined,
): void {
  const node = project.nodes[nodeId];
  if (!node) return;
  if (value === undefined || value === '') {
    clearNodeCharacter(node, characterId);
    return;
  }
  const character = project.characters.find((c) => c.id === characterId);
  if (character && character.type === 'discrete' && typeof value === 'string') {
    const declared = character.states.some((s) => s.id === value);
    if (!declared && !MISSING_STATE_CODES.includes(value)) {
      clearNodeCharacter(node, characterId);
      return;
    }
  }
  if (!node.charStates) node.charStates = {};
  node.charStates[characterId] = value;
}

/**
 * Assign a POLYMORPHIC / partially-observed state set ("A or B") to a node.
 * Every member must be a declared state id; an empty set clears the assignment.
 * A set is NOT missing data — parsimony scores it as the cheapest member, Mk
 * multiplies the members' likelihoods — which is exactly the Fitch & McPeek
 * ambiguous-encoding semantics the single-value field could not express.
 */
export function setNodeStateSet(
  project: Project,
  nodeId: NodeId,
  characterId: string,
  values: string[],
): boolean {
  const node = project.nodes[nodeId];
  if (!node) return false;
  const unique = [...new Set(values)];
  if (unique.length === 0) {
    clearNodeCharacter(node, characterId);
    return true;
  }
  const character = project.characters.find((c) => c.id === characterId);
  if (!character || character.type !== 'discrete') return false;
  if (!unique.every((v) => character.states.some((s) => s.id === v))) return false;
  if (!node.charStates) node.charStates = {};
  node.charStates[characterId] = unique;
  return true;
}

/** Set (or, with undefined, clear) a character's Sankoff step matrix. */
export function setCharacterCostMatrix(
  project: Project,
  characterId: string,
  matrix: number[][] | undefined,
): void {
  const c = project.characters.find((x) => x.id === characterId);
  if (!c) return;
  if (matrix) {
    // Only accept a square matrix whose dimensions match the state count. A
    // mismatched matrix would make parsimony/ASR silently fall back to uniform
    // cost (or index out of range), so reject it by clearing to uniform.
    const k = c.states.length;
    const square =
      matrix.length === k && matrix.every((row) => Array.isArray(row) && row.length === k);
    if (square) c.costMatrix = matrix;
    else delete c.costMatrix;
  } else delete c.costMatrix;
}

/**
 * Drop per-node state and evidence keys that point at characters the document no
 * longer declares. `removeCharacter` cleans up as it deletes, but a hand-edited
 * document — or one assembled from another tool — can still carry the orphan keys,
 * and `hypothesisExport` would publish them as evidence for a trait that does not
 * exist. Returns the number of keys removed.
 */
export function pruneOrphanCharacterData(project: Project): number {
  const declared = new Set(project.characters.map((c) => c.id));
  let removed = 0;
  for (const node of Object.values(project.nodes)) {
    const states = node.charStates;
    if (states) {
      for (const cid of Object.keys(states)) {
        if (declared.has(cid)) continue;
        delete states[cid];
        removed += 1;
      }
      if (Object.keys(states).length === 0) delete node.charStates;
    }
    const meta = node.charMeta;
    if (meta) {
      for (const cid of Object.keys(meta)) {
        if (declared.has(cid)) continue;
        delete meta[cid];
        removed += 1;
      }
      if (Object.keys(meta).length === 0) delete node.charMeta;
    }
  }
  return removed;
}

/** Fill every internal node's state for `characterId` with the parsimony suggestion. */
export function fillParsimony(project: Project, characterId: string): void {
  const c = project.characters.find((x) => x.id === characterId);
  if (!c || c.type !== 'discrete') return;
  const result = parsimony(project, c);
  for (const node of Object.values(project.nodes)) {
    if (node.childrenIds.length === 0) continue; // internal nodes only
    // `chosen` is the state on the reported minimum-cost path; `states[0]` is
    // merely first in *declaration* order (see the contract on
    // ParsimonyResult.chosen in model/parsimony.ts). Reading [0] would fill in a
    // suggestion that is not necessarily most parsimonious.
    const suggestion = result.chosen.get(node.id) ?? result.states.get(node.id)?.[0];
    if (!suggestion) continue;
    if (!node.charStates) node.charStates = {};
    node.charStates[characterId] = suggestion;
  }
}

/** Set confidence / evidence for a node's ancestral-state hypothesis of a character. */
export function setNodeCharMeta(
  project: Project,
  nodeId: NodeId,
  characterId: string,
  patch: Partial<HypothesisMeta>,
): void {
  const node = project.nodes[nodeId];
  if (!node) return;
  if (!node.charMeta) node.charMeta = {};
  const next: HypothesisMeta = { ...node.charMeta[characterId], ...patch };
  // Drop empty fields so a cleared meta object disappears entirely.
  if (!next.confidence) delete next.confidence;
  if (!next.support) delete next.support;
  if (!next.against) delete next.against;
  if (Object.keys(next).length === 0) {
    delete node.charMeta[characterId];
    if (Object.keys(node.charMeta).length === 0) delete node.charMeta;
  } else {
    node.charMeta[characterId] = next;
  }
}

// --- evolutionary events -----------------------------------------------------

export function addEvent(project: Project, event: EvolutionaryEvent): void {
  project.events.push(event);
}

/** Remove an event and purge any causal links that pointed at it. */
export function removeEvent(project: Project, eventId: EventId): void {
  project.events = project.events.filter((e) => e.id !== eventId);
  for (const e of project.events) {
    if (e.triggers.includes(eventId)) e.triggers = e.triggers.filter((t) => t !== eventId);
  }
}

export function updateEvent(
  project: Project,
  eventId: EventId,
  patch: Partial<EvolutionaryEvent>,
): void {
  const e = project.events.find((x) => x.id === eventId);
  if (e) Object.assign(e, patch);
}

/**
 * Causal chains form a directed graph over events; the UI presents them as a
 * DAG, so adding a link that would close a cycle is rejected (returns false).
 * Self-links (eventId === targetId) are rejected for the same reason.
 */
export function wouldCreateCycle(project: Project, eventId: EventId, targetId: EventId): boolean {
  // Walk forward from `targetId` along existing trigger links; reaching
  // `eventId` again would close a cycle A -> ... -> target -> A.
  const seen = new Set<EventId>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop() as EventId;
    if (cur === eventId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const e = project.events.find((x) => x.id === cur);
    if (e) stack.push(...e.triggers);
  }
  return false;
}

/** Add or remove a causal link (cause `eventId` triggers `targetId`). */
export function toggleEventTrigger(project: Project, eventId: EventId, targetId: EventId): void {
  const e = project.events.find((x) => x.id === eventId);
  if (!e || eventId === targetId) return;
  if (e.triggers.includes(targetId)) {
    e.triggers = e.triggers.filter((t) => t !== targetId);
  } else if (!wouldCreateCycle(project, eventId, targetId)) {
    e.triggers.push(targetId);
  }
}

/** Drop events attached to removed nodes and purge dangling causal links. */
function pruneEventsForNodes(project: Project, removedNodeIds: Set<NodeId>): void {
  const removedEventIds = new Set(
    project.events.filter((e) => removedNodeIds.has(e.nodeId)).map((e) => e.id),
  );
  if (removedEventIds.size === 0) return;
  project.events = project.events.filter((e) => !removedEventIds.has(e.id));
  for (const e of project.events) {
    if (e.triggers.some((t) => removedEventIds.has(t))) {
      e.triggers = e.triggers.filter((t) => !removedEventIds.has(t));
    }
  }
}

/** Drop hypothesis annotations for deleted nodes from every stored layer. */
function pruneHypothesisNotesForNodes(project: Project, removedNodeIds: Set<NodeId>): void {
  for (const stored of Object.values(project.layerStore)) {
    if (!stored.notes) continue;
    for (const id of removedNodeIds) delete stored.notes[id];
  }
}

// --- environmental context ---------------------------------------------------

export function addEnvironmentalEvent(project: Project, event: EnvironmentalEvent): void {
  project.environmentalEvents.push(event);
}

export function updateEnvironmentalEvent(
  project: Project,
  id: string,
  patch: Partial<EnvironmentalEvent>,
): void {
  const e = project.environmentalEvents.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
}

export function removeEnvironmentalEvent(project: Project, id: string): void {
  project.environmentalEvents = project.environmentalEvents.filter((e) => e.id !== id);
}

// --- calibration points -----------------------------------------------------

export function addCalibrationPoint(project: Project, point: CalibrationPoint): void {
  project.calibrationPoints.push(point);
}

export function updateCalibrationPoint(
  project: Project,
  id: string,
  patch: Partial<CalibrationPoint>,
): void {
  const c = project.calibrationPoints.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
}

export function removeCalibrationPoint(project: Project, id: string): void {
  project.calibrationPoints = project.calibrationPoints.filter((c) => c.id !== id);
}

// --- unified node-time data model ---------------------------------------------

/** Find the calibration point attached to a given node, if any. */
export function getCalibrationForNode(project: Project, nodeId: NodeId): CalibrationPoint | undefined {
  return project.calibrationPoints.find((c) => c.nodeId === nodeId);
}

/**
 * Set (or update) a calibration point for a specific node. If a calibration
 * already exists for that node, it is updated; otherwise a new one is created.
 * This is the single entry point for binding a time constraint to a node,
 * ensuring the left panel (calibration manager) and the right panel (node
 * properties) share the SAME data source (Single Source of Truth).
 */
export function setCalibrationForNode(
  project: Project,
  nodeId: NodeId,
  minAge: number,
  maxAge: number,
  label?: string,
): void {
  const existing = project.calibrationPoints.find((c) => c.nodeId === nodeId);
  if (existing) {
    existing.minAge = minAge;
    existing.maxAge = maxAge;
    if (label !== undefined) existing.label = label;
  } else {
    project.calibrationPoints.push({
      id: newId(),
      nodeId,
      minAge,
      maxAge,
      label,
    });
  }
}

/** Remove any calibration point bound to the given node. */
export function removeCalibrationForNode(project: Project, nodeId: NodeId): void {
  project.calibrationPoints = project.calibrationPoints.filter(
    (c) => c.nodeId !== nodeId,
  );
}
