// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// EMBEDDED reconciliation layout (docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md §5).
//
// One coordinate system, one viewport: the species tree is the only skeleton —
// each species branch is drawn as a THICK horizontal "tube" (plus a vertical
// hub bar at every internal node, so the whole species tree reads as thick
// wood) — and the gene tree's THIN lineages are nested INSIDE those tubes.
// Speciation σ = children enter different sub-tubes; duplication δ = parallel
// lanes in the same tube; horizontal transfer τ = a cross-tube arc; loss λ = a
// stub dying at a fork. Everything is computed once in world coordinates;
// pan/zoom is a pure projection (the canvas never re-runs this file).
//
// Geometry is built in two passes so lane offsets can be baked into path data:
// decomposition first records WHAT to draw (drafts + lane spans), lane
// assignment then numbers the lanes per tube, and only afterwards are the SVG
// path strings rendered from the final world coordinates. Deterministic — the
// same input always produces the same layout.

import type {
  GeneNodeAssumption,
  NodeId,
  Point,
  Project,
  ReconEventType,
  TreeNode,
} from '../model/types';
import type { LayoutResult } from './autoLayout';
import {
  lossesAlongSpeciesPath,
  resolveEffectiveGenePlacements,
  resolveTransferDonor,
  speciesPathBetween,
  type EffectivePlacements,
} from '../model/reconPlacements';
import { estimateLabelWidth } from '../canvas/labelBounds';

// --- tunables -----------------------------------------------------------------

export const EMBEDDED_MIN_SCALE = 0.15;
export const EMBEDDED_MAX_SCALE = 4;

export interface EmbeddedLayoutOptions {
  tubeWidth: number;
  laneGap: number;
  minTubeWidth: number;
  maxTubeWidth: number;
  showTransferArcs: boolean;
  showLossStubs: boolean;
}

export function defaultEmbeddedLayoutOptions(
  tubeWidth = 18,
  laneGap = 3,
): EmbeddedLayoutOptions {
  return {
    tubeWidth,
    laneGap,
    minTubeWidth: 12,
    maxTubeWidth: 32,
    showTransferArcs: true,
    showLossStubs: true,
  };
}

/** Force the geometry the nested view needs: horizontal, generous spacing. */
export function prepareEmbeddedSpeciesDoc(doc: Project): Project {
  const type = doc.layout.type === 'circular' ? 'rectangular-cladogram' : doc.layout.type;
  return {
    ...doc,
    layout: {
      ...doc.layout,
      type,
      orientation: 'LR',
      vGap: Math.max(doc.layout.vGap, 88),
      hGap: Math.max(doc.layout.hGap, 180),
    },
  };
}

// --- scene types ----------------------------------------------------------------

export interface EmbeddedTube {
  /** Species branch id = its child node id. */
  branchId: NodeId;
  parentId: NodeId;
  /** Tube centreline: (x0, y) → (x1, y); t=0 at the parent end, t=1 at the child end. */
  x0: number;
  y: number;
  x1: number;
  width: number;
  lanes: number;
  path: string;
}

export interface EmbeddedHub {
  /** Parent species node id; the hub spans its direct children's y range. */
  parentId: NodeId;
  x: number;
  /** The parent node's own y (a hub joint / mask circle centre). */
  y: number;
  y0: number;
  y1: number;
  width: number;
  path: string;
  nodeRadius: number;
}

export interface EmbeddedGeneNode {
  geneNodeId: NodeId;
  speciesNodeId: NodeId | null;
  /** Incoming species branch hosting this node; species root (or unmapped) = null. */
  hostBranchId: NodeId | null;
  /** 0..1 within the host branch (0 = parent end); meaningless when hostBranchId is null. */
  t: number;
  lane: number;
  x: number;
  y: number;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  placementSource: 'assumption' | 'tip-label' | 'inferred-mrca' | 'none';
  /** true = mapped but event unresolved (dashed / grey). */
  unresolved: boolean;
  /** true = display-inferred position; never written into assumptions. */
  inferred: boolean;
  unmapped: boolean;
  /** true = the default t was chosen by layout (no explicit branchFraction). */
  autoPositioned: boolean;
  /** true = parent/child order on one branch could not be satisfied. */
  orderConflict?: boolean;
}

export interface EmbeddedGeneSegment {
  id: string;
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId;
  hostBranchId: NodeId;
  t0: number;
  t1: number;
  lane: number;
  d: string;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  dashed: boolean;
  emphasis: 'normal' | 'muted';
}

export interface EmbeddedTransferArc {
  geneNodeId: NodeId;
  donorGeneNodeId: NodeId | null;
  recipientGeneNodeId: NodeId | null;
  donorBranchId: NodeId | null;
  recipientBranchId: NodeId | null;
  donorSpeciesNodeId: NodeId | null;
  recipientSpeciesNodeId: NodeId;
  from: Point;
  to: Point;
  d: string;
  timeFeasible: boolean | null; // null = no age data, cannot judge
}

export interface EmbeddedLossMark {
  /** A gene node contributing to (or asserting) this loss. */
  geneNodeId: NodeId;
  atSpeciesNodeId: NodeId;
  branchId: NodeId | null;
  count: number;
  x: number;
  y: number;
  source: 'structural' | 'asserted';
  /** true = this structural loss is NOT covered by an asserted count. */
  inferred: boolean;
  /** true = asserted < structural minimum (validation reports `loss-shortfall`). */
  shortfall: boolean;
}

export interface EmbeddedOrphan {
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId | null;
  reason: 'unmapped-tip' | 'unmapped-internal' | 'unknown-path';
  x: number;
  y: number;
}

export interface EmbeddedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type EmbeddedLayoutIssue =
  | { kind: 'lane-overflow'; branchId: NodeId; lanes: number; cap: number }
  | { kind: 'unmapped-gene-node'; geneNodeId: NodeId }
  | { kind: 'dangling-assumption'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'hidden-host'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'unknown-path'; geneNodeId: NodeId }
  | { kind: 'embedding-order-conflict'; geneNodeId: NodeId }
  | { kind: 'infeasible-lateral'; geneNodeId: NodeId }
  | { kind: 'donor-unknown'; geneNodeId: NodeId };

