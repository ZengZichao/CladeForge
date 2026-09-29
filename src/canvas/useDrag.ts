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
  | { kind: 'press-bg'; startScreen: Point; moved: boolean };

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
}

export function useCanvasGestures(
  svgRef: MutableRefObject<SVGSVGElement | null>,
  layoutRef: MutableRefObject<LayoutResult>,
  spaceHeld: MutableRefObject<boolean>,
): CanvasGestures {
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const setView = useStore((s) => s.setView);
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
      const world = SNAP_RADIUS / useStore.getState().view.scale;
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
      const v = useStore.getState().view;
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
    if (gestureRef.current.kind === 'press-node') {
      useStore.getState().cancelInteraction();
    }
    gestureRef.current = { kind: 'none' };
    setConnect(null);
    setDropTargetId(null);
    setSnapGuide(null);
  }, []);

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
    const screen = eventScreenPoint(svg, e);
    const world = screenToWorld(screen, view);
    // Resolve through closest(): the physical hit is often a CHILD of the
    // attributed group (custom edges draw a fat transparent hit path), so
    // reading e.target's own attributes misses and broke edge re-selection.
    const hit = hitTargetFor(e.target);
    const { role, nodeId, edgeId } = hit;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
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
    if (spaceHeld.current || e.button === 1) {
      gestureRef.current = { kind: 'pan', startScreen: screen, startView: view };
    } else {
      gestureRef.current = { kind: 'press-bg', startScreen: screen, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (g.kind === 'none') return;
    const svg = svgRef.current;
    if (!svg) return;
    const screen = eventScreenPoint(svg, e);
    const world = screenToWorld(screen, view);

    switch (g.kind) {
      case 'pan':
        setView({
          ...g.startView,
          tx: g.startView.tx + (screen.x - g.startScreen.x),
          ty: g.startView.ty + (screen.y - g.startScreen.y),
        });
        break;
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
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, cancelGesture, connect, dropTargetId, snapGuide };
}
