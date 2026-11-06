// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The view transform currently painted on the canvas.
//
// Wheel bursts update this value per animation frame WITHOUT touching the
// React store, so the tree does not re-render per wheel event. The store keeps
// the last COMMITTED view (for undo history, fit, keyboard zoom and the
// low-frequency overlays); pointer gestures read this live value so a drag
// started mid-burst starts from what the user actually sees.

import type { ViewTransform } from '../model/types';

let live: ViewTransform | null = null;

export function setLiveView(view: ViewTransform): void {
  live = view;
}

export function getLiveView(fallback: ViewTransform): ViewTransform {
  return live ?? fallback;
}

export function resetLiveView(): void {
  live = null;
}

/** SVG transform attribute for a view (pan then zoom, world -> screen). */
export function viewTransformAttr(view: ViewTransform): string {
  return `translate(${view.tx} ${view.ty}) scale(${view.scale})`;
}