export interface EmbeddedReconInput {
  speciesDoc: Project;
  speciesLayout: LayoutResult;
  geneDoc: Project;
  assumptions: Record<NodeId, GeneNodeAssumption>;
  options: EmbeddedLayoutOptions;
}

export interface EmbeddedReconLayout {
  speciesLayout: LayoutResult;
  /** Key = species branch id (= child species node id). */
  tubes: Map<NodeId, EmbeddedTube>;
  /** Key = parent species node id. */
  hubs: Map<NodeId, EmbeddedHub>;
  /** Key = gene node id. */
  placements: Map<NodeId, EmbeddedGeneNode>;
  segments: EmbeddedGeneSegment[];
  transfers: EmbeddedTransferArc[];
  losses: EmbeddedLossMark[];
  orphans: EmbeddedOrphan[];
  bounds: EmbeddedBounds;
  issues: EmbeddedLayoutIssue[];
  stats: {
    maxLane: number;
    overflowBranches: number;
    unmapped: number;
    inferred: number;
  };
}

// --- geometry helpers ------------------------------------------------------------

export function pointOnTube(tube: EmbeddedTube, t: number, laneOffset = 0): Point {
  const tt = Math.max(0, Math.min(1, t));
  return { x: tube.x0 + (tube.x1 - tube.x0) * tt, y: tube.y + laneOffset };
}

/** In-tube path from t0 to t1 at `laneOffset` (a horizontal line for LR tubes). */
export function lanePath(
  tube: EmbeddedTube,
  t0: number,
  t1: number,
  laneOffset = 0,
): string {
  const a = pointOnTube(tube, t0, laneOffset);
  const b = pointOnTube(tube, t1, laneOffset);
  return `M ${round2(a.x)} ${round2(a.y)} L ${round2(b.x)} ${round2(b.y)}`;
}

/** Nearest tube hit for a world point (Alt+click / hover); null when outside. */
export function hitTestTube(
  tubes: Iterable<EmbeddedTube>,
  p: Point,
  tolerance = 6,
): { tube: EmbeddedTube; t: number; distance: number } | null {
  let best: { tube: EmbeddedTube; t: number; distance: number } | null = null;
  for (const tube of tubes) {
    const half = tube.width / 2 + tolerance;
    const lo = Math.min(tube.x0, tube.x1) - tolerance;
    const hi = Math.max(tube.x0, tube.x1) + tolerance;
    if (p.x < lo || p.x > hi) continue;
    if (Math.abs(p.y - tube.y) > half) continue;
    const span = tube.x1 - tube.x0;
    const t = span === 0 ? 0 : (p.x - tube.x0) / span;
    const distance = Math.abs(p.y - tube.y);
    if (!best || distance < best.distance) {
      best = { tube, t: Math.max(0, Math.min(1, t)), distance };
    }
  }
  return best;
}

