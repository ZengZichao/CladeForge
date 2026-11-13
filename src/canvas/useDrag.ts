// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Canvas pointer-gesture hook. Encapsulates the drag/interaction state machine
// used by TreeCanvas: select / drag-move / Alt-drag-reparent / port-drag-connect
// / pan, via event delegation + pointer capture. Kept separate from rendering so
// TreeCanvas stays a thin view.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '../model/store';
import { screenToWorld, worldToScreen } from './coords';
import { getLiveView } from './liveView';
import { eventScreenPoint } from './usePanZoom';
import { hitTargetFor } from './hitTarget';
import {
  addCustomEdge,
  collectSubtree,
  constrainedMoveNode,
  reparent,
  unpinNode,
} from '../model/treeOps';
import type { NodeId, Point, ViewTransform } from '../model/types';
import type { LayoutResult } from '../layout/autoLayout';

const MOVE_THRESHOLD = 4; // px before a press becomes a drag
const HIT_RADIUS = 22; // px radius for node hit-testing during drag
// Magnetic alignment: when the dragged node's free-axis coordinate comes
// within this many SCREEN pixels of another node's coordinate, it snaps and
// sticks there — the node visibly pauses on the alignment while the pointer
// keeps moving, and a dashed guide line marks the alignment.
const SNAP_RADIUS = 10; // px

// --- spatial grid for O(1)-average hit-testing --------------------------------
// A uniform grid in screen space, rebuilt lazily whenever the layout object
// changes. Replaces the former O(n) scan over every visible node per
// pointermove, which becomes a bottleneck on trees with hundreds+ of tips.
const GRID_CELL = 64; // px; ~3x the hit radius keeps candidate lists short

interface HitGrid {
  cells: Map<string, NodeId[]>;
  minX: number;
  minY: number;
}

function buildHitGrid(
  positions: Map<NodeId, Point>,
  visible: Set<NodeId>,
  v: ViewTransform,
): HitGrid {
  const cells = new Map<string, NodeId[]>();
  let minX = Infinity;
  let minY = Infinity;
  for (const id of visible) {
    const wp = positions.get(id);
    if (!wp) continue;
    const sx = wp.x * v.scale + v.tx;
    const sy = wp.y * v.scale + v.ty;
    const cx = Math.floor(sx / GRID_CELL);
    const cy = Math.floor(sy / GRID_CELL);
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list) list.push(id);
    else cells.set(key, [id]);
  }
  return { cells, minX: minX === Infinity ? 0 : minX, minY: minY === Infinity ? 0 : minY };
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startScreen: Point; startView: ViewTransform }
  | {
      kind: 'press-node';
      id: NodeId;
      startScreen: Point;
      alt: boolean;
      moved: boolean;
      /** Circular layout only: the free axis is latched on the first move so a
          sticky snap can't flip it mid-gesture. */
      freeAxis?: 'x' | 'y';
    }
  | { kind: 'connect'; sourceId: NodeId }
  | { kind: 'press-bg'; startScreen: Point; moved: boolean }
  /**
   * Rubber-band (marquee) selection: Shift+drag (or Alt+drag) on the background
   * sweeps a rectangle; every node inside is selected on release. This is the
   * standard way to annotate a whole clade in one gesture — shift-clicking 30
   * tips one by one was the only alternative, and the marquee is what every
   * canvas tool ships.
   */
  | { kind: 'marquee'; startScreen: Point; additive: boolean };

