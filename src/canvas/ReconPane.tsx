// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// One reconciliation pane: an SVG tree drawn with the shared layout result,
// a fixed HTML header (identity + node count + zoom readout + Fit/Reset) and
// pan/zoom gestures.
//
// Design contract (see the 2026-10-31 reconciliation review, §5.6):
//  - the header is LAYOUT, not an absolutely-positioned overlay, so it can
//    never cover the tree;
//  - mapping-line guide stubs render BEFORE the nodes (under them), nodes and
//    labels above;
//  - event glyphs / loss badges / selection rings use screen-space sizes
//    (inverse-scaled), so zooming never shrinks them into noise;
//  - labels get a LOD: below ~8 px screen height internal labels hide, below
//    ~7 px tip labels hide, so a fitted 21-node tree stays readable;
//  - branches use `vector-effect: non-scaling-stroke` for a constant minimum
//    stroke width and theme variables instead of hard-coded hex colours.

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { LayoutResult } from '../layout/autoLayout';
import type { NodeId, Project, ReconViewOptions } from '../model/types';
import { elbowPath } from './paths';
import { estimateLabelWidth, type Box } from './labelBounds';
import type { MappingColorToken, PaneTransform } from './reconMapping';
export type { PaneTransform };
import { S, tr } from '../ui/strings';

export const RECON_MIN_SCALE = 0.15;
export const RECON_MAX_SCALE = 4;

/** Screen-space header height (the svg box sits below it). */
export const RECON_HEADER_H = 40;

export interface PaneNodeMeta {
  fill: string;
  glyph?: string;
  dashedRed?: boolean;
  selected?: boolean;
  losses?: number;
  hovered?: boolean;
}

/** A guide stub: a line from a node to the pane edge facing the bridge. */
export interface PaneStub {
  nodeId: NodeId;
  token: MappingColorToken;
  emphasized: boolean;
  muted: boolean;
}

interface ReconPaneProps {
  doc: Project;
  layout: LayoutResult;
  transform: PaneTransform;
  /** Commit a new transform; `userAction` marks manual pan/zoom (drops fit). */
  onTransform: (t: PaneTransform, userAction: boolean) => void;
  onSizeChange: (w: number, h: number, svgTop: number) => void;
  /** Fit this pane's tree into the given svg box. */
  onFit: () => void;
  onResetZoom: () => void;
  title: string;
  subtitle: string;
  badge?: string;
  badgeTone?: 'neutral' | 'readonly';
  nodeCount: number;
  zoomPercent: number;
  headerExtra?: ReactNode;
  nodeMeta?: Map<NodeId, PaneNodeMeta>;
  stubs?: PaneStub[];
  highlightNodes?: Set<NodeId>;
  ariaLabel: string;
  options: ReconViewOptions;
  onNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
  onNodeHover?: (id: NodeId | null) => void;
  onNodeKeyDown?: (id: NodeId, e: React.KeyboardEvent) => void;
  /** Which column this pane occupies (species = left, gene = right). */
  side: 'species' | 'gene';
}

/** World-space pane edge x that the stubs run to: the species pane's right
 *  edge or the gene pane's left edge (the two panes face each other). */
function stubEdgeX(transform: PaneTransform, boxW: number, fromLeft: boolean): number {
  return fromLeft ? (0 - transform.tx) / transform.scale : (boxW - transform.tx) / transform.scale;
}

/**
 * World bounding box of the pane content INCLUDING the chrome this view draws:
 * labels (mirroring the two text rules below), event glyphs, loss markers and
 * a margin for selection rings — so Fit never tucks a λ badge or a glyph under
 * the header or the pane edge. The gene pane is mirrored (trees face each
 * other), so its labels sit on the opposite side of each node.
 */
