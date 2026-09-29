// Shared node-marker geometry.
//
// The canvas (NodeView, JSX) and the image exporter (exportImage, SVG string
// builder) both derive their outline from the single `markerPath` source of
// truth below, so a shape is defined once and the two renderers cannot drift
// apart.

import type { NodeShape } from '../model/types';

/** SVG path data for the marker shape centred on (`cx`, `cy`). */
export function markerPath(shape: NodeShape, cx: number, cy: number, size: number): string {
  const s = size;
  switch (shape) {
    case 'square':
      return `M ${cx - s} ${cy - s} h ${2 * s} v ${2 * s} h ${-2 * s} Z`;
    case 'diamond':
      return `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;
    case 'circle':
    default:
      // Two-arc full circle (a single 360° arc degenerates to a point).
      return `M ${cx - s} ${cy} A ${s} ${s} 0 1 0 ${cx + s} ${cy} A ${s} ${s} 0 1 0 ${cx - s} ${cy} Z`;
  }
}