export function fitEmbeddedBounds(
  bounds: EmbeddedBounds,
  width: number,
  height: number,
): { tx: number; ty: number; scale: number } {
  const pad = 24;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const s = Math.max(
    EMBEDDED_MIN_SCALE,
    Math.min(EMBEDDED_MAX_SCALE, Number.isFinite(scale) ? scale : 1),
  );
  return {
    scale: s,
    tx: (width - bw * s) / 2 - bounds.minX * s,
    ty: (height - bh * s) / 2 - bounds.minY * s,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function laneOffsetOf(lane: number, laneCount: number, laneGap: number): number {
  return (lane - (laneCount - 1) / 2) * laneGap;
}

// --- main layout ------------------------------------------------------------------

export function computeEmbeddedReconLayout(input: EmbeddedReconInput): EmbeddedReconLayout {
  const { speciesDoc, speciesLayout, geneDoc, assumptions, options } = input;

  const effective0 = resolveEffectiveGenePlacements(speciesDoc, geneDoc, assumptions);

  const issues: EmbeddedLayoutIssue[] = [];
  for (const gid of effective0.danglingAssumptions) {
    issues.push({
      kind: 'dangling-assumption',
      geneNodeId: gid,
      speciesNodeId: assumptions[gid]?.speciesNode ?? '',
    });
  }
  // Hidden hosts: a placement onto a species node the layout does not render
  // (collapsed subtree) cannot be drawn — drop it (the node becomes an orphan)
  // and report, mirroring the side-by-side "invisible targets get no mapping
  // line" rule.
  const effective: EffectivePlacements = {
    byGeneNode: new Map(),
    inferredGeneNodes: [],
    unmappedGeneNodes: [...effective0.unmappedGeneNodes],
    danglingAssumptions: [...effective0.danglingAssumptions],
  };
  for (const [gid, pl] of effective0.byGeneNode) {
    if (!speciesLayout.visible.has(pl.speciesNodeId)) {
      issues.push({ kind: 'hidden-host', geneNodeId: gid, speciesNodeId: pl.speciesNodeId });
      effective.unmappedGeneNodes.push(gid);
      continue;
    }
    effective.byGeneNode.set(gid, pl);
    if (pl.inferred) effective.inferredGeneNodes.push(gid);
  }

  const tubes = buildTubes(speciesDoc, speciesLayout);
  const placements = placeGeneNodes(speciesDoc, speciesLayout, geneDoc, assumptions, effective, tubes);
  const decomposed = decomposeGeneEdges(
    speciesDoc,
    geneDoc,
    assumptions,
    effective,
    placements,
    tubes,
    options,
    issues,
  );

  assignLanes(tubes, placements, decomposed.spans, options, issues);
  const hubs = buildHubs(speciesDoc, speciesLayout, tubes, options);
  updatePlacementPositions(placements, tubes, options);

  const segments = decomposed.buildSegments();
  const transfers = decomposed.buildTransfers();
  const losses = buildLosses(
    speciesDoc,
    speciesLayout,
    assumptions,
    decomposed.edgeLosses,
    placements,
    options,
  );
  const orphans = buildOrphans(geneDoc, placements, decomposed.orphanEdges, speciesLayout, issues);

  const scene: EmbeddedReconLayout = {
    speciesLayout,
    tubes,
    hubs,
    placements,
    segments,
    transfers,
    losses,
    orphans,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    issues,
    stats: {
      maxLane: Math.max(0, ...[...tubes.values()].map((t) => t.lanes)),
      overflowBranches: issues.filter((i) => i.kind === 'lane-overflow').length,
      unmapped: orphans.length,
      inferred: effective.inferredGeneNodes.length,
    },
  };
  return { ...scene, bounds: computeEmbeddedBounds(scene, speciesDoc, geneDoc) };
}

// --- tubes & hubs -----------------------------------------------------------------

function buildTubes(species: Project, layout: LayoutResult): Map<NodeId, EmbeddedTube> {
  const tubes = new Map<NodeId, EmbeddedTube>();
  for (const id of layout.visible) {
    const n = species.nodes[id];
    if (!n || !n.parentId) continue;
    const p = layout.positions.get(id);
    const pp = layout.positions.get(n.parentId);
    if (!p || !pp) continue;
    tubes.set(id, {
      branchId: id,
      parentId: n.parentId,
      x0: pp.x,
      y: p.y,
      x1: p.x,
      width: 0, // set by assignLanes
      lanes: 1,
      path: '',
    });
  }
  return tubes;
}

function buildHubs(
  species: Project,
  layout: LayoutResult,
  tubes: Map<NodeId, EmbeddedTube>,
  options: EmbeddedLayoutOptions,
): Map<NodeId, EmbeddedHub> {
  const hubs = new Map<NodeId, EmbeddedHub>();
  for (const id of layout.visible) {
    const n = species.nodes[id];
    if (!n || n.childrenIds.length === 0) continue;
    const self = layout.positions.get(id);
    if (!self) continue;
    const childTubes = n.childrenIds
      .map((c) => tubes.get(c))
      .filter((t): t is EmbeddedTube => Boolean(t));
    if (childTubes.length === 0) continue;
    const y0 = Math.min(...childTubes.map((t) => t.y), self.y);
    const y1 = Math.max(...childTubes.map((t) => t.y), self.y);
    const width = Math.max(
      options.minTubeWidth,
      ...childTubes.map((t) => t.width || options.minTubeWidth),
    );
    hubs.set(id, {
      parentId: id,
      x: self.x,
      y: self.y,
      y0,
      y1,
      width,
      path: `M ${round2(self.x)} ${round2(y0)} L ${round2(self.x)} ${round2(y1)}`,
      nodeRadius: Math.max(width / 2, 4.5),
    });
  }
  return hubs;
}

// --- placement ----------------------------------------------------------------------

/**
 * Host branch + along-branch position for every placed gene node. Deterministic
 * defaults per §5.4 of the plan; an explicit `branchFraction` overrides the
 * default `t` (parent-order constraints are enforced afterwards).
 */
function placeGeneNodes(
  species: Project,
  speciesLayout: LayoutResult,
  geneDoc: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
  effective: EffectivePlacements,
  tubes: Map<NodeId, EmbeddedTube>,
): Map<NodeId, EmbeddedGeneNode> {
  const placements = new Map<NodeId, EmbeddedGeneNode>();
  const isTipOf = (id: NodeId) => (geneDoc.nodes[id]?.childrenIds.length ?? 0) === 0;

  // Child placement spread of each gene node (for the inferred-MRCA default).
  const childHosts = new Map<NodeId, NodeId[]>();
  for (const n of Object.values(geneDoc.nodes)) {
    const hosts: NodeId[] = [];
    for (const cid of n.childrenIds) {
      const cp = effective.byGeneNode.get(cid);
      if (cp) hosts.push(cp.speciesNodeId);
    }
    childHosts.set(n.id, hosts);
  }
  const spreadsAcrossSubBranches = (speciesNodeId: NodeId, hosts: NodeId[]): boolean => {
    if (hosts.length < 2) return false;
    const sn = species.nodes[speciesNodeId];
    if (!sn) return false;
    const branches = hosts.map((h) => {
      if (h === speciesNodeId) return speciesNodeId;
      for (const cid of sn.childrenIds) {
        let cur: NodeId | null = h;
        const seen = new Set<NodeId>();
        while (cur !== null && !seen.has(cur)) {
          seen.add(cur);
          if (cur === cid) return cid;
          cur = species.nodes[cur]?.parentId ?? null;
        }
      }
      return h;
    });
    return new Set(branches).size === branches.length;
  };

  for (const n of Object.values(geneDoc.nodes)) {
    const pl = effective.byGeneNode.get(n.id);
    const kind: 'tip' | 'internal' = isTipOf(n.id) ? 'tip' : 'internal';
    if (!pl) {
      placements.set(n.id, {
        geneNodeId: n.id,
        speciesNodeId: null,
        hostBranchId: null,
        t: 0,
        lane: 0,
        x: 0,
        y: 0,
        event: null,
        kind,
        placementSource: 'none',
        unresolved: kind === 'internal',
        inferred: false,
        unmapped: true,
        autoPositioned: true,
      });
      continue;
    }
    const a = assumptions[n.id];
    const event = kind === 'internal' ? (a?.event ?? null) : null;
    const unresolved = kind === 'internal' && !event;
    const hostBranchId = branchHost(species, pl.speciesNodeId);
    let t: number;
    let autoPositioned = true;
    if (hostBranchId === null) {
      t = 0;
    } else if (
      a?.branchFraction !== undefined &&
      Number.isFinite(a.branchFraction) &&
      a.speciesNode === pl.speciesNodeId
    ) {
      t = Math.max(0, Math.min(1, a.branchFraction));
      autoPositioned = false;
    } else if (kind === 'internal' && event === 'speciation') {
      t = 1.0; // the fork happens AT the species node
    } else if (kind === 'internal' && event === 'duplication') {
      t = 0.55; // room to fork inside the tube
    } else if (kind === 'internal' && event === 'transfer') {
      t = 0.75; // arrival point of the incoming arc
    } else if (kind === 'internal' && unresolved) {
      t = 0.9;
    } else if (kind === 'internal' && pl.inferred) {
      t = spreadsAcrossSubBranches(pl.speciesNodeId, childHosts.get(n.id) ?? []) ? 1.0 : 0.55;
    } else {
      // Tips and the gene root anchor at the mapped node's end.
      t = 1.0;
    }
    const tube = hostBranchId ? tubes.get(hostBranchId) : undefined;
    const speciesPos =
      hostBranchId === null ? speciesLayout.positions.get(pl.speciesNodeId) : undefined;
    placements.set(n.id, {
      geneNodeId: n.id,
      speciesNodeId: pl.speciesNodeId,
      hostBranchId,
      t,
      lane: 0,
      x: tube ? tube.x1 : (speciesPos?.x ?? 0),
      y: tube ? tube.y : (speciesPos?.y ?? 0),
      event,
      kind,
      placementSource: pl.source,
      unresolved,
      inferred: pl.inferred,
      unmapped: false,
      autoPositioned,
    });
  }

  enforceParentOrder(geneDoc, placements);
  return placements;
}

/** The branch entering `speciesNodeId`, or null at the species root. */
function branchHost(species: Project, speciesNodeId: NodeId): NodeId | null {
  return species.nodes[speciesNodeId]?.parentId != null ? speciesNodeId : null;
}

/**
 * Within one host branch a gene PARENT must sit closer to the parent end than
 * its child (parent t < child t). A violated parent is compressed toward the
 * parent end (floor 0.15); a still-impossible pair keeps the child's reading
 * and flags the parent (drawn dashed, reported as `embedding-order-conflict`).
 */
function enforceParentOrder(
  geneDoc: Project,
  placements: Map<NodeId, EmbeddedGeneNode>,
): void {
  const order: TreeNode[] = [];
  const root = geneDoc.nodes[geneDoc.rootId];
  if (root) {
    const seen = new Set<NodeId>([root.id]);
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      order.push(n);
      for (let i = n.childrenIds.length - 1; i >= 0; i -= 1) {
        const c = geneDoc.nodes[n.childrenIds[i]];
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        stack.push(c);
      }
    }
  }
  // Post-order: settle deepest pairs first so a chain resolves in one pass.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const p = placements.get(n.id);
    if (!p || !p.hostBranchId) continue;
    for (const cid of n.childrenIds) {
      const c = placements.get(cid);
      if (!c || c.hostBranchId !== p.hostBranchId) continue;
      if (p.t < c.t) continue;
      const squeezed = Math.max(0.15, c.t - 0.1);
      if (squeezed < c.t) {
        p.t = squeezed;
      } else {
        p.orderConflict = true;
      }
    }
  }
}

