// Which branches the layout could NOT measure, and how they are drawn.
//
// `TreeCanvas.tsx` / `EdgeView.tsx` both consult this rule; it lives in a plain
// `.ts` module so it is testable without rendering (the repository's test net
// covers `.ts` only — same reason `hitTarget.ts` and `labels.ts` exist next to
// the canvas components).
//
// `computeLayout` already knows which branches carry no usable length
// (`unknownDepth`) and which nodes carry no usable age (`unknownAge`), and it
// lays those out on the topological grid instead of inventing numbers. Reading
// a missing length as 0 and a missing age as "present" would make an
// UNMEASURED tree look pixel-identical to a measured one, so knowing it is not
// enough: the renderer has to say it too. The convention here is the one the
// layout panel's legend promises (`layoutPanel.branchLengthUnknownLegend`:
// "grey dashed branch = no recorded length (not a zero length)"), so the
// drawing and the legend agree.

import type { NodeId } from '../model/types';
import { C_UNKNOWN } from './colors';

/** Dash pattern for an unmeasured branch: long enough to read at 0.2× zoom. */
export const UNMEASURED_DASH = '6 5';
/** Minimum visible weight of the unmeasured marker, in world units. */
export const UNMEASURED_MIN_WIDTH = 1.5;

/**
 * The nodes whose own incoming branch (or an ancestral one) could not be
 * measured. `computeLayout` propagates an unknown downstream, so a member of
 * these sets is a branch that must be marked, not a branch that merely sits near
 * one. Either set alone may be absent — the rectangular phylogram fills
 * `unknownDepth`, the time-calibrated layout fills `unknownAge`.
 */
export function unmeasuredNodeIds(
  unknownDepth?: ReadonlySet<NodeId>,
  unknownAge?: ReadonlySet<NodeId>,
): Set<NodeId> {
  const out = new Set<NodeId>();
  if (unknownDepth) for (const id of unknownDepth) out.add(id);
  if (unknownAge) for (const id of unknownAge) out.add(id);
  return out;
}

/** Should the branch ENTERING `id` be drawn as unmeasured? */
export function isUnmeasured(ids: ReadonlySet<NodeId>, id: NodeId): boolean {
  return ids.has(id);
}

/** The overlay stroke for an unmeasured branch, derived from the branch's own. */
export function unmeasuredMark(width: number): { color: string; width: number; dash: string } {
  const w = Number.isFinite(width) ? Math.max(UNMEASURED_MIN_WIDTH, width) : UNMEASURED_MIN_WIDTH;
  return { color: C_UNKNOWN, width: w, dash: UNMEASURED_DASH };
}

/**
 * The scale bar is only meaningful when the layout actually mapped lengths onto
 * pixels. `computeLayout` drops `depthScale` exactly when nothing was measurable;
 * `hasScaleBar` is the single place that reads it, so the bar can never be drawn
 * against an invented scale.
 */
export function hasScaleBar(depthScale: number | undefined): boolean {
  return typeof depthScale === 'number' && Number.isFinite(depthScale) && depthScale > 0;
}
