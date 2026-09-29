// Auto-layout engine built on d3-hierarchy.
//
// Produces world-space positions for every *visible* node (collapsed subtrees
// are skipped). Supports rectangular cladogram / phylogram and circular
// layouts, four orientations, and honours manual (pinned) node positions which
// override the computed coordinates. This is the "hybrid" model: structure
// reflows automatically, but anything the user has dragged stays put.
//
// The node tree is built by `buildHierarchy` rather than d3's `hierarchy()`.
// Both produce identical nodes, depths and heights, but d3's height pass costs
// O(nodes x depth): 2.1-5.5 s to lay out a 16 000-tip comb-shaped tree against
// 36 ms for a balanced tree of the same size, and this function re-runs on every
// committed edit and drag frame.

import { cluster, type HierarchyNode } from 'd3-hierarchy';
import { buildHierarchy } from './hierarchy';
import type { NodeId, Point, Project, TreeNode } from '../model/types';
import type { Bounds } from '../canvas/coords';
import { knownLength } from '../model/treeOps';
import { tr } from '../ui/strings';
import { buildTimeAxis, planEraOverlay, type EraLevel, type TimeAxisInfo } from './timescale';

/** UI state that decides how much room the time-axis overlay needs. */
export interface AxisOverlayOptions {
  showEras: boolean;
  eraLevel: EraLevel;
}

/**
 * A data problem the layout has to work around. Inventing what is missing — an
 * absent branch length read as 1, an absent age read as "present" — would draw an
 * unmeasured tree exactly like a measured one, so such a node is placed on the
 * topological grid instead and the fact is reported: the renderer greys the branch
 * out and the panels list the issue.
 */
export type LayoutIssueKind =
  /** Some branches carry no usable length; their depths are topological guesses. */
  | 'phylogram-partial-lengths'
  /** No branch carries a usable length: the "phylogram" is a cladogram. */
  | 'phylogram-no-lengths'
  /** Some nodes carry no usable age: they are not on the present-day line. */
  | 'time-partial-ages'
  /** The time layout has no positive age anywhere and degraded to a cladogram. */
  | 'time-no-ages'
  /** The circular layout does not consume ages at all. */
  | 'circular-ignores-ages'
  /** Child references revisit nodes, so the reachable structure is not a tree. */
  | 'cyclic-children'
  | 'invalid-pinned-position';

export interface LayoutIssue {
  kind: LayoutIssueKind;
  /** How many nodes / branches the issue covers. */
  count: number;
  message: string;
}

export interface LayoutResult {
  positions: Map<NodeId, Point>;
  visible: Set<NodeId>;
  bounds: Bounds;
  /** Depth (root = 0) of every visible node, for depth-based styling. */
  depths: Map<NodeId, number>;
  /** Largest depth in the visible tree (0 for a lone root). */
  maxDepth: number;
  /** Time-axis geometry, present only for the time-calibrated layout. */
  timeAxis?: TimeAxisInfo;
  /** World units per branch-length unit (phylogram only) — drives the scale bar. */
  depthScale?: number;
  /**
   * Nodes whose phylogram depth is UNKNOWN because their own or an ancestral
   * branch length is missing / zero / non-finite. They are laid out on the
   * topological grid; the renderer must mark them as unmeasured rather than
   * letting them read as real lengths.
   */
  unknownDepth?: Set<NodeId>;
  /** Nodes the time-calibrated layout could not date (same treatment). */
  unknownAge?: Set<NodeId>;
  /** Why anything above is non-empty, in words (panels / status bar). */
  issues?: LayoutIssue[];
}

function childrenAccessor(project: Project) {
  return (n: TreeNode): TreeNode[] =>
    n.collapsed
      ? []
      : (n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[]);
}

/** A node's age when it is a usable finite number, else undefined. */
function finiteAge(node: TreeNode): number | undefined {
  return typeof node.age === 'number' && Number.isFinite(node.age) ? node.age : undefined;
}