function updatePlacementPositions(
  placements: Map<NodeId, EmbeddedGeneNode>,
  tubes: Map<NodeId, EmbeddedTube>,
  options: EmbeddedLayoutOptions,
): void {
  for (const p of placements.values()) {
    const tube = p.hostBranchId ? tubes.get(p.hostBranchId) : undefined;
    if (tube) {
      const off = laneOffsetOf(p.lane, tube.lanes, options.laneGap);
      const pt = pointOnTube(tube, p.t, off);
      p.x = pt.x;
      p.y = pt.y;
    }
  }
}

// --- edge decomposition --------------------------------------------------------------

interface Span {
  branchId: NodeId;
  /** Interval on the tube (direction-insensitive). */
  a: number;
  b: number;
  lane: number;
  /** Node placeholder: reserves a slot around a gene node. */
  nodeId?: NodeId;
  /** Edge span arriving at this gene node → inherits the node's lane. */
  arriveNodeId?: NodeId;
}

type DraftStyle = 'tail' | 'tube' | 'straight' | 'infeasible';

interface Draft {
  parentGeneNodeId: NodeId;
  geneNodeId: NodeId;
  style: DraftStyle;
  /** branch the horizontal runs in (tail/tube). */
  branchId: NodeId | null;
  t0: number;
  t1: number;
  /** Lane source: 'parent' = the parent gene node's lane, 'span' = the draft's span. */
  laneSrc: 'parent' | 'span';
  span?: Span;
  dashed: boolean;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
}

interface Decomposed {
  spans: Span[];
  orphanEdges: { geneNodeId: NodeId; parentGeneNodeId: NodeId | null }[];
  /** child gene node → (species fork → structural loss count). */
  edgeLosses: Map<NodeId, Map<NodeId, number>>;
  buildSegments: () => EmbeddedGeneSegment[];
  buildTransfers: () => EmbeddedTransferArc[];
}

/**
 * Turn every gene edge into tube spans + drafts. The child's
 * `event === 'transfer'` short-circuits the species-path walk: a transfer is
 * annotated by a donor→recipient arc plus a τ dashed parent stub — never a
 * normal descent, even when the recipient maps below the parent's mapping
 * (sample α's αAC case).
 */
