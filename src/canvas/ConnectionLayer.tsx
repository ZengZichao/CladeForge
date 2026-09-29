// Overlay for an in-progress custom-edge drag: a dashed curve from the source
// node to the current pointer position.

import { curvedPath } from './paths';
import type { Point } from '../model/types';

interface ConnectionLayerProps {
  from: Point;
  to: Point;
  color: string;
}

export function ConnectionLayer({ from, to, color }: ConnectionLayerProps) {
  return (
    <path
      d={curvedPath(from, to, 0.2)}
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeDasharray="5 4"
      opacity={0.85}
      pointerEvents="none"
    />
  );
}