/**
 * Cumulative branch length from the root to each node.
 *
 * A missing length makes the node's depth — and every depth below it — unknown;
 * it is NOT substituted with 1. `unknown` therefore holds the whole
 * subtree under any unmeasured branch.
 */
function cumulativeBranchLengths(root: HierarchyNode<TreeNode>): {
  cum: Map<NodeId, number>;
  unknown: Set<NodeId>;
} {
  const cum = new Map<NodeId, number>();
  const unknown = new Set<NodeId>();
  // d3's each() is pre-order, so a parent is always classified before its children.
  root.each((hn) => {
    if (!hn.parent) {
      cum.set(hn.data.id, 0);
      return;
    }
    const bl = knownLength(hn.data.branchLength);
    if (bl === undefined || unknown.has(hn.parent.data.id)) {
      unknown.add(hn.data.id);
      cum.set(hn.data.id, Number.NaN);
      return;
    }
    cum.set(hn.data.id, (cum.get(hn.parent.data.id) ?? 0) + bl);
  });
  return { cum, unknown };
}

function mapToWorld(sibling: number, depth: number, orientation: Project['layout']['orientation']): Point {
  switch (orientation) {
    case 'LR':
      return { x: depth, y: sibling };
    case 'RL':
      return { x: -depth, y: sibling };
    case 'TB':
      return { x: sibling, y: depth };
    case 'BT':
      return { x: sibling, y: -depth };
    default:
      return { x: depth, y: sibling };
  }
}

