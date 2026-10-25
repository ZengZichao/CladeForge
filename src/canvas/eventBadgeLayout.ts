// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Collision-aware layout for canvas annotations, in WORLD coordinates.
//
// Two things on the canvas are placed by hand-tuned offsets and can therefore
// collide with the rest of the drawing:
//
//   1. Node labels (NodeView). Layouts that shorten the depth axis (phylogram,
//      time-calibrated) can put a parent node so close to its child that the
//      parent's label runs straight through the child's label — e.g. the
//      aquatic demo sample's parent label once overlapped its children's labels in both
//      layouts. Labels are placed by `labelPlacement()` alone today, which has
//      no knowledge of the other labels.
//   2. Evolutionary-event badges (EventLayer). They are anchored on the branch
//      entering their node, which can drop them on top of a sibling branch's
//      label (BUG-4: the KI / AR badges sat on a parent label).
//
// This module owns the geometric solver for both: a greedy vertical stagger for
// labels, then a nearest-first ring search for badge groups that keeps badges
// clear of every label, node marker, time-axis text and already-placed badge.
// Everything is deterministic and pure, driven by the same placement /
// glyph-width rules as the renderer, so it is unit-testable without a DOM and
// pan/zoom cannot change the answer (a uniform view transform preserves
// intersection).
//
// The canvas computes its positions in TreeCanvas, which does not hand them to
// NodeView. `getCanvasCollisionPlan()` therefore recomputes the layout lazily,
// cached by project identity + overlay options, so every NodeView and EventLayer
// in one render pass shares a single computation. It is gated by node count so a
// very large tree never pays a second `computeLayout()` per edit; those trees
// keep the previous label placement (no regression, just no stagger).

import { computeLayout, type LayoutResult } from '../layout/autoLayout';
import { ERA_LANE_HEIGHT, planEraOverlay, type EraLevel } from '../layout/timescale';
import { EVENT_BADGE_RADIUS, eventBadgeExtent } from '../model/events';
import {
  resolveNodeStyle,
  type EvolutionaryEvent,
  type LayoutType,
  type NodeId,
  type Orientation,
  type Point,
  type Project,
  type TreeNode,
} from '../model/types';
import { branchMidpointOn } from './paths';
import { labelBoxForNode, type Box } from './labelBounds';

/** UI state the time-axis overlay is drawn from (mirrors TreeCanvas). */
export interface AxisOverlayOptions {
  showEras: boolean;
  eraLevel: EraLevel;
}

// --- box helpers -------------------------------------------------------------

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function translateBox(box: Box, dx: number, dy: number): Box {
  return { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
}

/** Union of every box in the list (null for an empty list). */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

// --- spatial hash ------------------------------------------------------------
// A label can be hundreds of world units wide, so a naive "compare against every
// placed box" pass is O(n²) and visibly slow on mid-sized trees. Cells hold box
// references; queries only touch the cells the candidate box covers.

const GRID_CELL = 64;

class BoxGrid {
  private readonly cells = new Map<string, Box[]>();

  insert(box: Box): void {
    const x0 = Math.floor(box.minX / GRID_CELL);
    const x1 = Math.floor(box.maxX / GRID_CELL);
    const y0 = Math.floor(box.minY / GRID_CELL);
    const y1 = Math.floor(box.maxY / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = `${ix},${iy}`;
        const list = this.cells.get(key);
        if (list) list.push(box);
        else this.cells.set(key, [box]);
      }
    }
  }

  intersects(box: Box): boolean {
    const x0 = Math.floor(box.minX / GRID_CELL);
    const x1 = Math.floor(box.maxX / GRID_CELL);
    const y0 = Math.floor(box.minY / GRID_CELL);
    const y1 = Math.floor(box.maxY / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(`${ix},${iy}`);
        if (!list) continue;
        for (const other of list) if (boxesIntersect(box, other)) return true;
      }
    }
    return false;
  }
}

// --- node labels: vertical stagger ------------------------------------------

/**
 * Half line-height as a multiple of font-size used for LABEL-vs-LABEL
 * collisions. A 14px SVG text is ~17px tall including ascender/descender, i.e.
 * half ≈ 0.61 em; 0.68 em leaves a small safety margin without demanding the
 * ~1 em half-height the fit-to-view box deliberately uses. Width uses the
 * shared `estimateLabelWidth` rule, which measures ~0.62 em for Latin glyphs
 * against an actual advance nearer 0.5 em — i.e. it errs wide, never narrow.
 */
