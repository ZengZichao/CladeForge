// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The interactive SVG canvas (view layer). Pointer gestures live in
// useCanvasGestures (./useDrag); this component owns layout, pan/zoom wheel,
// viewport fitting, keyboard shortcuts and the layered SVG rendering:
//   background -> tree branches -> custom edges -> nodes -> connection overlay.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { computeLayout, type LayoutResult } from '../layout/autoLayout';
import { fitView, zoomAt } from './coords';
import { getLiveView, resetLiveView, setLiveView, viewTransformAttr } from './liveView';
import { SelectedCustomEdgeDelete, SnapGuide } from './ViewOverlays';
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
import {
  resolveBranchStyle,
  resolveNodeStyle,
  branchColorFor,
  DEFAULT_CANVAS,
  DEFAULT_BRANCH_STYLE,
  type BranchStyle,
  type NodeId,
  type Point,
  type ViewTransform,
} from '../model/types';
import {
  characterValueColor,
  continuousRange,
  detectTransitions,
  findCharacter,
  nodeCharacterColor,
} from '../model/characters';
import { EdgeView } from './EdgeView';
import { supportPercent } from '../model/treeOps';
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
import { branchMidpointOn } from './paths';
import { removeCustomEdge } from '../model/treeOps';
import { C_MRCA, C_MRCA_TEXT, C_UNKNOWN, C_TRANSITION_TO } from './colors';
import { importTreeText } from '../io/fileActions';
import { MAX_PROJECT_CHARS, MAX_TREE_CHARS } from '../io/limits';
import { createSampleProject, SAMPLE_PROJECTS } from '../model/sampleTree';
import { openSample } from '../ui/sampleOpener';
import { requestDeletion } from '../ui/deleteGuard';
import { CanvasLegend } from '../ui/CanvasLegend';
import { isImeComposing } from '../ui/imeGuard';
import { modalIsOpen } from '../ui/useDialogFocus';
import { notify } from '../ui/toast';
import { requestConfirm } from '../ui/confirmDialog';
import { S, tr } from '../ui/strings';
// Shared, never-empty layout display name (BUG-5): the proposal below quotes
// the current layout, and that name must never be an empty string even when a
// loaded document carries a blank/unknown `layout.type`.
import { layoutTypeName } from '../ui/layoutTypeName';
// BUG-7: accepting this proposal is one of the explicit time-chart switch entry
// points, so it gets the same first-entry era-band behaviour as the 样式
// selector and the 时间 panel's switch button.
import { enterTimeChartLayout } from '../ui/timeChartEras';

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

/**
 * The last `loadCounter` this canvas auto-fitted for. Module scope, NOT a
 * component ref: the keyed subtree remounts on a language switch (App's
 * `key={lang}`), and a ref restarts at 0 — `0 !== loadCounter` then re-fired
 * the auto-fit and reset the user's zoom/pan on every language change.
 */
let lastAutoFitLoadCounter = -1;

