// Renders a single tree branch (parent -> child connector).

import { memo } from 'react';
import {
  branchCaps,
  dashArray,
  type BranchStyle,
  type LayoutType,
  type Orientation,
  type Point,
} from '../model/types';
import { branchPath } from './paths';
import { unmeasuredMark } from './branchFlags';

interface EdgeViewProps {
  from: Point;
  to: Point;
  orientation: Orientation;
  layoutType: LayoutType;
  style: BranchStyle;
  /**
   * M34 (UI_UX_REVIEW): the child node this branch leads TO. A branch press
   * then acts on that node (select / context menu), so core editing actions —
   * 插入父节点 / 重新定根 — are reachable by pointing at the branch itself
   * instead of hunting for the child's marker.
   */
  childId?: string;
  /**
   * The layout could not measure this branch (no usable length / no age).
   * Drawn as a grey dashed overlay ON TOP of the user's own style: the
   * colour still carries their meaning, and the dash says "this distance is not
   * data". Hiding the branch instead would erase topology.
   */
  unmeasured?: boolean;
  /**
   * Low-support branch (below the document's support threshold): rendered at
   * reduced opacity so the weakly-supported spine reads at a glance — the
   * exporter applies the same rule, which is what makes the threshold control
   * honest on both sides of the screen/export boundary.
   */
  dimmed?: boolean;
}

export const EdgeView = memo(function EdgeView({
  from,
  to,
  orientation,
  layoutType,
  style,
  childId,
  unmeasured,
  dimmed,
}: EdgeViewProps) {
  const d = branchPath(from, to, orientation, layoutType, style.shape);
  const caps = branchCaps(style.shape);
  const mark = unmeasured ? unmeasuredMark(style.width) : null;
  return (
    <>
      {/* M34: a 12px invisible hit path — hairline branches (≤1.5px) were
          impossible to point at, so branch-level actions never happened on the
          branch. Presses resolve through the child node id. */}
      {childId && (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          strokeLinecap="round"
          pointerEvents="stroke"
          data-role="branch"
          data-node-id={childId}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={style.color}
        strokeWidth={style.width}
        strokeDasharray={dashArray(style.dash, style.width)}
        strokeLinejoin={caps.linejoin}
        strokeLinecap={caps.linecap}
        opacity={dimmed ? 0.45 : undefined}
      />
      {mark && (
        <path
          d={d}
          fill="none"
          stroke={mark.color}
          strokeWidth={mark.width}
          strokeDasharray={mark.dash}
          strokeLinejoin={caps.linejoin}
          strokeLinecap={caps.linecap}
          pointerEvents="none"
        />
      )}
    </>
  );
});