const LABEL_COLLISION_HEIGHT_FACTOR = 0.68;
/** Breathing room between two stacked label rows (world px). */
const LABEL_NUDGE_GAP = 2;
/** How many stagger steps a label may be pushed before giving up. */
const LABEL_MAX_STEPS = 3;

/** A marker box a label must not be moved onto. */
export function nodeMarkerBox(
  project: Project,
  positions: Map<NodeId, Point>,
  node: TreeNode,
): Box | null {
  const pos = positions.get(node.id);
  if (!pos) return null;
  const style = resolveNodeStyle(node, project);
  // The collapse chevron extends past the marker on the depth axis.
  const extra = node.collapsed && node.childrenIds.length > 0 ? 10 : 0;
  const half = style.size + extra + style.strokeWidth / 2 + 1;
  return { minX: pos.x - half, minY: pos.y - half, maxX: pos.x + half, maxY: pos.y + half };
}

/** One labelled node's geometry, before and after staggering. */
interface LabelEntry {
  id: NodeId;
  box: Box;
  /** Vertical distance between stagger slots for this label. */
  step: number;
  movable: boolean;
}

/**
 * Greedily stagger labels vertically until no two rendered labels overlap.
 *
 * Ordering is top-to-bottom then left-to-right, so when a parent's label runs
 * into the child's label on the same row the CHILD (later in x order) yields and
 * drops/rises a line, which keeps the left-most label — the one whose natural
 * anchor the reader encounters first — where the layout put it. Axis text boxes
 * are obstacles too, so a label can never be pushed into the time-axis labels.
 * Node markers are deliberately NOT obstacles: the circular layout places a
 * label half a marker away by design, and treating the node's own dot as an
 * obstacle at that distance would stagger labels that are visually fine.
 *
 * Returns the vertical nudge per node (absent = 0). Rotated labels share the
 * conservative square box from `labelBounds` and are never moved.
 */