function computeBounds(positions: Iterable<Point>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const p of positions) {
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!any) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function computeLayout(project: Project, axisOverlay?: AxisOverlayOptions): LayoutResult {
  const { layout } = project;
  const rootData = project.nodes[project.rootId];
  const positions = new Map<NodeId, Point>();
  const visible = new Set<NodeId>();
  const depths = new Map<NodeId, number>();

  if (!rootData) {
    return {
      positions,
      visible,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      depths,
      maxDepth: 0,
      unknownDepth: new Set<NodeId>(),
      unknownAge: new Set<NodeId>(),
      issues: [],
    };
  }

  const issues: LayoutIssue[] = [];

  // A tree drawn from this document can never visit more nodes than the
  // document holds, so a budget is what keeps a corrupt `childrenIds` cycle
  // from hanging the render: d3's own `hierarchy()` would walk it forever.
  // `validateProject` removes such references on load; this is the
  // last line of defence for an in-memory document that skipped that path, and
  // the budget is loose enough that a legitimate tree cannot reach it.
  const nodeBudget = Object.keys(project.nodes).length * 4 + 1024;
  const truncation: { node: TreeNode | null } = { node: null };
  const root = buildHierarchy<TreeNode>(rootData, childrenAccessor(project), {
    maxNodes: nodeBudget,
    onTruncated: (node) => {
      truncation.node = node;
    },
  });
  if (truncation.node) {
    const who = truncation.node.label || truncation.node.id;
    issues.push({
      kind: 'cyclic-children',
      count: 1,
      message: tr(
        `节点「${who}」以下的子引用重复访问了已有节点，可达结构不是树；布局遍历已在 ${nodeBudget} 个节点处截断，请检查父子关系或重新导入该树。`,
        `Child references under node "${who}" revisit nodes, so the reachable structure is not a tree; the layout traversal was cut off at ${nodeBudget} nodes. Check the parent/child links or re-import this tree.`,
      ),
    });
  }

  const sep = Math.max(8, layout.vGap);
  const depthGap = Math.max(20, layout.hGap);
  let maxDepth = 0;
  // Captured by the time-calibrated branch so the axis can be built post-shift.
  let timeDepthOf: ((age: number) => number) | null = null;
  let depthScale: number | undefined;
  let timeMaxAge = 0;
  const unknownDepth = new Set<NodeId>();
  const unknownAge = new Set<NodeId>();

  if (layout.type === 'circular') {
    // The circular layout draws radii from TOPOLOGICAL depth only: switching a
    // dated tree to it hides the whole time axis, so the fact is reported
    // rather than left for the reader to notice.
    const dated = Object.values(project.nodes).filter((n) => (finiteAge(n) ?? 0) > 0).length;
    if (dated > 0) {
      issues.push({
        kind: 'circular-ignores-ages',
        count: dated,
        message: tr(
          `圆形布局按拓扑深度计半径，不消费年代数据：${dated} 个带年代的节点在此布局下不反映年龄（年代轴、代/纪色带与环境事件带均不绘制）。`,
          `The circular layout sizes radii by topological depth and ignores ages: ${dated} dated nodes carry no time meaning here (no time axis, era bands or event bands).`,
        ),
      });
    }
    const radiusDepth = Math.max(1, root.height);
    const radius = radiusDepth * depthGap;
    cluster<TreeNode>().size([2 * Math.PI, radius]).separation(() => 1)(root);
    root.each((hn) => {
      visible.add(hn.data.id);
      depths.set(hn.data.id, hn.depth);
      if (hn.depth > maxDepth) maxDepth = hn.depth;
      const angle = (hn.x ?? 0) - Math.PI / 2; // start at top
      const r = hn.y ?? 0;
      positions.set(hn.data.id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
    });
  } else {
    // Dendrogram (cluster) layout for row (cross-axis) assignment. Unlike
    // d3.tree(), cluster() gives every LEAF its own evenly-spaced row, so a
    // shallow leaf can never share a row with a deeper cousin. That shared-row
    // collision is exactly what made a multifurcation whose middle child is
    // itself a clade render as a "box": the shallow sibling's elbow branch
    // became collinear with a grandchild's, overlapping into a rectangle.
    cluster<TreeNode>().nodeSize([sep, depthGap]).separation(() => 1)(root);

    // Default (cladogram): depth = topological depth. cluster() tip-aligns
    // every leaf onto the deepest level via hn.y, so drive the depth axis from
    // hn.depth instead to keep the ragged-tip cladogram look (each leaf drawn
    // at its own depth). hn.depth * depthGap is what a d3 tree layout would
    // assign (y = depth * depthGap), so only the row assignment differs.
    let depthCoord: (hn: HierarchyNode<TreeNode>) => number = (hn) => hn.depth * depthGap;
    // Grid row for a node the layout cannot place from data: its topological
    // depth. Used for unmeasured branches and undated nodes alike, so a gap in
    // the data shifts nothing but stays visibly flagged instead of being drawn
    // as a measured length.
    const gridDepth = (hn: HierarchyNode<TreeNode>) => hn.depth * depthGap;
    if (layout.type === 'rectangular-phylogram') {
      const { cum, unknown } = cumulativeBranchLengths(root);
      for (const id of unknown) unknownDepth.add(id);
      let maxCum = 0;
      for (const v of cum.values()) if (Number.isFinite(v) && v > maxCum) maxCum = v;
      const maxDepthPx = root.height * depthGap;
      if (maxCum > 0) {
        const scale = maxDepthPx / maxCum;
        depthScale = scale;
        depthCoord = (hn) => {
          const c = cum.get(hn.data.id);
          if (c === undefined || !Number.isFinite(c)) return gridDepth(hn);
          return c * scale;
        };
        if (unknown.size > 0) {
          issues.push({
            kind: 'phylogram-partial-lengths',
            count: unknown.size,
            message: tr(
              `${unknown.size} 条分支（含其下游）没有可用枝长，已按拓扑等长摆放并标记为未知，未按 1 计入累加。`,
              `${unknown.size} branches (and everything below them) have no usable branch length; they are laid out on the topological grid and flagged unknown — not counted as length 1.`,
            ),
          });
        }
      } else {
        // Nothing measurable at all: the phylogram degrades to a
        // cladogram and the scale bar disappears — name both facts.
        for (const hn of root) if (hn.parent) unknownDepth.add(hn.data.id);
        depthScale = undefined;
        if (unknownDepth.size > 0) {
          issues.push({
            kind: 'phylogram-no-lengths',
            count: unknownDepth.size,
            message: tr(
              '工程内没有任何可用枝长（缺失、0 或负值），分支图已退化为等长枝序图，比例尺不显示。',
              'No usable branch length exists in this document (missing, zero or negative), so the phylogram degraded to an equal-length cladogram and the scale bar is hidden.',
            ),
          });
        }
      }
    } else if (layout.type === 'time-calibrated') {
      let maxAge = 0;
      let undatable = 0;
      const undated: NodeId[] = [];
      root.each((hn) => {
        const a = finiteAge(hn.data);
        if (a === undefined || a <= 0) undatable += 1;
        if (a === undefined) {
          undated.push(hn.data.id);
          return;
        }
        if (a > maxAge) maxAge = a;
      });
      if (maxAge > 0) {
        const depthPx = Math.max(1, root.height) * depthGap;
        const pxPerUnit = depthPx / maxAge;
        timeMaxAge = maxAge;
        // Oldest (largest age) sits at depth 0 (root side); present (age 0) is farthest.
        timeDepthOf = (age) => (maxAge - age) * pxPerUnit;
        // Undated nodes get the pseudo-age of their topological level, and are
        // flagged: reading an absent age as 0 (`age ?? 0`) would nail every undated
        // node — including whole internal clades — to the 0 Ma line and draw an
        // unmeasured tree as a fresh chronogram.
        const maxLevel = Math.max(1, root.height);
        const ageOf = (hn: HierarchyNode<TreeNode>): number | undefined => finiteAge(hn.data);
        for (const id of undated) unknownAge.add(id);
        depthCoord = (hn) => {
          const a = ageOf(hn);
          if (a === undefined) {
            return timeDepthOf!(((maxLevel - hn.depth) / maxLevel) * maxAge);
          }
          return timeDepthOf!(a);
        };
        if (undated.length > 0) {
          issues.push({
            kind: 'time-partial-ages',
            count: undated.length,
            message: tr(
              `${undated.length} 个可见节点没有年龄，已按拓扑层级暂放并标记为未知，未当作 0 Ma（现今）绘制。`,
              `${undated.length} visible nodes have no age; they are parked on their topological level and flagged unknown rather than drawn as 0 Ma (present).`,
            ),
          });
        }
      } else {
        // No positive age anywhere (nothing set, or only "0 Ma"): the time chart
        // silently becomes a cladogram. Say so instead of letting the layout name
        // claim something the drawing does not show.
        for (const id of undated) unknownAge.add(id);
        issues.push({
          kind: 'time-no-ages',
          count: undatable,
          message: tr(
            `没有可用的正年龄（${undatable} 个可见节点缺失或为 0），时间校准布局已退化为等长枝序图。`,
            `No usable positive age (${undatable} visible nodes missing or zero), so the time-calibrated layout degraded to an equal-length cladogram.`,
          ),
        });
      }
    }

    root.each((hn) => {
      visible.add(hn.data.id);
      depths.set(hn.data.id, hn.depth);
      if (hn.depth > maxDepth) maxDepth = hn.depth;
      positions.set(hn.data.id, mapToWorld(hn.x ?? 0, depthCoord(hn), layout.orientation));
    });
  }

  // Normalise auto-computed coordinates so they start near the origin — but
  // NOT for the circular layout: its polar geometry (arcs / radii) is relative
  // to the world origin, and translating the tree would move the centre away
  // from (0,0) and break the arc construction in circularPath().
  const autoBounds = computeBounds(positions.values());
  const shiftX = layout.type === 'circular' ? 0 : -autoBounds.minX;
  const shiftY = layout.type === 'circular' ? 0 : -autoBounds.minY;
  for (const [id, p] of positions) {
    positions.set(id, { x: p.x + shiftX, y: p.y + shiftY });
  }

  // Manual/pinned positions (absolute world coords) override the auto result.
  // A non-finite x/y — from a hand-edited or foreign document — must not be
  // written straight through, because that renders `translate(NaN NaN)`: one
  // node, silently invisible and unselectable, while `bounds` stays finite so
  // "fit" never exposes it. Such a pin is dropped, and the node falls back to
  // its auto-computed position.
  let badPins = 0;
  for (const id of visible) {
    const pin = project.nodes[id]?.position;
    if (!pin) continue;
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) {
      badPins += 1;
      continue;
    }
    positions.set(id, { x: pin.x, y: pin.y });
  }
  if (badPins > 0) {
    issues.push({
      kind: 'invalid-pinned-position',
      count: badPins,
      message: tr(
        `${badPins} 个节点的手工坐标不是有限数值（NaN/Infinity），已忽略并回落到自动布局；该节点原先在画布上不可见、不可选中。`,
        `${badPins} node(s) carry a non-finite manual position (NaN/Infinity); ignored, falling back to the automatic layout. They were previously invisible and unselectable.`,
      ),
    });
  }

  let bounds = computeBounds(positions.values());

  // Time-axis geometry (only for the time-calibrated layout with ages set).
  let timeAxis: TimeAxisInfo | undefined;
  if (layout.type === 'time-calibrated' && timeDepthOf && timeMaxAge > 0) {
    const horizontal = layout.orientation === 'LR' || layout.orientation === 'RL';
    const shift = horizontal ? shiftX : shiftY;
    const ageToCoord = (age: number) => {
      const w = mapToWorld(0, timeDepthOf!(age), layout.orientation);
      return (horizontal ? w.x : w.y) + shift;
    };
    timeAxis = buildTimeAxis(
      timeMaxAge,
      ageToCoord,
      layout.orientation,
      layout.timeUnit ?? 'Ma',
      horizontal ? bounds.minY : bounds.minX,
      horizontal ? bounds.maxY : bounds.maxX,
    );

    // Reserve room for the axis overlay so fit-to-view and exports never
    // crop it. Everything sits on the breadth-low side: era/event label rows
    // stack outward from the band edge (above for LR/RL, left for TB/BT —
    // including the label text width, which runs along the axis only in the
    // horizontal case), plus the tick-label row on the far side.
    const plan = planEraOverlay(
      timeAxis,
      { showEras: axisOverlay?.showEras ?? false, eraLevel: axisOverlay?.eraLevel ?? 'both' },
      project.environmentalEvents,
    );
    const lanes = [...plan.labels, ...plan.env]
      .filter((l) => l.lane >= 0)
      .map((l) => l.lane);
    // PAD 24 + lane gap 6 + 14 per lane + ascent, plus a width allowance for
    // the vertical axis where labels extend sideways from their lane.
    const lowSide = lanes.length ? 30 + 14 * (Math.max(...lanes) + 1) + (timeAxis.horizontal ? 0 : 66) : 0;
    // Tick numerals sit just beyond the band edge opposite the label rows:
    // below the bands for LR/RL, right of them for TB/BT (PAD 24 + offset).
    const highSide = timeAxis.horizontal ? 44 : 56;
    bounds = {
      minX: bounds.minX - (timeAxis.horizontal ? 0 : lowSide),
      minY: bounds.minY - (timeAxis.horizontal ? lowSide : 0),
      maxX: bounds.maxX + (timeAxis.horizontal ? 0 : highSide),
      maxY: bounds.maxY + (timeAxis.horizontal ? highSide : 0),
    };
  }

  return { positions, visible, bounds, depths, maxDepth, timeAxis, depthScale, unknownDepth, unknownAge, issues };
}
