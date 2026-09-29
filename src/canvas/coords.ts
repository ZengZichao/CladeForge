// Pure coordinate math for the canvas: world <-> screen and zoom-at-anchor.

import type { Point, ViewTransform } from '../model/types';

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export function worldToScreen(p: Point, v: ViewTransform): Point {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty };
}

export function screenToWorld(p: Point, v: ViewTransform): Point {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

/** Zoom by `factor` while keeping `anchor` (screen coords) visually fixed. */
export function zoomAt(
  v: ViewTransform,
  anchor: Point,
  factor: number,
  min = MIN_SCALE,
  max = MAX_SCALE,
): ViewTransform {
  const scale = clamp(v.scale * factor, min, max);
  const k = scale / v.scale;
  return {
    scale,
    tx: anchor.x - (anchor.x - v.tx) * k,
    ty: anchor.y - (anchor.y - v.ty) * k,
  };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A view transform that fits `bounds` into a viewport of the given size. */
export function fitView(
  bounds: Bounds,
  viewportW: number,
  viewportH: number,
  padding = 60,
): ViewTransform {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // A degenerate box (empty document, single node) has no extent to fit. The
  // old `Math.max(1, …)` turned it into a 1-unit subject and produced a scale
  // pinned at MAX_SCALE, so a brand-new tab displayed "zoom 800%" over an empty
  // canvas. Hold at 1:1 and just centre it.
  if (w <= 0 || h <= 0) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return { scale: 1, tx: viewportW / 2 - cx, ty: viewportH / 2 - cy };
  }
  const scale = clamp(
    Math.min((viewportW - padding * 2) / w, (viewportH - padding * 2) / h),
    MIN_SCALE,
    MAX_SCALE,
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    tx: viewportW / 2 - cx * scale,
    ty: viewportH / 2 - cy * scale,
  };
}
