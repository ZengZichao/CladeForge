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
  unmeasured,
  dimmed,
}: EdgeViewProps) {
  const d = branchPath(from, to, orientation, layoutType, style.shape);
  const caps = branchCaps(style.shape);
  const mark = unmeasured ? unmeasuredMark(style.width) : null;
  return (
    <>
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
