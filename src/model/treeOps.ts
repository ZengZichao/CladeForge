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
    // When the removed node has no recorded length there is nothing to add and
    // the child's own segment is kept — never a made-up number.
    const ownLength = knownLength(node.branchLength);
    for (const cid of node.childrenIds) {
      const c = project.nodes[cid];
      if (!c) continue;
      c.parentId = parent.id;
      if (ownLength !== undefined) {
        const childLength = knownLength(c.branchLength);
        c.branchLength = childLength === undefined ? undefined : ownLength + childLength;
      }
    }
    delete project.nodes[id];
    project.customEdges = project.customEdges.filter(
      (e) => e.sourceId !== id && e.targetId !== id,
    );
    pruneEventsForNodes(project, new Set([id]));
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

  // Snapshot every weight that is about to move, before anything is rewired.
  const oldWeight = new Map<NodeId, number | undefined>();
  for (const id of path) oldWeight.set(id, knownLength(project.nodes[id]?.branchLength));
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

  // Reverse each edge along the path up to the old root, carrying its weight to
  // the new child end.
  for (let j = 0; j < path.length - 1; j += 1) {
    const upper = project.nodes[path[j + 1]];
    upper.childrenIds = upper.childrenIds.filter((x) => x !== path[j]);
    project.nodes[path[j]].childrenIds.push(path[j + 1]);
    upper.parentId = path[j];
    project.nodes[path[j + 1]].branchLength = oldWeight.get(path[j]);
  }

  // Where the split branch sits between two dated endpoints, so does the root.
  const parentAge = finiteAge(oldParent);
  const targetAge = finiteAge(target);
  if (parentAge !== undefined && targetAge !== undefined) {
    root.age = parentAge + f * (targetAge - parentAge);
  }

  project.rootId = root.id;

  // Suppress a unifurcation left at the former root.
  const formerRoot = project.nodes[oldRootId];
  if (formerRoot && formerRoot.parentId !== null && formerRoot.childrenIds.length === 1) {
    reattachNodeReferences(project, oldRootId, formerRoot.childrenIds[0]);
    deleteNode(project, oldRootId, false);
  }
  return true;
}

/**
 * Move a node's annotations onto a surviving lineage before the node is spliced
 * out, so a re-root never destroys evidence. Per-character records are
 * merged with the survivor winning, because an existing hypothesis on the
 * surviving node is the more specific statement.
 */
function reattachNodeReferences(project: Project, fromId: NodeId, toId: NodeId): void {
  if (fromId === toId) return;
  for (const e of project.events) if (e.nodeId === fromId) e.nodeId = toId;
  for (const cp of project.calibrationPoints ?? []) if (cp.nodeId === fromId) cp.nodeId = toId;
  for (const stored of Object.values(project.layerStore)) {
    mergeNodeRecord(stored.states, fromId, toId);
    mergeNodeRecord(stored.meta, fromId, toId);
  }
}

/** Merge `from`'s record into `to`'s for a node-keyed record map. */
function mergeNodeRecord<T extends object>(
  records: Record<NodeId, T>,
  from: NodeId,
  to: NodeId,
): void {
  const src = records[from];
  if (!src) return;
  const dst = records[to];
  if (!dst) records[to] = src;
  else {
    for (const [k, v] of Object.entries(src)) {
      if (!(k in (dst as Record<string, unknown>))) (dst as Record<string, unknown>)[k] = v;
    }
  }
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
  // The outgroup MRCA is the root ⇒ its complement is empty ⇒ there is no
  // branch to move the root onto.
  if (m === project.rootId || project.nodes[m]?.parentId === null) return 'outgroup-is-root';
  return null;
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
      charStates: n.charStates ? { ...n.charStates } : undefined,
      charMeta: n.charMeta ? copyMetaRecord(n.charMeta) : undefined,
      style: n.style ? { ...n.style } : undefined,
      branchStyle: n.branchStyle ? { ...n.branchStyle } : undefined,
      meta: n.meta ? { ...n.meta } : undefined,
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
 * Support values reach us in two conventions: bootstrap proportions are written
 * 0–100 (`75`) and posterior probabilities 0–1 (`0.95`), and both land in the
 * same `support` field (`newick.ts` stores whatever the file says). Comparing a
 * mixed field against a single threshold without converting first marks every
 * branch of a Bayesian tree "low supported" — the same root cause as the
 * `support < 70` test in `exportImage.ts`. Anything <= 1 is read as
 * a fraction, so `1` means 100 %, and 0 stays 0.
 */
export function normalizeSupport(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value <= 1 ? value * 100 : value;
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
    const support = normalizeSupport(n.support);
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
    let ancId: NodeId | undefined = n.parentId ?? undefined;
    while (ancId) {
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
  reason?: 'character-missing' | 'state-missing';
  /** True when a hand-built Sankoff matrix had to be dropped (dimension change). */
  costMatrixDiscarded: boolean;
  /** Node assignments cleared by the edit. */
  clearedAssignments: number;
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
function purgeFromRecordMap<T extends object>(
  records: Record<NodeId, T>,
  characterId: string,
  stateId?: string,
): number {
  let removed = 0;
  for (const nid of Object.keys(records)) {
    const rec: Record<string, unknown> | undefined = records[nid] as Record<string, unknown>;
    if (!rec || !(characterId in rec)) continue;
    if (stateId !== undefined && rec[characterId] !== stateId) continue;
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
 * Add a state to a character. Returns whether the hand-built Sankoff matrix had
 * to be discarded: the matrix is indexed by state position, so any dimension
 * change invalidates it — but dropping it silently degrades a weighted analysis
 * to equal-cost Fitch without the user hearing about it. The caller is
 * expected to say so.
 */
export function addCharacterState(
  project: Project,
  characterId: string,
  state: CharacterState,
): CharacterEditResult {
  const c = project.characters.find((x) => x.id === characterId);
  if (!c) return { ok: false, reason: 'character-missing', costMatrixDiscarded: false, clearedAssignments: 0 };
  const discarded = !!c.costMatrix;
  c.states.push(state);
  delete c.costMatrix; // dimensions changed; reset to uniform to avoid mismatch
  return { ok: true, costMatrixDiscarded: discarded, clearedAssignments: 0 };
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
  const discarded = !!c.costMatrix;
  c.states = c.states.filter((s) => s.id !== stateId);
  delete c.costMatrix; // dimensions changed; reset to uniform to avoid mismatch
  let cleared = 0;
  for (const node of Object.values(project.nodes)) {
    if (node.charStates?.[characterId] === stateId) {
      clearNodeCharacter(node, characterId, true);
      cleared += 1;
    } else if (node.charMeta && characterId in node.charMeta && !node.charStates?.[characterId]) {
      // Evidence left behind for a hypothesis that has just been erased.
      clearNodeCharacter(node, characterId, true);
    }
  }
  cleared += purgeCharacterFromLayers(project, characterId, stateId);
  return { ok: true, costMatrixDiscarded: discarded, clearedAssignments: cleared };
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
