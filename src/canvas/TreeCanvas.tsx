// The interactive SVG canvas (view layer). Pointer gestures live in
// useCanvasGestures (./useDrag); this component owns layout, pan/zoom wheel,
// viewport fitting, keyboard shortcuts and the layered SVG rendering:
//   background -> tree branches -> custom edges -> nodes -> connection overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { computeLayout, type LayoutResult } from '../layout/autoLayout';
import { fitView, zoomAt, type Bounds } from './coords';
import { boundsWithLabels } from './labelBounds';
import {
  collectSubtree,
  constrainedMoveNode,
  deleteNode,
  isTimeCalibrated,
  nodesMissingAges,
  pathBetween,
  topologicalNeighbour,
  unpinAll,
} from '../model/treeOps';
import { resolveBranchStyle, resolveNodeStyle, branchColorFor, DEFAULT_CANVAS, DEFAULT_BRANCH_STYLE, type LayoutType, type NodeId, type Point } from '../model/types';
import {
  continuousRange,
  detectTransitions,
  findCharacter,
  nodeCharacterColor,
} from '../model/characters';
import { EdgeView } from './EdgeView';
import { labelAngleOf } from './labels';
import { hasScaleBar, unmeasuredNodeIds } from './branchFlags';
import { CustomEdgeView } from './CustomEdgeView';
import { NodeView } from './NodeView';
import { EventLayer } from './EventLayer';
import { TimeAxis } from './TimeAxis';
import { Minimap } from './Minimap';
import { AsrPieLayer } from './AsrPieLayer';
import { ScaleBar, TimeScaleBar } from './ScaleBar';
import { ConnectionLayer } from './ConnectionLayer';
import { eventScreenPoint, useSpaceHeld, useWheel } from './usePanZoom';
import { useCanvasGestures } from './useDrag';
import { branchMidpointOn, curveMidpoint } from './paths';
import { removeCustomEdge } from '../model/treeOps';
import { C_MRCA, C_MRCA_TEXT, C_UNKNOWN, C_TRANSITION_TO } from './colors';
import { importTreeText } from '../io/fileActions';
import { createSampleProject, SAMPLE_PROJECTS } from '../model/sampleTree';
import { requestDeletion } from '../ui/deleteGuard';
import { CanvasLegend } from '../ui/CanvasLegend';
import { isImeComposing } from '../ui/imeGuard';
import { modalIsOpen } from '../ui/useDialogFocus';
import { notify } from '../ui/toast';
import { S, tr } from '../ui/strings';

/** Human-readable name for a layout type, locale-aware (mirrors TimePanel's). */
function layoutTypeName(type: LayoutType): string {
  switch (type) {
    case 'rectangular-cladogram':
      return S.layoutType.cladogram;
    case 'rectangular-phylogram':
      return S.layoutType.phylogram;
    case 'time-calibrated':
      return S.layoutType.timeCalibrated;
    case 'circular':
      return S.layoutType.circular;
    default:
      return type;
  }
}

/**
 * Documents for which the time-chart switch has already been PROPOSED.
 *
 * Keyed on the PROJECT ID and never on `layout.type`: an effect that depends on
 * the layout it is rewriting re-fires when that layout is undone, so the switch
 * would be re-applied right after the user reverted it. The layout is only ever
 * changed here from a click, so the guard exists purely to stop a proposal being
 * nagged out twice for the same document.
 */
const timeProposalShownFor = new Set<string>();

