// Corner minimap: a scaled overview of the whole tree with a rectangle marking
// the current viewport. Click or drag anywhere on it to recentre the main view.
// Rendered as an overlay inside the canvas wrapper (it needs the live layout,
// view transform and viewport size).

import { memo, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { LayoutResult } from '../layout/autoLayout';
import type { Point, TreeNode, ViewTransform } from '../model/types';

const W = 178;
const H = 128;
const M = 10;
const PAD = 4; // CSS padding inside the card

/** Ceiling on rendered branch segments; above it the minimap is sub-pixel anyway. */
const MAX_MINIMAP_SEGMENTS = 480;

export const Minimap = memo(function Minimap({
  layout,
  nodes,
  view,
  size,
  setView,
}: {
  layout: LayoutResult;
  nodes: Record<string, TreeNode>;
  view: ViewTransform;
  size: { w: number; h: number };
  setView: (v: ViewTransform) => void;
}) {
  const b = layout.bounds;
  const treeW = Math.max(1, b.maxX - b.minX);
  const treeH = Math.max(1, b.maxY - b.minY);
  const k = Math.min((W - 2 * M) / treeW, (H - 2 * M) / treeH);
  const offX = (W - treeW * k) / 2;
  const offY = (H - treeH * k) / 2;
  const toMap = (x: number, y: number): Point => ({
    x: offX + (x - b.minX) * k,
    y: offY + (y - b.minY) * k,
  });

  // Branch segments in minimap coords; recomputed only when the layout changes.
  const segs = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const id of layout.visible) {
      const n = nodes[id];
      if (!n?.parentId || !layout.visible.has(n.parentId)) continue;
      const from = layout.positions.get(n.parentId);
      const to = layout.positions.get(id);
      if (!from || !to) continue;
      const a = toMap(from.x, from.y);
      const c = toMap(to.x, to.y);
      out.push({ x1: a.x, y1: a.y, x2: c.x, y2: c.y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, nodes]);

  // Teardown for an in-progress drag; invoked on unmount so the window
  // mousemove/mouseup listeners can't outlive the component (memory leak).
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  // The minimap is only ~178x128 px, so beyond a few hundred branches the extra
  // detail is sub-pixel — yet every segment became a React element rebuilt on each
  // drag frame, because `layout` changes identity whenever the dragged subtree
  // moves. Sampling evenly keeps the same silhouette for a fraction of the work.
  const drawnSegs = useMemo(() => {
    if (segs.length <= MAX_MINIMAP_SEGMENTS) return segs;
    const stride = segs.length / MAX_MINIMAP_SEGMENTS;
    const out: typeof segs = [];
    for (let i = 0; i < MAX_MINIMAP_SEGMENTS; i += 1) out.push(segs[Math.floor(i * stride)]);
    return out;
  }, [segs]);

  if (segs.length === 0) return null;

  // Current viewport as a world-space rectangle mapped into the minimap; only
  // available once the canvas has been measured (and the scale is usable).
  const hasView = size.w > 0 && size.h > 0 && view.scale > 0;
  const r0 = hasView ? toMap((0 - view.tx) / view.scale, (0 - view.ty) / view.scale) : null;
  const r1 = hasView
    ? toMap((size.w - view.tx) / view.scale, (size.h - view.ty) / view.scale)
    : null;

  const navTo = (clientX: number, clientY: number, rect: DOMRect) => {
    if (!hasView) return;
    const worldX = b.minX + (clientX - rect.left - offX) / k;
    const worldY = b.minY + (clientY - rect.top - offY) / k;
    setView({
      scale: view.scale,
      tx: size.w / 2 - worldX * view.scale,
      ty: size.h / 2 - worldY * view.scale,
    });
  };

  const onDown = (e: ReactMouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    navTo(e.clientX, e.clientY, rect);
    const move = (ev: MouseEvent) => navTo(ev.clientX, ev.clientY, rect);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragCleanup.current = null;
    };
    dragCleanup.current = up;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <svg className="minimap" width={W} height={H} onMouseDown={onDown}>
      <rect className="minimap-bg" x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx={8} />
      {drawnSegs.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="minimap-branch" />
      ))}
      {r0 && r1 && (
        <rect
          className="minimap-view"
          x={Math.min(r0.x, r1.x)}
          y={Math.min(r0.y, r1.y)}
          width={Math.abs(r1.x - r0.x)}
          height={Math.abs(r1.y - r0.y)}
        />
      )}
    </svg>
  );
});
