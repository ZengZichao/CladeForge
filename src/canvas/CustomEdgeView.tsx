// Renders a custom (reticulation / special-relationship) edge as a curved
// connector with an optional arrowhead and label. Each edge carries its own
// arrow marker so the arrow colour always matches the stroke.

import { memo } from 'react';
import { dashArray, type CustomEdge, type Point } from '../model/types';
import { curvedPath, curveMidpoint } from './paths';

interface CustomEdgeViewProps {
  edge: CustomEdge;
  from: Point;
  to: Point;
  selected: boolean;
}

export const CustomEdgeView = memo(function CustomEdgeView({
  edge,
  from,
  to,
  selected,
}: CustomEdgeViewProps) {
  const { style } = edge;
  const d = curvedPath(from, to, style.curvature);
  const markerId = `cf-arrow-${edge.id}`;
  const mid = curveMidpoint(from, to, style.curvature);

  return (
    <g data-role="custom-edge" data-edge-id={edge.id} style={{ cursor: 'pointer' }}>
      {style.arrow && (
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={style.color} />
          </marker>
        </defs>
      )}
      {/* Fat invisible hit area for easy selection.
          pointerEvents="stroke" is set explicitly because some browsers
          (notably WebKit/Safari) treat stroke="transparent" as non-hit
          under the default visiblePainted rule, making custom edges
          unclickable after the first one is selected. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, style.width + 8)} pointerEvents="stroke" />
      {selected && (
        <path d={d} fill="none" stroke="var(--c-select)" strokeWidth={style.width + 4} opacity={0.35} pointerEvents="none" />
      )}
      <path
        d={d}
        fill="none"
        stroke={style.color}
        strokeWidth={style.width}
        strokeDasharray={dashArray(style.dash, style.width)}
        strokeLinecap="round"
        markerEnd={style.arrow ? `url(#${markerId})` : undefined}
      />
      {edge.label && (
        <text
          x={mid.x}
          y={mid.y - 4}
          textAnchor="middle"
          fontSize={12}
          fill={style.color}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
});
