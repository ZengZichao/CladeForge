// Shared label geometry for the canvas and the exporters.
//
// Both need to know how much world-space a node's LABEL occupies, not just where
// the node dot sits. This module must stay free of export-only heavy imports
// (jspdf / svg2pdf), because the canvas pulls it in on every render.

import { labelAngleOf, labelPlacement } from './labels';
import type { Bounds } from './coords';
import { resolveNodeStyle, type NodeId, type Point, type Project, type TreeNode } from '../model/types';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The one glyph-width rule for the whole app: CJK and other full-width glyphs
 * advance ≈ 1 em, Latin ≈ 0.62 em. It lives here because both the canvas bounds
 * and the time-axis label planner need it and must agree — charging every UTF-16
 * unit 0.62 em measures a CJK label short, and the crop then shows up in SVG, PNG
 * and PDF alike. The shipped sample projects label their states 陆生 / 半水生 /
 * 水生, so this is not a hypothetical.
 */
const FULL_WIDTH_ABOVE = 0x2e7f;
export function estimateLabelWidth(label: string, fontSize: number): number {
  let w = 0;
  for (const ch of label) {
    w += ch.charCodeAt(0) > FULL_WIDTH_ABOVE ? fontSize : fontSize * 0.62;
  }
  return w;
}

/**
 * The circular layout places a label along the parent → node ray, so the export
 * measures and draws it the same way the canvas does (the WYSIWYG rule).
 */
export function labelAngleFor(
  project: Project,
  positions: Map<NodeId, Point>,
  node: TreeNode,
): number | undefined {
  if (project.layout.type !== 'circular') return undefined;
  const pos = positions.get(node.id);
  if (!pos) return undefined;
  const parentPos = node.parentId ? positions.get(node.parentId) : undefined;
  return labelAngleOf(parentPos, pos);
}

/**
 * World-space bounding box of every node LABEL text (null when nothing is
 * labelled). Text is drawn horizontally unless the node carries a rotation, so
 * the box comes from the same `labelPlacement` the canvas uses plus a
 * conservative one-line height.
 */
export function labelBoxes(
  project: Project,
  positions: Map<NodeId, Point>,
  visible: Set<NodeId>,
): Box | null {
  let box: Box | null = null;
  const add = (x0: number, x1: number, y0: number, y1: number) => {
    if (!box) {
      box = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
      return;
    }
    box.minX = Math.min(box.minX, x0);
    box.minY = Math.min(box.minY, y0);
    box.maxX = Math.max(box.maxX, x1);
    box.maxY = Math.max(box.maxY, y1);
  };
  for (const id of visible) {
    const node = project.nodes[id];
    const pos = positions.get(id);
    if (!node?.label || !pos) continue;
    const style = resolveNodeStyle(node, project);
    if (!style.showLabel) continue;
    const place = labelPlacement(
      project.layout.orientation,
      node.childrenIds.length === 0,
      style.size,
      style.labelPosition,
      style.labelOffsetX,
      style.labelOffsetY,
      labelAngleFor(project, positions, node),
    );
    // Italic / bold are wider than the average advance, hence the 1.05 factor.
    // Deliberately generous: too much margin costs whitespace, too little cuts a
    // taxon name off.
    const w = estimateLabelWidth(node.label, style.fontSize) * 1.05;
    const x = pos.x + place.dx;
    const y = pos.y + place.dy;
    let x0 = x;
    let x1 = x + w;
    if (place.anchor === 'end') {
      x0 = x - w;
      x1 = x;
    } else if (place.anchor === 'middle') {
      x0 = x - w / 2;
      x1 = x + w / 2;
    }
    const half = style.fontSize;
    let y0 = y - half;
    let y1 = y + half;
    if (style.labelRotation) {
      // A rotated label sweeps the larger of width / height in every direction.
      const r = Math.max(w, half) + Math.hypot(x - pos.x, y - pos.y);
      x0 = pos.x - r;
      x1 = pos.x + r;
      y0 = pos.y - r;
      y1 = pos.y + r;
    }
    add(x0, x1, y0, y1);
  }
  return box;
}

/**
 * Union of the node-coordinate box and the box the label TEXT occupies.
 *
 * `computeLayout().bounds` is a box of node dots. A taxon name runs well past
 * its own dot, so anything fitted to `bounds` alone crops the labels: `labelBoxes()`
 * grows the box with the text, and both the exporters and the on-screen fit go
 * through this function, so neither can show a different figure than the other.
 */
export function boundsWithLabels(
  project: Project,
  positions: Map<NodeId, Point>,
  visible: Set<NodeId>,
  bounds: Bounds,
): Bounds {
  const box = labelBoxes(project, positions, visible);
  if (!box) return bounds;
  return {
    minX: Math.min(bounds.minX, box.minX),
    minY: Math.min(bounds.minY, box.minY),
    maxX: Math.max(bounds.maxX, box.maxX),
    maxY: Math.max(bounds.maxY, box.maxY),
  };
}