function decomposeGeneEdges(
  species: Project,
  geneDoc: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
  effective: EffectivePlacements,
  placements: Map<NodeId, EmbeddedGeneNode>,
  tubes: Map<NodeId, EmbeddedTube>,
  options: EmbeddedLayoutOptions,
  issues: EmbeddedLayoutIssue[],
): Decomposed {
  const spans: Span[] = [];
  const drafts: Draft[] = [];
  const orphanEdges: { geneNodeId: NodeId; parentGeneNodeId: NodeId | null }[] = [];
  const edgeLosses = new Map<NodeId, Map<NodeId, number>>();

  const pushSpan = (s: Span): Span => {
    spans.push(s);
    return s;
  };

  // Deterministic pre-order edge list.
  const edges: { parent: TreeNode; child: TreeNode }[] = [];
  const root = geneDoc.nodes[geneDoc.rootId];
  if (root) {
    const seen = new Set<NodeId>([root.id]);
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      for (const cid of n.childrenIds) {
        const c = geneDoc.nodes[cid];
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        edges.push({ parent: n, child: c });
        stack.push(c);
      }
    }
  }

  for (const { parent, child } of edges) {
    const pp = placements.get(parent.id);
    const cp = placements.get(child.id);
    if (!pp || !cp) continue;
    const dashedBase =
      cp.inferred || cp.unresolved || pp.inferred || pp.unresolved || Boolean(pp.orderConflict);

    if (cp.unmapped) {
      if (!pp.unmapped) {
        orphanEdges.push({ geneNodeId: child.id, parentGeneNodeId: parent.id });
        issues.push({ kind: 'unknown-path', geneNodeId: child.id });
      } else {
        orphanEdges.push({ geneNodeId: child.id, parentGeneNodeId: parent.id });
      }
      continue;
    }
    if (pp.unmapped) {
      // A placed child under an unplaced parent: the child's own subtree still
      // draws from its own placement; report the broken edge once.
      issues.push({ kind: 'unknown-path', geneNodeId: parent.id });
      continue;
    }

    const u = pp.speciesNodeId as NodeId;
    const v = cp.speciesNodeId as NodeId;
    const childEvent = cp.event;

    // The DONOR child of a transfer parent is connected by the transfer arc,
    // not by a tube path (appendix A: the arc + the τ dashed parent stub carry
    // the event; no normal species-path descent is drawn for that edge).
    if (pp.event === 'transfer') {
      const donor = resolveTransferDonor(species, geneDoc, parent.id, effective, assumptions[parent.id]?.transferDonor);
      if (donor && donor.donorGeneNodeId === child.id) continue;
    }

    if (childEvent === 'transfer') {
      // τ: the arc carries the event; the parent edge is a dashed stub.
      drafts.push({
        parentGeneNodeId: parent.id,
        geneNodeId: child.id,
        style: 'straight',
        branchId: cp.hostBranchId,
        t0: cp.t,
        t1: cp.t,
        laneSrc: 'parent',
        dashed: true,
        event: 'transfer',
        kind: cp.kind,
      });
      continue;
    }

    const path = speciesPathBetween(species, u, v);

    if (path.kind === 'same') {
      if (cp.hostBranchId === null && pp.hostBranchId === null) continue; // both at species root
      const branchId = cp.hostBranchId ?? pp.hostBranchId;
      if (!branchId) continue;
      const span = pushSpan({
        branchId,
        a: Math.min(pp.t, cp.t),
        b: Math.max(pp.t, cp.t),
        lane: 0,
        arriveNodeId: child.id,
      });
      drafts.push({
        parentGeneNodeId: parent.id,
        geneNodeId: child.id,
        style: 'straight',
        branchId,
        t0: pp.t,
        t1: cp.t,
        laneSrc: 'parent',
        span,
        dashed: dashedBase || cp.t < pp.t,
        event: childEvent,
        kind: cp.kind,
      });
      if (cp.t < pp.t) issues.push({ kind: 'embedding-order-conflict', geneNodeId: child.id });
      continue;
    }

    if (path.kind === 'up') {
      // Time travel: no loss count makes it legal (validateScenario reports
      // `upward-move`). Draw a dashed warning stub, never a normal path.
      issues.push({ kind: 'infeasible-lateral', geneNodeId: child.id });
      drafts.push({
        parentGeneNodeId: parent.id,
        geneNodeId: child.id,
        style: 'infeasible',
        branchId: cp.hostBranchId,
        t0: cp.t,
        t1: cp.t,
        laneSrc: 'parent',
        dashed: true,
        event: childEvent,
        kind: cp.kind,
      });
      continue;
    }

    // down and lateral: the parent-tube tail, then each species branch of the
    // path (climbing BACK through the MRCA for a lateral), the last one
    // arriving at the child gene node. A lateral is a legal, MRCA-priced move
    // in this model (minLossesBetween prices both descents) — only `up` is
    // infeasible, so lateral routes are drawn like any other path.
    const route: { b: NodeId; t0: number; t1: number }[] = [];
    if (path.kind === 'lateral') {
      // Climb: back along the parent's own tube to its parent end, then each
      // ancestral branch backwards to the MRCA.
      if (pp.hostBranchId) route.push({ b: pp.hostBranchId, t0: pp.t, t1: 0 });
      for (let i = 1; i < path.upBranches.length; i += 1) {
        route.push({ b: path.upBranches[i], t0: 1, t1: 0 });
      }
      path.downBranches.forEach((b, j) =>
        route.push({
          b,
          t0: 0,
          t1: j === path.downBranches.length - 1 ? cp.t : 1,
        }),
      );
    } else {
      if (pp.hostBranchId) route.push({ b: pp.hostBranchId, t0: pp.t, t1: 1 });
      path.branches.forEach((b, j) =>
        route.push({
          b,
          t0: 0,
          t1: j === path.branches.length - 1 ? cp.t : 1,
        }),
      );
    }
    // Structural losses: strictly between u and v (never counting u itself —
    // its sibling branches belong to the sibling gene nodes' own paths).
    const perFork = lossesAlongSpeciesPath(species, path);
    if (perFork.size > 0) edgeLosses.set(child.id, perFork);

    route.forEach((step, i) => {
      if (!tubes.has(step.b)) return;
      const isFirst = i === 0;
      const isLast = i === route.length - 1;
      const span = pushSpan({
        branchId: step.b,
        a: Math.min(step.t0, step.t1),
        b: Math.max(step.t0, step.t1),
        lane: 0,
        arriveNodeId: isLast ? child.id : undefined,
      });
      drafts.push({
        parentGeneNodeId: parent.id,
        geneNodeId: child.id,
        style: isFirst ? 'tail' : 'tube',
        branchId: step.b,
        t0: step.t0,
        t1: step.t1,
        laneSrc: isFirst ? 'parent' : 'span',
        span,
        dashed: dashedBase,
        event: childEvent,
        kind: cp.kind,
      });
    });
  }

  const buildSegments = (): EmbeddedGeneSegment[] => {
    const out: EmbeddedGeneSegment[] = [];
    let prevEndY: number | null = null;
    let prevEdge = '';
    for (const draft of drafts) {
      const edgeId = `${draft.parentGeneNodeId}->${draft.geneNodeId}`;
      if (edgeId !== prevEdge) {
        prevEdge = edgeId;
        prevEndY = null;
      }
      const parentP = placements.get(draft.parentGeneNodeId);
      const childP = placements.get(draft.geneNodeId);
      if (!parentP || !childP) continue;
      let d = '';
      let lane = 0;
      if (draft.style === 'straight' || draft.style === 'infeasible') {
        d = `M ${round2(parentP.x)} ${round2(parentP.y)} L ${round2(childP.x)} ${round2(childP.y)}`;
        lane = childP.lane;
      } else {
        const tube = draft.branchId ? tubes.get(draft.branchId) : undefined;
        if (!tube) continue;
        if (draft.style === 'tail') {
          lane = parentP.lane;
          const off = laneOffsetOf(lane, tube.lanes, options.laneGap);
          const a = pointOnTube(tube, draft.t0, off);
          const b2 = pointOnTube(tube, draft.t1, off);
          if (parentP.hostBranchId === null) {
            // Root-anchored parent: drop from the species-root position into
            // the branch (a.x === parentP.x — the tube starts at the root).
            d = `M ${round2(parentP.x)} ${round2(parentP.y)} L ${round2(a.x)} ${round2(a.y)} L ${round2(b2.x)} ${round2(b2.y)}`;
          } else {
            d = `M ${round2(a.x)} ${round2(a.y)} L ${round2(b2.x)} ${round2(b2.y)}`;
          }
          prevEndY = b2.y;
        } else {
          lane = draft.laneSrc === 'span' ? (draft.span?.lane ?? 0) : childP.lane;
          const off = laneOffsetOf(lane, tube.lanes, options.laneGap);
          const start = pointOnTube(tube, draft.t0, off);
          const end = pointOnTube(tube, draft.t1, off);
          // The hub connector runs at the segment's entry x: the parent-end
          // join of a descending branch (t0=0) or the child-end join of a
          // climbing branch (t0=1) — both are hub positions in the mask.
          const joinX = start.x;
          const fromY = prevEndY ?? (parentP.hostBranchId === null ? parentP.y : start.y);
          d =
            Math.abs(fromY - start.y) < 0.01
              ? `M ${round2(start.x)} ${round2(start.y)} L ${round2(end.x)} ${round2(end.y)}`
              : `M ${round2(joinX)} ${round2(fromY)} L ${round2(joinX)} ${round2(start.y)} L ${round2(end.x)} ${round2(end.y)}`;
          prevEndY = end.y;
        }
      }
      out.push({
        id: edgeId,
        geneNodeId: draft.geneNodeId,
        parentGeneNodeId: draft.parentGeneNodeId,
        hostBranchId: draft.branchId ?? childP.hostBranchId ?? '',
        t0: draft.t0,
        t1: draft.t1,
        lane,
        d,
        event: draft.event,
        kind: draft.kind,
        dashed: draft.dashed,
        emphasis: 'normal',
      });
    }
    return out;
  };

  const buildTransfers = (): EmbeddedTransferArc[] => {
    const arcs: EmbeddedTransferArc[] = [];
    if (!options.showTransferArcs) return arcs;
    for (const n of Object.values(geneDoc.nodes)) {
      const g = placements.get(n.id);
      if (!g || g.event !== 'transfer' || g.unmapped) continue;
      const donor = resolveTransferDonor(
        species,
        geneDoc,
        n.id,
        effective,
        assumptions[n.id]?.transferDonor,
      );
      if (!donor) {
        issues.push({ kind: 'donor-unknown', geneNodeId: n.id });
        continue;
      }
      const donorP = placements.get(donor.donorGeneNodeId);
      const donorTube = donorP?.hostBranchId ? tubes.get(donorP.hostBranchId) : undefined;
      if (!donorP || !donorTube) continue;
      const recipientBranchId = g.hostBranchId;
      const recipientTube = recipientBranchId ? tubes.get(recipientBranchId) : undefined;
      if (!recipientTube) continue;
      // The recipient child = a gene child placed INSIDE the recipient subtree.
      const recipientChild = n.childrenIds.find((cid) => {
        const cp = effective.byGeneNode.get(cid);
        return !!cp && speciesSubtreeContains(species, g.speciesNodeId as NodeId, cp.speciesNodeId);
      });
      const from = { x: donorP.x, y: donorP.y };
      const to = { x: g.x, y: g.y };
      arcs.push({
        geneNodeId: n.id,
        donorGeneNodeId: donor.donorGeneNodeId,
        recipientGeneNodeId: recipientChild ?? null,
        donorBranchId: donorTube.branchId,
        recipientBranchId: recipientTube.branchId,
        donorSpeciesNodeId: donor.donorSpeciesNodeId,
        recipientSpeciesNodeId: g.speciesNodeId as NodeId,
        from,
        to,
        d: arcPath(from, to),
        timeFeasible: transferTimeFeasible(
          species,
          donor.donorSpeciesNodeId,
          g.speciesNodeId as NodeId,
        ),
      });
    }
    return arcs;
  };

  return { spans, orphanEdges, edgeLosses, buildSegments, buildTransfers };
}

