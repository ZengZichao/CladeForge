// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The EMBEDDED reconciliation canvas: a single viewport where the species tree
// is drawn as THICK branch tubes with the gene tree's THIN lineages nested
// inside them.
//
// Rendering contract:
//  - the species tree is the only skeleton: horizontal tubes + vertical hub
//    bars at every internal node, so the whole tree reads as thick wood;
//  - gene segments are clipped to tubes ∪ hubs through an SVG <mask> whose
//    white strokes are the tube/hub geometry (a clipPath cannot clip a STROKE
//    shape — the mask is the reliable construction, §6.3);
//  - transfer arcs, loss stubs, selection chrome and labels are drawn OUTSIDE
//    the mask;
//  - tube widths and gene line widths live in WORLD units (zooming keeps the
//    gene lines inside the tubes), while glyphs, rings and labels use
//    screen-space (inverse-scaled) sizes like `ReconPane`;
//  - pan/zoom coalesces input into a ref and commits at most once per frame;
//  - the layout runs only when documents/options change — never on pan/zoom.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GeneTreeEntry, NodeId, Project, ReconViewOptions } from '../model/types';
import { computeLayout } from '../layout/autoLayout';
import {
  computeEmbeddedReconLayout,
  defaultEmbeddedLayoutOptions,
  fitEmbeddedBounds,
  hitTestTube,
  prepareEmbeddedSpeciesDoc,
  EMBEDDED_MIN_SCALE,
  EMBEDDED_MAX_SCALE,
  type EmbeddedHub,
  type EmbeddedLossMark,
  type EmbeddedTube,
  type EmbeddedTransferArc,
} from '../layout/embeddedRecon';
import { S, tr } from '../ui/strings';
import { useAltHeld } from './ReconPane';
import { prFamilyVar } from './phyloTheme';
import { useStore } from '../model/store';

const IDENTITY: { tx: number; ty: number; scale: number } = { tx: 40, ty: 40, scale: 1 };
type Transform = { tx: number; ty: number; scale: number };

/** Event-class colour — the same CSS variables the bridge view uses. */
function eventColor(event: string | null, kind: 'tip' | 'internal'): string {
  if (event === 'speciation') return 'var(--recon-map-sigma)';
  if (event === 'duplication') return 'var(--recon-map-dup)';
  if (event === 'transfer') return 'var(--recon-map-transfer)';
  return kind === 'tip' ? 'var(--recon-tip)' : 'var(--recon-map-unresolved)';
}

export interface EmbeddedReconCanvasProps {
  speciesDoc: Project;
  geneEntry: GeneTreeEntry;
  options: ReconViewOptions;
  geneSelection: NodeId[];
  speciesSelection: NodeId[];
  hoveredGeneId: NodeId | null;
  focusTarget: { id: NodeId; seq: number } | null;
  /** Plain clicks select gene nodes — gated by the 点选目标 toggle upstream;
   *  undefined renders the markers inert so presses fall through to pan. */
  onGeneNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
  /** Plain clicks select species nodes (tubes fall back to this without Alt). */
  onSpeciesNodeClick?: (id: NodeId, e: React.MouseEvent) => void;
  /** Alt+click a tube: map the selected gene node to this branch at `t`. */
  onTubeClick?: (branchId: NodeId, t: number, e: React.MouseEvent) => void;
  onGeneHover: (id: NodeId | null) => void;
  /** Single-viewport zoom readout (status bar). */
  onZoomChange?: (zoom: number) => void;
}