export function planLabelNudges(
  project: Project,
  positions: Map<NodeId, Point>,
  visible: Iterable<NodeId>,
  axisBoxes: readonly Box[] = [],
): Map<NodeId, number> {
  const entries: LabelEntry[] = [];
  const grid = new BoxGrid();
  for (const id of visible) {
    const node = project.nodes[id];
    if (!node) continue;
    const box = labelBoxForNode(project, positions, node, {
      widthFactor: 1,
      heightFactor: LABEL_COLLISION_HEIGHT_FACTOR,
    });
    if (!box) continue;
    const style = resolveNodeStyle(node, project);
    entries.push({
      id,
      box,
      step: Math.max(8, Math.round(style.fontSize * 2 * LABEL_COLLISION_HEIGHT_FACTOR + LABEL_NUDGE_GAP)),
      movable: !style.labelRotation,
    });
  }
  for (const b of axisBoxes) grid.insert(b);

  entries.sort(
    (a, b) =>
      a.box.minY - b.box.minY ||
      a.box.minX - b.box.minX ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const nudges = new Map<NodeId, number>();
  for (const entry of entries) {
    let dy = 0;
    if (entry.movable) {
      search: for (let k = 0; k <= LABEL_MAX_STEPS; k++) {
        for (const sign of k === 0 ? [0] : [-1, 1]) {
          const candidate = sign * k * entry.step;
          if (!grid.intersects(translateBox(entry.box, 0, candidate))) {
            dy = candidate;
            break search;
          }
        }
      }
    }
    nudges.set(entry.id, dy);
    grid.insert(translateBox(entry.box, 0, dy));
  }
  return nudges;
}

// --- time-axis text ----------------------------------------------------------
// The TimeAxis overlay lives in TreeCanvas/TimeAxis.tsx, which is outside this
// module's edit scope, so its label geometry is mirrored here from the same
// shared planner (`planEraOverlay`) it renders from. A badge must not land on
// era / period / environmental-event / tick text.

const TIME_AXIS_PAD = 24; // TimeAxis.tsx PAD
const TIME_AXIS_FONT = 11; // TimeAxis.tsx FONT
const TIME_AXIS_HALF_H = 7; // conservative half-height of an 11px line
const TIME_AXIS_ASCENT = 11;
const TIME_AXIS_DESCENT = 4;

/** World-space boxes of every text run the geological time-axis overlay draws. */
export function timeAxisTextBoxes(
  project: Project,
  layout: LayoutResult,
  opts: AxisOverlayOptions,
): Box[] {
  const info = layout.timeAxis;
  if (!info) return [];
  const b0 = info.breadthMin - TIME_AXIS_PAD;
  const b1 = info.breadthMax + TIME_AXIS_PAD;
  const plan = planEraOverlay(info, opts, project.environmentalEvents, TIME_AXIS_FONT);
  const boxes: Box[] = [];
  // Local copy of the width rule, kept next to the axis geometry (same numbers
  // as canvas/labelBounds.estimateLabelWidth, which timescale.ts re-exports).
  const estimateAxisWidth = (label: string): number => {
    let w = 0;
    for (const ch of label) w += ch.charCodeAt(0) > 0x2e7f ? TIME_AXIS_FONT : TIME_AXIS_FONT * 0.62;
    return w;
  };
  const horizontalText = (x: number, y: number, label: string): Box => {
    const w = estimateAxisWidth(label);
    return { minX: x - w / 2, minY: y - TIME_AXIS_ASCENT, maxX: x + w / 2, maxY: y + TIME_AXIS_DESCENT };
  };

  for (const l of plan.labels) {
    if (info.horizontal) {
      if (l.rotated) {
        // Rotated in-band label: runs downward from (center, b0+5).
        const w = estimateAxisWidth(l.label);
        boxes.push({
          minX: l.center - TIME_AXIS_ASCENT,
          minY: b0 + 5 - 2,
          maxX: l.center + TIME_AXIS_DESCENT,
          maxY: b0 + 5 + w,
        });
      } else {
        boxes.push(horizontalText(l.center, b0 - 6 - l.lane * ERA_LANE_HEIGHT, l.label));
      }
    } else if (l.rotated) {
      // Rotated in-band label: centred on (b0+11, center), running along y.
      const w = estimateAxisWidth(l.label);
      const ax = b0 + 11;
      boxes.push({ minX: ax - TIME_AXIS_HALF_H, minY: l.center - w / 2, maxX: ax + TIME_AXIS_HALF_H, maxY: l.center + w / 2 });
    } else {
      const x = b0 - 6 - l.lane * ERA_LANE_HEIGHT;
      const w = estimateAxisWidth(l.label);
      boxes.push({ minX: x - w, minY: l.center - TIME_AXIS_HALF_H, maxX: x, maxY: l.center + TIME_AXIS_HALF_H });
    }
  }

  for (const t of info.ticks) {
    const label = t.age === 0 ? 'Present' : `${t.age}`;
    const w = estimateAxisWidth(label);
    if (info.horizontal) {
      boxes.push({
        minX: t.coord - w / 2,
        minY: b1 + 13 - TIME_AXIS_ASCENT,
        maxX: t.coord + w / 2,
        maxY: b1 + 13 + TIME_AXIS_DESCENT,
      });
    } else {
      boxes.push({
        minX: b1 + 4,
        minY: t.coord - TIME_AXIS_HALF_H,
        maxX: b1 + 4 + w,
        maxY: t.coord + TIME_AXIS_HALF_H,
      });
    }
  }

  for (const e of plan.env) {
    const w = estimateAxisWidth(e.label);
    if (info.horizontal) {
      boxes.push(horizontalText(e.center, b0 - 6 - e.lane * ERA_LANE_HEIGHT, e.label));
    } else {
      const x = b0 - 6 - e.lane * ERA_LANE_HEIGHT;
      boxes.push({ minX: x - w, minY: e.center - TIME_AXIS_HALF_H, maxX: x, maxY: e.center + TIME_AXIS_HALF_H });
    }
  }

  return boxes;
}

// --- event badges: nearest-first ring search ---------------------------------

/** Badge box padding over the circle radius (half the widest stroke + slack). */
const BADGE_BOX_PAD = 1.5;
/** Minimum displacement (world px) at which a thin leader line is drawn. */
export const BADGE_LEADER_MIN_SHIFT = 13;
/** Ring-search step: the smallest useful nudge, then multiples of it. */
const BADGE_RING_STEP = 12;
const BADGE_RING_COUNT = 12;
/** Default space between stacked badges of one node (existing visual design). */
const BADGE_STACK_GAP = 16;

export interface BadgeLeader {
  /** Final (placed) group centre. */
  from: Point;
  /** Natural (on-branch) group centre the leader line points back to. */
  to: Point;
}

export interface EventAnchorPlan {
  anchors: Map<string, Point>;
  leaders: BadgeLeader[];
}

export interface EventAnchorInput {
  project: Project;
  events: EvolutionaryEvent[];
  positions: Map<NodeId, Point>;
  nodes: Record<NodeId, TreeNode>;
  culled: Set<NodeId>;
  orientation: Orientation;
  layoutType: LayoutType;
  /** Label stagger from {@link planLabelNudges}, so obstacles match the DOM. */
  labelNudges: ReadonlyMap<NodeId, number>;
  /** Time-axis text boxes from {@link timeAxisTextBoxes}. */
  axisBoxes: readonly Box[];
}

/**
 * Ordered unit directions for the ring search: the branch axis first (a badge
 * that slides along its own branch keeps its visual attachment), then the
 * perpendicular, then 16 compass directions so the search cannot dead-end in a
 * gap between two obstacles.
 */
function preferredDirections(
  layoutType: LayoutType,
  orientation: Orientation,
  anchor: Point,
): Point[] {
  const horizontal = orientation === 'LR' || orientation === 'RL';
  let along: Point;
  let perp: Point;
  if (layoutType === 'circular') {
    const len = Math.hypot(anchor.x, anchor.y);
    along = len > 1e-6 ? { x: anchor.x / len, y: anchor.y / len } : { x: 1, y: 0 };
    perp = { x: -along.y, y: along.x };
  } else if (horizontal) {
    along = orientation === 'LR' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    // Prefer ABOVE the branch: the row below a label is usually where the next
    // subtree's horizontal segment runs (for the aquatic sample that is the
    // deepest internal branch), so a badge dropped there would sit on a line.
    perp = { x: 0, y: -1 };
  } else {
    along = orientation === 'TB' ? { x: 0, y: 1 } : { x: 0, y: -1 };
    perp = { x: 1, y: 0 };
  }
  // Preference order: the branch axis both ways (keeps the badge on its own
  // branch), then the perpendicular (which side is preferred is set above),
  // then the diagonals and the remaining 22.5° steps so the ring cannot
  // dead-end in a gap between two obstacles.
  const out: Point[] = [along, { x: -along.x, y: -along.y }, perp, { x: -perp.x, y: -perp.y }];
  const angle = Math.atan2(along.y, along.x);
  for (const deg of [45, -45, 135, -135, 22.5, -22.5, 67.5, -67.5, 112.5, -112.5, 157.5, -157.5]) {
    const a = angle + (deg * Math.PI) / 180;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return out;
}

/**
 * Candidate translations of a badge group, ordered by distance from the natural
 * anchor (ring 0 = no movement). Same-radius candidates keep the direction
 * preference above, so a tie picks the most attached-looking position.
 */
export function badgeCandidateOffsets(
  layoutType: LayoutType,
  orientation: Orientation,
  anchor: Point,
): Point[] {
  const dirs = preferredDirections(layoutType, orientation, anchor);
  const out: Point[] = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= BADGE_RING_COUNT; ring++) {
    const r = ring * BADGE_RING_STEP;
    for (const d of dirs) out.push({ x: d.x * r, y: d.y * r });
  }
  return out;
}

/**
 * World-space box a badge occupies. The extent is the per-event size override
 * (falling back to EVENT_BADGE_RADIUS) scaled by the shape factor, so a
 * triangle's vertices claim the room they actually draw.
 */
function badgeBox(center: Point, extent: number = EVENT_BADGE_RADIUS): Box {
  const half = extent + BADGE_BOX_PAD;
  return { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
}

/**
 * The badge's natural anchor, mirroring the historical EventLayer placement:
 * node events sit on the branch entering the node, offset toward the node;
 * branch events sit on the branch midpoint. Events sharing a node+target stack
 * along the branch axis by index.
 */
export function naturalBadgeAnchor(
  event: EvolutionaryEvent,
  index: number,
  input: Pick<EventAnchorInput, 'positions' | 'nodes' | 'orientation' | 'layoutType'>,
): Point | null {
  const { positions, nodes, orientation, layoutType } = input;
  const p = positions.get(event.nodeId);
  if (!p) return null;
  const parentId = nodes[event.nodeId]?.parentId ?? null;
  const pp = parentId ? positions.get(parentId) : undefined;
  const horizontal = orientation === 'LR' || orientation === 'RL';
  if (event.target === 'branch') {
    const b = pp ? branchMidpointOn(pp, p, orientation, layoutType) : p;
    if (layoutType === 'circular' && pp) {
      const rc = Math.hypot(p.x, p.y) || 1;
      const ux = p.x / rc;
      const uy = p.y / rc;
      return { x: b.x + ux * index * BADGE_STACK_GAP, y: b.y + uy * index * BADGE_STACK_GAP };
    }
    return horizontal
      ? { x: b.x + index * BADGE_STACK_GAP, y: b.y }
      : { x: b.x, y: b.y + index * BADGE_STACK_GAP };
  }
  if (pp) {
    const m = branchMidpointOn(pp, p, orientation, layoutType);
    if (layoutType === 'circular') {
      const rc = Math.hypot(p.x, p.y) || 1;
      const ux = p.x / rc;
      const uy = p.y / rc;
      return { x: m.x + ux * (18 + index * BADGE_STACK_GAP), y: m.y + uy * (18 + index * BADGE_STACK_GAP) };
    }
    const dir = horizontal ? Math.sign(p.x - m.x) || 1 : Math.sign(p.y - m.y) || 1;
    return horizontal
      ? { x: m.x + dir * (18 + index * BADGE_STACK_GAP), y: m.y }
      : { x: m.x, y: m.y + dir * (18 + index * BADGE_STACK_GAP) };
  }
  // Root node: keep the simple near-node offset.
  return { x: p.x + 14 + index * BADGE_STACK_GAP, y: p.y + 16 };
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Place every event badge, resolving collisions by moving the WHOLE stack of a
 * node+target group together (so several events on one node still read as one
 * cluster) to the nearest candidate position that intersects nothing.
 *
 * Obstacles: every rendered node label (after the label stagger), every rendered
 * node marker, the time-axis text, and every badge already placed. When a group
 * has to leave the branch by more than {@link BADGE_LEADER_MIN_SHIFT} world px a
 * thin leader line back to the natural on-branch anchor is reported so the
 * badge's ownership stays readable.
 */
export function planEventAnchors(input: EventAnchorInput): EventAnchorPlan {
  const { project, events, positions, nodes, culled, orientation, layoutType, labelNudges, axisBoxes } = input;
  const anchors = new Map<string, Point>();
  const leaders: BadgeLeader[] = [];

  const grid = new BoxGrid();
  for (const id of culled) {
    const node = project.nodes[id];
    if (!node) continue;
    const label = labelBoxForNode(project, positions, node);
    if (label) grid.insert(translateBox(label, 0, labelNudges.get(id) ?? 0));
    const marker = nodeMarkerBox(project, positions, node);
    if (marker) grid.insert(marker);
  }
  for (const b of axisBoxes) grid.insert(b);

  // Group in event order so the stack index and the draw order are stable. The
  // cluster key is the NODE (not node+target): all events of one node move
  // together, so e.g. the demo sample's branch event KI and node event AR stay a pair
  // instead of being scattered to different sides of the branch. The stack index
  // used for the natural anchors still counts per node+target, exactly like the
  // historical renderer did, so events on the same target keep stacking.
  const groups: EvolutionaryEvent[][] = [];
  const byNode = new Map<NodeId, EvolutionaryEvent[]>();
  for (const e of events) {
    if (!culled.has(e.nodeId)) continue;
    if (!positions.get(e.nodeId)) continue;
    let list = byNode.get(e.nodeId);
    if (!list) {
      list = [];
      byNode.set(e.nodeId, list);
      groups.push(list);
    }
    list.push(e);
  }

  const anchorInput = { positions, nodes, orientation, layoutType };
  for (const group of groups) {
    const naturals: Point[] = [];
    const groupIdx = new Map<string, number>();
    for (const event of group) {
      const stackKey = `${event.nodeId}:${event.target}`;
      const idx = groupIdx.get(stackKey) ?? 0;
      groupIdx.set(stackKey, idx + 1);
      const n = naturalBadgeAnchor(event, idx, anchorInput);
      if (!n) break;
      naturals.push(n);
    }
    if (naturals.length !== group.length) continue;

    // One shared offset moves the whole stack, so the collision test uses the
    // largest badge extent in the group (a mixed-size stack clears as a block);
    // the final grid insertion is per-event so small badges don't over-claim.
    const groupExtent = Math.max(...group.map(eventBadgeExtent));
    const candidates = badgeCandidateOffsets(layoutType, orientation, naturals[0]);
    let chosen: Point | null = null;
    for (const offset of candidates) {
      let clear = true;
      for (const n of naturals) {
        if (grid.intersects(badgeBox({ x: n.x + offset.x, y: n.y + offset.y }, groupExtent))) {
          clear = false;
          break;
        }
      }
      if (clear) {
        chosen = offset;
        break;
      }
    }
    // Dense or tiny canvases can leave no free ring; the natural anchor (never a
    // crash) is still better than dropping the badge.
    const offset = chosen ?? { x: 0, y: 0 };
    const finals = naturals.map((n) => ({ x: n.x + offset.x, y: n.y + offset.y }));
    for (let i = 0; i < group.length; i++) anchors.set(group[i].id, finals[i]);
    for (let i = 0; i < finals.length; i++) grid.insert(badgeBox(finals[i], eventBadgeExtent(group[i])));
    if (Math.hypot(offset.x, offset.y) >= BADGE_LEADER_MIN_SHIFT) {
      leaders.push({ from: centroid(finals), to: centroid(naturals) });
    }
  }

  return { anchors, leaders };
}

// --- cached whole-canvas plan ------------------------------------------------

/**
 * Above this many nodes the canvas keeps the pre-fix placement: a second
 * `computeLayout()` per edit could otherwise cost tens of milliseconds on the
 * 10 000-tip trees the app supports. Small and medium documents get the fix.
 */
export const MAX_COLLISION_PLAN_NODES = 1200;

export interface CanvasCollisionPlan {
  nudges: Map<NodeId, number>;
  axisBoxes: Box[];
}

const planCache = new WeakMap<Project, Map<string, CanvasCollisionPlan | null>>();
const nodeCountCache = new WeakMap<Project, number>();
const lastPlanByOptions = new Map<string, CanvasCollisionPlan | null>();

function optionKey(opts: AxisOverlayOptions): string {
  return `${opts.showEras ? 1 : 0}:${opts.eraLevel}`;
}

function nodeCount(project: Project): number {
  const cached = nodeCountCache.get(project);
  if (cached !== undefined) return cached;
  const count = Object.keys(project.nodes).length;
  nodeCountCache.set(project, count);
  return count;
}

/**
 * Label staggering + time-axis text boxes for the current document, computed
 * lazily and cached. Returns null for documents above
 * {@link MAX_COLLISION_PLAN_NODES} (the caller falls back to un-staggered
 * labels and layout-position obstacles).
 */
export function getCanvasCollisionPlan(
  project: Project,
  opts: AxisOverlayOptions,
): CanvasCollisionPlan | null {
  const key = optionKey(opts);
  let byOptions = planCache.get(project);
  if (!byOptions) {
    byOptions = new Map();
    planCache.set(project, byOptions);
  }
  if (byOptions.has(key)) return byOptions.get(key) ?? null;

  let plan: CanvasCollisionPlan | null = null;
  if (nodeCount(project) <= MAX_COLLISION_PLAN_NODES) {
    // Only positions / visible / timeAxis are consumed here; the overlay options
    // affect the reserved bounds (and therefore fit-to-view), not the geometry.
    const layout = computeLayout(project);
    const axisBoxes = timeAxisTextBoxes(project, layout, opts);
    plan = { nudges: planLabelNudges(project, layout.positions, layout.visible, axisBoxes), axisBoxes };
  }
  byOptions.set(key, plan);
  lastPlanByOptions.set(key, plan);
  return plan;
}

/**
 * The most recently computed plan for these options, regardless of which project
 * revision produced it. During an active drag TreeCanvas overlays live positions
 * instead of recomputing the layout, and recomputing it here every pointer frame
 * would hand the browser back the cost that optimisation removed — so labels
 * keep their pre-drag stagger until the gesture commits.
 */
export function getLastCanvasCollisionPlan(opts: AxisOverlayOptions): CanvasCollisionPlan | null {
  return lastPlanByOptions.get(optionKey(opts)) ?? null;
}
