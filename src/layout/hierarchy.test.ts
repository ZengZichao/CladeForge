import { describe, it, expect } from 'vitest';
import { cluster, hierarchy, type HierarchyNode } from 'd3-hierarchy';
import { parseNewick } from '../io/newick';
import { createSampleProject } from '../model/sampleTree';
import { toggleCollapse } from '../model/treeOps';
import type { NodeId, Project, TreeNode } from '../model/types';
import { buildHierarchy } from './hierarchy';
import { computeLayout } from './autoLayout';

/**
 * `computeLayout` builds its tree with `buildHierarchy` rather than d3's
 * `hierarchy()`, because d3's constructor ends with a height pass that walks up
 * the ancestors of every node: O(n·depth), 2.1-5.5 s for a 16 000-tip comb
 * versus 36 ms for a balanced tree of the same size. Here the heights come from
 * a single reverse sweep over the creation order instead.
 *
 * Swapping the constructor the layout is built on is only safe if the result is
 * *identical*, so these tests diff the two constructions node by node — and
 * again through the coordinates `d3.cluster()` assigns — over random trees,
 * degenerate shapes and the shipped samples. The last group pins the cost, so a
 * quadratic walk cannot slip in unnoticed.
 */

/** The same accessor `autoLayout` uses, minus the collapsed-subtree skip. */
function childData(project: Project) {
  return (node: TreeNode): TreeNode[] =>
    node.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];
}

/** The accessor `autoLayout` actually passes, collapse included. */
function visibleChildData(project: Project) {
  return (node: TreeNode): TreeNode[] =>
    node.collapsed
      ? []
      : (node.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[]);
}

/** A deterministic PRNG so a failure is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A random rooted tree in Newick, `tips` tips, random branching factor 2-4. */
function randomNewick(tips: number, random: () => number): string {
  let label = 0;
  const nextLabel = () => `t${label++}`;
  function sub(depth: number): string {
    const leavesLeft = tips - label;
    if (depth > 12 || leavesLeft <= 1 || random() < 0.25) return nextLabel();
    const arity = 2 + Math.floor(random() * 3);
    const parts: string[] = [];
    for (let i = 0; i < arity; i += 1) parts.push(sub(depth + 1));
    const internal = random() < 0.5 ? nextLabel() : '';
    return `(${parts.join(',')})${internal}`;
  }
  return `${sub(0)};`;
}

function combNewick(n: number): string {
  let s = '(t0:1,t1:1)';
  for (let i = 2; i < n; i += 1) s = `(${s},t${i}:1)`;
  return `${s};`;
}

/** Snapshot of a d3 hierarchy in d3's own pre-order, for a like-for-like diff. */
function fingerprint(root: HierarchyNode<TreeNode>) {
  const rows: string[] = [];
  root.eachBefore((node) => {
    rows.push(
      [
        node.data.id,
        node.depth,
        node.height,
        node.parent ? node.parent.data.id : '-',
        node.children ? node.children.length : -1,
      ].join('|'),
    );
  });
  return rows;
}

/** The coordinates `cluster()` writes, keyed by node id. */
function clustered(
  root: HierarchyNode<TreeNode>,
  sep: number,
  gap: number,
): Map<NodeId, { x: number; y: number }> {
  cluster<TreeNode>().nodeSize([sep, gap]).separation(() => 1)(root);
  const out = new Map<NodeId, { x: number; y: number }>();
  root.eachBefore((node) => out.set(node.data.id, { x: node.x ?? 0, y: node.y ?? 0 }));
  return out;
}

const HAND_SHAPES: Array<[string, string]> = [
  ['single node', 'A;'],
  ['two tips', '(A,B)R;'],
  ['balanced 4', '((A,B),(C,D))R;'],
  ['pectinate 6', '((((A,B),C),D),E)R;'],
  ['star 12', '(A,B,C,D,E,F,G,H,I,J,K,L)R;'],
  ['multifurcation inside multifurcation', '(A,(B,(C,D,E),F),(G,H),I)R;'],
  ['shallow leaf beside deep cousin', '(A,(B,(C,(D,E))))R;'],
  ['zero-length and missing lengths', '((A:0,B:1)n1:5,C:2,D:0.0001)R;'],
  ['long chain (stack safety)', combNewick(1200)],
];