/** Cubic arc between two points, bowing above or below with vertical clearance. */
function arcPath(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2;
  const bowDown = to.y >= from.y;
  const clear = 30;
  const c1 = { x: mx, y: from.y + (bowDown ? clear : -clear) };
  const c2 = { x: mx, y: to.y + (bowDown ? clear * 0.4 : -clear * 0.4) };
  return `M ${round2(from.x)} ${round2(from.y)} C ${round2(c1.x)} ${round2(c1.y)}, ${round2(c2.x)} ${round2(c2.y)}, ${round2(to.x)} ${round2(to.y)}`;
}

function speciesSubtreeContains(species: Project, root: NodeId, id: NodeId): boolean {
  if (root === id) return true;
  const seen = new Set<NodeId>();
  let cur: NodeId | null = id;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    if (cur === root) return true;
    cur = species.nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Interval overlap of the donor/recipient lineage age spans (see validateScenario). */
function transferTimeFeasible(species: Project, donor: NodeId, recipient: NodeId): boolean | null {
  const interval = (id: NodeId): [number, number] | null => {
    const nd = species.nodes[id];
    if (!nd || typeof nd.age !== 'number' || !Number.isFinite(nd.age)) return null;
    const p = nd.parentId ? species.nodes[nd.parentId] : undefined;
    const pa = p && typeof p.age === 'number' && Number.isFinite(p.age) ? p.age : nd.age;
    return pa >= nd.age ? [nd.age, pa] : [pa, nd.age];
  };
  const d = interval(donor);
  const r = interval(recipient);
  if (!d || !r) return null;
  return d[0] <= r[1] + 1e-12 && r[0] <= d[1] + 1e-12;
}

// --- lanes & widths -----------------------------------------------------------------

function assignLanes(
  tubes: Map<NodeId, EmbeddedTube>,
  placements: Map<NodeId, EmbeddedGeneNode>,
  spans: Span[],
  options: EmbeddedLayoutOptions,
  issues: EmbeddedLayoutIssue[],
): void {
  const perBranch = new Map<NodeId, Span[]>();
  for (const s of spans) {
    const arr = perBranch.get(s.branchId);
    if (arr) arr.push(s);
    else perBranch.set(s.branchId, [s]);
  }
  // Node placeholders reserve a slot around each placed gene node.
  for (const p of placements.values()) {
    if (!p.hostBranchId) continue;
    const eps = 0.025;
    const arr = perBranch.get(p.hostBranchId);
    const span: Span = {
      branchId: p.hostBranchId,
      a: p.t - eps,
      b: p.t + eps,
      lane: 0,
      nodeId: p.geneNodeId,
    };
    if (arr) arr.push(span);
    else perBranch.set(p.hostBranchId, [span]);
  }

  for (const [branchId, arr] of perBranch) {
    arr.sort(
      (x, y) => x.a - y.a || x.b - y.b || (x.nodeId ?? '').localeCompare(y.nodeId ?? ''),
    );
    // Greedy interval colouring.
    const laneEnds: number[] = [];
    for (const s of arr) {
      let lane = laneEnds.findIndex((end) => end <= s.a + 1e-9);
      if (lane < 0) {
        laneEnds.push(s.b);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = Math.max(laneEnds[lane], s.b);
      }
      s.lane = lane;
    }
    // A span arriving at a gene node shares that node's lane, so the drawn
    // line meets the node marker.
    for (const s of arr) {
      if (!s.arriveNodeId) continue;
      const node = placements.get(s.arriveNodeId);
      if (node) s.lane = node.lane;
    }
    const lanes = Math.max(1, ...arr.map((s) => s.lane + 1));
    const required = (lanes - 1) * options.laneGap + 4; // 2 px padding each side
    let width = Math.max(options.tubeWidth, required);
    if (width > options.maxTubeWidth) {
      issues.push({ kind: 'lane-overflow', branchId, lanes, cap: options.maxTubeWidth });
      width = options.maxTubeWidth;
    }
    width = Math.max(options.minTubeWidth, width);
    const tube = tubes.get(branchId);
    if (tube) {
      tube.lanes = lanes;
      tube.width = width;
      tube.path = `M ${round2(tube.x0)} ${round2(tube.y)} L ${round2(tube.x1)} ${round2(tube.y)}`;
    }
  }
}

// --- losses ---------------------------------------------------------------------------

function buildLosses(
  species: Project,
  speciesLayout: LayoutResult,
  assumptions: Record<NodeId, GeneNodeAssumption>,
  edgeLosses: Map<NodeId, Map<NodeId, number>>,
  placements: Map<NodeId, EmbeddedGeneNode>,
  options: EmbeddedLayoutOptions,
): EmbeddedLossMark[] {
  const marks: EmbeddedLossMark[] = [];
  if (!options.showLossStubs) return marks;
  // Aggregate structural marks per fork: sum counts, track coverage states.
  interface Acc {
    count: number;
    anyCovered: boolean;
    anyUncovered: boolean;
    shortfall: boolean;
    geneNodes: Set<NodeId>;
  }
  const byFork = new Map<NodeId, Acc>();
  for (const [childId, perFork] of edgeLosses) {
    const asserted = assumptions[childId]?.losses;
    let structuralTotal = 0;
    for (const count of perFork.values()) structuralTotal += count;
    const covered = asserted !== undefined && asserted >= structuralTotal;
    const shortfall = asserted !== undefined && asserted < structuralTotal;
    for (const [fork, count] of perFork) {
      const acc = byFork.get(fork) ?? {
        count: 0,
        anyCovered: false,
        anyUncovered: false,
        shortfall: false,
        geneNodes: new Set<NodeId>(),
      };
      acc.count += count;
      acc.anyCovered = acc.anyCovered || covered;
      acc.anyUncovered = acc.anyUncovered || !covered;
      acc.shortfall = acc.shortfall || shortfall;
      acc.geneNodes.add(childId);
      byFork.set(fork, acc);
    }
  }
  for (const [fork, acc] of byFork) {
    const forkNode = species.nodes[fork];
    if (!forkNode) continue;
    const pos = speciesLayout.positions.get(fork);
    if (!pos) continue;
    const host = branchHost(species, fork);
    marks.push({
      geneNodeId: [...acc.geneNodes][0] ?? '',
      atSpeciesNodeId: fork,
      branchId: host,
      count: acc.count,
      x: pos.x,
      y: pos.y,
      source: 'structural',
      inferred: !acc.anyCovered,
      shortfall: acc.shortfall,
    });
  }
  // Extra asserted losses beyond the structural minimum: a stub beside the
  // gene node that asserts them (never faked onto a specific fork).
  for (const [childId, perFork] of edgeLosses) {
    const asserted = assumptions[childId]?.losses;
    if (asserted === undefined) continue;
    let structuralTotal = 0;
    for (const count of perFork.values()) structuralTotal += count;
    const extra = asserted - structuralTotal;
    if (extra <= 0) continue;
    const p = placements.get(childId);
    if (!p || p.unmapped) continue;
    marks.push({
      geneNodeId: childId,
      atSpeciesNodeId: p.speciesNodeId ?? '',
      branchId: p.hostBranchId,
      count: extra,
      x: p.x,
      y: p.y,
      source: 'asserted',
      inferred: false,
      shortfall: false,
    });
  }
  return marks;
}

// --- orphans -------------------------------------------------------------------------

function buildOrphans(
  geneDoc: Project,
  placements: Map<NodeId, EmbeddedGeneNode>,
  orphanEdges: { geneNodeId: NodeId; parentGeneNodeId: NodeId | null }[],
  speciesLayout: LayoutResult,
  issues: EmbeddedLayoutIssue[],
): EmbeddedOrphan[] {
  const orphans: EmbeddedOrphan[] = [];
  const gutterX = speciesLayout.bounds.maxX + 70;
  let y = speciesLayout.bounds.minY;
  const seen = new Set<NodeId>();
  const pushOrphan = (
    id: NodeId,
    parentGeneNodeId: NodeId | null,
    reason: EmbeddedOrphan['reason'],
  ) => {
    if (seen.has(id)) return;
    seen.add(id);
    orphans.push({ geneNodeId: id, parentGeneNodeId, reason, x: gutterX, y });
    y += 22;
  };
  for (const e of orphanEdges) pushOrphan(e.geneNodeId, e.parentGeneNodeId, 'unmapped-tip');
  // Any other unplaced node (e.g. an unplaced internal node): DFS order.
  const root = geneDoc.nodes[geneDoc.rootId];
  if (root) {
    const seenWalk = new Set<NodeId>([root.id]);
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      const p = placements.get(n.id);
      if (p?.unmapped && !seen.has(n.id)) {
        pushOrphan(
          n.id,
          null,
          n.childrenIds.length === 0 ? 'unmapped-tip' : 'unmapped-internal',
        );
      }
      for (let i = n.childrenIds.length - 1; i >= 0; i -= 1) {
        const c = geneDoc.nodes[n.childrenIds[i]];
        if (!c || seenWalk.has(c.id)) continue;
        seenWalk.add(c.id);
        stack.push(c);
      }
    }
  }
  for (const o of orphans) {
    issues.push({ kind: 'unmapped-gene-node', geneNodeId: o.geneNodeId });
  }
  return orphans;
}

