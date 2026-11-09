// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Pure viewport culling for the reconciliation panes.
//
// The 2026-11-08 reconciliation-lag analysis (§3.3) found both trees are drawn
// node-by-node with no viewport culling: a medium data set already mounts
// 3 500–4 000 SVG elements and the cost grows linearly with imported trees.
// Extracting the maths keeps the rule unit-testable without a DOM; the pane
// renders only the ids this returns (plus one viewport of buffer, so elbow
// branches entering from off-screen stay connected).

import type { LayoutResult } from '../layout/autoLayout';
import type { NodeId } from '../model/types';
import type { PaneTransform } from './reconMapping';

/** Axis-aligned world-space rectangle. */
export interface WorldViewport {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The world rectangle shown by a pane box under `transform`, expanded by
 * `buffer` box-widths / box-heights on every side. A zero/negative box means
 * "not measured yet" and is reported as unbounded.
 */
export function paneWorldViewport(
  transform: PaneTransform,
  width: number,
  height: number,
  buffer = 1,
): WorldViewport {
  if (width <= 0 || height <= 0) {
    return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
  }
  const { scale, tx, ty } = transform;
  const padX = (width * Math.max(0, buffer)) / scale;
  const padY = (height * Math.max(0, buffer)) / scale;
  return {
    minX: -tx / scale - padX,
    maxX: (width - tx) / scale + padX,
    minY: -ty / scale - padY,
    maxY: (height - ty) / scale + padY,
  };
}

/** Node ids of `layout` that intersect the pane's (buffered) viewport. */
export function cullPaneNodes(
  layout: LayoutResult,
  transform: PaneTransform,
  width: number,
  height: number,
  buffer = 1,
): NodeId[] {
  const ids: NodeId[] = [];
  if (width <= 0 || height <= 0) {
    for (const id of layout.visible) ids.push(id);
    return ids;
  }
  const v = paneWorldViewport(transform, width, height, buffer);
  for (const id of layout.visible) {
    const p = layout.positions.get(id);
    if (p && p.x >= v.minX && p.x <= v.maxX && p.y >= v.minY && p.y <= v.maxY) {
      ids.push(id);
    }
  }
  return ids;
}