export function TreeCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const spaceHeld = useSpaceHeld();

  const project = useStore((s) => s.project);
  // Deliberately NO `useStore((s) => s.view)` subscription: the view transform
  // is painted imperatively (see the layout effect and handleWheel below), so a
  // wheel burst never re-renders the tree.
  const viewGroupRef = useRef<SVGGElement | null>(null);
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
  const characterColorTarget = useStore((s) => s.characterColorTarget);
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

  // --- imperative view transform (wheel fast path) ---------------------------
  // The store holds the last COMMITTED transform (history / fit / undo); a wheel
  // burst accumulates into a ref and paints the world group at most once per
  // animation frame. Nothing in the tree's React subtree re-renders during the
  // burst. Committing at a time-based interval — and once when the burst ends —
  // keeps the Minimap, scale bars and zoom read-outs following at low frequency
  // without turning every wheel tick into a React commit. A delta threshold
  // would not be enough: a pinch can deliver ~2 events per frame (2 × 1.1),
  // which would trip any percentage threshold on every frame.
  const liveViewRef = useRef(useStore.getState().view);
  const committedViewRef = useRef(useStore.getState().view);
  const lastCommitAtRef = useRef(0);
  const [cullView, setCullView] = useState(useStore.getState().view);
  const frameRef = useRef<number | null>(null);
  const wheelIdleRef = useRef<number | null>(null);
  // True for the whole of a view gesture — a wheel burst OR a pointer pan.
  // Culling is frozen while it is set and refreshed once when it ends.
  const viewGestureActiveRef = useRef(false);
  // Zoom or pan, decided on the FIRST event of a burst and kept until it ends.
  // A high-resolution wheel / trackpad ramps deltaY across the pan threshold
  // mid-swipe; classifying each event separately made one gesture both pan
  // vertically and zoom.
  const wheelModeRef = useRef<'zoom' | 'pan-x' | 'pan-y' | null>(null);
  // Last view object written to the group. A threshold commit republishes the
  // very object the frame just painted; deduping it keeps the DOM write at most
  // once per frame.
  const appliedViewRef = useRef<ViewTransform | null>(null);

  const applyViewToCanvas = useCallback((v: ViewTransform) => {
    setLiveView(v);
    if (appliedViewRef.current === v) return;
    appliedViewRef.current = v;
    // Passed by ref instead of through React so an unrelated re-render cannot
    // put a stale transform back onto the group while a burst is in flight.
    viewGroupRef.current?.setAttribute('transform', viewTransformAttr(v));
  }, []);

  useLayoutEffect(() => {
    lastCommitAtRef.current = performance.now();
    applyViewToCanvas(getLiveView(useStore.getState().view));
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.view === prev.view) return;
      // The burst's own threshold commits carry the very object the wheel
      // accumulator holds; anything else (fit, minimap click, undo, tab
      // switch) supersedes the pending transform, and its idle flush must not
      // overwrite the newer view.
      if (viewGestureActiveRef.current && s.view !== liveViewRef.current) {
        viewGestureActiveRef.current = false;
        wheelModeRef.current = null;
        if (wheelIdleRef.current !== null) {
          window.clearTimeout(wheelIdleRef.current);
          wheelIdleRef.current = null;
        }
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      }
      if (!viewGestureActiveRef.current) liveViewRef.current = s.view;
      committedViewRef.current = s.view;
      applyViewToCanvas(s.view);
      // Viewport culling is frozen while a view gesture is in flight (the end of
      // the gesture recomputes it once): a per-move cull set would rebuild the
      // branch list and every downstream memo.
      if (!viewGestureActiveRef.current) setCullView(s.view);
    });
    return () => {
      unsubscribe();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
      resetLiveView();
    };
  }, [applyViewToCanvas]);

  const commitLiveView = useCallback((force: boolean) => {
    // Long continuous gestures still get periodic overlay updates; short bursts
    // are committed once, when they end.
    const now = performance.now();
    if (!force && now - lastCommitAtRef.current < 120) return;
    lastCommitAtRef.current = now;
    const next = liveViewRef.current;
    if (next === committedViewRef.current) return;
    committedViewRef.current = next;
    useStore.getState().setView(next);
  }, []);

  // Paint the latest live transform at most once per frame, then update the
  // store only at the low-frequency cadence above. This is the shared fast
  // path for wheel navigation AND pointer panning.
  const scheduleViewFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      applyViewToCanvas(liveViewRef.current);
      commitLiveView(false);
    });
  }, [applyViewToCanvas, commitLiveView]);

  /** Start of a pointer pan: stop the wheel idle flush from ending it early. */
  const beginPanView = useCallback(() => {
    if (wheelIdleRef.current !== null) {
      window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = null;
    }
    wheelModeRef.current = null;
    viewGestureActiveRef.current = true;
  }, []);

  /** A pointer-move pan step: no React update, painted on the next frame. */
  const dragPanView = useCallback(
    (next: ViewTransform) => {
      liveViewRef.current = next;
      viewGestureActiveRef.current = true;
      scheduleViewFrame();
    },
    [scheduleViewFrame],
  );

  /** End of a view gesture (wheel burst idle or pointer pan release). */
  const finishViewGesture = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    wheelIdleRef.current = null;
    // Flush the last accumulated frame before committing its final value.
    applyViewToCanvas(liveViewRef.current);
    viewGestureActiveRef.current = false;
    wheelModeRef.current = null;
    commitLiveView(true);
    // One culling refresh per gesture, after the transform settles.
    setCullView(liveViewRef.current);
  }, [applyViewToCanvas, commitLiveView]);

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
    // BUG-7: an explicit entry into the time chart — apply the first-entry era
    // band rule (auto-enable once + one-time hint, honouring a remembered
    // opt-out). UI-only, so it adds no undo step to the layout change above.
    enterTimeChartLayout();
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
        // The unknown-branch sets and the issue list must ride along: the
        // unmeasured-marker rule reads them per frame, and a dropped set made
        // every unmeasured branch render solid for the whole drag.
        unknownDepth: base.unknownDepth,
        unknownAge: base.unknownAge,
        issues: base.issues,
      };
    }
    const full = computeLayout(project, { showEras, eraLevel });
    baseLayoutRef.current = full;
    return full;
  }, [project, draggingId, interactionActive, dragNode, showEras, eraLevel]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Pointer panning uses the same fast path as the wheel: per-move transforms
  // stay in the live ref and are painted once per frame; the store (and the
  // culling refresh) is touched once when the drag ends.
  const viewControls = useMemo(
    () => ({ begin: beginPanView, dragTo: dragPanView, end: finishViewGesture }),
    [beginPanView, dragPanView, finishViewGesture],
  );
  const { onPointerDown, onPointerMove, onPointerUp, cancelGesture, connect, dropTargetId, snapGuide, marquee } =
    useCanvasGestures(svgRef, layoutRef, spaceHeld, viewControls);
  // Drop-zone feedback (PM-04/06): the overlay must be visible WHILE dragging,
  // or the user gets no signal that the canvas accepts files at all.
  const [dragActive, setDragActive] = useState(false);

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
  // Use a MODULE-level tracker for the auto-fit, not a component ref: a ref
  // restarts at 0 on every mount, and the keyed subtree IS remounted by a
  // language switch (App's `key={lang}`) — `0 !== loadCounter` then re-fired
  // the fit and threw away the user's zoom/pan on every language change.
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
    if (loadCounter !== lastAutoFitLoadCounter && size.w > 0 && size.h > 0) {
      lastAutoFitLoadCounter = loadCounter;
      fitNow(layoutRef.current);
    }
  }, [loadCounter, size.w, size.h, fitNow]);
  // Explicit fit requests: fire on a CHANGE of the counter only. The effect
  // used to run on mount as well, so any remount with fitRequests > 0 (i.e.
  // always, it never resets) refitted — the same view-reset the loadCounter
  // guard above exists to prevent.
  const prevFitRequests = useRef(fitRequests);
  useEffect(() => {
    if (fitRequests === prevFitRequests.current) return;
    prevFitRequests.current = fitRequests;
    if (fitRequests > 0) fitNow(layoutRef.current);
  }, [fitRequests, fitNow]);

  // --- pan to a searched node, keeping the current zoom ---
  useEffect(() => {
    if (!focusTarget) return;
    const el = wrapRef.current;
    const p = layoutRef.current.positions.get(focusTarget.id);
    if (!el || !p) return;
    const scale = getLiveView(useStore.getState().view).scale;
    setView({ scale, tx: el.clientWidth / 2 - p.x * scale, ty: el.clientHeight / 2 - p.y * scale });
  }, [focusTarget]);

  // --- wheel zoom / trackpad pan (non-passive so preventDefault works) ---
  // Trackpad semantics (FigTree / iTOL / every map app): Ctrl-held wheels and
  // pinch gestures ZOOM; a plain two-finger scroll PANS (deltaX moves
  // horizontally — on the old handler every trackpad swipe zoomed, and macOS
  // users read the canvas as "not native" within seconds).
  //
  // The MODE is latched on the first event of a burst. Classifying each event
  // independently meant a high-resolution wheel (or a trackpad whose deltaY
  // ramps across 12 px mid-swipe) panned on small ticks and zoomed on large
  // ones — one physical scroll did both at once.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      if (e.deltaX === 0 && e.deltaY === 0) return;
      // Build on the LIVE transform, not the last committed one: several wheel
      // events can arrive before the next frame, and each must compound on the
      // previous one (or fast trackpads would lose most of their delta).
      const current = liveViewRef.current;
      const pinch = e.ctrlKey || e.metaKey;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      // Latched mode AND axis: a diagonal swipe keeps the axis it started on,
      // so cross-axis jitter can never add an unintended pan.
      const mode =
        wheelModeRef.current ??
        (pinch
          ? 'zoom'
          : // Two-finger pan: horizontal-dominant, or a sub-notch vertical delta
            // (high-resolution wheels and trackpads both report pixel chunks;
            // any horizontal noise must not turn a vertical swipe into a zoom).
            absX > absY
            ? 'pan-x'
            : e.deltaMode === 0 && absY < 12
              ? 'pan-y'
              : 'zoom');
      let next: ViewTransform;
      if (mode === 'pan-x') {
        next = { ...current, tx: current.tx - e.deltaX, ty: current.ty };
      } else if (mode === 'pan-y') {
        next = { ...current, tx: current.tx, ty: current.ty - e.deltaY };
      } else {
        // Ctrl/Cmd wheel and pinch share this path; zoomAt keeps the pointer
        // anchor fixed and clamps to MIN_SCALE / MAX_SCALE exactly as before.
        // A pure horizontal event inside a zoom burst carries no zoom amount.
        if (e.deltaY === 0) return;
        const screen = eventScreenPoint(svg, e);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        next = zoomAt(current, screen, factor);
      }
      // At a scale limit the transform is unchanged; do not open a burst for a
      // no-op (preventDefault above still stops the page from scrolling).
      if (next.scale === current.scale && next.tx === current.tx && next.ty === current.ty) return;
      wheelModeRef.current = mode;
      // Coalesce every wheel event in this frame into ONE paint. The event
      // handler itself performs no React update.
      dragPanView(next);
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = window.setTimeout(finishViewGesture, 140);
    },
    [dragPanView, finishViewGesture],
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
        // keyboard too — through the SAME confirm guard as the context menu
        // (PM-20), so the keyboard is never the unguarded path.
        e.preventDefault();
        const edgeId = st.selectedEdgeId;
        const edge = project.customEdges.find((x) => x.id === edgeId);
        const label = edge?.label || edge?.kind || tr('未命名自定义连线', 'unnamed link');
        requestConfirm({
          key: 'delete-edge-kbd',
          title: S.edge.delete,
          message: tr(
            `将删除自定义连线「${label}」及其注记。该操作可撤销。`,
            `This deletes the custom edge "${label}" and its note. The action is undoable.`,
          ),
          confirmLabel: S.edge.delete,
          danger: true,
          onConfirm: () => apply((d) => removeCustomEdge(d, edgeId)),
        });
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
  // Culling follows the COMMITTED view, not the per-frame wheel transform.
  // Rebuilding this set per wheel tick used to invalidate the branch list, the
  // transition list and every downstream memo; a burst now recomputes it once,
  // when it ends. The one-viewport buffer above keeps the frozen set valid for
  // the whole gesture. Identity is reused when the members did not change, so a
  // pan that moves the window but reveals no new node costs nothing.
  const prevCulledRef = useRef<Set<NodeId>>(new Set());
  const culledIds = useMemo(() => {
    const set = new Set<NodeId>();
    // Before the viewport is measured there is nothing to cull against.
    if (viewportSize.w <= 0 || viewportSize.h <= 0) {
      for (const n of visibleNodes) set.add(n.id);
    } else {
      const { scale, tx, ty } = cullView;
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
    }
    const prev = prevCulledRef.current;
    if (prev.size === set.size) {
      let same = true;
      for (const id of set) {
        if (!prev.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    prevCulledRef.current = set;
    return set;
  }, [visibleNodes, layout, cullView, viewportSize]);
  // The branches the layout could NOT measure. `computeLayout` parks them on the
  // topological grid instead of inventing a length, but that is invisible unless
  // they are drawn differently — otherwise an unmeasured tree looks
  // pixel-identical to a measured one.
  const unmeasured = useMemo(
    () => unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge),
    [layout],
  );
  // Built from the layout only (not from culling), so the branch items — and
  // therefore the points handed to every EdgeView — keep their identity across
  // view-only changes; rendering merely filters this list.
  const allBranches = useMemo(
    () =>
      visibleNodes
        .filter((n) => n.parentId)
        .map((n) => ({
          node: n,
          from: layout.positions.get(n.parentId as NodeId) as Point,
          to: layout.positions.get(n.id) as Point,
        })),
    [visibleNodes, layout],
  );
  const branches = useMemo(
    () => allBranches.filter((b) => culledIds.has(b.node.id) && culledIds.has(b.node.parentId as NodeId)),
    [allBranches, culledIds],
  );
  const allCustomEdgeItems = useMemo(
    () =>
      project.customEdges.map((edge) => ({
        edge,
        from: layout.positions.get(edge.sourceId) as Point,
        to: layout.positions.get(edge.targetId) as Point,
      })),
    [project.customEdges, layout],
  );
  const customEdgeItems = useMemo(
    () =>
      allCustomEdgeItems.filter(
        (ce) => culledIds.has(ce.edge.sourceId) && culledIds.has(ce.edge.targetId),
      ),
    [allCustomEdgeItems, culledIds],
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
    // Both character types use the same mid-branch marker; hiding the markers
    // is the user's switch, not an implicit type difference.
    if (!activeCharacter || !showTransitions) return [];
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
  // on every render, defeating shallow comparison. Keyed on the document's own
  // identities (nodes/defaults) and covering ALL nodes — not just the culled
  // ones — so a viewport change never swaps style objects under every node.
  const styleCache = useMemo(() => {
    const nodeStyles = new Map<NodeId, ReturnType<typeof resolveNodeStyle>>();
    const branchStyles = new Map<NodeId, ReturnType<typeof resolveBranchStyle>>();
    for (const id of Object.keys(project.nodes)) {
      const n = project.nodes[id];
      nodeStyles.set(id, resolveNodeStyle(n, project));
      if (n.parentId) branchStyles.set(id, resolveBranchStyle(n, project));
    }
    return { nodeStyles, branchStyles };
  }, [project.defaults, project.nodes]);

  // Resolve each branch's FINAL visual style once per document/colour change.
  // The old code spread `{ ...bs, color }` inside branches.map, producing a new
  // style object on every TreeCanvas render and invalidating EdgeView's memo
  // for the whole tree. Character colouring, the theme substitution for the
  // default colour, and support-threshold dimming are all folded in here.
  const edgeStyles = useMemo(() => {
    const out = new Map<NodeId, { style: BranchStyle; dimmed: boolean }>();
    const threshold =
      typeof project.layout.supportThreshold === 'number'
        ? project.layout.supportThreshold
        : undefined;
    for (const id of Object.keys(project.nodes)) {
      const node = project.nodes[id];
      if (!node.parentId) continue;
      const bs = styleCache.branchStyles.get(id) ?? resolveBranchStyle(node, project);
      // Character colouring can paint the child's state on its incoming branch.
      // Unassigned branches keep the normal style colour rather than turning
      // the whole tree grey.
      const charColor =
        activeCharacter && characterColorTarget === 'branch'
          ? nodeCharacterColor(activeCharacter, node, charRange)
          : undefined;
      const color =
        charColor ??
        branchColorFor(node, project, layout.depths.get(id) ?? 0, layout.maxDepth);
      // Default branch colour (#333333) is invisible on the dark canvas; when
      // the user has not customised it, render the theme variable (exports keep
      // the stored default, so files stay self-contained).
      const renderedColor = charColor
        ? charColor
        : color === DEFAULT_BRANCH_STYLE.color
          ? 'var(--c-default-branch)'
          : color;
      // Support-threshold dimming: branches whose (scale-aware) support falls
      // below the document's threshold draw dashed and lighter — the SAME rule
      // the exporter applies, so "I dimmed it on screen" matches the figure.
      const belowSupport =
        threshold !== undefined &&
        typeof node.support === 'number' &&
        node.childrenIds.length > 0 &&
        (supportPercent(node) ?? 100) < threshold;
      const style: BranchStyle = belowSupport
        ? { ...bs, color: renderedColor, dash: bs.dash === 'solid' ? 'dashed' : bs.dash }
        : renderedColor === bs.color
          ? bs
          : { ...bs, color: renderedColor };
      out.set(id, { style, dimmed: belowSupport });
    }
    return out;
  }, [
    project.nodes,
    project.defaults,
    project.layout,
    layout.depths,
    layout.maxDepth,
    styleCache,
    activeCharacter,
    charRange,
    characterColorTarget,
  ]);

  // MRCA highlight style per branch: same geometry as the branch itself, wider
  // and in the selection colour. Memoised so the selection overlay does not
  // recreate style objects on unrelated renders.
  const mrcaStyles = useMemo(() => {
    const out = new Map<NodeId, BranchStyle>();
    if (!mrcaPath) return out;
    for (const b of allBranches) {
      if (!mrcaPath.branches.has(b.node.id)) continue;
      const bs = styleCache.branchStyles.get(b.node.id) ?? resolveBranchStyle(b.node, project);
      out.set(b.node.id, {
        color: C_MRCA,
        width: bs.width + 8,
        dash: 'solid',
        // Follow the branch's own geometry: a highlight drawn as an elbow over
        // a curved branch would visibly diverge from it.
        shape: bs.shape,
      });
    }
    return out;
  }, [mrcaPath, allBranches, styleCache, project]);
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
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        const projectFile = files.find((f) => /\.cladeforge\.json$|\.json$/i.test(f.name));
        // .txt is accepted here (M21): a legal Newick shipped as tree.txt used
        // to be refused until renamed — the CONTENT parsers are the real gate,
        // the extension list only decides what gets a chance.
        const treeFiles = files.filter((f) => /\.(nwk|newick|tree|tre|nex|nexus|txt)$/i.test(f.name));
        // Same `File.size` pre-check the browser open path applies: the drop
        // path used to read a mistyped 200 MB pick WHOLESALE into the webview
        // and only then let assertTreeInput reject it. A byte is at least one
        // UTF-8 char, so the byte comparison never wrongly refuses.
        const oversize = (f: File, maxBytes: number): boolean => {
          if (!(Number.isFinite(f.size) && f.size > maxBytes)) return false;
          notify.error(
            tr(
              `文件过大（${(f.size / 1e6).toFixed(1)} MB），上限为 ${(maxBytes / 1e6).toFixed(1)} MB。`,
              `File is too large (${(f.size / 1e6).toFixed(1)} MB); the limit is ${(maxBytes / 1e6).toFixed(1)} MB.`,
            ),
          );
          return true;
        };
        if (projectFile) {
          if (oversize(projectFile, MAX_PROJECT_CHARS)) return;
          // A project (.cladeforge.json) dropped on the canvas opens as a tab —
          // the review's PM-06: the project format used to be un-droppable.
          void projectFile.text().then((text) => {
            void import('../io/fileActions').then(({ actionOpenProjectText }) =>
              actionOpenProjectText(text, projectFile.name),
            );
          });
          return;
        }
        if (treeFiles.length > 0) {
          // Every dropped tree imports (PM-05: the old code took the FIRST
          // match and silently dropped the rest — batch gene-tree imports are
          // exactly the multi-file case).
          for (const f of treeFiles) {
            if (oversize(f, MAX_TREE_CHARS)) continue;
            void f.text().then((text) => importTreeText(text, f.name));
          }
          return;
        }
        // PM-04: dropping an unsupported file used to be a SILENT no-op. Name
        // what was rejected and what to do instead.
        const rejected = files.map((f) => f.name).slice(0, 3).join(', ');
        notify.error(
          tr(
            `暂不支持拖入的文件（${rejected || '未知'}）：请拖入 .nwk/.newick/.tree/.tre/.nex/.nexus/.txt 树文件或 .cladeforge.json 项目；CSV/TSV 性状表请用 文件 › 导入表格`,
            `Unsupported dropped file${files.length === 1 ? '' : 's'} (${rejected || 'unknown'}): drop a .nwk/.newick/.tree/.tre/.nex/.nexus/.txt tree or a .cladeforge.json project; CSV/TSV tables go through File › Import table`,
          ),
        );
      }}
    >
      {dragActive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background: 'var(--accent, #2563eb)',
            opacity: 0.08,
            zIndex: 5,
          }}
        >
          <span
            style={{
              pointerEvents: 'none',
              fontSize: 13,
              background: 'var(--surface, #fff)',
              padding: '6px 12px',
              borderRadius: 6,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              opacity: 1,
            }}
          >
            {tr('松开以导入：树文件（.nwk/.nex）或项目（.cladeforge.json）', 'Drop to import: a tree file (.nwk/.nex) or a project (.cladeforge.json)')}
          </span>
        </div>
      )}
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
        {/* No `transform` prop: it is painted through viewGroupRef, once per
            animation frame, so React never rewrites it during a wheel burst. */}
        <g ref={viewGroupRef} data-role="world">
          {/* Alignment guide while a dragged node is magnetically snapped to
              another node's coordinate — makes the snap pause visible. */}
          <SnapGuide guide={snapGuide} bounds={layout.bounds} />
          {layout.timeAxis && (
            <TimeAxis
              info={layout.timeAxis}
              showEras={showEras}
              eraLevel={eraLevel}
              envEvents={project.environmentalEvents}
            />
          )}          {mrcaPath &&
            branches
              .filter((b) => mrcaPath.branches.has(b.node.id))
              .map((b) => {
                const style = mrcaStyles.get(b.node.id);
                if (!style) return null;
                return (
                  <EdgeView
                    key={`mrca-${b.node.id}`}
                    from={b.from}
                    to={b.to}
                    orientation={project.layout.orientation}
                    layoutType={project.layout.type}
                    style={style}
                  />
                );
              })}
          {branches.map((b) => {
            // Precomputed once per document/colour change: no inline spread, so
            // EdgeView's shallow comparison holds across unrelated renders.
            const resolved = edgeStyles.get(b.node.id);
            const style =
              resolved?.style ??
              styleCache.branchStyles.get(b.node.id) ??
              resolveBranchStyle(b.node, project);
            return (
              <EdgeView
                key={`b-${b.node.id}`}
                from={b.from}
                to={b.to}
                orientation={project.layout.orientation}
                layoutType={project.layout.type}
                style={style}
                unmeasured={unmeasured.has(b.node.id)}
                dimmed={resolved?.dimmed}
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
            return (
              <SelectedCustomEdgeDelete
                edgeId={sel.edge.id}
                from={sel.from}
                to={sel.to}
                curvature={sel.edge.style.curvature}
              />
            );
          })()}
          {transitions.map((t) => {
            const from = layout.positions.get(t.parentId);
            const to = layout.positions.get(t.nodeId);
            if (!from || !to) return null;
            // Anchor the marker ON the drawn branch. Opacity/colour styles may
            // leave the path itself untouched, but a curved branch no longer
            // passes through the elbow midpoint.
            const transitionStyle = resolveBranchStyle(project.nodes[t.nodeId], project);
            const m = branchMidpointOn(
              from,
              to,
              project.layout.orientation,
              project.layout.type,
              transitionStyle.shape === 'curved',
            );
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
            // Same colour helper for discrete states and continuous ramps, so
            // both character types get identical mid-branch change markers.
            const fromColor =
              (activeCharacter ? characterValueColor(activeCharacter, t.from, charRange) : undefined) ??
              C_UNKNOWN;
            const toColor =
              (activeCharacter ? characterValueColor(activeCharacter, t.to, charRange) : undefined) ??
              C_TRANSITION_TO;
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
                characterActive={!!activeCharacter && characterColorTarget === 'node'}
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
        
      {/* Rubber-band (marquee) selection rectangle — SCREEN space, outside the
          world transform, so its coordinates match the gesture's screen px. */}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="var(--accent)"
          fillOpacity={0.08}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
</g>
      </svg>
      <Minimap layout={layout} nodes={project.nodes} size={size} setView={setView} />
      {/* On-canvas colour legend */}
      <CanvasLegend unmeasuredBranches={unmeasured.size > 0} />
      {/* On a dated tree the circular layout is the time wheel (root at the
          centre, radii by age); without ages it degrades to topological depth.
          Either way the mapping / degradation is named out loud instead of
          leaving the reader to notice. */}
      {layoutNotices.map((issue) => (
        <div key={issue.kind} className="canvas-notice" role="note" title={issue.message}>
          {issue.message}
        </div>
      ))}
      {project.layout.type === 'rectangular-phylogram' && hasScaleBar(layout.depthScale) ? (
        <ScaleBar depthScale={layout.depthScale as number} />
      ) : null}
      {project.layout.type === 'time-calibrated' && layout.timeAxis ? (
        <TimeScaleBar timeAxis={layout.timeAxis} axisScale={project.layout.timeScale} />
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
                  onClick={() => openSample(s)}
                >
                  {/* Reconciliation samples land in the recon workspace with one
                      click (§7.4) — the badge says so before the click. */}
                  {s.entryView === 'recon' && (
                    <span className="sample-card-badge">{S.recon.sampleBadge}</span>
                  )}
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
