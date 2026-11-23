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
//
// PERFORMANCE (2026-11-08 reconciliation-lag analysis, §3.1–§3.3):
//  - nodes, edges and guide stubs are `React.memo` children whose props are
//    world-space primitives, so a hover change reconciles only the two nodes
//    whose emphasis changed (and their lines), not every SVG element;
//  - pan/zoom input events accumulate into a ref and commit at most once per
//    animation frame — the coalescing pattern the main canvas uses
//    (`21ec332`) — instead of one React render per input event;
//  - only nodes inside the viewport (plus a one-viewport buffer) are mounted,
//    so imported trees with thousands of tips do not create thousands of DOM
//    elements the user cannot even see.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LayoutResult } from '../layout/autoLayout';
import type { NodeId, Project, ReconViewOptions } from '../model/types';
import { useStore } from '../model/store';
import { isImeComposing } from '../ui/imeGuard';
import { elbowPath, curvedBranchPath } from './paths';
import { PR_TUBE_FILL, prFamilyVar } from './phyloTheme';
import { estimateLabelWidth, type Box } from './labelBounds';
import { cullPaneNodes } from './reconViewport';
import type { MappingColorToken, PaneTransform } from './reconMapping';

/** M37 (UI_UX_REVIEW): Alt+click mapping had one dismissable banner and no
 *  persistent affordance. Tracks the Alt key so panes can answer with a copy
 *  cursor while it is held (see EmbeddedReconCanvas). */
