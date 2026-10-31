// Pure SVG path builders for branches and custom (reticulation) edges.

import type { BranchShape, LayoutType, Orientation, Point } from '../model/types';

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

/**
 * Smooth cubic connector for a rectangular tree — the "tube" branch style
 * ported from PhyloRecViewer. The branch leaves the parent along the depth
 * axis and enters the child along the same axis, bending on the breadth axis
 * at the midpoint: both control points of an LR/RL branch share
 * x = (from.x + to.x) / 2, and both of a TB/BT branch share
 * y = (from.y + to.y) / 2. At t = 0.5 the curve passes through the plain
 * midpoint of the two endpoints, which is what branch-midpoint anchors use.
 */
export function curvedBranchPath(from: Point, to: Point, orientation: Orientation): string {
  const horizontal = orientation === 'LR' || orientation === 'RL';
  if (horizontal) {
    const xm = (from.x + to.x) / 2;
    return `M ${f(from.x)} ${f(from.y)} C ${f(xm)} ${f(from.y)} ${f(xm)} ${f(to.y)} ${f(to.x)} ${f(to.y)}`;
  }
  const ym = (from.y + to.y) / 2;
  return `M ${f(from.x)} ${f(from.y)} C ${f(from.x)} ${f(ym)} ${f(to.x)} ${f(ym)} ${f(to.x)} ${f(to.y)}`;
}

export function straightPath(from: Point, to: Point): string {
  return `M ${f(from.x)} ${f(from.y)} L ${f(to.x)} ${f(to.y)}`;
}

/**
 * One branch path for every renderer: the circular layout keeps its arc +
 * radial construction, rectangular layouts use the user's branch shape
 * (elbow by default, smooth cubic for 'curved'). Canvas and exporter both call
 * this so a branch cannot be curved on screen and angular in an export.
 */
export function branchPath(
  from: Point,
  to: Point,
  orientation: Orientation,
  layoutType: LayoutType,
  shape: BranchShape,
): string {
  if (layoutType === 'circular') return circularPath(from, to);
  return shape === 'curved' ? curvedBranchPath(from, to, orientation) : elbowPath(from, to, orientation);
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
  curved = false,
): Point {
  if (layoutType === 'circular') {
    const rp = Math.hypot(from.x, from.y);
    const rc = Math.hypot(to.x, to.y);
    const ac = Math.atan2(to.y, to.x);
    const r = (rp + rc) / 2;
    return { x: r * Math.cos(ac), y: r * Math.sin(ac) };
  }
  return branchMidpoint(from, to, orientation, curved);
}

/**
 * A point that actually lies ON an elbow branch between a parent and child.
 * The elbow path (see elbowPath) bends at `corner`, so the plain bounding-box
 * midpoint `((x1+x2)/2, (y1+y2)/2)` lands in empty air for rectangular
 * layouts — transition markers / branch-event anchors must instead sit on a
 * segment of the polyline, otherwise coloured dots appear to float next to
 * (not on) the branches (P6).
 */
export function branchMidpoint(
  from: Point,
  to: Point,
  orientation: Orientation,
  curved = false,
): Point {
  if (curved) {
    // On the curvedBranchPath cubic, t = 0.5 lands on the plain midpoint of
    // the two endpoints (both control points sit on the breadth midpoint).
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }
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