// --- bounds ---------------------------------------------------------------------------

export function computeEmbeddedBounds(
  scene: EmbeddedReconLayout,
  speciesDoc: Project,
  geneDoc: Project,
): EmbeddedBounds {
  const b: EmbeddedBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    b.minX = Math.min(b.minX, x0);
    b.minY = Math.min(b.minY, y0);
    b.maxX = Math.max(b.maxX, x1);
    b.maxY = Math.max(b.maxY, y1);
  };
  for (const t of scene.tubes.values()) {
    grow(
      Math.min(t.x0, t.x1) - t.width / 2,
      t.y - t.width / 2,
      Math.max(t.x0, t.x1) + t.width / 2,
      t.y + t.width / 2,
    );
  }
  for (const h of scene.hubs.values()) {
    grow(
      h.x - h.width / 2,
      Math.min(h.y0, h.y1) - h.width / 2,
      h.x + h.width / 2,
      Math.max(h.y0, h.y1) + h.width / 2,
    );
  }
  for (const p of scene.placements.values()) {
    if (p.unmapped) continue;
    grow(p.x - 8, p.y - 22, p.x + 8, p.y + 10);
  }
  for (const t of scene.transfers) {
    grow(
      Math.min(t.from.x, t.to.x) - 12,
      Math.min(t.from.y, t.to.y) - 44,
      Math.max(t.from.x, t.to.x) + 12,
      Math.max(t.from.y, t.to.y) + 44,
    );
  }
  for (const l of scene.losses) grow(l.x - 4, l.y - 20, l.x + 26, l.y + 8);
  for (const o of scene.orphans) grow(o.x - 4, o.y - 8, o.x + 90, o.y + 8);
  // Labels: species labels right of the nodes; gene labels above placements.
  for (const id of scene.speciesLayout.visible) {
    const n = speciesDoc.nodes[id];
    const p = scene.speciesLayout.positions.get(id);
    if (!n?.label || !p) continue;
    const w = estimateLabelWidth(n.label, n.childrenIds.length === 0 ? 11.5 : 10.5) * 1.05;
    grow(p.x + 9, p.y - 12, p.x + 9 + w, p.y + 10);
  }
  for (const [gid, p] of scene.placements) {
    if (p.unmapped) continue;
    const n = geneDoc.nodes[gid];
    if (!n?.label) continue;
    const w = estimateLabelWidth(n.label, 9.5) * 1.05;
    grow(p.x - w / 2, p.y - 22, p.x + w / 2, p.y - 8);
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pad = 6;
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}