export function EmbeddedReconCanvas({
  speciesDoc,
  geneEntry,
  options,
  geneSelection,
  speciesSelection,
  hoveredGeneId,
  focusTarget,
  onGeneNodeClick,
  onSpeciesNodeClick,
  onTubeClick,
  onGeneHover,
  onZoomChange,
}: EmbeddedReconCanvasProps) {
  const svgBoxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [transform, setTransformState] = useState<Transform>(IDENTITY);
  const fitMode = useRef(true);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  // --- size measurement ----------------------------------------------------------
  useEffect(() => {
    const el = svgBoxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    // jsdom (component tests) has no ResizeObserver; the one-shot measure above
    // still gives the canvas a usable box there.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- scene (layout pass — independent of pan/zoom) -------------------------------
  const speciesLayout = useMemo(
    () => computeLayout(prepareEmbeddedSpeciesDoc(speciesDoc)),
    [speciesDoc],
  );
  const scene = useMemo(
    () =>
      computeEmbeddedReconLayout({
        speciesDoc,
        speciesLayout,
        geneDoc: geneEntry.doc,
        assumptions: geneEntry.assumptions,
        options: defaultEmbeddedLayoutOptions(
          Math.max(10, Math.min(32, options.embeddedTubeWidth)),
          Math.max(1.5, Math.min(6, options.embeddedLaneGap)),
        ),
      }),
    [speciesDoc, speciesLayout, geneEntry, options.embeddedTubeWidth, options.embeddedLaneGap],
  );

  // Mask id: useId() can contain ':', which breaks url(#…) references.
  const rawId = useId();
  const maskId = useMemo(() => `er-mask-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);
  const tubeGradId = useMemo(() => `er-tubegrad-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);

  // PhyloRecViewer family colour for the active gene tree (用户反馈
  // 2026-11-16): lineages are painted per family, event glyphs stay
  // event-coloured. The swap guard matches ReconPane (index -1 → 0).
  const familyIndex = useStore((s) => {
    const trees = s.project.geneTrees ?? [];
    const i = trees.findIndex((g) => g.id === s.activeGeneTreeId);
    return i < 0 ? 0 : i;
  });
  const familyColor = prFamilyVar(familyIndex);
  const lineageColor = (event: string | null, kind: 'tip' | 'internal'): string =>
    options.embeddedFamilyColors ? familyColor : eventColor(event, kind);

  // --- pan/zoom (coalesced commit, same pattern as ReconPane) ----------------------
  const transformRef = useRef(transform);
  const gestureRef = useRef(false);
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const wheelIdleRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!gestureRef.current) transformRef.current = transform;
  }, [transform]);

  const commitFrame = useCallback(() => {
    rafRef.current = null;
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setTransformState(transformRef.current);
  }, []);

  const scheduleCommit = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(commitFrame);
  }, [commitFrame]);

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
      setTransformState(transformRef.current);
    }
    gestureRef.current = false;
  }, []);

  useEffect(() => {
    const onInterrupt = () => {
      if (!dragRef.current && !gestureRef.current) return;
      dragRef.current = null;
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

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = svgBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const live = transformRef.current;
      gestureRef.current = true;
      fitMode.current = false;
      // M32: main-canvas wheel contract — Ctrl/⌘+wheel (trackpad pinch) zooms;
      // a plain two-finger scroll pans. Every wheel used to zoom here too.
      if (e.ctrlKey || e.metaKey) {
        const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = Math.max(EMBEDDED_MIN_SCALE, Math.min(EMBEDDED_MAX_SCALE, live.scale * k));
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
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = window.setTimeout(finishGesture, 140);
    },
    [scheduleCommit, finishGesture],
  );

  const bgDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-node-id],[data-tube-id]')) return;
    const live = transformRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: live.tx, ty: live.ty };
    gestureRef.current = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const bgMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    transformRef.current = {
      ...transformRef.current,
      tx: d.tx + (e.clientX - d.x),
      ty: d.ty + (e.clientY - d.y),
    };
    scheduleCommit();
  };
  const bgUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    finishGesture();
  };

  // --- fit / 1:1 / focus -------------------------------------------------------------
  const fit = useCallback(() => {
    if (box.w <= 0 || box.h <= 0) return;
    fitMode.current = true;
    transformRef.current = fitEmbeddedBounds(scene.bounds, box.w, box.h);
    setTransformState(transformRef.current);
  }, [scene, box.w, box.h]);

  const resetZoom = useCallback(() => {
    fitMode.current = false;
    const cx = box.w / 2;
    const cy = box.h / 2;
    setTransformState((t: Transform) => {
      const wx = (cx - t.tx) / t.scale;
      const wy = (cy - t.ty) / t.scale;
      return { scale: 1, tx: cx - wx, ty: cy - wy };
    });
  }, [box.w, box.h]);

  // Fit on entry/size change while in fit mode.
  useEffect(() => {
    if (box.w <= 0 || box.h <= 0) return;    if (!fitMode.current) return;
    const t = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(t);
  }, [box.w, box.h, geneEntry.id, fit]);

  // ⌘⇧F reaches the canvas through this event (the side-by-side listener is
  // unmounted with its view, so exactly one handler is active per mode).
  useEffect(() => {
    const onFitEvt = () => fit();
    window.addEventListener('cladeforge:recon-fit', onFitEvt);
    return () => window.removeEventListener('cladeforge:recon-fit', onFitEvt);
  }, [fit]);

  // 用户反馈: the zoom control lives in the status bar's 嵌套视图缩放 readout
  // (bottom-right) — these events carry its slider / 1:1 button into the canvas.
  useEffect(() => {
    const onZoomTo = (e: Event) => {
      const scale = (e as CustomEvent<number>).detail;
      if (!Number.isFinite(scale)) return;
      fitMode.current = false;
      const cx = box.w / 2;
      const cy = box.h / 2;
      setTransformState((t: Transform) => {
        const wx = (cx - t.tx) / t.scale;
        const wy = (cy - t.ty) / t.scale;
        const s = Math.max(EMBEDDED_MIN_SCALE, Math.min(EMBEDDED_MAX_SCALE, scale));
        return { scale: s, tx: cx - wx * s, ty: cy - wy * s };
      });
    };
    const onZoomReset = () => resetZoom();
    window.addEventListener('cladeforge:embedded-zoom', onZoomTo);
    window.addEventListener('cladeforge:embedded-zoom-reset', onZoomReset);
    return () => {
      window.removeEventListener('cladeforge:embedded-zoom', onZoomTo);
      window.removeEventListener('cladeforge:embedded-zoom-reset', onZoomReset);
    };
  }, [box.w, box.h, resetZoom]);

  // Zoom readout for the workspace status bar.
  useEffect(() => {
    onZoomChange?.(transform.scale);
  }, [transform.scale, onZoomChange]);

  // "Locate" from the panel/inspector: centre the placed gene node.
  const focusSeq = focusTarget?.seq ?? 0;
  const lastFocusSeq = useRef(0);
  useEffect(() => {
    if (!focusTarget || focusSeq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusSeq;
    const p = scene.placements.get(focusTarget.id);
    if (!p || p.unmapped) return;
    fitMode.current = false;
    const s = transformRef.current.scale;
    setTransformState({ scale: s, tx: box.w / 2 - p.x * s, ty: box.h / 2 - p.y * s });
  }, [focusSeq, focusTarget, scene, box.w, box.h]);

  // --- derived view state ---------------------------------------------------------------
  const selectedGene = useMemo(() => new Set(geneSelection), [geneSelection]);
  const selectedSpecies = useMemo(() => new Set(speciesSelection), [speciesSelection]);
  const inv = 1 / transform.scale;

  // Filters WEAKEN non-matching elements instead of hiding them (§7.2): the
  // nested figure must keep the gene tree intact.
  const isMuted = useCallback(
    (geneNodeId: NodeId, event: string | null, kind: 'tip' | 'internal'): boolean => {
      if (selectedGene.has(geneNodeId) || hoveredGeneId === geneNodeId) return false;
      const n = geneEntry.doc.nodes[geneNodeId];
      const isTip = kind === 'tip' || (n?.childrenIds.length ?? 0) === 0;
      if (options.mappingScope === 'tips' && !isTip) return true;
      if (options.mappingScope === 'internal' && isTip) return true;
      if (options.eventFilter !== 'all') {
        if (options.eventFilter === 'unresolved') return !(kind === 'internal' && event === null);
        if (event !== options.eventFilter) return true;
      }
      return false;
    },
    [selectedGene, hoveredGeneId, geneEntry.doc.nodes, options.mappingScope, options.eventFilter],
  );

  const hideGeneTipLabels = options.showLabels && transform.scale * 9.5 < 7;
  // M37: persistent Alt feedback — copy cursor while Alt is held anywhere.
  const altHeld = useAltHeld();
  const geneLabelSet = useMemo(() => {
    // Gene labels: tips by default (LOD); internal only when selected/hovered.
    // m17 (UI_UX_REVIEW): a 1:1-mapped tip with the SAME label as its species
    // tube suppressed its own copy — "Taxon_A" used to print twice, stacked.
    // Species-side and gene-side differ in label ⇒ both stay.
    const show = new Set<NodeId>();
    if (!options.showLabels) return show;
    for (const n of Object.values(geneEntry.doc.nodes)) {
      const isTip = n.childrenIds.length === 0;
      if (isTip && !hideGeneTipLabels) {
        const sn = geneEntry.assumptions[n.id]?.speciesNode;
        const speciesLabel = sn ? speciesDoc.nodes[sn]?.label : undefined;
        if (speciesLabel !== undefined && speciesLabel === n.label) continue;
        show.add(n.id);
      } else if (!isTip && (selectedGene.has(n.id) || hoveredGeneId === n.id)) {
        show.add(n.id);
      }
    }
    return show;
  }, [geneEntry.doc.nodes, geneEntry.assumptions, speciesDoc, options.showLabels, hideGeneTipLabels, selectedGene, hoveredGeneId]);

  // No ages and no usable lengths ⇒ the nested figure is a topological sketch.

  // Multiple loss marks can share one fork — fan them out horizontally.
  const lossOffsets = useMemo(() => {
    const seen = new Map<string, number>();
    return scene.losses.map((l) => {
      const key = `${Math.round(l.x)},${Math.round(l.y)}`;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      return idx * 7;
    });
  }, [scene.losses]);

  // --- interaction: world-space helpers ----------------------------------------------
  const eventToWorld = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const el = svgBoxRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const live = transformRef.current;
    return {
      x: (e.clientX - rect.left - live.tx) / live.scale,
      y: (e.clientY - rect.top - live.ty) / live.scale,
    };
  }, []);

  // 用户反馈: the 点选目标 toggle decides which side is interactive — a
  // press aimed at the gene lines must not be swallowed by a nearby tube.
  const tubeClickable = Boolean(onTubeClick || onSpeciesNodeClick);
  const handleTubeClick = useCallback(
    (branchId: NodeId, e: React.MouseEvent) => {
      if (!tubeClickable) return;
      if (e.altKey) {
        e.stopPropagation();
        const w = eventToWorld(e);
        const hit = w ? hitTestTube(scene.tubes.values(), w, 2) : null;
        onTubeClick?.(branchId, hit?.tube.branchId === branchId ? hit.t : 1, e);
        return;
      }
      onSpeciesNodeClick?.(branchId, e);
    },
    [eventToWorld, scene, onTubeClick, onSpeciesNodeClick, tubeClickable],
  );

  // --- viewport culling -----------------------------------------------------------------
  const view = useMemo(() => {
    // Before the first measurement (box 0×0 — or a headless DOM) draw
    // everything rather than culing the whole figure away.
    const unmeasured = box.w <= 0 || box.h <= 0;
    const pad = unmeasured ? Infinity : Math.max(box.w, box.h) / Math.max(0.001, transform.scale);
    const x0 = (0 - transform.tx) / transform.scale - pad;
    const y0 = (0 - transform.ty) / transform.scale - pad;
    const x1 = (box.w - transform.tx) / transform.scale + pad;
    const y1 = (box.h - transform.ty) / transform.scale + pad;
    const vis = unmeasured
      ? () => true
      : (bx0: number, by0: number, bx1: number, by1: number) =>
          bx1 >= x0 && bx0 <= x1 && by1 >= y0 && by0 <= y1;
    const tubes = [...scene.tubes.values()].filter((t) =>
      vis(
        Math.min(t.x0, t.x1) - t.width,
        t.y - t.width,
        Math.max(t.x0, t.x1) + t.width,
        t.y + t.width,
      ),
    );
    const hubs = [...scene.hubs.values()].filter((h) =>
      vis(
        h.x - h.width,
        Math.min(h.y0, h.y1) - h.width,
        h.x + h.width,
        Math.max(h.y0, h.y1) + h.width,
      ),
    );
    const tubeVisible = new Set(tubes.map((t) => t.branchId));
    const segments = scene.segments.filter((s) => !s.hostBranchId || tubeVisible.has(s.hostBranchId));
    const speciesNodes = [...scene.speciesLayout.visible].filter((id) => {
      const p = scene.speciesLayout.positions.get(id);
      return !!p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    return { tubes, hubs, segments, speciesNodes, tubeVisible };
  }, [scene, transform, box.w, box.h]);

  const maskSpan = 400; // world-px buffer so panning never clips at the mask edge

  return (
    <div className="recon-embedded" role="group" aria-label={S.recon.embeddedAria}>
      {/* 用户反馈: no in-canvas header (title / subtitle / node count / zoom
          buttons) and no Alt-click hint bar — the toolbar fits the view, and
          the zoom control lives in the status bar's 嵌套视图缩放 readout. */}
      <div
        className="recon-embedded-svg"
        ref={svgBoxRef}
        onWheel={onWheel}
        onPointerDown={bgDown}
        onPointerMove={bgMove}
        onPointerUp={bgUp}
        onPointerCancel={bgUp}
        /* M37: the Alt+click mapping mode had a dismissable banner and then
           nothing — after closing it, holding Alt gave no signal. While Alt is
           down the whole pane answers with a copy cursor (persistent, invisible
           when the mode's precondition isn't met because the click itself
           explains). */
        style={{ cursor: altHeld ? 'copy' : undefined }}
      >
        <svg>
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={scene.bounds.minX - maskSpan}
              y={scene.bounds.minY - maskSpan}
              width={scene.bounds.maxX - scene.bounds.minX + maskSpan * 2}
              height={scene.bounds.maxY - scene.bounds.minY + maskSpan * 2}
            >
              <rect
                x={scene.bounds.minX - maskSpan}
                y={scene.bounds.minY - maskSpan}
                width={scene.bounds.maxX - scene.bounds.minX + maskSpan * 2}
                height={scene.bounds.maxY - scene.bounds.minY + maskSpan * 2}
                fill="black"
              />
              {view.tubes.map((t) => (
                <path
                  key={`mt${t.branchId}`}
                  d={t.path}
                  fill="none"
                  stroke="white"
                  strokeWidth={t.width}
                  strokeLinecap="round"
                />
              ))}
              {view.hubs.map((h) => (
                <path
                  key={`mh${h.parentId}`}
                  d={h.path}
                  fill="none"
                  stroke="white"
                  strokeWidth={h.width}
                  strokeLinecap="round"
                />
              ))}
              {view.hubs.map((h) => (
                <circle
                  key={`mc${h.parentId}`}
                  cx={h.x}
                  cy={h.y}
                  r={h.nodeRadius}
                  fill="white"
                />
              ))}
            </mask>
            {/* PhyloRec species-tube gradient: fill (root side) → stroke
                (tip side) along the horizontal growth axis. */}
            <linearGradient id={tubeGradId} x1={0} y1={0} x2={1} y2={0}>
              <stop offset="0" style={{ stopColor: 'var(--pr-tube-fill)' }} />
              <stop offset="1" style={{ stopColor: 'var(--pr-tube-stroke)' }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {/* layers 1+2: species tubes (border + fill) and hub bars */}
            {view.tubes.map((t) => (
              <EmbeddedTubeShape
                key={`t${t.branchId}`}
                tube={t}
                highlighted={selectedSpecies.has(t.branchId)}
                gradientId={options.embeddedTubeGradient ? tubeGradId : null}
                opacity={options.embeddedTubeOpacity}
                onClick={tubeClickable ? handleTubeClick : undefined}
              />
            ))}
            {view.hubs.map((h) => (
              <EmbeddedHubShape key={`h${h.parentId}`} hub={h} />
            ))}
            {/* species nodes + labels */}
            {view.speciesNodes.map((id) => {
              const n = speciesDoc.nodes[id];
              const p = scene.speciesLayout.positions.get(id)!;
              const isTip = (n?.childrenIds.length ?? 0) === 0;
              const selected = selectedSpecies.has(id);
              return (
                <g key={`sn${id}`} data-node-id={id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isTip ? 4.5 : 5.5}
                    fill={selected ? 'var(--recon-select)' : 'var(--recon-node-fill)'}
                    stroke="var(--recon-node-stroke)"
                    strokeWidth={selected ? 2.5 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    style={onSpeciesNodeClick ? { cursor: 'pointer' } : undefined}
                    role={onSpeciesNodeClick ? 'button' : undefined}
                    tabIndex={onSpeciesNodeClick ? 0 : undefined}
                    aria-label={S.recon.ariaSpeciesNode(n?.label || id.slice(0, 6))}
                    onClick={onSpeciesNodeClick ? (e) => onSpeciesNodeClick(id, e) : undefined}
                    onKeyDown={(e) => {
                      if (!onSpeciesNodeClick) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSpeciesNodeClick(id, e as unknown as React.MouseEvent);
                      }
                    }}
                  />
                  {n?.label && options.showLabels && (
                    <text
                      x={isTip ? p.x + 9 : p.x - 9}
                      y={p.y + 4}
                      textAnchor={isTip ? 'start' : 'end'}
                      fontSize={isTip ? 11.5 : 10.5}
                      opacity={isTip ? 1 : 0.65}
                      fill="currentColor"
                      style={{ pointerEvents: 'none' }}
                    >
                      {n.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* layer 3: gene segments inside the mask */}
            <g mask={`url(#${maskId})`}>
              {view.segments.map((s) => {
                const muted = isMuted(s.geneNodeId, s.event, s.kind);
                const emphasized =
                  selectedGene.has(s.geneNodeId) || hoveredGeneId === s.geneNodeId;
                return (
                  <EmbeddedSegment
                    key={s.id}
                    d={s.d}
                    color={lineageColor(s.event, s.kind)}
                    halo={options.embeddedGeneHalo}
                    dashed={s.dashed}
                    muted={muted}
                    emphasized={emphasized}
                  />
                );
              })}
            </g>
            {/* layer 4: transfer arcs (unmasked) */}
            {options.embeddedShowTransfers &&
              scene.transfers.map((arc) => {
                const muted = isMuted(arc.geneNodeId, 'transfer', 'internal');
                const emphasized =
                  selectedGene.has(arc.geneNodeId) || hoveredGeneId === arc.geneNodeId;
                return (
                  <EmbeddedTransferArcShape
                    key={`ta${arc.geneNodeId}`}
                    arc={arc}
                    color={options.embeddedFamilyColors ? familyColor : 'var(--recon-map-transfer)'}
                    muted={muted}
                    emphasized={emphasized}
                    titleTopo={tr(
                      '拓扑转移（无年代数据，未做时间校验）',
                      'Topological transfer (no age data; time not checked)',
                    )}
                    titleInfeasible={tr('时间不可行的转移', 'Time-infeasible transfer')}
                  />
                );
              })}
            {/* layer 5: gene node markers + event glyphs + gene labels */}
            {[...scene.placements.values()].map((p) => {
              if (p.unmapped) return null;
              const n = geneEntry.doc.nodes[p.geneNodeId];
              const emphasized =
                selectedGene.has(p.geneNodeId) || hoveredGeneId === p.geneNodeId;
              const muted = isMuted(p.geneNodeId, p.event, p.kind);
              const r = p.kind === 'tip' ? 2.6 : 3.2;
              const fill = p.inferred || p.unresolved
                ? 'var(--surface)'
                : lineageColor(p.event, p.kind);
              const stroke = emphasized
                ? 'var(--recon-select)'
                : p.inferred || p.unresolved
                  ? 'var(--recon-map-unresolved)'
                  : 'var(--recon-node-stroke)';
              return (
                <g
                  key={`gn${p.geneNodeId}`}
                  data-node-id={p.geneNodeId}
                  onClick={onGeneNodeClick ? (e) => onGeneNodeClick(p.geneNodeId, e) : undefined}
                  onPointerEnter={() => onGeneHover(p.geneNodeId)}
                  onPointerLeave={() => onGeneHover(null)}
                  onKeyDown={(e) => {
                    if (!onGeneNodeClick) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onGeneNodeClick(p.geneNodeId, e as unknown as React.MouseEvent);
                    }
                  }}
                  role={onGeneNodeClick ? 'button' : undefined}
                  tabIndex={onGeneNodeClick ? 0 : undefined}
                  style={onGeneNodeClick ? { cursor: 'pointer', outline: 'none' } : undefined}
                  aria-label={S.recon.ariaGeneNode(
                    n?.label || p.geneNodeId.slice(0, 6),
                    p.speciesNodeId
                      ? speciesDoc.nodes[p.speciesNodeId]?.label || ''
                      : S.recon.tipUnmapped,
                    p.event === 'speciation'
                      ? S.recon.legendSigma
                      : p.event === 'duplication'
                        ? S.recon.legendDup
                        : p.event === 'transfer'
                          ? S.recon.legendTransfer
                          : '',
                    geneEntry.assumptions[p.geneNodeId]?.losses ?? 0,
                  )}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + (emphasized ? 1.2 : 0)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1.2}
                    strokeDasharray={p.inferred || p.unresolved ? '2 1.6' : undefined}
                    opacity={muted && !emphasized ? 0.35 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                  {emphasized && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 5 * inv}
                      fill="none"
                      stroke="var(--recon-select)"
                      strokeWidth={1.2}
                      opacity={0.9}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {options.showEventGlyphs && p.event && (
                    <text
                      transform={`translate(${p.x},${p.y - r - 5 * inv}) scale(${inv})`}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill={eventColor(p.event, p.kind)}
                      opacity={muted ? 0.4 : 1}
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.event === 'speciation' ? 'S' : p.event === 'duplication' ? 'D' : 'T'}
                    </text>
                  )}
                  {geneLabelSet.has(p.geneNodeId) && n?.label && (
                    <text
                      transform={`translate(${p.x},${p.y - r - 3.5 * inv}) scale(${inv})`}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill="currentColor"
                      opacity={muted ? 0.35 : 1}
                      style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                      stroke="var(--recon-pane-bg)"
                      strokeWidth={2.5}
                    >
                      {n.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* layer 6: loss stubs + λ badges (unmasked) */}
            {options.showLosses &&
              options.embeddedShowLossStubs &&
              scene.losses.map((l, i) => (
                <EmbeddedLossShape
                  key={`ls${l.geneNodeId}-${l.atSpeciesNodeId}-${i}`}
                  mark={l}
                  offset={lossOffsets[i]}
                  inv={inv}
                />
              ))}
            {/* layer 9: orphan gutter (unmapped gene nodes) */}
            {scene.orphans.map((o) => {
              const n = geneEntry.doc.nodes[o.geneNodeId];
              const parentPlaced = o.parentGeneNodeId
                ? scene.placements.get(o.parentGeneNodeId)
                : undefined;
              return (
                <g key={`or${o.geneNodeId}`}>
                  {parentPlaced && !parentPlaced.unmapped && (
                    <line
                      x1={parentPlaced.x}
                      y1={parentPlaced.y}
                      x2={o.x}
                      y2={o.y}
                      stroke="var(--recon-gene-unmapped)"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      opacity={0.6}
                    />
                  )}
                  <circle
                    cx={o.x}
                    cy={o.y}
                    r={3}
                    fill="var(--surface)"
                    stroke="var(--recon-gene-unmapped)"
                    strokeWidth={1.2}
                    strokeDasharray="2 1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={o.x + 7}
                    y={o.y + 3.5}
                    fontSize={9.5}
                    fill="var(--recon-gene-unmapped)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n?.label || o.geneNodeId.slice(0, 6)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

// --- memoised shapes -----------------------------------------------------------------

const EmbeddedTubeShape = memo(function EmbeddedTubeShape({
  tube,
  highlighted,
  gradientId,
  opacity,
  onClick,
}: {
  tube: EmbeddedTube;
  highlighted: boolean;
  /** PhyloRec fill→stroke gradient pass; null = flat fill. */
  gradientId: string | null;
  opacity: number;
  /** Undefined = the 点选目标 toggle points at the gene tree — render inert. */
  onClick?: (branchId: NodeId, e: React.MouseEvent) => void;
}) {
  return (
    <g
      data-tube-id={tube.branchId}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${S.recon.legendTube} ${tube.branchId}`}
      style={onClick ? { cursor: 'pointer', outline: 'none', opacity } : { opacity }}
      onClick={onClick ? (e) => onClick(tube.branchId, e) : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(tube.branchId, e as unknown as React.MouseEvent);
        }
      }}
    >
      {/* fat hit area first (transparent), then border, then fill */}
      <path
        d={tube.path}
        fill="none"
        stroke="transparent"
        strokeWidth={tube.width + 8}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
      />
      <path
        d={tube.path}
        fill="none"
        stroke="var(--pr-tube-stroke)"
        strokeWidth={tube.width + 2}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
      <path
        d={tube.path}
        fill="none"
        stroke={
          highlighted
            ? 'var(--recon-select)'
            : gradientId
              ? `url(#${gradientId})`
              : 'var(--pr-tube-fill)'
        }
        strokeWidth={tube.width}
        strokeLinecap="round"
        opacity={highlighted ? 0.55 : 1}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
});

const EmbeddedHubShape = memo(function EmbeddedHubShape({ hub }: { hub: EmbeddedHub }) {
  return (
    <path
      d={hub.path}
      fill="none"
      stroke="var(--recon-tube)"
      strokeWidth={hub.width}
      strokeLinecap="round"
      style={{ pointerEvents: 'none' }}
    />
  );
});

const EmbeddedSegment = memo(function EmbeddedSegment({
  d,
  color,
  halo,
  dashed,
  muted,
  emphasized,
}: {
  d: string;
  color: string;
  /** Wider background-coloured under-stroke so the lineage reads over tubes. */
  halo: boolean;
  dashed: boolean;
  muted: boolean;
  emphasized: boolean;
}) {
  return (
    <>
    {halo && !muted && (
      <path
        d={d}
        fill="none"
        stroke="var(--bg)"
        strokeWidth={emphasized ? 4.6 : 3.8}
        strokeLinecap="round"
        opacity={emphasized ? 1 : 0.9}
        style={{ pointerEvents: 'none' }}
      />
    )}
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={emphasized ? 1.7 : 1.25}
      strokeDasharray={dashed ? '4 3' : undefined}
      strokeLinecap="round"
      opacity={muted ? 0.18 : emphasized ? 1 : 0.92}
    />
    </>
  );
});

const EmbeddedTransferArcShape = memo(function EmbeddedTransferArcShape({
  arc,
  color,
  muted,
  emphasized,
  titleTopo,
  titleInfeasible,
}: {
  arc: EmbeddedTransferArc;
  color: string;
  muted: boolean;
  emphasized: boolean;
  /** Hover titles are translated per render in the parent (locale freeze). */
  titleTopo: string;
  titleInfeasible: string;
}) {
  // Arrowhead at the recipient end, oriented along the curve's arrival tangent
  // (approximated from the mirrored control point the layout used).
  const c2y = arc.to.y + (arc.to.y >= arc.from.y ? 12 : -12);
  const ang = Math.atan2(arc.to.y - c2y, arc.to.x - (arc.from.x + arc.to.x) / 2);
  const L = 9;
  const tipX = arc.to.x;
  const tipY = arc.to.y;
  const b1x = tipX - L * Math.cos(ang - 0.5);
  const b1y = tipY - L * Math.sin(ang - 0.5);
  const b2x = tipX - L * Math.cos(ang + 0.5);
  const b2y = tipY - L * Math.sin(ang + 0.5);
  return (
    <g opacity={muted ? 0.2 : emphasized ? 1 : 0.85}>
      <path
        d={arc.d}
        fill="none"
        stroke={color}
        strokeWidth={emphasized ? 2 : 1.5}
        strokeDasharray={arc.timeFeasible === false ? '5 4' : undefined}
        strokeLinecap="round"
      />
      <polygon
        points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
        fill={color}
      />
      {arc.timeFeasible === null && <title>{titleTopo}</title>}
      {arc.timeFeasible === false && <title>{titleInfeasible}</title>}
    </g>
  );
});

const EmbeddedLossShape = memo(function EmbeddedLossShape({
  mark,
  offset,
  inv,
}: {
  mark: EmbeddedLossMark;
  offset: number;
  inv: number;
}) {
  const x = mark.x + offset;
  return (
    <g>
      <line
        x1={x}
        y1={mark.y}
        x2={x}
        y2={mark.y - 9}
        stroke="var(--recon-loss)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={mark.inferred ? '2 2' : undefined}
      />
      <circle
        cx={x}
        cy={mark.y - 10}
        r={mark.inferred ? 1.4 : 1.8}
        fill={mark.inferred ? 'var(--surface)' : 'var(--recon-loss)'}
        stroke="var(--recon-loss)"
        strokeWidth={1}
      />
      <text
        transform={`translate(${x + 3},${mark.y - 11}) scale(${inv})`}
        fontSize={9}
        fill="var(--recon-loss)"
        style={{ pointerEvents: 'none' }}
      >
        {mark.shortfall ? 'L!' : `L${mark.count}`}
      </text>
    </g>
  );
});