const PROJECTS: Array<[string, Project]> = (() => {
  const list: Array<[string, Project]> = HAND_SHAPES.map(([name, nwk]) => [
    name,
    parseNewick(nwk),
  ]);
  const random = rng(20260925);
  for (let i = 0; i < 25; i += 1) {
    const tips = 3 + Math.floor(random() * 120);
    list.push([`random #${i} (${tips} tips)`, parseNewick(randomNewick(tips, random))]);
  }
  list.push(['shipped sample project', createSampleProject()]);
  return list;
})();

describe('buildHierarchy — identical to d3 hierarchy()', () => {
  it.each(PROJECTS.map((p): [string, Project] => [p[0], p[1]]))(
    'matches depth/height/parent/children on %s',
    (_name, project) => {
      const children = childData(project);
      const mine = buildHierarchy(project.nodes[project.rootId], children);
      const theirs = hierarchy(project.nodes[project.rootId], children);
      expect(fingerprint(mine)).toEqual(fingerprint(theirs));
    },
  );

  it.each(PROJECTS.map((p): [string, Project] => [p[0], p[1]]))(
    'makes cluster() assign the same coordinates on %s',
    (_name, project) => {
      const children = childData(project);
      const mine = buildHierarchy(project.nodes[project.rootId], children);
      const theirs = hierarchy(project.nodes[project.rootId], children);
      expect(clustered(mine, 8, 20)).toEqual(clustered(theirs, 8, 20));
    },
  );

  it('keeps d3’s node semantics: no children property on a leaf, leaves/height/descendants intact', () => {
    const project = parseNewick('((A,B),(C,D))R;');
    const root = buildHierarchy(project.nodes[project.rootId], childData(project));
    const leaf = root.children?.[0].children?.[0];
    expect(leaf?.children).toBeUndefined();
    expect(root.leaves().length).toBe(4);
    expect(root.height).toBe(2);
    // 4 tips + 2 unlabeled internal nodes + the root.
    expect(root.descendants().length).toBe(7);
  });

  it('skips a collapsed subtree exactly as d3 would with the same accessor', () => {
    const project = createSampleProject();
    const firstChild = project.nodes[project.rootId].childrenIds[0];
    toggleCollapse(project, firstChild);
    const children = visibleChildData(project);
    const mine = buildHierarchy(project.nodes[project.rootId], children);
    const theirs = hierarchy(project.nodes[project.rootId], children);
    expect(fingerprint(mine)).toEqual(fingerprint(theirs));
    expect(mine.children?.length).toBe(theirs.children?.length);
  });

  it('reports the real type so the d3 fallback stays type-correct', () => {
    const project = parseNewick('(A,B)R;');
    const root = buildHierarchy(project.nodes[project.rootId], childData(project));
    // The returned object is a genuine d3 node, not a look-alike: that is what
    // lets `cluster()` and `root.each()` keep working unchanged.
    const d3Node = (hierarchy({}) as unknown as { constructor: new () => unknown })
      .constructor;
    expect(root).toBeInstanceOf(d3Node);
  });
});

describe('buildHierarchy — a corrupt document cannot hang the layout', () => {
  it('cuts off a cycle and says where, instead of looping forever', () => {
    // root -> a -> root. `hierarchy()` never returns on this; validateProject
    // is what normally removes such a reference, and the node budget is the
    // last line of defence for an in-memory document that skipped it.
    const a = { id: 'a', label: 'a', childrenIds: ['root'] } as unknown as TreeNode;
    const root = { id: 'root', label: 'root', childrenIds: ['a'] } as unknown as TreeNode;
    const byId: Record<string, TreeNode> = { root, a };
    const truncated: string[] = [];
    const built = buildHierarchy<TreeNode>(root, (node) =>
      node.childrenIds.map((id) => byId[id]),
      {
        maxNodes: 6,
        onTruncated: (node) => truncated.push(node.id),
      },
    );
    let created = 0;
    built.eachBefore(() => {
      created += 1;
    });
    expect(created).toBeLessThanOrEqual(6);
    expect(truncated).toEqual(['a']);
  });

  it('leaves a legitimate tree well inside the budget', () => {
    // The budget is 4·nodes + 1024 in `computeLayout`; a real tree of N distinct
    // nodes visits exactly N, so it must never truncate.
    const project = parseNewick(combNewick(900));
    let truncated = false;
    const built = buildHierarchy(project.nodes[project.rootId], childData(project), {
      maxNodes: Object.keys(project.nodes).length * 4 + 1024,
      onTruncated: () => {
        truncated = true;
      },
    });
    let created = 0;
    built.eachBefore(() => {
      created += 1;
    });
    expect(created).toBe(Object.keys(project.nodes).length);
    expect(truncated).toBe(false);
  });

  it('lets computeLayout report a cyclic document instead of hanging on it', () => {
    // `validateProject` strips these on load. Layout must still terminate if
    // one reaches it by another route; d3's own construction would never return.
    const project = parseNewick('((A,B),C)R;');
    const root = project.nodes[project.rootId];
    const a = project.nodes[root.childrenIds[0]];
    a.childrenIds.push(root.id); // a -> root, closing a cycle
    const { positions, issues } = computeLayout(project);
    expect(positions.size).toBeGreaterThan(0);
    expect(issues?.some((i) => i.kind === 'cyclic-children')).toBe(true);
  });
});

