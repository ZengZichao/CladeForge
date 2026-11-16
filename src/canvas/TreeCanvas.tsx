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
  pathBetween,
  topologicalNeighbour,
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
import { TimeAxis, CalibrationBars } from './TimeAxis';
import { Minimap } from './Minimap';
import { AsrPieLayer } from './AsrPieLayer';
import { ScaleBar } from './ScaleBar';
import { ConnectionLayer } from './ConnectionLayer';
import { eventScreenPoint, useSpaceHeld, useWheel } from './usePanZoom';
import { useCanvasGestures } from './useDrag';
import { branchMidpointOn } from './paths';
import { removeCustomEdge } from '../model/treeOps';
import { C_MRCA, C_MRCA_TEXT, C_UNKNOWN, C_TRANSITION_TO } from './colors';
import { importTreeText, actionImportTree, actionNewTreeFile } from '../io/fileActions';
import { MAX_PROJECT_CHARS, MAX_TREE_CHARS } from '../io/limits';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import { openSample } from '../ui/sampleOpener';
import { requestDeletion } from '../ui/deleteGuard';
import { CanvasLegend } from '../ui/CanvasLegend';
import { isImeComposing } from '../ui/imeGuard';
import { modalIsOpen } from '../ui/useDialogFocus';
import { notify } from '../ui/toast';
import { requestConfirm } from '../ui/confirmDialog';
import { S, tr } from '../ui/strings';

/**
 * Below this node count the overview minimap hides (review finding 3 / R4): on
 * a small tree every tip is visible at a glance, so the minimap is decoration
 * that costs canvas space. The threshold matches the smallest tree where the
 * minimap has answered a real navigation question in testing (tens of tips).
 */
