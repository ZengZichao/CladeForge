// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Small overlays that need the view SCALE to keep a constant on-screen size.
//
// They live in their own leaf components so that a change of scale re-renders
// the overlay alone: the wheel burst paints the world group imperatively, and
// these follow the low-frequency committed-view cadence instead of dragging
// the whole canvas through React on every wheel event.

import { memo } from 'react';
import { useStore } from '../model/store';
import { removeCustomEdge } from '../model/treeOps';
import { curveMidpoint } from './paths';
import { S } from '../ui/strings';
import type { Bounds } from './coords';
import type { EdgeId, Point } from '../model/types';

export const SnapGuide = memo(function SnapGuide({
  guide,
  bounds,
}: {
  guide: { axis: 'x' | 'y'; coord: number } | null;
  bounds: Bounds;
}) {
  const scale = useStore((s) => s.view.scale);
  if (!guide) return null;
  const inv = 1 / Math.max(scale, 0.01);
  return (
    <line
      x1={guide.axis === 'x' ? guide.coord : bounds.minX - 400}
      y1={guide.axis === 'x' ? bounds.minY - 400 : guide.coord}
      x2={guide.axis === 'x' ? guide.coord : bounds.maxX + 400}
      y2={guide.axis === 'x' ? bounds.maxY + 400 : guide.coord}
      stroke="var(--c-select)"
      strokeWidth={inv}
      strokeDasharray={`${6 * inv} ${4 * inv}`}
      opacity={0.55}
      pointerEvents="none"
    />
  );
});

/**
 * Floating delete button at the midpoint of the selected custom edge. The
 * nested scale keeps it a constant on-screen size; only this button re-renders
 * when the zoom changes.
 */
export const SelectedCustomEdgeDelete = memo(function SelectedCustomEdgeDelete({
  edgeId,
  from,
  to,
  curvature,
}: {
  edgeId: EdgeId;
  from: Point;
  to: Point;
  curvature: number;
}) {
  const scale = useStore((s) => s.view.scale);
  const apply = useStore((s) => s.apply);
  const m = curveMidpoint(from, to, curvature);
  const s = 1 / Math.max(scale, 0.01);
  return (
    <g
      transform={`translate(${m.x} ${m.y}) scale(${s})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        apply((d) => removeCustomEdge(d, edgeId));
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
});
