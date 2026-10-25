// Shared node-marker geometry.
//
// The canvas (NodeView, JSX) and the image exporter (exportImage, SVG string
// builder) both derive their outline from the single `markerPath` source of
// truth below, so a shape is defined once and the two renderers cannot drift
// apart. `eventMarkerPath` plays the same role for evolutionary-event badges
// (EventLayer + exportImage), including the shapes the badge editor offers
// beyond the node marker set.

import type { EventMarkerShape, NodeShape } from '../model/types';

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

/**
 * Regular-polygon / star vertex ring: `n` points at radius `r` around (cx, cy),
 * starting at 12 o'clock (-90°) so triangles and stars read upright.
 */
function vertexRing(n: number, cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * SVG path data for an event badge centred on (`cx`, `cy`) with outer radius
 * `size`. Same shapes must render identically on the canvas and in every
 * export, so the exporter calls this instead of re-implementing geometry.
 */
export function eventMarkerPath(
  shape: EventMarkerShape,
  cx: number,
  cy: number,
  size: number,
): string {
  const s = size;
  switch (shape) {
    case 'square':
      return markerPath('square', cx, cy, s * 0.92);
    case 'diamond':
      return markerPath('diamond', cx, cy, s * 1.12);
    case 'triangle': {
      const pts = vertexRing(3, cx, cy, s * 1.18);
      return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
    }
    case 'star': {
      // Five-point star: outer ring at radius s, inner ring at ~0.42 s so the
      // arms stay readable at badge sizes (the classic 10-vertex outline).
      const outer = vertexRing(5, cx, cy, s);
      const inner: [number, number][] = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / 5;
        inner.push([cx + s * 0.42 * Math.cos(a), cy + s * 0.42 * Math.sin(a)]);
      }
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        pts.push(`${outer[i][0].toFixed(2)} ${outer[i][1].toFixed(2)}`);
        pts.push(`${inner[i][0].toFixed(2)} ${inner[i][1].toFixed(2)}`);
      }
      return `M ${pts.join(' L ')} Z`;
    }
    case 'hexagon': {
      const pts = vertexRing(6, cx, cy, s);
      return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
    }
    case 'circle':
    default:
      return markerPath('circle', cx, cy, s);
  }
}