function bestMs(fn: () => void, reps = 5): number {
  let best = Infinity;
  for (let r = 0; r < reps; r += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return best;
}

/**
 * Wall-clock assertions are kept behind this flag. They are the right tool for a
 * profiling run on a quiet machine and the wrong tool for a shared CI runner: a
 * threshold on measured milliseconds mostly measures the scheduler, so the
 * suite gates on counted work instead. Set `CLADEFORGE_TIMING_GATE=1` to enable
 * them.
 */
const GATE_TIMINGS = process.env.CLADEFORGE_TIMING_GATE === '1';

/** A perfectly balanced Newick with exactly `tips` tips (tips must be 2^k). */
function balancedNewick(tips: number): string {
  let next = 0;
  const build = (k: number): string => {
    if (k <= 1) return `t${next++}:1`;
    return `(${build(k / 2)},${build(k / 2)})`;
  };
  return `${build(tips)};`;
}

// --- deterministic cost evidence --------------------------------------------

/**
 * The cost group below compares counted operations rather than measured
 * milliseconds, and it does not compare ratios of timings either: a ratio of
 * sub-millisecond measurements on a loaded machine is noise, and a noise-driven
 * test that sometimes reddens CI is worse than no test, because a suite people
 * learn to ignore protects nothing. What the layout claims is a bound on an
 * OPERATION COUNT, so that is what is counted.
 *
 * The operation is visible for free. d3's `hierarchy()` ends with
 * `root.eachBefore(computeHeight)`, and `computeHeight` is the quadratic term
 * (node_modules/d3-hierarchy/src/hierarchy/index.js):
 *
 *   function computeHeight(node) {
 *     var height = 0;
 *     do node.height = height;
 *     while ((node = node.parent) && (node.height < ++height));
 *   }
 *
 * Every step of that loop is a write to `height` and a read of `parent` on d3's
 * own node objects. Installing counting accessors for those two properties on
 * d3's node prototype therefore counts the ancestor walk itself — exactly, on
 * every machine, every time. `buildHierarchy` replaces the walk with one reverse
 * sweep over the creation order, so it writes each node's height twice (its
 * constructor plus the sweep) and never follows a parent chain at all.
 */
interface ConstructionWork {
  /** Writes of a d3 node's `height`: 1 per node for a bottom-up sweep. */
  heightWrites: number;
  /** Reads of a d3 node's `parent`: 1 per step of an ancestor walk. */
  parentHops: number;
}

const NODE_PROTO = Object.getPrototypeOf(hierarchy({ probe: 1 } as unknown)) as object;

function measureConstructionWork(build: () => void): ConstructionWork {
  const counts: ConstructionWork = { heightWrites: 0, parentHops: 0 };
  const heightKey = Symbol('countedHeight');
  const parentKey = Symbol('countedParent');
  const proto = NODE_PROTO as Record<string | symbol, unknown>;
  const savedHeight = Object.getOwnPropertyDescriptor(proto, 'height');
  const savedParent = Object.getOwnPropertyDescriptor(proto, 'parent');
  const slot = (node: unknown, key: symbol): unknown =>
    (node as Record<symbol, unknown>)[key];

  Object.defineProperty(proto, 'height', {
    configurable: true,
    get(this: unknown) {
      return slot(this, heightKey);
    },
    set(this: unknown, value: number) {
      counts.heightWrites += 1;
      (this as Record<symbol, unknown>)[heightKey] = value;
    },
  });
  Object.defineProperty(proto, 'parent', {
    configurable: true,
    get(this: unknown) {
      counts.parentHops += 1;
      return slot(this, parentKey);
    },
    set(this: unknown, value: unknown) {
      (this as Record<symbol, unknown>)[parentKey] = value;
    },
  });
  try {
    build();
    return counts;
  } finally {
    delete proto.height;
    delete proto.parent;
    if (savedHeight) Object.defineProperty(proto, 'height', savedHeight);
    if (savedParent) Object.defineProperty(proto, 'parent', savedParent);
  }
}

const nodeCountOf = (project: Project): number => Object.keys(project.nodes).length;

/** Work the builder itself does, counted over one build. */
function buildWork(project: Project): ConstructionWork {
  const root = project.nodes[project.rootId];
  const children = childData(project);
  // Warm `buildHierarchy`'s cached d3 constructor outside the counted window:
  // its one-off sanity probe reads a `parent`, and that read is not construction.
  buildHierarchy(root, children);
  return measureConstructionWork(() => buildHierarchy(root, children));
}

/** Σ depth over the tree: the number of hops d3's height pass walks per node. */
function ancestorHopModel(project: Project): number {
  const root = buildHierarchy(project.nodes[project.rootId], childData(project));
  let hops = 0;
  root.each((node) => {
    hops += node.depth;
  });
  return hops;
}

describe('buildHierarchy — construction work is O(nodes), not O(nodes × depth)', () => {
  it('builds a comb without following one parent chain', () => {
    const project = parseNewick(combNewick(8_000));
    const nodes = nodeCountOf(project);
    const root = project.nodes[project.rootId];
    const children = childData(project);
    buildHierarchy(root, children); // warm the constructor probe
    const mine = measureConstructionWork(() => buildHierarchy(root, children));

    // One height write from d3's Node constructor plus one from the reverse
    // sweep, per node — and no ancestor walk anywhere.
    expect(mine.heightWrites).toBe(2 * nodes);
    expect(mine.parentHops).toBe(0);

    // The counter's own sensitivity check, on a smaller comb so the suite stays
    // quick: the same instrument over d3's `hierarchy()` sees the ancestor walk
    // directly, so a builder that performed it could not pass the two lines
    // above. (Measured at 16 000 tips, the same figure is 128 023 999 hops.)
    const small = parseNewick(combNewick(2_000));
    const smallRoot = small.nodes[small.rootId];
    const smallChildren = childData(small);
    const theirs = measureConstructionWork(() => hierarchy(smallRoot, smallChildren));
    expect(theirs.parentHops).toBeGreaterThan(10 * nodeCountOf(small));
    expect(theirs.heightWrites).toBeGreaterThan(theirs.parentHops);
  });

  it('scales with nodes on a comb, not with nodes × depth', () => {
    const small = parseNewick(combNewick(4_000));
    const large = parseNewick(combNewick(16_000));
    const smallWork = buildWork(small);
    const largeWork = buildWork(large);
    const nodeRatio = nodeCountOf(large) / nodeCountOf(small);
    // 4× the nodes may cost at most 4× the work plus the constant per node.
    expect(largeWork.heightWrites / smallWork.heightWrites).toBeLessThanOrEqual(nodeRatio + 0.05);
    expect(largeWork.parentHops).toBe(0);
    // …while d3's height pass grows with the DEPTH as well: quadrupling the
    // nodes of a comb quadruples its depth, so that path costs ~16×.
    expect(ancestorHopModel(large) / ancestorHopModel(small)).toBeGreaterThan(nodeRatio * 3);
  });

  it('costs the same per node for a comb and a balanced tree of the same size', () => {
    // Shape independence is the property under test: a balanced tree of
    // the same node count must not be cheaper per node.
    const pectinate = parseNewick(combNewick(8_000));
    const balanced = parseNewick(balancedNewick(8_192));
    expect(nodeCountOf(pectinate)).toBeLessThan(nodeCountOf(balanced));
    const comb = buildWork(pectinate);
    const even = buildWork(balanced);
    const perNode = (w: ConstructionWork, nodes: number): number => w.heightWrites / nodes;
    expect(perNode(comb, nodeCountOf(pectinate))).toBeCloseTo(2, 9);
    expect(perNode(even, nodeCountOf(balanced))).toBeCloseTo(2, 9);
    // Depth still differs enormously between the two shapes — a 34 000-deep comb
    // versus a 13-level balanced tree — so d3's height pass would cost far more
    // on the comb; `buildHierarchy` does no such walk.
    expect(ancestorHopModel(pectinate) / ancestorHopModel(balanced)).toBeGreaterThan(50);
  });

  it('keeps a whole layout inside the same linear bound as its node count', () => {
    // The layout is what re-runs on every committed edit, so the bound is
    // counted over `computeLayout`, not just over the builder. Measured here:
    // 4 000-tip comb → 7 999 nodes, 15 998 height writes, 0 parent hops;
    // 16 000-tip comb → 31 999 nodes, 63 998 height writes, 0 parent hops.
    // d3's `hierarchy()` on that same 16 000-tip comb walks 128 023 999 parent
    // links (counted, not extrapolated) — several seconds of work, which is why
    // the layout does not build its tree that way.
    const small = parseNewick(combNewick(4_000));
    const large = parseNewick(combNewick(16_000));
    computeLayout(small); // warm: the first build resolves the d3 constructor probe
    const smallWork = measureConstructionWork(() => computeLayout(small));
    const largeWork = measureConstructionWork(() => computeLayout(large));
    const nodeRatio = nodeCountOf(large) / nodeCountOf(small);

    expect(smallWork.parentHops).toBe(0);
    expect(largeWork.parentHops).toBe(0);
    // Two writes per node (constructor + bottom-up sweep), for the layout as a
    // whole: neither `cluster()` nor the coordinate pass recomputes a height.
    expect(smallWork.heightWrites).toBe(2 * nodeCountOf(small));
    expect(largeWork.heightWrites).toBe(2 * nodeCountOf(large));
    // Quadrupling the nodes quadruples the work. Under an O(n·depth) height pass
    // the same size step would multiply it by ~16 (4× nodes × 4× depth).
    expect(largeWork.heightWrites / smallWork.heightWrites).toBeLessThanOrEqual(nodeRatio + 0.05);
    expect(ancestorHopModel(large) / ancestorHopModel(small)).toBeGreaterThan(nodeRatio * 3);
  });
});

describe('buildHierarchy — wall-clock guards (non-gating; CLADEFORGE_TIMING_GATE=1)', () => {
  // These run for profiling, not for CI: a millisecond threshold on a shared
  // runner mostly measures the scheduler, so the deterministic counters above
  // carry the property. What is left here is the constant — and each of these is
  // bound by the counter it is paired with, since a layout that visits each node
  // twice cannot legitimately take seconds.
  it.skipIf(!GATE_TIMINGS)(
    'constructs a comb far more cheaply than d3’s height pass',
    () => {
      // 8 000 rather than 16 000 tips: d3's quadratic walk is already ~150x the
      // whole rest of the build here, and this keeps the suite quick.
      const project = parseNewick(combNewick(8_000));
      const root = project.nodes[project.rootId];
      const children = childData(project);
      const mine = bestMs(() => buildHierarchy(root, children));
      const theirs = bestMs(() => hierarchy(root, children), 3);
      // Typical run: 0.7 ms against d3's 109 ms on this tree. Anything within
      // 10x of d3 means the builder is doing the O(n·depth) ancestor walk again.
      expect(mine * 10).toBeLessThan(theirs);
    },
  );

  it.skipIf(!GATE_TIMINGS)(
    'lays out a 16 000-tip comb inside an interactive budget',
    () => {
      const project = parseNewick(combNewick(16_000));
      const ms = bestMs(() => computeLayout(project), 3);
      // Typical runs land at 17-30 ms depending on the machine, where d3's
      // height pass on the same tree costs seconds. The 300 ms ceiling
      // is a generous multiple of the counted work (32 000 nodes, 2 height writes
      // per node), not a stopwatch verdict: the layout runs on every committed
      // edit, so seconds here means a frozen window.
      expect(ms).toBeLessThan(300);
    },
  );
});
