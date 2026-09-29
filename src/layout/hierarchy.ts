// Iterative hierarchy construction.
//
// d3-hierarchy's `hierarchy(data, children)` builds its nodes with an explicit
// stack (fast, and already stack-safe on deep trees), but it then finishes with
// `root.eachBefore(computeHeight)`, and *that* pass is the problem:
// `computeHeight` walks UP from each visited node through its parents, bumping
// every ancestor's height until it reaches one that already holds a larger
// value (`node_modules/d3-hierarchy/src/hierarchy/index.js:62-66`). On a
// balanced tree the walk is O(log n) per node; on a pectinate ("comb") tree
// nearly every node walks the full depth, so construction costs O(n·depth).
// Measured on this repository's own 16 000-tip comb: 2.1-5.5 s for
// `hierarchy()` against 1 ms for `cluster()` and 2 ms for a hand-written
// traversal — the height pass is the whole defect.
//
// None of that walk is needed: a node's height is `1 + max(child.height)`, so
// one reverse pass over the creation order — where children always appear after
// their parent — computes every height in O(n). This module does exactly that,
// producing REAL d3 nodes (same constructor, so `each`, `eachAfter`,
// `eachBefore`, `leaves`, `Symbol.iterator` and `d3.cluster()` all behave
// identically to `hierarchy()`'s output) with `depth`, `parent` and `height`
// filled in iteratively.
//
// Two things make using this instead of `hierarchy()` safe rather than a coin
// flip:
//   * `hierarchy.test.ts` diffs it against the genuine `hierarchy()` over
//     randomly generated trees, degenerate shapes and every shipped sample
//     project — node by node in d3's own pre-order, and again through the
//     coordinates `cluster()` assigns. A divergence there is a test failure, not
//     a silently redrawn tree.
//   * if a future d3-hierarchy ever changes how its nodes are constructed, the
//     probe below detects it and we delegate to `hierarchy()` instead: slow, but
//     correct.

import { hierarchy, type HierarchyNode } from 'd3-hierarchy';

/**
 * The slice of d3's node shape that construction writes. d3's own
 * `HierarchyNode<Datum>` types `depth`/`height` as read-only (only `hierarchy()`
 * is supposed to fill them in) and carries a construct signature, so it cannot
 * be used as the type a builder writes through; the object produced here is the
 * same runtime object, cast back to `HierarchyNode` on the way out.
 */
interface MutableNode<T> {
  data: T;
  depth: number;
  height: number;
  parent: MutableNode<T> | null;
  children?: MutableNode<T>[] | undefined;
  [key: string]: unknown;
}

/** d3's node constructor, as an opaque class taking only the datum. */
type D3NodeConstructor = new (data: unknown) => MutableNode<unknown>;

let cachedConstructor: D3NodeConstructor | null | undefined;

/**
 * Locate d3's own node constructor and verify it behaves like the one this
 * module assumes: a datum-carrying object starting at depth 0, height 0, no
 * parent, with prototype traversal methods. `null` means "do not hand-build
 * nodes; call `hierarchy()`".
 */
function d3NodeConstructor(): D3NodeConstructor | null {
  if (cachedConstructor !== undefined) return cachedConstructor;
  try {
    const probe = hierarchy({ marker: 1 } as unknown) as unknown as {
      constructor: D3NodeConstructor;
    };
    const ctor = probe.constructor;
    if (typeof ctor !== 'function') {
      cachedConstructor = null;
      return cachedConstructor;
    }
    const a = new ctor({ a: 1 });
    const b = new ctor({ b: 2 });
    const sane =
      a.depth === 0 &&
      a.height === 0 &&
      a.parent === null &&
      (a.data as { a?: number }).a === 1 &&
      b.depth === 0 &&
      typeof a.eachAfter === 'function' &&
      typeof (a as unknown as Iterable<unknown>)[Symbol.iterator] === 'function' &&
      a.children === undefined;
    cachedConstructor = sane ? ctor : null;
  } catch {
    cachedConstructor = null;
  }
  return cachedConstructor;
}

export interface BuildHierarchyOptions<T> {
  /**
   * Hard cap on how many nodes may be created. A tree of distinct nodes can
   * never visit more nodes than the document holds, so a caller-supplied budget
   * is what makes a corrupt structure *terminable*: d3's own `hierarchy()`
   * simply never returns when a child reference closes a cycle.
   */
  maxNodes?: number;
  /**
   * Called once when `maxNodes` cut a traversal short, with the parent whose
   * remaining children were dropped.
   */
  onTruncated?: (node: T) => void;
}

/**
 * Build a d3 `HierarchyNode` tree without d3's O(n·depth) height pass.
 *
 * `children` defaults to d3's own `(node) => node.children`, matching
 * `hierarchy(data)`'s implicit accessor. Unlike `hierarchy()`, a `Map` datum is
 * not special-cased — no caller here feeds one.
 */
export function buildHierarchy<T>(
  root: T,
  children: (node: T) => readonly T[] | undefined | null = defaultChildren,
  options: BuildHierarchyOptions<T> = {},
): HierarchyNode<T> {
  const { maxNodes, onTruncated } = options;
  const Ctor = d3NodeConstructor();
  // Never trust a guess about d3's internals: fall back to the real thing.
  if (!Ctor) return hierarchy(root, children as (node: T) => T[]);

  const rootNode = new Ctor(root) as MutableNode<T>;
  // Creation order doubles as the traversal proof: a parent is always pushed
  // before its children, so reversing it visits every child before its parent.
  const order: MutableNode<T>[] = [rootNode];
  let truncatedUnder: MutableNode<T> | null = null;

  for (let i = 0; i < order.length; i += 1) {
    const node = order[i];
    const kids = children(node.data);
    if (!kids || kids.length === 0) continue;
    const built: MutableNode<T>[] = [];
    for (const childData of kids) {
      if (maxNodes !== undefined && order.length + built.length >= maxNodes) {
        truncatedUnder = node;
        break;
      }
      const child = new Ctor(childData) as MutableNode<T>;
      child.parent = node;
      child.depth = node.depth + 1;
      built.push(child);
    }
    // Same as d3: a node with no children has no `children` property at all.
    if (built.length > 0) node.children = built;
    for (const child of built) order.push(child);
    if (truncatedUnder) break;
  }

  if (truncatedUnder && onTruncated) onTruncated(truncatedUnder.data);

  // O(n): heights bottom-up. This lands on exactly what d3 arrives at by walking
  // up from every node, because `height` is `1 + max(child.height)` and 0 for a
  // leaf.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const node = order[i];
    const kids = node.children;
    let height = 0;
    if (kids) {
      let deepest = 0;
      for (const kid of kids) if (kid.height > deepest) deepest = kid.height;
      height = deepest + 1;
    }
    node.height = height;
  }

  return rootNode as unknown as HierarchyNode<T>;
}

function defaultChildren<T>(node: T): readonly T[] | undefined {
  return (node as { children?: readonly T[] }).children;
}
