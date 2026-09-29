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
import { circularPath, elbowPath } from './paths';
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
}

export const EdgeView = memo(function EdgeView({
  from,
  to,
  orientation,
  layoutType,
  style,
  unmeasured,
}: EdgeViewProps) {
  const d = layoutType === 'circular' ? circularPath(from, to) : elbowPath(from, to, orientation);
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