export function TreeCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const spaceHeld = useSpaceHeld();

  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const apply = useStore((s) => s.apply);
  const clearSelection = useStore((s) => s.clearSelection);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const fitRequests = useStore((s) => s.fitRequests);
  const loadCounter = useStore((s) => s.loadCounter);
  const setViewport = useStore((s) => s.setViewport);
  const draggingId = useStore((s) => s.draggingId);
  const viewportSize = useStore((s) => s.viewport);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const showTransitions = useStore((s) => s.showTransitions);
  const showEvents = useStore((s) => s.showEvents);
  const showEras = useStore((s) => s.showEras);
  const eraLevel = useStore((s) => s.eraLevel);
  const focusTarget = useStore((s) => s.focusTarget);
  const asr = useStore((s) => s.asr);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);
  const openInNewTab = useStore((s) => s.openInNewTab);
  const requestFit = useStore((s) => s.requestFit);

  // STATE MACHINE — the time-data mismatch is a PROPOSAL, never an imposition.
  //
  // When the tree carries time data but the layout is neither the geological time
  // chart nor the circular one, nothing here runs
  // `apply(d => { d.layout.type = 'time-calibrated' })` out of an effect. That
  // would overwrite an explicit layout choice without asking the user, and since
  // such an effect depends on `project.layout.type`, undoing the switch would
  // re-fire it — the change would survive Undo and the layout become
  // unrecoverable.
  //
  // Instead the user gets an informative message with a one-click switch (and the
  // 时间 panel keeps a dismissible banner with the same button for as long as
  // the mismatch lasts), offered at most once per document, guarded on the project
  // id above.
  const timeReady = isTimeCalibrated(project);
  const timeChartWouldHelp =
    timeReady && project.layout.type !== 'time-calibrated' && project.layout.type !== 'circular';

  // The one-click answer to the proposal: one undoable step, exactly as if the
  // choice had been made in the 样式 selector or the 时间 panel.
  const switchToTimeChart = useCallback(() => {
    const missing = nodesMissingAges(useStore.getState().project).length;
    apply((d) => {
      d.layout.type = 'time-calibrated';
      unpinAll(d);
    });
    if (missing > 0) notify.info(S.notify.missingAgesToast(missing));
    requestFit();
    notify.success(tr('已切换到「地质时间图」布局', 'Switched to the geological time chart layout'));
  }, [apply, requestFit]);

  useEffect(() => {
    if (!timeChartWouldHelp) return;
    if (timeProposalShownFor.has(project.id)) return;
    timeProposalShownFor.add(project.id);
    notify.action(
      S.layoutPanel.timeDataButWrongLayout(
        layoutTypeName(useStore.getState().project.layout.type),
      ),
      S.layoutPanel.switchToTimeChart,
      switchToTimeChart,
    );
    // Deliberately NOT keyed on `project.layout.type`: this effect must never be
    // re-triggered by the state it is proposing a change to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeChartWouldHelp, project.id, switchToTimeChart]);

  // An arrow-key nudge held down repeats at the OS rate, so applying every
  // keydown as its own edit would push dozens of undo steps for one visual
  // adjustment. The nudge therefore runs through the same begin / live / commit
  // transaction the mouse drag uses, so a gesture records exactly one step.
  const openNudge = useRef<string | null>(null);
  const endNudgeGesture = useCallback(() => {
    if (openNudge.current === null) return;
    openNudge.current = null;
    useStore.getState().commitInteraction();
  }, []);

  // --- layout with drag-aware caching -----------------------------------------
  // While a node is being dragged, the dragged node AND its subtree members
  // (which are repositioned by constrainedMoveNode) need their live positions
  // overlaid on the pre-drag base layout. A full recompute runs once when the
  // interaction ends.
  const baseLayoutRef = useRef<LayoutResult | null>(null);
  // `useDrag` clears `draggingId` on pointercancel / lostpointercapture / blur /
  // visibilitychange, but a baseline captured by an interaction that ended
  // abnormally must not be trusted forever. Only overlay while an interaction is
  // genuinely open in the store; otherwise fall through to a fresh full layout.
  const interactionActive = useStore((s) => s.interactionBase !== null);
  const dragNode = draggingId ? project.nodes[draggingId] : undefined;
  const layout = useMemo<LayoutResult>(() => {
    if (draggingId && interactionActive && baseLayoutRef.current) {
      const base = baseLayoutRef.current;
      const positions = new Map(base.positions);
      // Overlay the live (pinned) positions of the dragged node and every
      // node in its subtree — constrainedMoveNode propagates depth-axis
      // deltas to children, so they all need to appear at their new spots.
      const subtree = collectSubtree(project, draggingId);
      for (const id of subtree) {
        const node = project.nodes[id];
        if (node?.position) positions.set(id, node.position);
      }
      return {
        positions,
        visible: base.visible,
        bounds: base.bounds,
        depths: base.depths,
        maxDepth: base.maxDepth,
        timeAxis: base.timeAxis,
        depthScale: base.depthScale,
      };
    }
    const full = computeLayout(project, { showEras, eraLevel });
    baseLayoutRef.current = full;
    return full;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, draggingId, interactionActive, dragNode, showEras, eraLevel]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const { onPointerDown, onPointerMove, onPointerUp, cancelGesture, connect, dropTargetId, snapGuide } =
    useCanvasGestures(svgRef, layoutRef, spaceHeld);

  // --- viewport measurement ---
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
      setViewport(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  // --- fit to view (once on first size, and on every explicit fit request) ---
  // Use loadCounter from store instead of a local ref so that re-mounting
  // (e.g. when returning from reconciliation mode) does not reset the view.
  const prevLoadCounter = useRef(0);
  const fitNow = useCallback(
    (layout: LayoutResult) => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      // Grow the box by the label text before fitting, so what the user sees
      // after "fit" is the whole tree INCLUDING taxon names, and matches the
      // exported figure.
      const box = boundsWithLabels(
        useStore.getState().project,
        layout.positions,
        layout.visible,
        layout.bounds,
      );
      setView(fitView(box, w, h));
    },
    [setView],
  );
  useEffect(() => {
    // Only auto-fit when loadCounter changes (new document loaded), not on remount
    if (loadCounter !== prevLoadCounter.current && size.w > 0 && size.h > 0) {
      prevLoadCounter.current = loadCounter;
      fitNow(layoutRef.current);
    }
  }, [loadCounter, size.w, size.h, fitNow]);
  useEffect(() => {
    if (fitRequests > 0) fitNow(layoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequests]);

  // --- pan to a searched node, keeping the current zoom ---
  useEffect(() => {
    if (!focusTarget) return;
    const el = wrapRef.current;
    const p = layoutRef.current.positions.get(focusTarget.id);
    if (!el || !p) return;
    const scale = useStore.getState().view.scale;
    setView({ scale, tx: el.clientWidth / 2 - p.x * scale, ty: el.clientHeight / 2 - p.y * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  // --- wheel zoom (non-passive so preventDefault works) ---
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const screen = eventScreenPoint(svg, e);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView(zoomAt(useStore.getState().view, screen, factor));
    },
    [setView],
  );
  useWheel(svgRef, handleWheel);

  // --- keyboard: delete, escape, arrow nudge, Alt+arrow topology nav ---
  // The document is read through `useStore.getState()` rather than closed over, so
  // this listener is installed once and a held-key transaction is never broken by a
  // re-install half-way through the gesture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // A modal is up: its own controls own the keyboard. The tag test above is
      // not enough, because a dialog that never claims focus leaves the active
      // element on <body> and Delete / arrows would reach the tree.
      if (modalIsOpen()) return;
      // A composition session over the canvas (an inline label, a focus
      // that never left the SVG) still delivers its physical keystrokes here —
      // Delete would remove the selected nodes, arrows would move them, and
      // Escape would cancel a gesture the user never started.
      if (isImeComposing(e)) return;
      const st = useStore.getState();
      const project = st.project;
      const sel = st.selection;

      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault();
        // The risk assessment, the confirmation key and the Undo toast are shared
        // with the other delete entry points, so the keyboard never executes a cut
        // the context menu would ask about, and "Undo" reverts THIS deletion rather
        // than the stack top at click time.
        requestDeletion(
          project,
          sel,
          'keyboard',
          () => {
            apply((d) => {
              for (const id of sel) deleteNode(d, id, true);
            });
            clearSelection();
          },
        );
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedEdgeId) {
        // A selected custom (horizontal-transfer) edge is deletable via the
        // keyboard too, so the shortcut does not depend on finding the edge in the
        // inspector first.
        e.preventDefault();
        const edgeId = st.selectedEdgeId;
        apply((d) => removeCustomEdge(d, edgeId));
      } else if (e.key === 'Escape') {
        endNudgeGesture();
        cancelGesture();
        clearSelection();
      } else if (e.key.startsWith('Arrow') && e.altKey && sel.length === 1) {
        // Alt+arrows move the focus between nodes TOPOLOGICALLY — which is what the
        // shortcut reference promises ("父/子/兄弟", "parent/child/sibling").
        // Stepping ±1 through a flat pre-order list would land Alt+Up from a deep
        // tip on an unrelated node rather than on its parent. Plain arrows still
        // nudge positions.
        e.preventDefault();
        endNudgeGesture(); // navigation is not part of a nudge gesture
        const next = topologicalNeighbour(project, sel[0], e.key as
          'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
        if (next && project.nodes[next]) {
          select(next);
          focusNode(next);
        }
      } else if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        let dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Same axis constraint as mouse dragging (see useDrag): rectangular
        // layouts only nudge along the tree's depth axis.
        if (project.layout.type !== 'circular') {
          const horizontal =
            project.layout.orientation === 'LR' || project.layout.orientation === 'RL';
          if (horizontal) dy = 0;
          else dx = 0;
        }
        // A cross-axis arrow is constrained to a zero move on a rectangular
        // layout. Opening a transaction for it would still burn an undo slot on
        // release (the pin object is rewritten), so the key is swallowed and
        // nothing is recorded.
        if (!dx && !dy) return;
        // A keydown can land while a node drag is mid-flight. Starting a second
        // transaction there would replace the drag's baseline (and the drag's own
        // commit would then find none), so arrows simply wait for the drag to end.
        if (st.draggingId !== null) return;
        // The first keydown of a gesture opens the transaction, the OS repeats
        // live-update it, and the commit — one undo step — happens when the key
        // comes up (or on any of the terminators below). A different direction or
        // step size is a different gesture, so it commits and re-opens.
        const gesture = `${e.key}:${step}`;
        if (openNudge.current !== gesture) {
          endNudgeGesture();
          openNudge.current = gesture;
          st.beginInteraction();
        }
        const positions = layoutRef.current.positions;
        const layout = project.layout;
        st.live((d) => {
          for (const id of sel) {
            const p = positions.get(id);
            if (p) constrainedMoveNode(d, id, { x: p.x + dx, y: p.y + dy }, layout, positions);
          }
        });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) endNudgeGesture();
    };
    // A keyup can fail to arrive: the window loses focus mid-hold (Alt-Tab, an OS
    // dialog), the tab is hidden, or a pointer gesture takes over. `useDrag`
    // interrupts itself on exactly these events; a nudge must not be
    // able to leave an interaction open, because `interactionBase` then feeds the
    // drag-cached baseline of every later frame.
    const onInterrupt = () => endNudgeGesture();
    const onVisibility = () => {
      if (document.hidden) endNudgeGesture();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onInterrupt);
    window.addEventListener('pointerdown', onInterrupt);
    window.addEventListener('pointercancel', onInterrupt);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onInterrupt);
      window.removeEventListener('pointerdown', onInterrupt);
      window.removeEventListener('pointercancel', onInterrupt);
      document.removeEventListener('visibilitychange', onVisibility);
      // Unmount (returning from the reconciliation view, a locale switch, …) must
      // not leave the transaction open either.
      endNudgeGesture();
    };
  }, [apply, clearSelection, cancelGesture, endNudgeGesture, focusNode, select]);

  // --- derived render data (viewport-culled) ----------------------------------
  // Only nodes inside the visible viewport (plus a one-viewport buffer so
  // elbow branches entering from off-screen stay connected) become DOM
  // elements; off-screen subtrees cost nothing to render. This is the
  // lightweight alternative to full canvas/WebGL virtualisation.
  const visibleNodes = useMemo(
    () => Array.from(layout.visible, (id) => project.nodes[id]).filter(Boolean),
    [layout, project],
  );

  // Circular layout: "away from the parent" is an ANGLE here, not a side, so
  // each label's outward ray is resolved from its own parent's position and
  // handed to NodeView. Rectangular layouts skip the work.
  const isCircular = project.layout.type === 'circular';
  const labelAngles = useMemo(() => {
    const out = new Map<NodeId, number>();
    if (!isCircular) return out;
    for (const n of visibleNodes) {
      const pos = layout.positions.get(n.id);
      if (!pos) continue;
      const parentPos = n.parentId ? layout.positions.get(n.parentId) : undefined;
      const angle = labelAngleOf(parentPos, pos);
      if (angle !== undefined) out.set(n.id, angle);
    }
    return out;
  }, [isCircular, visibleNodes, layout]);

  // Everything `computeLayout` has to work around, announced on the canvas: a
  // dated tree switched to circular loses its time axis, era bands and event
  // ribbon; a phylogram with no usable lengths becomes a cladogram and loses its
  // scale bar; partial data gets parked on the topological grid. Each case says so
  // next to the branches it describes, because the degradation is invisible
  // otherwise.
  const layoutNotices = layout.issues ?? [];
  const culledIds = useMemo(() => {
    const set = new Set<NodeId>();
    // Before the viewport is measured there is nothing to cull against.
    if (viewportSize.w <= 0 || viewportSize.h <= 0) {
      for (const n of visibleNodes) set.add(n.id);
      return set;
    }
    const { scale, tx, ty } = view;
    const bufX = Math.max(200, viewportSize.w) / scale;
    const bufY = Math.max(200, viewportSize.h) / scale;
    const x0 = -tx / scale - bufX;
    const x1 = (viewportSize.w - tx) / scale + bufX;
    const y0 = -ty / scale - bufY;
    const y1 = (viewportSize.h - ty) / scale + bufY;
    for (const n of visibleNodes) {
      const p = layout.positions.get(n.id);
      if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) set.add(n.id);
    }
    return set;
  }, [visibleNodes, layout, view, viewportSize]);
  // The branches the layout could NOT measure. `computeLayout` parks them on the
  // topological grid instead of inventing a length, but that is invisible unless
  // they are drawn differently — otherwise an unmeasured tree looks
  // pixel-identical to a measured one.
  const unmeasured = useMemo(
    () => unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge),
    [layout],
  );
  const branches = useMemo(
    () =>
      visibleNodes
        .filter((n) => n.parentId && culledIds.has(n.id) && culledIds.has(n.parentId))
        .map((n) => ({
          node: n,
          from: layout.positions.get(n.parentId as NodeId) as Point,
          to: layout.positions.get(n.id) as Point,
        })),
    [visibleNodes, culledIds, layout],
  );
  const customEdgeItems = useMemo(
    () =>
      project.customEdges
        .filter((edge) => culledIds.has(edge.sourceId) && culledIds.has(edge.targetId))
        .map((edge) => ({
          edge,
          from: layout.positions.get(edge.sourceId) as Point,
          to: layout.positions.get(edge.targetId) as Point,
        })),
    [project.customEdges, culledIds, layout],
  );
  const renderNodes = useMemo(
    () => visibleNodes.filter((n) => culledIds.has(n.id)),
    [visibleNodes, culledIds],
  );

  // --- active-character colouring + transition detection ----------------------
  const activeCharacter = useMemo(
    () => findCharacter(project, activeCharacterId),
    [project, activeCharacterId],
  );
  const charRange = useMemo(
    () =>
      activeCharacter?.type === 'continuous' ? continuousRange(project, activeCharacter) : undefined,
    [project, activeCharacter],
  );
  const transitions = useMemo(() => {
    if (!activeCharacter || activeCharacter.type !== 'discrete' || !showTransitions) return [];
    return detectTransitions(project, activeCharacter, layout.visible).filter(
      (t) => culledIds.has(t.nodeId) && culledIds.has(t.parentId),
    );
  }, [project, activeCharacter, showTransitions, layout, culledIds]);

  const connectFrom = connect ? layout.positions.get(connect.sourceId) : undefined;

  // Common-ancestry highlight: when exactly two nodes are selected, mark their
  // MRCA and the branches on the path between them.
  const mrcaPath = useMemo(
    () => (selection.length === 2 ? pathBetween(project, selection[0], selection[1]) : null),
    [project, selection],
  );

  // Cache resolved styles so that memo (NodeView/EdgeView) works correctly.
  // Without this cache, resolveNodeStyle/resolveBranchStyle return new objects
  // on every render, defeating shallow comparison.
  const styleCache = useMemo(() => {
    const nodeStyles = new Map<NodeId, ReturnType<typeof resolveNodeStyle>>();
    const branchStyles = new Map<NodeId, ReturnType<typeof resolveBranchStyle>>();
    for (const n of renderNodes) {
      nodeStyles.set(n.id, resolveNodeStyle(n, project));
      if (n.parentId) branchStyles.set(n.id, resolveBranchStyle(n, project));
    }
    return { nodeStyles, branchStyles };
  }, [renderNodes, project.defaults, project.nodes]);
  // An empty document drives the empty-state guidance and sample picker below.
  const isEmpty = (project.nodes[project.rootId]?.childrenIds.length ?? 0) === 0;

  // Canvas background follows the chrome theme unless the user has explicitly
  // chosen a colour: a fixed white default would leave dark mode with a bright
  // drawing panel. `var(--canvas-bg)` resolves to #f0f0f2 (light) or
  // #141416 (dark). Exports read project.canvas.background directly, so they
  // are unaffected by this render-time substitution.
  const canvasBg =
    project.canvas.background === DEFAULT_CANVAS.background
      ? 'var(--canvas-bg)'
      : project.canvas.background;

  return (
    <div
      ref={wrapRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files ?? []);
        const treeFile = files.find((f) => /\.(nwk|newick|tree|tre|nex|nexus)$/i.test(f.name));
        if (!treeFile) return;
        void treeFile.text().then((text) => importTreeText(text, treeFile.name));
      }}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="tree"
        aria-label={project.name}
        aria-multiselectable="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          display: 'block',
          touchAction: 'none',
          background: canvasBg,
          cursor: connect ? 'crosshair' : 'default',
        }}
      >
        <rect
          data-role="background"
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          fill={canvasBg}
        />
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Alignment guide while a dragged node is magnetically snapped to
              another node's coordinate — makes the snap pause visible. */}
          {snapGuide && (
            <line
              x1={snapGuide.axis === 'x' ? snapGuide.coord : layout.bounds.minX - 400}
              y1={snapGuide.axis === 'x' ? layout.bounds.minY - 400 : snapGuide.coord}
              x2={snapGuide.axis === 'x' ? snapGuide.coord : layout.bounds.maxX + 400}
              y2={snapGuide.axis === 'x' ? layout.bounds.maxY + 400 : snapGuide.coord}
              stroke="var(--c-select)"
              strokeWidth={1 / view.scale}
              strokeDasharray={`${6 / view.scale} ${4 / view.scale}`}
              opacity={0.55}
              pointerEvents="none"
            />
          )}
          {layout.timeAxis && (
            <TimeAxis
              info={layout.timeAxis}
              showEras={showEras}
              eraLevel={eraLevel}
              envEvents={project.environmentalEvents}
            />
          )}
          {mrcaPath &&
            branches
              .filter((b) => mrcaPath.branches.has(b.node.id))
              .map((b) => (
                <EdgeView
                  key={`mrca-${b.node.id}`}
                  from={b.from}
                  to={b.to}
                  orientation={project.layout.orientation}
                  layoutType={project.layout.type}
                  style={{
                    color: C_MRCA,
                    width: resolveBranchStyle(b.node, project).width + 8,
                    dash: 'solid',
                    shape: 'line',
                  }}
                />
              ))}
          {branches.map((b) => {
            const bs = styleCache.branchStyles.get(b.node.id) ?? resolveBranchStyle(b.node, project);
            const color = branchColorFor(
              b.node,
              project,
              layout.depths.get(b.node.id) ?? 0,
              layout.maxDepth,
            );
            // Default branch colour (#333333) is invisible on the dark canvas;
            // when the user has not customised it, render the theme variable
            // (exports keep the stored default, so files stay self-contained).
            const renderedColor =
              color === DEFAULT_BRANCH_STYLE.color ? 'var(--c-default-branch)' : color;
            return (
              <EdgeView
                key={`b-${b.node.id}`}
                from={b.from}
                to={b.to}
                orientation={project.layout.orientation}
                layoutType={project.layout.type}
                style={renderedColor === bs.color ? bs : { ...bs, color: renderedColor }}
                unmeasured={unmeasured.has(b.node.id)}
              />
            );
          })}
          {customEdgeItems.map((ce) => (
            <CustomEdgeView
              key={ce.edge.id}
              edge={ce.edge}
              from={ce.from}
              to={ce.to}
              selected={selectedEdgeId === ce.edge.id}
            />
          ))}
          {/* Selected custom edge: floating delete button at its midpoint.
              This is the primary, always-visible way to remove a horizontal-
              transfer arrow (the inspector section is easy to miss). */}
          {(() => {
            const sel = customEdgeItems.find((ce) => ce.edge.id === selectedEdgeId);
            if (!sel) return null;
            const m = curveMidpoint(sel.from, sel.to, sel.edge.style.curvature);
            const s = 1 / view.scale; // keep a constant on-screen size
            return (
              <g
                transform={`translate(${m.x} ${m.y}) scale(${s})`}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  apply((d) => removeCustomEdge(d, sel.edge.id));
                }}
              >
                <title>{S.edge.delete}</title>
                <circle r={11} fill="var(--surface)" stroke="var(--danger)" strokeWidth={1.5} />
                <path
                  d="M -4 -4 L 4 4 M 4 -4 L -4 4"
                  stroke="var(--danger)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </g>
            );
          })()}
          {transitions.map((t) => {
            const from = layout.positions.get(t.parentId);
            const to = layout.positions.get(t.nodeId);
            if (!from || !to) return null;
            // Anchor the marker ON the elbow segment — the bounding-box
            // midpoint floats in empty air for rectangular layouts.
            const m = branchMidpointOn(from, to, project.layout.orientation, project.layout.type);
            // A branch with an UNKNOWN endpoint is a data prompt, not an
            // evolutionary change (missing data adds no homoplasy), so it is
            // drawn in its own class — a dashed grey ring with a question mark
            // and no "to" colour — and the hover text says which it is. Sharing
            // one marker class would let the figure read "N transitions" while
            // some of them are only missing data.
            if (t.involvesUnknown) {
              return (
                <g key={`t-${t.nodeId}`}>
                  <circle
                    cx={m.x}
                    cy={m.y}
                    r={5.5}
                    fill="var(--surface)"
                    stroke={C_UNKNOWN}
                    strokeWidth={1.6}
                    strokeDasharray="2.4 1.8"
                  />
                  <text
                    x={m.x}
                    y={m.y + 3}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={700}
                    fill={C_UNKNOWN}
                    pointerEvents="none"
                  >
                    ?
                  </text>
                  <title>{`${t.fromLabel} → ${t.toLabel} · ${tr('端点未赋值：提示补数据，不计入演化转变', 'endpoint unassigned: a prompt for data, not an evolutionary change')}`}</title>
                </g>
              );
            }
            const fromColor = activeCharacter?.states.find((s) => s.id === t.from)?.color ?? C_UNKNOWN;
            const toColor = activeCharacter?.states.find((s) => s.id === t.to)?.color ?? C_TRANSITION_TO;
            return (
              <g key={`t-${t.nodeId}`}>
                <circle cx={m.x} cy={m.y} r={5.5} fill="var(--surface)" stroke={fromColor} strokeWidth={2} />
                <circle cx={m.x} cy={m.y} r={3} fill={toColor} />
                <title>{`${t.fromLabel} → ${t.toLabel}`}</title>
              </g>
            );
          })}
          {/* A fresh document shows only the empty-state guidance — the
              bare root node (a large circle + "Root" label) is hidden so the
              canvas doesn't double-render the "new tree" concept as a node. */}
          {!isEmpty &&
            renderNodes.map((n) => (
              <NodeView
                key={n.id}
                node={n}
                pos={layout.positions.get(n.id) as Point}
                style={styleCache.nodeStyles.get(n.id)!}
                orientation={project.layout.orientation}
                isLeaf={n.childrenIds.length === 0}
                isDropTarget={dropTargetId === n.id}
                isConnectSource={connect?.sourceId === n.id}
                characterActive={!!activeCharacter}
                characterColor={
                  activeCharacter ? nodeCharacterColor(activeCharacter, n, charRange) : undefined
                }
                labelAngle={labelAngles.get(n.id)}
              />
            ))}
          {showEvents && project.events.length > 0 && (
            <EventLayer
              events={project.events}
              positions={layout.positions}
              nodes={project.nodes}
              culled={culledIds}
              orientation={project.layout.orientation}
              layoutType={project.layout.type}
            />
          )}
          {asr && activeCharacter && asr.characterId === activeCharacter.id && (
            // The display cut-off travels with the reconstruction result,
            // so the slider in the analysis dialog changes what is drawn.
            <AsrPieLayer
              probs={asr.probs}
              states={activeCharacter.states}
              positions={layout.positions}
              nodes={project.nodes}
              culled={culledIds}
              threshold={asr.threshold}
            />
          )}
          {mrcaPath &&
            (() => {
              const pos = layout.positions.get(mrcaPath.mrca);
              if (!pos) return null;
              return (
                <g pointerEvents="none">
                  <circle cx={pos.x} cy={pos.y} r={13} fill="none" stroke={C_MRCA} strokeWidth={2.5} />
                  <text
                    x={pos.x}
                    y={pos.y - 18}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={C_MRCA_TEXT}
                  >
                    {tr('MRCA', 'MRCA')}
                  </text>
                </g>
              );
            })()}
          {connect && connectFrom && (
            <ConnectionLayer
              from={connectFrom}
              to={connect.world}
              color={project.defaults.edge.color}
            />
          )}
        </g>
      </svg>
      <Minimap layout={layout} nodes={project.nodes} view={view} size={size} setView={setView} />
      {/* On-canvas colour legend */}
      <CanvasLegend unmeasuredBranches={unmeasured.size > 0} />
      {/* The circular layout draws radii from topological depth only,
          so a dated tree switched to it loses the time axis, the era bands and
          the event strip. Named out loud instead of leaving the reader to notice. */}
      {layoutNotices.map((issue) => (
        <div key={issue.kind} className="canvas-notice" role="note" title={issue.message}>
          {issue.message}
        </div>
      ))}
      {project.layout.type === 'rectangular-phylogram' && hasScaleBar(layout.depthScale) ? (
        <ScaleBar depthScale={layout.depthScale as number} viewScale={view.scale} />
      ) : null}
      {project.layout.type === 'time-calibrated' && layout.timeAxis ? (
        <TimeScaleBar timeAxis={layout.timeAxis} viewScale={view.scale} />
      ) : null}
      {isEmpty && (
        <div className="empty-state">
          <svg
            className="empty-glyph"
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 32 H20 M20 32 V16 H38 M20 32 V48 H38 M38 16 V10 H56 M38 16 V22 H56 M38 48 V42 H56 M38 48 V54 H56" />
          </svg>
          <div className="empty-title">{S.empty.title}</div>
          <div className="empty-hint">{S.empty.hint}</div>
          {/* Sample tree: lets a first-time user see a finished
              document with characters + events within seconds. */}
          <div className="sample-picker">
            <div className="sample-picker-title">{S.empty.samplePickerTitle}</div>
            <div className="sample-picker-hint">{S.empty.samplePickerHint}</div>
            <div className="sample-grid">
              {SAMPLE_PROJECTS.map((s) => (
                <button
                  key={s.id}
                  className="sample-card"
                  title={tr(s.desc, s.descEn)}
                  onClick={() => openInNewTab(s.build())}
                >
                  <span className="sample-card-label">{tr(s.label, s.labelEn)}</span>
                  <span className="sample-card-desc">{tr(s.desc, s.descEn)}</span>
                </button>
              ))}
            </div>
          </div>
          {/* A single-button equivalent, so keyboard and command-palette users
              reach a sample in one step */}
          <button
            className="btn primary"
            title={S.empty.loadSampleTitle}
            onClick={() => openInNewTab(createSampleProject())}
          >
            {S.empty.loadSample}
          </button>
        </div>
      )}
    </div>
  );
}
