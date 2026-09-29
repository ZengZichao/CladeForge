// Shared label placement logic so the on-screen canvas and the exported SVG
// position labels identically (WYSIWYG export).
//
// Label placement rule: regardless of whether a node is internal or a leaf,
// the label is always placed on the "far side" of the node — the side away
// from the parent — so labels never overlap the tree topology. Concretely:
//   LR → labels on the RIGHT of the node (dx > 0)
//   RL → labels on the LEFT  of the node (dx < 0)
//   TB → labels BELOW the node (dy > 0)
//   BT → labels ABOVE the node (dy < 0)
// This applies to BOTH internal and tip nodes identically.
//
// Circular layout: the four cardinal branches above cannot
// express "away from the parent" on a polar layout, so every label fell to the
// default LR case — right of the node, anchored at its start — which on the left
// half of the circle drove every label straight INTO the tree, over the branches
// and over each other. When the caller supplies the node's radial angle (the
// parent → node direction, see `labelAngleOf`), the label is placed along that
// ray instead, with the anchor flipped per hemisphere so the text still reads
// left-to-right.
//
// When the user sets a custom `labelPosition` (top / bottom / left / right /
// top-left / top-right / bottom-left / bottom-right), that direction overrides
// the auto placement — also in the circular layout, so manual correction keeps
// working. Manual XY offsets (`labelOffsetX` / `labelOffsetY`) are added on top
// of any placement.

import type { LabelPosition, Orientation, Point } from '../model/types';

export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'hanging' | 'auto';
}

/** Gap between the node marker edge and the label text. */
const LABEL_GAP = 6;

/**
 * Within this cosine of the radial angle the text is treated as "beside" the
 * node (anchor start / end); outside it the label sits above or below and is
 * centred, so it does not run off tangentially.
 */
const HORIZONTAL_BAND = 0.25;

/**
 * The direction a label should point: away from the parent, i.e. along the
 * parent → node ray. Undefined for the root (no parent) and for a node that
 * coincides with its parent, where the caller falls back to the orientation
 * default. Screen-space y grows downwards, which `Math.atan2` already accounts
 * for because the offset is used in the same coordinate space.
 */
export function labelAngleOf(parent: Point | undefined, pos: Point): number | undefined {
  if (!parent) return undefined;
  const dx = pos.x - parent.x;
  const dy = pos.y - parent.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return undefined;
  return Math.atan2(dy, dx);
}

/**
 * Placement along the outward ray `angleRad`, `LABEL_GAP` beyond the marker.
 * The anchor flips on the left half so the text never renders backwards or into
 * the centre of the circle.
 */
export function radialPlacement(angleRad: number, size: number): LabelPlacement {
  const g = size + LABEL_GAP;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const anchor: LabelPlacement['anchor'] =
    cos > HORIZONTAL_BAND ? 'start' : cos < -HORIZONTAL_BAND ? 'end' : 'middle';
  return { dx: cos * g, dy: sin * g, anchor, baseline: 'central' };
}

/** The default "far side" placement for the four rectangular orientations. */
function sidePlacement(orientation: Orientation, size: number): LabelPlacement {
  switch (orientation) {
    case 'RL':
      return { dx: -(size + LABEL_GAP), dy: 0, anchor: 'end', baseline: 'central' };
    case 'TB':
      return { dx: 0, dy: size + LABEL_GAP, anchor: 'middle', baseline: 'hanging' };
    case 'BT':
      return { dx: 0, dy: -(size + LABEL_GAP), anchor: 'middle', baseline: 'auto' };
    case 'LR':
    default:
      return { dx: size + LABEL_GAP, dy: 0, anchor: 'start', baseline: 'central' };
  }
}

/**
 * Explicit placement for each cardinal / intercardinal direction.
 * The `size` parameter is the node marker radius; labels sit `LABEL_GAP`
 * pixels beyond the marker edge.
 */
function explicitPlacement(pos: LabelPosition, size: number): LabelPlacement {
  const g = size + LABEL_GAP;
  switch (pos) {
    case 'top':
      return { dx: 0, dy: -g, anchor: 'middle', baseline: 'auto' };
    case 'bottom':
      return { dx: 0, dy: g, anchor: 'middle', baseline: 'hanging' };
    case 'left':
      return { dx: -g, dy: 0, anchor: 'end', baseline: 'central' };
    case 'right':
      return { dx: g, dy: 0, anchor: 'start', baseline: 'central' };
    case 'top-left':
      return { dx: -g, dy: -g, anchor: 'end', baseline: 'auto' };
    case 'top-right':
      return { dx: g, dy: -g, anchor: 'start', baseline: 'auto' };
    case 'bottom-left':
      return { dx: -g, dy: g, anchor: 'end', baseline: 'hanging' };
    case 'bottom-right':
      return { dx: g, dy: g, anchor: 'start', baseline: 'hanging' };
    default:
      return { dx: g, dy: 0, anchor: 'start', baseline: 'central' };
  }
}

export function labelPlacement(
  orientation: Orientation,
  _isLeaf: boolean,
  size: number,
  labelPosition?: LabelPosition,
  labelOffsetX?: number,
  labelOffsetY?: number,
  /**
   * Radial (parent → node) angle in radians, supplied by the caller only for the
   * circular layout. When present it replaces the orientation branch, because
   * "away from the parent" is an angle there, not a side.
   */
  angleRad?: number,
): LabelPlacement {
  let place: LabelPlacement;

  if (labelPosition && labelPosition !== 'auto') {
    place = explicitPlacement(labelPosition, size);
  } else if (typeof angleRad === 'number' && Number.isFinite(angleRad)) {
    place = radialPlacement(angleRad, size);
  } else {
    // Both internal and tip nodes use the same "far side" placement.
    place = sidePlacement(orientation, size);
  }

  // Apply manual XY offsets on top of the computed placement.
  const ox = labelOffsetX ?? 0;
  const oy = labelOffsetY ?? 0;
  if (ox !== 0 || oy !== 0) {
    place = { ...place, dx: place.dx + ox, dy: place.dy + oy };
  }

  return place;
}