export function useAltHeld(): boolean {
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false);
    };
    const blur = () => setAltDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return altDown;
}
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
  badgeTone?: 'neutral' | 'readonly' | 'editing';
  nodeCount: number;
  headerExtra?: ReactNode;
  nodeMeta?: Map<NodeId, PaneNodeMeta>;
  stubs?: PaneStub[];
  ariaLabel: string;
  options: ReconViewOptions;
  onNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
  /** 用户反馈 (2026-11-23): the mapping editor edits both trees — double-click
   *  opens the rename dialog for the pane's tree. */
  onNodeDblClick?: (id: NodeId, e: React.MouseEvent) => void;
  /** Right-click opens the pane's edit menu (add children / rename / delete). */
  onNodeContextMenu?: (id: NodeId, e: React.MouseEvent) => void;
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
    // Internal nodes fall back to a short id on the canvas (用户反馈 2026-11-23)
    // so every name the left-panel mapping list shows is visible on the tree.
    const tip = node.childrenIds.length === 0;
    const effLabel = node.label || (tip ? '' : node.id.slice(0, 6));
    if (effLabel) {
      const fontSize = tip ? 11.5 : 10.5;
      const w = estimateLabelWidth(effLabel, fontSize) * 1.05;
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

// --- memoised SVG primitives ----------------------------------------------------
// Props are WORLD-SPACE primitives: a hover or pan re-render of the pane maps
// over the same values and these children bail out, so React only touches the
// nodes (and lines) whose emphasis actually changed.

/** How one pane edge is drawn — the PhyloRecViewer look (用户反馈 2026-11-16)
 *  renders the species side as thick rounded slate TUBES and the gene side as
 *  smooth curved family-coloured lines with a white halo; the legacy look is
 *  a thin elbow hairline. */
export type PaneEdgeVariant =
  | { kind: 'thin' }
  | { kind: 'tube'; width: number; opacity: number; gradientId: string | null }
  | { kind: 'curve'; width: number; familyIndex: number; halo: boolean };

const PaneEdge = memo(function PaneEdge({
  x1,
  y1,
  x2,
  y2,
  orientation,
  variant,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientation: 'LR' | 'RL';
  variant: PaneEdgeVariant;
}) {
  // Tubes and gene curves use the smooth PhyloRec spine; the legacy hairline
  // keeps the rectangular elbow.
  const d =
    variant.kind === 'thin'
      ? elbowPath({ x: x1, y: y1 }, { x: x2, y: y2 }, orientation)
      : curvedBranchPath({ x: x1, y: y1 }, { x: x2, y: y2 }, orientation);
  if (variant.kind === 'tube') {
    return (
      <path
        d={d}
        fill="none"
        stroke={variant.gradientId ? `url(#${variant.gradientId})` : PR_TUBE_FILL}
        strokeWidth={variant.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={variant.opacity}
      />
    );
  }
  if (variant.kind === 'curve') {
    const color = prFamilyVar(variant.familyIndex);
    return (
      <>
        {/* Halo: a wider background-coloured under-stroke so the lineage reads
            where it crosses species tubes and mapping lines. */}
        {variant.halo && (
          <path
            d={d}
            fill="none"
            stroke="var(--recon-pane-bg)"
            strokeWidth={variant.width + 3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={variant.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--recon-branch)"
      strokeWidth={1.4}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
});

const PaneStubLine = memo(function PaneStubLine({
  x1,
  y1,
  x2,
  y2,
  token,
  emphasized,
  muted,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  token: MappingColorToken;
  emphasized: boolean;
  muted: boolean;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={`var(--recon-map-${token})`}
      strokeWidth={emphasized ? 2 : 1.2}
      strokeOpacity={muted ? 0.2 : emphasized ? 0.95 : 0.6}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
});

interface PaneNodeProps {
  nodeId: NodeId;
  /** Display label (falls back to a short id for unlabelled nodes). */
  label: string;
  /** Raw node label, drawn by the label texts and the LOD tooltip; '' when absent. */
  rawLabel: string;
  x: number;
  y: number;
  isTip: boolean;
  fill: string;
  stroke: string;
  dashedRed: boolean;
  selected: boolean;
  hovered: boolean;
  losses: number | undefined;
  glyph: string | undefined;
  showEventGlyph: boolean;
  showLoss: boolean;
  showTipLabel: boolean;
  showInternalLabel: boolean;
  showLodTooltip: boolean;
  /** Inverse scale — only supplied when a screen-space element actually needs
   *  it, so plain nodes survive zoom frames without re-rendering. */
  invScale: number | undefined;
  mirrored: boolean;
  interactive: boolean;
  paneAriaLabel: string;
  onNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
  onNodeDblClick?: (id: NodeId, e: React.MouseEvent) => void;
  onNodeContextMenu?: (id: NodeId, e: React.MouseEvent) => void;
  onNodeHover?: (id: NodeId | null) => void;
  onNodeKeyDown?: (id: NodeId, e: React.KeyboardEvent) => void;
}

const PaneNode = memo(function PaneNode({
  nodeId,
  label,
  rawLabel,
  x,
  y,
  isTip,
  fill,
  stroke,
  dashedRed,
  selected,
  hovered,
  losses,
  glyph,
  showEventGlyph,
  showLoss,
  showTipLabel,
  showInternalLabel,
  showLodTooltip,
  invScale,
  mirrored,
  interactive,
  paneAriaLabel,
  onNodeClick,
  onNodeDblClick,
  onNodeContextMenu,
  onNodeHover,
  onNodeKeyDown,
}: PaneNodeProps) {
  const inv = invScale ?? 1;
  const r = isTip ? 5 : 6.5;
  const handleClick = useCallback(
    (e: React.MouseEvent) => onNodeClick?.(nodeId, e),
    [onNodeClick, nodeId],
  );
  const handleDblClick = useCallback(
    (e: React.MouseEvent) => onNodeDblClick?.(nodeId, e),
    [onNodeDblClick, nodeId],
  );
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onNodeContextMenu?.(nodeId, e),
    [onNodeContextMenu, nodeId],
  );
  const handleEnter = useCallback(() => onNodeHover?.(nodeId), [onNodeHover, nodeId]);
  const handleLeave = useCallback(() => onNodeHover?.(null), [onNodeHover]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNodeClick?.(nodeId, e as unknown as React.MouseEvent);
      }
      onNodeKeyDown?.(nodeId, e);
    },
    [onNodeClick, onNodeKeyDown, nodeId],
  );
  return (
    <g
      data-node-id={nodeId}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${paneAriaLabel} ${label}` : undefined}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={{ cursor: interactive ? 'pointer' : undefined, outline: 'none' }}
    >
      <circle
        cx={x}
        cy={y}
        r={r + (selected ? 2 : 0)}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={dashedRed ? '3 2' : undefined}
        vectorEffect="non-scaling-stroke"
        className={dashedRed ? 'recon-node-unresolved' : undefined}
      />
      {/* selection / hover ring in screen space (never shrinks away) */}
      {(selected || hovered) && (
        <circle
          cx={x}
          cy={y}
          r={r + 5 * inv}
          fill="none"
          stroke="var(--recon-select)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          opacity={selected ? 0.9 : 0.5}
        />
      )}
      {showEventGlyph && glyph && (
        <text
          transform={`translate(${x},${y - r - 4 * inv}) scale(${inv})`}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={fill}
          style={{ pointerEvents: 'none' }}
        >
          {glyph}
        </text>
      )}
      {showLoss && typeof losses === 'number' && losses > 0 && (
        <text
          transform={`translate(${x},${y + r + 9 * inv}) scale(${inv})`}
          textAnchor="middle"
          fontSize={9.5}
          fill="var(--recon-loss)"
          style={{ pointerEvents: 'none' }}
        >
          L{losses}
        </text>
      )}
      {showTipLabel && (
        <text
          /* S12/M39 (Sonus+UI_UX_REVIEW): screen-space font floor. Below 100%
             zoom the label holds a readable on-screen size instead of shrinking
             into nothing (a 4-tip tree fitted to 43% used to show zero names);
             at/above 100% it scales with the tree as before. The offsets are
             multiplied by the same inverse so the anchor distance stays fixed
             on screen too. */
          transform={`translate(${x + (mirrored ? -9 : 9) * inv}, ${y + 4 * inv}) scale(${inv})`}
          textAnchor={mirrored ? 'end' : 'start'}
          fontSize={11.5}
          fill="currentColor"
          style={{ pointerEvents: 'none' }}
        >
          {rawLabel}
        </text>
      )}
      {showInternalLabel && (
        /* Screen-space font floor, same treatment as the tip labels: the
           internal name stays readable at fit-zoom instead of shrinking away
           (the switch, not the zoom, decides whether it shows). */
        <text
          transform={`translate(${x + (mirrored ? r + 4 : -r - 4) * inv}, ${y + 4 * inv}) scale(${inv})`}
          textAnchor={mirrored ? 'start' : 'end'}
          fontSize={10.5}
          opacity={0.65}
          fill="currentColor"
          style={{ pointerEvents: 'none' }}
        >
          {rawLabel}
        </text>
      )}
      {/* hidden-by-LOD labels stay reachable via the tooltip */}
      {showLodTooltip && <title>{rawLabel}</title>}
    </g>
  );
});

export const ReconPane = memo(function ReconPane({
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
  headerExtra,
  nodeMeta,
  stubs,
  ariaLabel,
  options,
  onNodeClick,
  onNodeDblClick,
  onNodeContextMenu,
  onNodeHover,
  onNodeKeyDown,
  side,
}: ReconPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgBoxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved?: boolean } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // --- PhyloRecViewer-style edge presentation (用户反馈 2026-11-16) ------------
  // Species side: thick rounded slate tubes (optional fill→stroke gradient);
  // gene side: smooth curved family-coloured lines with a white halo. A single
  // gradient definition per pane serves every tube (objectBoundingBox vector
  // aligned with the growth axis, like PhyloRecViewer).
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const tubeGradId = `recon-tube-grad-${rawId}`;
  const familyIndex = useStore((s) => {
    const trees = s.project.geneTrees ?? [];
    const i = trees.findIndex((g) => g.id === s.activeGeneTreeId);
    return i < 0 ? 0 : i;
  });
  const edgeVariant: PaneEdgeVariant = useMemo(() => {
    if (side === 'species' && options.speciesTubeStyle) {
      return {
        kind: 'tube',
        width: options.speciesTubeWidth,
        opacity: options.speciesTubeOpacity,
        gradientId: options.speciesTubeGradient ? tubeGradId : null,
      };
    }
    if (side === 'gene' && options.geneCurveStyle) {
      return {
        kind: 'curve',
        width: options.geneLineThickness,
        familyIndex,
        halo: options.geneLineHalo,
      };
    }
    return { kind: 'thin' };
  }, [side, options, familyIndex, tubeGradId]);

  // --- imperative transform fast path -----------------------------------------
  // A wheel burst or pointer pan accumulates into `transformRef` and commits
  // through `onTransform` at most once per animation frame. The parent still
  // owns the committed transform, but input devices that report 125–1000 Hz no
  // longer cause 125–1000 React renders.
  const altHeld = useAltHeld();
  // 用户反馈: the typed zoom value mirrors the live scale; a wheel burst
  // keeps it current through the same effect that renders the header.
  const [zoomInput, setZoomInput] = useState(String(Math.round(transform.scale * 100)));
  useEffect(() => {
    setZoomInput(String(Math.round(transform.scale * 100)));
  }, [transform.scale]);
  const transformRef = useRef(transform);
  const gestureRef = useRef(false);
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const wheelIdleRef = useRef<number | null>(null);
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;

  // External updates (Fit, 1:1, synced zoom from the sibling pane) win whenever
  // no local gesture is in flight; a gesture's own commits are already the
  // value held in the ref and must not be rewound by the prop echo.
  useLayoutEffect(() => {
    if (!gestureRef.current) transformRef.current = transform;
  }, [transform]);

  const commitFrame = useCallback(() => {
    rafRef.current = null;
    if (!dirtyRef.current) return;
    onTransformRef.current(transformRef.current, true);
  }, []);

  const scheduleCommit = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(commitFrame);
  }, [commitFrame]);

  /** Flush the painted transform and end the local gesture. */
  const finishGesture = useCallback(() => {
    if (wheelIdleRef.current !== null) {
      window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (dirtyRef.current) {
      dirtyRef.current = false;
      onTransformRef.current(transformRef.current, true);
    }
    gestureRef.current = false;
  }, []);

  // A gesture can end without delivering pointerup (window blur, tab hidden,
  // OS taking the pointer over): flush the painted transform so the parent
  // state is not left behind the visible position.
  useEffect(() => {
    const onInterrupt = () => {
      if (!drag.current && !gestureRef.current) return;
      drag.current = null;
      finishGesture();
    };
    window.addEventListener('blur', onInterrupt);
    document.addEventListener('visibilitychange', onInterrupt);
    return () => {
      window.removeEventListener('blur', onInterrupt);
      document.removeEventListener('visibilitychange', onInterrupt);
      onInterrupt();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
    };
  }, [finishGesture]);

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
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      reportSize.current(w, h, top);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 用户反馈：three ways to set the pane scale — wheel (existing), a typed
  // exact value, and preset steps. zoomToScale anchors at the pane centre and
  // commits once (a single action, not a wheel burst).
  const zoomToScale = useCallback(
    (nextScale: number) => {
      const live = transformRef.current;
      const scale = Math.max(RECON_MIN_SCALE, Math.min(RECON_MAX_SCALE, nextScale));
      if (scale === live.scale) return;
      const k = scale / live.scale;
      const cx = box.w / 2;
      const cy = box.h / 2;
      gestureRef.current = true;
      transformRef.current = {
        scale,
        tx: cx - (cx - live.tx) * k,
        ty: cy - (cy - live.ty) * k,
      };
      scheduleCommit();
      finishGesture();
    },
    [box.w, box.h, scheduleCommit, finishGesture],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = svgBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      gestureRef.current = true;
      // Compound on the LIVE transform: several wheel events can arrive before
      // the next frame, and each must build on the previous one.
      const live = transformRef.current;
      // M32 (UI_UX_REVIEW): the main canvas contract — Ctrl/⌘+wheel (trackpad
      // pinch) zooms, a plain two-finger scroll PANS. The recon pane used to
      // zoom on every wheel, so the pan gesture users learned on the main
      // canvas turned into zoom jitter here. Same contract, same limits.
      if (e.ctrlKey || e.metaKey) {
        const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = Math.max(RECON_MIN_SCALE, Math.min(RECON_MAX_SCALE, live.scale * k));
        const kk = scale / live.scale;
        transformRef.current = {
          scale,
          tx: mx - (mx - live.tx) * kk,
          ty: my - (my - live.ty) * kk,
        };
      } else {
        transformRef.current = {
          ...live,
          tx: live.tx - e.deltaX,
          ty: live.ty - e.deltaY,
        };
      }
      scheduleCommit();
      // One final commit when the burst settles, mirroring the main canvas.
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = window.setTimeout(finishGesture, 140);
    },
    [scheduleCommit, finishGesture],
  );

  const bgDown = (e: React.PointerEvent) => {
    if ((e.target as Element | null)?.closest('[data-node-id]')) return;
    const live = transformRef.current;
    drag.current = { x: e.clientX, y: e.clientY, tx: live.tx, ty: live.ty };
    gestureRef.current = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const bgMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // M33: track total travel so a still press can be told from a pan.
    d.moved = Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4 ? true : d.moved;
    transformRef.current = {
      ...transformRef.current,
      tx: d.tx + (e.clientX - d.x),
      ty: d.ty + (e.clientY - d.y),
    };
    scheduleCommit();
  };
  const bgUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // M33 (UI_UX_REVIEW): a still background click (≤4px travel) clears the
    // selection, matching the main canvas; the pan keeps moving the view.
    if (!d.moved) {
      const st = useStore.getState();
      if (st.selection.length > 0 || st.geneSelection.length > 0) {
        st.clearSelection();
        st.clearGeneSelection();
      }
    }
    finishGesture();
  };

  // LOD thresholds: hide labels whose SCREEN font size drops below readability.
  // S12/M39: SMALL trees keep their tip labels — they now carry a screen-space
  // font floor, so hiding them bought nothing but lost identity. Large trees
  // keep the density-based LOD (labels would overlap into a solid band).
  const tipCount = useMemo(
    () => Object.values(doc.nodes).filter((n) => n.childrenIds.length === 0).length,
    [doc],
  );
  const RECON_READABLE_TIP_LIMIT = 30;
  // 用户反馈 (2026-11-23): internal names answer to their own switch
  // (options.showInternalLabels) — no zoom LOD hides them any more. Tip labels
  // keep the density LOD (a fitted 1000-tip tree is unreadable otherwise).
  const hideTipLabels =
    options.showLabels && tipCount > RECON_READABLE_TIP_LIMIT && transform.scale * 11.5 < 7;
  const boxW = box.w;
  const boxH = box.h;
  const invScale = 1 / transform.scale;
  // The two panes face each other: the species tree grows rightwards and the
  // gene tree is mirrored, so labels and mapping stubs swap sides too.
  const mirrored = side === 'gene';
  const branchOrientation = mirrored ? ('RL' as const) : ('LR' as const);

  // --- viewport culling --------------------------------------------------------
  // Only nodes inside this pane's viewport (plus one screen of buffer) mount.
  // The buffer keeps elbow branches entering from off-screen connected; the
  // committed-view cull the main canvas uses is not needed here because the
  // parent re-renders per coalesced frame.
  const visibleIds = useMemo(
    () => cullPaneNodes(layout, transform, boxW, boxH),
    [layout, transform, boxW, boxH],
  );
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  return (
    <div className={`recon-pane recon-pane--${side ?? 'gene'}`} ref={hostRef} role="group" aria-label={ariaLabel}>
      <div className="recon-pane-header">
        <div className="recon-pane-title">
          <span className="recon-pane-name">{title}</span>
          <span className="recon-pane-sub">{subtitle}</span>
        </div>
        {badge && (
          <span className={`recon-pane-badge${badgeTone === 'readonly' ? ' readonly' : ''}${badgeTone === 'editing' ? ' editing' : ''}`}>
            {badge}
          </span>
        )}
        <span className="recon-pane-count">
          {tr('节点', 'nodes')} {nodeCount}
        </span>
        {/* 用户反馈：ONE combined 缩放 control — the typed value lives inside the
            same rounded box as the preset menu (the old row had a separate left
            number field and a 档位 select). */}
        <div className="recon-zoom-group" title={tr('缩放', 'Zoom')}>
          <select
            className="recon-zoom-presets"
            value={
              [50, 75, 100, 150, 200, 300].includes(Math.round(transform.scale * 100))
                ? String(Math.round(transform.scale * 100))
                : ''
            }
            aria-label={tr('缩放', 'Zoom')}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v) zoomToScale(v / 100);
            }}
          >
            <option value="" disabled>
              {tr('缩放', 'Zoom')}
            </option>
            {[50, 75, 100, 150, 200, 300].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
          <input
            className="recon-zoom-input"
            type="number"
            min={Math.round(RECON_MIN_SCALE * 100)}
            max={Math.round(RECON_MAX_SCALE * 100)}
            step={5}
            value={zoomInput}
            aria-label={tr('缩放百分比', 'Zoom percentage')}
            onChange={(e) => setZoomInput(e.target.value)}
            onBlur={() => {
              const n = parseFloat(zoomInput);
              if (Number.isFinite(n)) zoomToScale(n / 100);
              else setZoomInput(String(Math.round(transform.scale * 100)));
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
        </div>
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
        /* M37: copy cursor while Alt is held — the mapping gesture answers
           before the click, not only in a dismissable banner. */
        style={{ cursor: altHeld ? 'copy' : undefined }}
      >
        <svg>
          {/* PhyloRec species-tube gradient: fill at the root end → stroke at
              the tip end, along the pane's growth axis. */}
          <defs>
            <linearGradient
              id={tubeGradId}
              x1={mirrored ? 1 : 0}
              y1={0}
              x2={mirrored ? 0 : 1}
              y2={0}
            >
              <stop offset="0" style={{ stopColor: 'var(--pr-tube-fill)' }} />
              <stop offset="1" style={{ stopColor: 'var(--pr-tube-stroke)' }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {/* edges */}
            {visibleIds.map((id) => {
              const n = doc.nodes[id];
              if (!n || !n.parentId) return null;
              if (!visibleSet.has(n.parentId)) return null;
              const from = layout.positions.get(id);
              const to = layout.positions.get(n.parentId);
              if (!from || !to) return null;
              return (
                <PaneEdge
                  key={`e${id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  orientation={branchOrientation}
                  variant={edgeVariant}
                />
              );
            })}
            {/* mapping guide stubs (layer 2, under nodes) */}
            {options.showMappings &&
              stubs?.map((stub) => {
                if (!visibleSet.has(stub.nodeId)) return null;
                const p = layout.positions.get(stub.nodeId);
                if (!p) return null;
                return (
                  <PaneStubLine
                    key={`s${stub.nodeId}`}
                    x1={p.x}
                    y1={p.y}
                    x2={stubEdgeX(transform, boxW, mirrored)}
                    y2={p.y}
                    token={stub.token}
                    emphasized={stub.emphasized}
                    muted={stub.muted}
                  />
                );
              })}
            {/* nodes */}
            {visibleIds.map((id) => {
              const n = doc.nodes[id];
              if (!n) return null;
              const p = layout.positions.get(id);
              if (!p) return null;
              const meta = nodeMeta?.get(id);
              const isTip = n.childrenIds.length === 0;
              const fill = meta?.dashedRed ? 'var(--surface)' : meta?.fill ?? 'var(--recon-node-fill)';
              const stroke = meta?.selected || meta?.hovered
                ? 'var(--recon-select)'
                : meta?.dashedRed
                  ? 'var(--danger)'
                  : meta?.fill ?? 'var(--recon-node-stroke)';
              const label = n.label || n.id.slice(0, 6);
              const showTipLabel = isTip && !!n.label && options.showLabels && !hideTipLabels;
              // 用户反馈: internal names have their own switch and fall back to
              // the short id — the same name the left-panel list shows.
              const showInternalLabel = !isTip && options.showLabels && options.showInternalLabels;
              const selected = !!meta?.selected;
              const hovered = !!meta?.hovered;
              const glyph = meta?.glyph;
              const losses = meta?.losses;
              const showEventGlyph = options.showEventGlyphs && !!glyph;
              const showLoss = options.showLosses && typeof losses === 'number' && losses > 0;
              // `invScale` is the only transform-dependent prop, and only rows
              // that draw screen-space chrome receive it — a zoom frame leaves
              // every plain node's props unchanged.
              const needsInv = selected || hovered || showEventGlyph || showLoss || showInternalLabel;
              return (
                <PaneNode
                  key={id}
                  nodeId={id}
                  label={label}
                  rawLabel={isTip ? (n.label ?? '') : label}
                  x={p.x}
                  y={p.y}
                  isTip={isTip}
                  fill={fill}
                  stroke={stroke}
                  dashedRed={!!meta?.dashedRed}
                  selected={selected}
                  hovered={hovered}
                  losses={losses}
                  glyph={glyph}
                  showEventGlyph={showEventGlyph}
                  showLoss={showLoss}
                  showTipLabel={showTipLabel}
                  showInternalLabel={showInternalLabel}
                  showLodTooltip={
                    options.showLabels && !showTipLabel && !showInternalLabel && !!label
                  }
                  invScale={needsInv ? invScale : undefined}
                  mirrored={mirrored}
                  interactive={!!onNodeClick}
                  paneAriaLabel={ariaLabel}
                  onNodeClick={onNodeClick}
                  onNodeDblClick={onNodeDblClick}
                  onNodeContextMenu={onNodeContextMenu}
                  onNodeHover={onNodeHover}
                  onNodeKeyDown={onNodeKeyDown}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
});

/** Build stub descriptors for one pane's nodes from the collected lines. */
export function stubsFromLines(
  lines: { geneNodeId: NodeId; speciesNodeId: NodeId; token: MappingColorToken; state: string }[],
  side: 'species' | 'gene',
): PaneStub[] {
  const out: PaneStub[] = [];
  // Rebuilt on every hover/selection change, so dedupe through a Set: the old
  // `out.some(...)` made this O(lines²) on large families.
  const seen = new Set<NodeId>();
  for (const l of lines) {
    const id = side === 'species' ? l.speciesNodeId : l.geneNodeId;
    if (seen.has(id)) continue;
    seen.add(id);
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