export function reconPaneBounds(
  doc: Project,
  layout: LayoutResult,
  options: ReconViewOptions,
  side: 'species' | 'gene' = 'species',
): Box {
  const box: Box = { ...layout.bounds };
  const mirrored = side === 'gene';
  let touched = false;
  for (const id of layout.visible) {
    const node = doc.nodes[id];
    const p = layout.positions.get(id);
    if (!node || !p) continue;
    touched = true;
    if (node.label) {
      const tip = node.childrenIds.length === 0;
      const fontSize = tip ? 11.5 : 10.5;
      const w = estimateLabelWidth(node.label, fontSize) * 1.05;
      const x0 = tip
        ? (mirrored ? p.x - 9 - w : p.x + 9)
        : (mirrored ? p.x + 10.5 : p.x - 10.5 - w);
      const x1 = tip
        ? (mirrored ? p.x - 9 : p.x + 9 + w)
        : (mirrored ? p.x + 10.5 + w : p.x - 10.5);
      const y0 = p.y + 4 - fontSize;
      const y1 = p.y + 4 + fontSize * 0.35;
      box.minX = Math.min(box.minX, x0);
      box.maxX = Math.max(box.maxX, x1);
      box.minY = Math.min(box.minY, y0);
      box.maxY = Math.max(box.maxY, y1);
    }
    // Event glyph above the node, loss badge below — both screen-space, but the
    // world bbox reserves a fixed margin so Fit leaves room for them.
    if (options.showEventGlyphs && node.childrenIds.length > 0) {
      box.minY = Math.min(box.minY, p.y - 24);
    }
    if (options.showLosses) {
      box.maxY = Math.max(box.maxY, p.y + 24);
    }
  }
  if (touched) {
    // One shared margin for selection rings + stroke overshoot.
    const ringPad = 6;
    box.minX -= ringPad;
    box.minY -= ringPad;
    box.maxX += ringPad;
    box.maxY += ringPad;
  }
  return box;
}

export function fitTransformFor(
  bounds: Box,
  w: number,
  h: number,
): PaneTransform {
  const pad = 24;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const s = Math.max(RECON_MIN_SCALE, Math.min(RECON_MAX_SCALE, Number.isFinite(scale) ? scale : 1));
  return {
    scale: s,
    tx: (w - bw * s) / 2 - bounds.minX * s,
    ty: (h - bh * s) / 2 - bounds.minY * s,
  };
}

/** Keep the tree at least partly on screen after a manual pan/zoom. */
export function clampTransform(t: PaneTransform, bounds: Box, w: number, h: number): PaneTransform {
  const scale = Math.max(RECON_MIN_SCALE, Math.min(RECON_MAX_SCALE, t.scale));
  const bw = Math.max(1, (bounds.maxX - bounds.minX) * scale);
  const bh = Math.max(1, (bounds.maxY - bounds.minY) * scale);
  // The tree centre must stay inside a viewport expanded by one viewport each
  // side — the tree can leave the view, but never vanish without a trace.
  const cx = (bounds.minX + bounds.maxX) / 2 * scale + t.tx;
  const cy = (bounds.minY + bounds.maxY) / 2 * scale + t.ty;
  const clampedCx = Math.max(-w, Math.min(2 * w, cx));
  const clampedCy = Math.max(-h, Math.min(2 * h, cy));
  return {
    scale,
    tx: t.tx + (clampedCx - cx),
    ty: t.ty + (clampedCy - cy),
  };
}