const MINIMAP_MIN_NODES = 60;

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

  // M36 (UI_UX_REVIEW): space-pan had no affordance — the cursor stayed
  // default while space was held. grab announces "you can pan now"; the
  // grabbing state during the actual drag is set imperatively in useDrag.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (spaceHeld.current) el.style.setProperty('cursor', 'grab');
    else el.style.setProperty('cursor', '');
  }, [spaceHeld.current]);

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
  // A14: the calibration-interval overlay (error bars on the time axis).
  const focusTarget = useStore((s) => s.focusTarget);
  const asr = useStore((s) => s.asr);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);

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

  // The time-data mismatch is surfaced only where the user is already working
  // on time: the 时间 panel's inline note and its switch action. A global toast
  // would follow the user into unrelated documents and could act on the wrong
  // project after a tab switch, so the canvas keeps no proposal of its own.

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
  // Measure once before paint, then track resizes. The explicit first read
  // matters: a ResizeObserver's initial callback can be skipped when the canvas
  // mounts inside a restored, still-hidden tab, leaving the SVG at 0×0.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (w: number, h: number) => {
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      setViewport(w, h);
    };
    measure(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      measure(r.width, r.height);
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
  // M38 (UI_UX_REVIEW): the first auto-fit ran on the FIRST nonzero size,
  // which could predate the persisted panel widths being applied — the fit then
  // used a wider container than the one the user actually gets, and clipped
  // Taxon_E/F off the right edge (139% zoom). The fit now waits for the
  // container to be QUIET (no resize callback for 120ms) before measuring.
  const autoFitStableTimerRef = useRef<number | null>(null);
  const autoFitPendingRef = useRef(false);
  useEffect(() => {
    if (loadCounter !== lastAutoFitLoadCounter) {
      lastAutoFitLoadCounter = loadCounter;
      autoFitPendingRef.current = true;
    }
    if (autoFitPendingRef.current && size.w > 0 && size.h > 0) {
      if (autoFitStableTimerRef.current !== null) window.clearTimeout(autoFitStableTimerRef.current);
      autoFitStableTimerRef.current = window.setTimeout(() => {
        autoFitPendingRef.current = false;
        fitNow(layoutRef.current);
      }, 120);
    }
    return () => {
      if (autoFitStableTimerRef.current !== null) window.clearTimeout(autoFitStableTimerRef.current);
    };
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

  // --- zoom to selection (2026-11-15 OP-04) ---
  // Fit-to-window answers "show me the whole tree"; with a multi-selection the
  // user's question is "show me THIS clade". The palette asks through an event,
  // and the canvas owns the viewport, so the two never need shared state.
  useEffect(() => {
    const onFitSelection = () => {
      const st = useStore.getState();
      const layout = layoutRef.current;
      const el = wrapRef.current;
      if (!el) return;
      const ids = st.selection.filter((id) => layout.visible.has(id));
      if (ids.length === 0) {
        fitNow(layout);
        return;
      }
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const id of ids) {
        const p = layout.positions.get(id);
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (!Number.isFinite(minX)) {
        fitNow(layout);
        return;
      }
      // A little breathing room around the nodes; labels are left out of the
      // box deliberately — a tight clade still fits with the adaptive margin.
      setView(fitView({ minX, minY, maxX: maxX + 1, maxY: maxY + 1 }, el.clientWidth, el.clientHeight));
    };
    window.addEventListener('cladeforge:fit-selection', onFitSelection);
    return () => window.removeEventListener('cladeforge:fit-selection', onFitSelection);
  }, [fitNow, setView]);

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
  // chosen a colour: `var(--canvas-bg)` is the same paper as the panels,
  // separated by the pane hairlines. Exports read project.canvas.background
  // directly, so they are unaffected by this render-time substitution.
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
            // B2 (UI_UX_REVIEW): a low-opacity wash tint needs the ink token;
            // the surface-token --accent resolved to near-white and vanished.
            background: 'var(--foreground)',
            opacity: 0.08,
            zIndex: 5,
          }}
        >
          <span
            style={{
              pointerEvents: 'none',
              fontSize: 'var(--text-sm)',
              background: 'var(--surface)',
              padding: '6px 12px',
              borderRadius: 0,
              border: '0.5px solid var(--border-popover)',
              boxShadow: 'none',
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
          )}
          {/* A14 (review §4.2): calibration intervals as node-anchored error
              bars on the time axis. The intervals were export-only data before
              ("they go to the NEXUS file and nothing draws") — honest, but it
              left a whole hypothesis layer invisible on its own canvas. Off by
              default; the 时间 module owns the toggle. */}
          {/* 用户反馈: a node with min/max ages draws its confidence bar on the
              canvas whenever calibration points exist (no display toggle — the
              bars ARE the visualisation of the 时间约束 data). */}
          {project.calibrationPoints.length > 0 && layout.timeAxis && (
            <CalibrationBars
              info={layout.timeAxis}
              points={project.calibrationPoints}
              nodes={project.nodes}
              positions={layout.positions}
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
                childId={b.node.id}
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
                  <title>{`${t.fromLabel} → ${t.toLabel}：${tr('端点未赋值，提示补数据，不计入演化转变', 'endpoint unassigned; a prompt for data, not an evolutionary change')}`}</title>
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
      </g>
      {/* B1 (UI_UX_REVIEW 2026-11-15): the marquee rect is genuinely in SCREEN
          space now — it sits outside the world transform, so its coordinates
          match the gesture's screen px at any zoom. Color uses the primary ink
          (the surface-token `--accent` resolved to near-white on light canvas). */}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="var(--primary)"
          fillOpacity={0.08}
          stroke="var(--primary)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      </svg>
      {/* Overview aids appear only once there is a tree to navigate. On a small
          tree the minimap is pure decoration (review finding 3 / R4): below the
          threshold it hides, because every tip is already visible at a glance. */}
      {!isEmpty && Object.keys(project.nodes).length >= MINIMAP_MIN_NODES && (
        <Minimap layout={layout} nodes={project.nodes} size={size} setView={setView} />
      )}
      {/* On-canvas colour legend */}
      {!isEmpty && <CanvasLegend unmeasuredBranches={unmeasured.size > 0} />}
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
      {/* V14 (UI_UX_REVIEW): the time-calibrated axis already carries Ma ticks —
          a second "10 Ma" bar at the bottom repeated the same information in a
          weaker form. The axis is the authority; the redundant bar is gone. */}
      {isEmpty && (
        <div className="empty-state">
          <div className="empty-masthead">
            <div className="empty-wordmark">{S.app.name}</div>
            <div className="empty-hint">{S.empty.hint}</div>
          </div>
          <div className="empty-actions">
            <div className="empty-actions-row">
              <button
                className="btn primary"
                onClick={() => void actionImportTree()}
              >
                {S.empty.openFile}
              </button>
              {/* 用户反馈：a blank front page must also offer to START a tree. */}
              <button className="btn" onClick={() => actionNewTreeFile()}>
                {tr('新建树文件', 'New tree file')}
              </button>
            </div>
            {/* 用户反馈：the ⌘K hint sits UNDER the two buttons, not beside
                them — it is a reading note, not a third action. */}
            <span className="empty-kbd">{S.empty.shortcutHint}</span>
          </div>
          {/* 用户反馈：samples as a 2×2 grid of rounded cards — the big title
              only (the description stays as the hover tooltip), no gray body
              copy competing with the actions above. */}
          <div className="sample-picker">
            <div className="sample-picker-title">{S.empty.samplePickerTitle}</div>
            <div className="sample-card-grid">
              {/* 用户反馈：exactly TWO standard samples — a time tree and a
                  non-time tree, centered. The calibration demo and the
                  reconciliation sample stay in the sample library dialog. */}
              {SAMPLE_PROJECTS.filter((s) => s.id === 'feature-tour' || s.id === 'large-tree').map((s) => (
                <button
                  key={s.id}
                  className="sample-card"
                  title={tr(s.desc, s.descEn)}
                  onClick={() => openSample(s)}
                >
                  {tr(s.label, s.labelEn)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
