// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Pure view-model for the reconciliation mapping layer.
//
// "Which lines exist, where do they run, how are they emphasised" is decided
// HERE — no DOM reads, no React — so the rules (scope filter, event filter,
// selection emphasis) are unit-testable and the renderer stays a dumb painter.
// Coordinates are computed from the pane rects + transforms the caller passes
// in, in the coordinate space of the shared mapping host (the panes row), so
// the renderer never calls getBoundingClientRect() during render.

import type {
  GeneNodeAssumption,
  MappingScope,
  NodeId,
  Project,
  ReconEventType,
  ReconViewOptions,
} from '../model/types';
import type { LayoutResult } from '../layout/autoLayout';

export interface PaneTransform {
  tx: number;
  ty: number;
  scale: number;
}

/** A pane's rect in mapping-host coordinates plus its current transform. */
export interface PaneView {
  left: number;
  top: number;
  width: number;
  height: number;
  transform: PaneTransform;
}

/** Colour token for a mapping line — the renderer maps it to a CSS variable.
 *  `tip` is a label-matched anchor with no event asserted on it. */
export type MappingColorToken = 'sigma' | 'dup' | 'transfer' | 'tip' | 'unresolved';

export type MappingLineState = 'normal' | 'selected' | 'hovered' | 'muted';

export interface ReconMappingLine {
  id: string;
  geneNodeId: NodeId;
  speciesNodeId: NodeId;
  /** Tip mappings are the label-matched anchors; internal ones are inferred. */
  kind: 'tip' | 'internal';
  event: ReconEventType | null;
  token: MappingColorToken;
  state: MappingLineState;
  /** Host-space start point: the species pane's right edge at the node's y. */
  from: { x: number; y: number };
  /** Host-space end point: the gene pane's left edge at the node's y. */
  to: { x: number; y: number };
  /** Number of lines bundled into this one (aggregation; 1 = unbundled). */
  bundleCount: number;
}

export interface ReconMappingInput {
  speciesDoc: Project;
  geneDoc: Project;
  assumptions: Record<NodeId, GeneNodeAssumption>;
  speciesLayout: LayoutResult;
  geneLayout: LayoutResult;
  speciesPane: PaneView;
  genePane: PaneView;
  options: ReconViewOptions;
  selectedGeneIds: NodeId[];
  hoveredGeneId: NodeId | null;
}

/** Stable colour token for an event class; unresolved stays grey. */
export function eventToken(event: ReconEventType | null | undefined): MappingColorToken {
  if (event === 'speciation') return 'sigma';
  if (event === 'duplication') return 'dup';
  if (event === 'transfer') return 'transfer';
  return 'unresolved';
}

export function mappingKindOf(geneDoc: Project, geneNodeId: NodeId): 'tip' | 'internal' {
  const node = geneDoc.nodes[geneNodeId];
  return node && node.childrenIds.length > 0 ? 'internal' : 'tip';
}

/** Does a line of this kind pass the current mapping scope? */
export function scopePasses(kind: 'tip' | 'internal', scope: MappingScope): boolean {
  if (scope === 'all') return true;
  return scope === 'tips' ? kind === 'tip' : kind === 'internal';
}

/** Does an event pass the current event filter? */
export function eventFilterPasses(
  event: ReconEventType | null,
  filter: ReconViewOptions['eventFilter'],
): boolean {
  if (filter === 'all') return true;
  if (filter === 'unresolved') return event === null;
  return event === filter;
}

/** Straight bridge segment between two host points: a mapping must read as a
 *  direct correspondence, not a decorative curve. */
export function bridgeLine(from: { x: number; y: number }, to: { x: number; y: number }): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * Collect the mapping lines to draw under the current view options.
 *
 * Rules (each unit-tested):
 *  - both endpoints must exist and be visible in their layouts;
 *  - scope (`tips` / `internal` / `all`) and the event filter drop lines;
 *  - the selected and hovered gene nodes' lines ALWAYS pass both filters and
 *    are emphasised; every other visible line is muted while an emphasis
 *    exists;
 *  - lines bundling onto the same species node + event + kind share one path
 *    with a `bundleCount` (first gene id wins, the rest are dropped from the
 *    output but counted).
 */
export function collectMappingLines(input: ReconMappingInput): ReconMappingLine[] {
  const {
    speciesDoc,
    geneDoc,
    assumptions,
    speciesLayout,
    geneLayout,
    speciesPane,
    genePane,
    options,
    selectedGeneIds,
    hoveredGeneId,
  } = input;
  const lines: ReconMappingLine[] = [];
  const hasEmphasis = selectedGeneIds.length > 0 || hoveredGeneId !== null;
  const selected = new Set(selectedGeneIds);

  for (const [gid, a] of Object.entries(assumptions)) {
    const target = a.speciesNode;
    if (!target) continue;
    const gPos = geneLayout.positions.get(gid);
    const spPos = speciesLayout.positions.get(target);
    if (!gPos || !spPos) continue;
    if (!geneLayout.visible.has(gid) || !speciesLayout.visible.has(target)) continue;
    if (!speciesDoc.nodes[target] || !geneDoc.nodes[gid]) continue;

    const kind = mappingKindOf(geneDoc, gid);
    const isSel = selected.has(gid);
    const isHover = hoveredGeneId === gid;
    if (!isSel && !isHover) {
      if (!scopePasses(kind, options.mappingScope)) continue;
      if (!eventFilterPasses(a.event ?? null, options.eventFilter)) continue;
    }
    const state: MappingLineState = isSel ? 'selected' : isHover ? 'hovered' : hasEmphasis ? 'muted' : 'normal';
    const s = speciesPane.transform;
    const g = genePane.transform;
    lines.push({
      id: gid,
      geneNodeId: gid,
      speciesNodeId: target,
      kind,
      event: a.event ?? null,
      token: a.event ? eventToken(a.event) : kind === 'tip' ? 'tip' : 'unresolved',
      state,
      from: {
        x: speciesPane.left + speciesPane.width,
        y: speciesPane.top + spPos.y * s.scale + s.ty,
      },
      to: {
        x: genePane.left,
        y: genePane.top + gPos.y * g.scale + g.ty,
      },
      bundleCount: 1,
    });
  }

  // Bundle lines that land on the same species node with the same event class
  // and kind: the bridge stays readable when a large family collapses onto one
  // placement. The first gene node in iteration order carries the path.
  const byKey = new Map<string, ReconMappingLine>();
  const bundled: ReconMappingLine[] = [];
  for (const line of lines) {
    const key = `${line.speciesNodeId}|${line.event ?? '-'}|${line.kind}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.bundleCount += 1;
      continue;
    }
    byKey.set(key, line);
    bundled.push(line);
  }
  return bundled;
}

/** Aggregate counts for one bundle member list (status-bar summary). */
export function bundleTotals(lines: ReconMappingLine[]): {
  total: number;
  bundled: number;
  byToken: Record<MappingColorToken, number>;
} {
  const byToken: Record<MappingColorToken, number> = {
    sigma: 0,
    dup: 0,
    transfer: 0,
    tip: 0,
    unresolved: 0,
  };
  let total = 0;
  for (const l of lines) {
    total += l.bundleCount;
    byToken[l.token] += l.bundleCount;
  }
  return { total, bundled: lines.length, byToken };
}