export interface CanvasGestures {
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
  /** Abort the active gesture (used by the Escape key). */
  cancelGesture: () => void;
  connect: { sourceId: NodeId; world: Point } | null;
  dropTargetId: NodeId | null;
  /** Active alignment guide while a dragged node is snapped to others. */
  snapGuide: { axis: 'x' | 'y'; coord: number } | null;
  /** Live rubber-band rectangle (screen px) while a marquee drag is active. */
  marquee: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Imperative view callbacks owned by TreeCanvas. Pointer panning paints through
 * here instead of calling `setView` on every move — the same coalesced fast
 * path the wheel uses, so a drag does not re-render the tree per pointermove.
 */
export interface CanvasViewControls {
  /** The gesture will manage the view: stop the wheel idle flush. */
  begin: () => void;
  /** A pan step, in screen px terms: no React update, painted next frame. */
  dragTo: (view: ViewTransform) => void;
  /** Flush and commit the final transform, then refresh culling once. */
  end: () => void;
}

export function useCanvasGestures(
  svgRef: MutableRefObject<SVGSVGElement | null>,
  layoutRef: MutableRefObject<LayoutResult>,
  spaceHeld: MutableRefObject<boolean>,
  viewControls: CanvasViewControls,
): CanvasGestures {
  // NO `s.view` subscription: wheel bursts and pointer pans must not re-render
  // the canvas. Gesture handlers read the live transform (including wheel/drag
  // frames not yet committed to the store) at the moment of the event instead.
  const project = useStore((s) => s.project);
  const apply = useStore((s) => s.apply);
  const live = useStore((s) => s.live);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const commitInteraction = useStore((s) => s.commitInteraction);
  const select = useStore((s) => s.select);
  const clearSelection = useStore((s) => s.clearSelection);
  const selectEdge = useStore((s) => s.selectEdge);

  const gestureRef = useRef<Gesture>({ kind: 'none' });
  const [connect, setConnect] = useState<{ sourceId: NodeId; world: Point } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<NodeId | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ axis: 'x' | 'y'; coord: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const gridRef = useRef<{ forLayout: unknown; forView: ViewTransform; grid: HitGrid } | null>(null);

  /**
   * Nearest alignment coordinate on `axis` among all other visible nodes,
   * within the snap radius (in screen px, converted to world units). Returns
   * null when nothing is close enough — no snap, the node follows the pointer
   * 1:1. The sticky snap (node holds the aligned coordinate until the pointer
   * leaves the radius) is what makes alignment feel like a deliberate pause.
   * `exclude` must contain the dragged node AND its subtree: subtree members
   * move with the drag, so snapping to one of them would feed back into the
   * next frame and make the node run away from the pointer.
   */
  const findSnap = useCallback(
    (axis: 'x' | 'y', value: number, exclude: Set<NodeId>): number | null => {
      const { positions, visible } = layoutRef.current;
      const world = SNAP_RADIUS / getLiveView(useStore.getState().view).scale;
      let best: number | null = null;
      let bestD = world;
      for (const id of visible) {
        if (exclude.has(id)) continue;
        const p = positions.get(id);
        if (!p) continue;
        const d = Math.abs(p[axis] - value);
        if (d <= bestD) {
          bestD = d;
          best = p[axis];
        }
      }
      return best;
    },
    [layoutRef],
  );

  const findNodeAt = useCallback(
    (screen: Point, exclude?: Set<NodeId>): NodeId | null => {
      const { positions, visible } = layoutRef.current;
      const v = getLiveView(useStore.getState().view);
      // Rebuild when the layout object was replaced (positions changed) or the
      // view transform changed (the grid stores screen-space coordinates).
      if (
        !gridRef.current ||
        gridRef.current.forLayout !== layoutRef.current ||
        gridRef.current.forView !== v
      ) {
        gridRef.current = {
          forLayout: layoutRef.current,
          forView: v,
          grid: buildHitGrid(positions, visible, v),
        };
      }
      const { cells, minX, minY } = gridRef.current.grid;
      const span = Math.ceil(HIT_RADIUS / GRID_CELL);
      const cx = Math.floor(screen.x / GRID_CELL);
      const cy = Math.floor(screen.y / GRID_CELL);
      let best: NodeId | null = null;
      let bestD = Infinity;
      for (let gx = cx - span; gx <= cx + span; gx += 1) {
        for (let gy = cy - span; gy <= cy + span; gy += 1) {
          // Skip provably-empty regions (cells left of / above the tree).
          if (gx < minX || gy < minY) continue;
          const bucket = cells.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const id of bucket) {
            if (exclude?.has(id)) continue;
            const wp = positions.get(id);
            if (!wp) continue;
            const sp = worldToScreen(wp, v);
            const d = Math.hypot(sp.x - screen.x, sp.y - screen.y);
            if (d < HIT_RADIUS && d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
      return best;
    },
    [layoutRef],
  );

  const cancelGesture = useCallback(() => {
    const wasPanning = gestureRef.current.kind === 'pan';
    if (gestureRef.current.kind === 'press-node') {
      useStore.getState().cancelInteraction();
    }
    gestureRef.current = { kind: 'none' };
    // A pan has already been painted frame by frame; "cancel" must not leave
    // the store behind the visible transform.
    if (wasPanning) viewControls.end();
    setConnect(null);
    setDropTargetId(null);
    setSnapGuide(null);
    setMarquee(null);
  }, [viewControls]);

  // A gesture can end without ever delivering `pointerup`: the window losing
  // focus or being hidden (Alt-Tab, OS dialog, mobile backgrounding), or the
  // platform taking the pointer over (`pointercancel` — the usual outcome for a
  // trackpad / touch gesture the OS claims). Without the last two, `draggingId`
  // stayed set forever and TreeCanvas kept serving the pre-drag cached layout, so
  // every later orientation / spacing / relayout edit drew on stale coordinates.
  useEffect(() => {
    const onInterrupt = () => {
      if (gestureRef.current.kind !== 'none') cancelGesture();
    };
    window.addEventListener('blur', onInterrupt);
    document.addEventListener('visibilitychange', onInterrupt);
    window.addEventListener('pointercancel', onInterrupt);
    window.addEventListener('lostpointercapture', onInterrupt);
    return () => {
      window.removeEventListener('blur', onInterrupt);
      document.removeEventListener('visibilitychange', onInterrupt);
      window.removeEventListener('pointercancel', onInterrupt);
      window.removeEventListener('lostpointercapture', onInterrupt);
    };
  }, [cancelGesture]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    const svg = svgRef.current;
    if (!svg) return;
    const view = getLiveView(useStore.getState().view);
    const screen = eventScreenPoint(svg, e);
    const world = screenToWorld(screen, view);
    // Resolve through closest(): the physical hit is often a CHILD of the
    // attributed group (custom edges draw a fat transparent hit path), so
    // reading e.target's own attributes misses and broke edge re-selection.
    const hit = hitTargetFor(e.target);
    let { role, nodeId, edgeId } = hit;
    // Node hit circles are world-space (and no longer grow at low zoom). Fall
    // back to the same screen-space nearest-node search the drop targets use,
    // so a press near a node still selects it when the tree is zoomed out.
    if (!role && !nodeId && !edgeId) {
      const nearest = findNodeAt(screen);
      if (nearest) {
        role = 'node';
        nodeId = nearest;
      }
    }
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    // Middle-button / space panning MUST be decided before the node / port /
    // edge roles: a middle press landing ON a node used to fall through to the
    // select branch instead of panning, so the pan convention ("the middle
    // button pans, anywhere") silently broke over every node.
    if (spaceHeld.current || e.button === 1) {
      viewControls.begin();
      gestureRef.current = { kind: 'pan', startScreen: screen, startView: view };
      return;
    }

    if (role === 'collapse-toggle' && nodeId) {
      // The expand/collapse triangle handles itself (see NodeView); never turn
      // it into a node press.
      gestureRef.current = { kind: 'none' };
      return;
    }
    if (role === 'port' && nodeId) {
      gestureRef.current = { kind: 'connect', sourceId: nodeId };
      setConnect({ sourceId: nodeId, world });
      return;
    }
    if (role === 'custom-edge' && edgeId) {
      selectEdge(edgeId);
      gestureRef.current = { kind: 'none' };
      return;
    }
    if (role === 'node' && nodeId) {
      select(nodeId, e.shiftKey);
      gestureRef.current = {
        kind: 'press-node',
        id: nodeId,
        startScreen: screen,
        alt: e.altKey,
        moved: false,
      };
      return;
    }
    if (e.shiftKey || e.altKey) {
      // Shift/Alt + background drag = rubber-band selection (pan stays on the
      // plain drag so both gestures coexist).
      gestureRef.current = { kind: 'marquee', startScreen: screen, additive: e.shiftKey };
      if (!e.shiftKey) select(null);
      setMarquee({ x: screen.x, y: screen.y, w: 0, h: 0 });
    } else {
      gestureRef.current = { kind: 'press-bg', startScreen: screen, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (g.kind === 'none') return;
    const svg = svgRef.current;
    if (!svg) return;
    const view = getLiveView(useStore.getState().view);
    const screen = eventScreenPoint(svg, e);
    const world = screenToWorld(screen, view);

    switch (g.kind) {
      case 'pan':
        // No setView here: the live transform is painted once per frame and
        // committed when the drag ends (see CanvasViewControls).
        viewControls.dragTo({
          ...g.startView,
          tx: g.startView.tx + (screen.x - g.startScreen.x),
          ty: g.startView.ty + (screen.y - g.startScreen.y),
        });
        break;
      case 'marquee': {
        setMarquee({
          x: Math.min(g.startScreen.x, screen.x),
          y: Math.min(g.startScreen.y, screen.y),
          w: Math.abs(screen.x - g.startScreen.x),
          h: Math.abs(screen.y - g.startScreen.y),
        });
        break;
      }
      case 'connect':
        setConnect((c) => (c ? { ...c, world } : c));
        setDropTargetId(findNodeAt(screen, new Set([g.sourceId])));
        break;
      case 'press-node': {
        const dist = Math.hypot(screen.x - g.startScreen.x, screen.y - g.startScreen.y);
        if (!g.moved && dist > MOVE_THRESHOLD) {
          g.moved = true;
          beginInteraction(g.id);
        }
        if (g.moved) {
          // Rectangular layouts constrain manual adjustment to the DEPTH axis
          // of the tree (root left/right -> horizontal only; root top/bottom
          // -> vertical only) so a dragged node stays on its row/column and
          // the parent-to-children spacing stays uniform. The circular layout
          // keeps free 2D movement.
          const cur = layoutRef.current.positions.get(g.id);
          let target = world;
          if (project.layout.type !== 'circular' && cur) {
            const horizontal = project.layout.orientation === 'LR' || project.layout.orientation === 'RL';
            target = horizontal ? { x: world.x, y: cur.y } : { x: cur.x, y: world.y };
          }
          // Magnetic alignment (see SNAP_RADIUS): snap the free coordinate to
          // the nearest OTHER node and show a guide line while snapped. The
          // dragged subtree is excluded — its members travel with the node,
          // so they are not meaningful alignment targets and would create a
          // self-reinforcing snap (the runaway that let a node escape the
          // pointer and slide past its ancestors).
          const subtree = collectSubtree(project, g.id);
          if (project.layout.type === 'circular' && !g.freeAxis) {
            // Latch the dominant axis once — recomputing every frame would let
            // a sticky snap flip the axis mid-drag.
            g.freeAxis =
              Math.abs(world.x - (cur?.x ?? world.x)) >= Math.abs(world.y - (cur?.y ?? world.y))
                ? 'x'
                : 'y';
          }
          const freeAxis: 'x' | 'y' =
            project.layout.type === 'circular'
              ? g.freeAxis!
              : project.layout.orientation === 'LR' || project.layout.orientation === 'RL'
                ? 'x'
                : 'y';
          const snapped = findSnap(freeAxis, target[freeAxis], subtree);
          if (snapped !== null) {
            target = { ...target, [freeAxis]: snapped };
            setSnapGuide({ axis: freeAxis, coord: snapped });
          } else {
            setSnapGuide(null);
          }
          live((d) => constrainedMoveNode(d, g.id, target, project.layout, layoutRef.current.positions));
          if (g.alt) setDropTargetId(findNodeAt(screen, subtree));
        }
        break;
      }
      case 'press-bg': {
        const dist = Math.hypot(screen.x - g.startScreen.x, screen.y - g.startScreen.y);
        if (!g.moved && dist > MOVE_THRESHOLD) {
          viewControls.begin();
          gestureRef.current = { kind: 'pan', startScreen: g.startScreen, startView: view };
        }
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const g = gestureRef.current;
    gestureRef.current = { kind: 'none' };
    if (svg) {
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (g.kind === 'none' || !svg) return;
    const screen = eventScreenPoint(svg, e);

    switch (g.kind) {
      case 'pan':
        // Flush the last frame, commit the final transform once, refresh culling.
        viewControls.end();
        break;
      case 'connect': {
        const t = findNodeAt(screen, new Set([g.sourceId]));
        if (t) {
          // apply() returns void, but the recipe runs synchronously — capture
          // the new edge id through the closure to select it below.
          let newEdgeId: string | null = null;
          apply((d) => {
            newEdgeId = addCustomEdge(d, g.sourceId, t, project.defaults.edge);
          });
          // Select the fresh edge so its on-canvas delete button is visible
          // immediately — otherwise a new arrow has no discoverable way to be
          // removed until the user happens to click it.
          if (newEdgeId) selectEdge(newEdgeId as string);
        }
        setConnect(null);
        setDropTargetId(null);
        break;
      }
      case 'press-node': {
        if (g.moved) {
          setSnapGuide(null);
          if (g.alt) {
            const t = findNodeAt(screen, collectSubtree(project, g.id));
            if (t) {
              commitInteraction((d) => {
                // Only unpin on a SUCCESSFUL reparent: a no-op drop (e.g. back
                // onto its own parent) returns false and must keep the node's
                // current (manual) position instead of snapping it to auto.
                const ok = reparent(d, g.id, t);
                if (ok) unpinNode(d, g.id);
              });
            } else {
              commitInteraction();
            }
          } else {
            commitInteraction();
          }
        }
        setDropTargetId(null);
        break;
      }
      case 'press-bg':
        if (!g.moved) clearSelection();
        break;
      case 'marquee': {
        const current = eventScreenPoint(svg, e);
        const rect = {
          x1: Math.min(g.startScreen.x, current.x),
          y1: Math.min(g.startScreen.y, current.y),
          x2: Math.max(g.startScreen.x, current.x),
          y2: Math.max(g.startScreen.y, current.y),
        };
        // A click-sized sweep is just a click: keep the existing selection
        // semantics instead of wiping it.
        if (Math.abs(rect.x2 - rect.x1) < MOVE_THRESHOLD && Math.abs(rect.y2 - rect.y1) < MOVE_THRESHOLD) {
          setMarquee(null);
          break;
        }
        const v = getLiveView(useStore.getState().view);
        const w1 = screenToWorld({ x: rect.x1, y: rect.y1 }, v);
        const w2 = screenToWorld({ x: rect.x2, y: rect.y2 }, v);
        const { positions, visible } = layoutRef.current;
        const inside: NodeId[] = [];
        for (const id of visible) {
          const p = positions.get(id);
          if (!p) continue;
          if (p.x >= w1.x && p.x <= w2.x && p.y >= w1.y && p.y <= w2.y) inside.push(id);
        }
        if (g.additive) {
          const cur = useStore.getState().selection;
          useStore.getState().selectMany([...new Set([...cur, ...inside])]);
        } else {
          useStore.getState().selectMany(inside);
        }
        setMarquee(null);
        break;
      }
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, cancelGesture, connect, dropTargetId, snapGuide, marquee };
}