export function ReconPane({
  doc,
  layout,
  transform,
  onTransform,
  onSizeChange,
  onFit,
  onResetZoom,
  title,
  subtitle,
  badge,
  badgeTone = 'neutral',
  nodeCount,
  zoomPercent,
  headerExtra,
  nodeMeta,
  stubs,
  highlightNodes,
  ariaLabel,
  options,
  onNodeClick,
  onNodeHover,
  onNodeKeyDown,
  side,
}: ReconPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgBoxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  // Report the svg box size upward (fit needs the real content area). The
  // callback identity may change across renders, but a report only fires when
  // the measured size ACTUALLY changed — otherwise the parent's setState would
  // re-render this pane, re-run this effect, and loop forever.
  const lastSize = useRef<{ w: number; h: number; top: number } | null>(null);
  const reportSize = useRef(onSizeChange);
  reportSize.current = onSizeChange;
  useEffect(() => {
    const el = svgBoxRef.current;
    if (!el) return;
    const report = () => {
      const host = hostRef.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      // The svg box starts under the pane header; report its offset so the
      // bridge lines use the same origin as the nodes (the header may wrap).
      const top = host
        ? Math.round((el.getBoundingClientRect().top - host.getBoundingClientRect().top) * 10) / 10
        : 0;
      const last = lastSize.current;
      if (last && last.w === w && last.h === h && last.top === top) return;
      lastSize.current = { w, h, top };
      reportSize.current(w, h, top);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = svgBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const scale = Math.max(RECON_MIN_SCALE, Math.min(RECON_MAX_SCALE, transform.scale * k));
      const kk = scale / transform.scale;
      onTransform(
        {
          scale,
          tx: mx - (mx - transform.tx) * kk,
          ty: my - (my - transform.ty) * kk,
        },
        true,
      );
    },
    [transform, onTransform],
  );

  const bgDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-node-id]')) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const bgMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    onTransform(
      {
        ...transform,
        tx: drag.current.tx + (e.clientX - drag.current.x),
        ty: drag.current.ty + (e.clientY - drag.current.y),
      },
      true,
    );
  };
  const bgUp = () => {
    drag.current = null;
  };

  // LOD thresholds: hide labels whose SCREEN font size drops below readability.
  const hideInternalLabels = options.showLabels && transform.scale * 10.5 < 8;
  const hideTipLabels = options.showLabels && transform.scale * 11.5 < 7;
  const boxW = hostRef.current?.clientWidth ?? 0;
  // The two panes face each other: the species tree grows rightwards and the
  // gene tree is mirrored, so labels and mapping stubs swap sides too.
  const mirrored = side === 'gene';
  const branchOrientation = mirrored ? ('RL' as const) : ('LR' as const);

  return (
    <div className={`recon-pane recon-pane--${side ?? 'gene'}`} ref={hostRef} role="group" aria-label={ariaLabel}>
      <div className="recon-pane-header">
        <div className="recon-pane-title">
          <span className="recon-pane-name">{title}</span>
          <span className="recon-pane-sub">{subtitle}</span>
        </div>
        {badge && (
          <span className={`recon-pane-badge${badgeTone === 'readonly' ? ' readonly' : ''}`}>
            {badge}
          </span>
        )}
        <span className="recon-pane-count">
          {tr('节点', 'nodes')} {nodeCount}
        </span>
        <span className="recon-pane-zoom" title={S.status.zoom}>
          {zoomPercent}%
        </span>
        <button className="btn icon tiny" title={S.recon.zoomFit} aria-label={S.recon.zoomFit} onClick={onFit}>
          ⤢
        </button>
        <button
          className="btn icon tiny"
          title={S.recon.zoomReset}
          aria-label={S.recon.zoomReset}
          onClick={onResetZoom}
        >
          1:1
        </button>
        {headerExtra}
      </div>
      <div
        className="recon-pane-svg"
        ref={svgBoxRef}
        onWheel={onWheel}
        onPointerDown={bgDown}
        onPointerMove={bgMove}
        onPointerUp={bgUp}
        onPointerCancel={bgUp}
      >
        <svg>
          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {/* edges */}
            {layout.visible.size > 0 &&
              [...layout.visible].map((id) => {
                const n = doc.nodes[id];
                if (!n || !n.parentId) return null;
                if (!layout.visible.has(n.parentId)) return null;
                const from = layout.positions.get(id)!;
                const to = layout.positions.get(n.parentId)!;
                return (
                  <path
                    key={`e${id}`}
                    d={elbowPath(from, to, branchOrientation)}
                    fill="none"
                    stroke="var(--recon-branch)"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            {/* mapping guide stubs (layer 2, under nodes) */}
            {options.showMappings &&
              stubs?.map((stub) => {
                const p = layout.positions.get(stub.nodeId);
                if (!p) return null;
                const edgeX = stubEdgeX(transform, boxW, mirrored);
                return (
                  <line
                    key={`s${stub.nodeId}`}
                    x1={p.x}
                    y1={p.y}
                    x2={edgeX}
                    y2={p.y}
                    stroke={`var(--recon-map-${stub.token})`}
                    strokeWidth={stub.emphasized ? 2 : 1.2}
                    strokeOpacity={stub.muted ? 0.2 : stub.emphasized ? 0.95 : 0.6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            {/* nodes */}
            {[...layout.visible].map((id) => {
              const n = doc.nodes[id];
              if (!n) return null;
              const p = layout.positions.get(id)!;
              const meta = nodeMeta?.get(id);
              const isTip = n.childrenIds.length === 0;
              const r = isTip ? 5 : 6.5;
              const fill = meta?.dashedRed ? 'var(--surface)' : meta?.fill ?? 'var(--recon-node-fill)';
              const stroke =
                meta?.selected || meta?.hovered
                  ? 'var(--recon-select)'
                  : meta?.dashedRed
                    ? 'var(--danger)'
                    : meta?.fill ?? 'var(--recon-node-stroke)';
              const inv = 1 / transform.scale;
              const label = n.label || n.id.slice(0, 6);
              const showTipLabel = isTip && n.label && options.showLabels && !hideTipLabels;
              const showInternalLabel = !isTip && n.label && options.showLabels && !hideInternalLabels;
              return (
                <g
                  key={id}
                  data-node-id={id}
                  role={onNodeClick ? 'button' : undefined}
                  tabIndex={onNodeClick ? 0 : undefined}
                  aria-label={
                    onNodeClick ? `${ariaLabel} · ${label}` : undefined
                  }
                  onClick={(e) => onNodeClick?.(id, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onNodeClick?.(id, e as unknown as React.MouseEvent);
                    }
                    onNodeKeyDown?.(id, e);
                  }}
                  onPointerEnter={onNodeHover ? () => onNodeHover(id) : undefined}
                  onPointerLeave={onNodeHover ? () => onNodeHover(null) : undefined}
                  style={{ cursor: onNodeClick ? 'pointer' : undefined, outline: 'none' }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + (meta?.selected ? 2 : 0)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={(meta?.selected ? 2.5 : 1.5) * inv}
                    strokeDasharray={meta?.dashedRed ? '3 2' : undefined}
                    className={meta?.dashedRed ? 'recon-node-unresolved' : undefined}
                  />
                  {/* selection / hover ring in screen space (never shrinks away) */}
                  {(meta?.selected || meta?.hovered) && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 5 * inv}
                      fill="none"
                      stroke="var(--recon-select)"
                      strokeWidth={1.5 * inv}
                      opacity={meta?.selected ? 0.9 : 0.5}
                    />
                  )}
                  {options.showEventGlyphs && meta?.glyph && (
                    <text
                      transform={`translate(${p.x},${p.y - r - 4 * inv}) scale(${inv})`}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill={meta.fill}
                      style={{ pointerEvents: 'none' }}
                    >
                      {meta.glyph}
                    </text>
                  )}
                  {options.showLosses && typeof meta?.losses === 'number' && meta.losses > 0 && (
                    <text
                      transform={`translate(${p.x},${p.y + r + 9 * inv}) scale(${inv})`}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill="var(--recon-loss)"
                      style={{ pointerEvents: 'none' }}
                    >
                      λ{meta.losses}
                    </text>
                  )}
                  {showTipLabel && (
                    <text
                      x={mirrored ? p.x - 9 : p.x + 9}
                      y={p.y + 4}
                      textAnchor={mirrored ? 'end' : 'start'}
                      fontSize={11.5}
                      fill="currentColor"
                      style={{ pointerEvents: 'none' }}
                    >
                      {n.label}
                    </text>
                  )}
                  {showInternalLabel && (
                    <text
                      x={mirrored ? p.x + r + 4 : p.x - r - 4}
                      y={p.y + 4}
                      textAnchor={mirrored ? 'start' : 'end'}
                      fontSize={10.5}
                      opacity={0.65}
                      fill="currentColor"
                      style={{ pointerEvents: 'none' }}
                    >
                      {n.label}
                    </text>
                  )}
                  {/* hidden-by-LOD labels stay reachable via the tooltip */}
                  {options.showLabels && ((isTip && hideTipLabels) || (!isTip && hideInternalLabels)) && n.label && (
                    <title>{n.label}</title>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

/** Build stub descriptors for one pane's nodes from the collected lines. */
export function stubsFromLines(
  lines: { geneNodeId: NodeId; speciesNodeId: NodeId; token: MappingColorToken; state: string }[],
  side: 'species' | 'gene',
): PaneStub[] {
  const out: PaneStub[] = [];
  for (const l of lines) {
    const id = side === 'species' ? l.speciesNodeId : l.geneNodeId;
    if (out.some((s) => s.nodeId === id)) continue;
    out.push({
      nodeId: id,
      token: l.token,
      emphasized: l.state === 'selected' || l.state === 'hovered',
      muted: l.state === 'muted',
    });
  }
  return out;
}

export const RECON_ZOOM_MIN = RECON_MIN_SCALE;
export const RECON_ZOOM_MAX = RECON_MAX_SCALE;
