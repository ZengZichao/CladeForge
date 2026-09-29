// Pure SVG path builders for branches and custom (reticulation) edges.

import type { LayoutType, Orientation, Point } from '../model/types';

/** Round to 2 decimals to keep exported SVG compact and stable. */
function f(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rectangular "elbow" connector between a parent and child node. */
export function elbowPath(from: Point, to: Point, orientation: Orientation): string {
  const horizontal = orientation === 'LR' || orientation === 'RL';
  const corner: Point = horizontal ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
  return `M ${f(from.x)} ${f(from.y)} L ${f(corner.x)} ${f(corner.y)} L ${f(to.x)} ${f(to.y)}`;
}

export function straightPath(from: Point, to: Point): string {
  return `M ${f(from.x)} ${f(from.y)} L ${f(to.x)} ${f(to.y)}`;
}

/**
 * Circular-layout branch: an ARC at the parent's radius sweeping from the
 * parent's angle to the child's angle, then a straight RADIAL segment out to
 * the child. Drawing plain straight chords (parent point -> child point) made
 * the "circular" view read as a sunburst of diagonals instead of a fan/ring
 * tree; the arc + radial construction is what a circular cladogram looks like.
 */
export function circularPath(from: Point, to: Point): string {
  const rp = Math.hypot(from.x, from.y);
  const rc = Math.hypot(to.x, to.y);
  if (rp < 0.5 || rc < 0.5) return straightPath(from, to);
  const ap = Math.atan2(from.y, from.x);
  const ac = Math.atan2(to.y, to.x);
  // Shortest signed sweep from ap to ac in (-π, π]; root's fan never spans
  // more than 2π so this is always the correct (small) arc.
  let delta = ac - ap;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) < 1e-4) return straightPath(from, to);
  const sweep = delta > 0 ? 1 : 0;
  const bx = rp * Math.cos(ac);
  const by = rp * Math.sin(ac);
  return (
    `M ${f(from.x)} ${f(from.y)} ` +
    `A ${f(rp)} ${f(rp)} 0 0 ${sweep} ${f(bx)} ${f(by)} ` +
    `L ${f(to.x)} ${f(to.y)}`
  );
}

/**
 * Layout-aware "point on the branch": for rectangular layouts the on-segment
 * elbow midpoint; for the circular layout the midpoint of the radial segment
 * (at the child's angle, halfway between the two radii) so markers sit ON the
 * drawn branch instead of floating inside the fan.
 */
export function branchMidpointOn(
  from: Point,
  to: Point,
  orientation: Orientation,
  layoutType?: LayoutType,
): Point {
  if (layoutType === 'circular') {
    const rp = Math.hypot(from.x, from.y);
    const rc = Math.hypot(to.x, to.y);
    const ac = Math.atan2(to.y, to.x);
    const r = (rp + rc) / 2;
    return { x: r * Math.cos(ac), y: r * Math.sin(ac) };
  }
  return branchMidpoint(from, to, orientation);
}

/**
 * A point that actually lies ON an elbow branch between a parent and child.
 * The elbow path (see elbowPath) bends at `corner`, so the plain bounding-box
 * midpoint `((x1+x2)/2, (y1+y2)/2)` lands in empty air for rectangular
 * layouts — transition markers / branch-event anchors must instead sit on a
 * segment of the polyline, otherwise coloured dots appear to float next to
 * (not on) the branches (P6).
 */
export function branchMidpoint(from: Point, to: Point, orientation: Orientation): Point {
  const horizontal = orientation === 'LR' || orientation === 'RL';
  return horizontal
    ? // For LR/RL the horizontal segment runs from x=from.x to x=to.x at y=to.y.
      { x: (from.x + to.x) / 2, y: to.y }
    : // For TB/BT the vertical segment runs from y=from.y to y=to.y at x=to.x.
      { x: to.x, y: (from.y + to.y) / 2 };
}

/**
 * Curved connector for custom edges. `curvature` (0..1) bows the quadratic
 * control point perpendicular to the straight line between endpoints.
 */
export function curvedPath(from: Point, to: Point, curvature: number): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = curvature * len * 0.5;
  const cx = mx + nx * off;
  const cy = my + ny * off;
  return `M ${f(from.x)} ${f(from.y)} Q ${f(cx)} ${f(cy)} ${f(to.x)} ${f(to.y)}`;
}

/** Midpoint of the quadratic curve above (for placing a label). */
export function curveMidpoint(from: Point, to: Point, curvature: number): Point {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = curvature * len * 0.5;
  // Point on the quadratic at t=0.5 is the average of endpoints and control.
  const cx = mx + nx * off;
  const cy = my + ny * off;
  return { x: (from.x + 2 * cx + to.x) / 4, y: (from.y + 2 * cy + to.y) / 4 };
}
