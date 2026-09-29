import { describe, it, expect } from 'vitest';
import { boundsWithLabels, labelBoxes } from './labelBounds';
import { fitView, worldToScreen } from './coords';
import { computeLayout } from '../layout/autoLayout';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import type { Project } from '../model/types';

/**
 * The exporters size their viewBox by the label text, so the on-screen "fit" has
 * to use the same box rather than the box of node DOTS: otherwise every fit
 * crops the right-hand taxon names and the canvas disagrees with the exported
 * figure.
 */
describe('fit-to-view contains the label text, not just the node dots', () => {
  // The Tauri window is 1280x820; the canvas column is what is left after the
  // rails and the two panels.
  const VIEWPORT = { w: 618, h: 693 };

  for (const descriptor of SAMPLE_PROJECTS) {
    it(`${descriptor.id}: every label fits inside the viewport after fitView`, () => {
      const project: Project = descriptor.build();
      const layout = computeLayout(project);
      const box = boundsWithLabels(project, layout.positions, layout.visible, layout.bounds);
      const view = fitView(box, VIEWPORT.w, VIEWPORT.h);

      const labels = labelBoxes(project, layout.positions, layout.visible);
      expect(labels, 'the sample has labelled nodes').not.toBeNull();

      const corners = [
        { x: labels!.minX, y: labels!.minY },
        { x: labels!.maxX, y: labels!.minY },
        { x: labels!.minX, y: labels!.maxY },
        { x: labels!.maxX, y: labels!.maxY },
      ].map((p) => worldToScreen(p, view));

      for (const c of corners) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(VIEWPORT.w);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThanOrEqual(VIEWPORT.h);
      }
    });
  }

  it('the node-only box really is too small — the guard is not vacuous', () => {
    const project = SAMPLE_PROJECTS[0].build();
    const layout = computeLayout(project);
    const labels = labelBoxes(project, layout.positions, layout.visible)!;
    // If bounds already covered the labels, the test above would prove nothing.
    expect(labels.maxX).toBeGreaterThan(layout.bounds.maxX);
  });
});

/**
 * A degenerate (empty / single-node) document fitted to `Math.max(1,…)` would
 * pin the scale at MAX_SCALE — "zoom 800%" over nothing — so `fitView` holds it
 * at 1:1.
 */
describe('fitView on a degenerate document holds at 1:1', () => {
  const ZERO = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  it('returns scale 1 rather than MAX_SCALE', () => {
    expect(fitView(ZERO, 900, 600).scale).toBe(1);
  });

  it('still centres the point in the viewport', () => {
    const v = fitView(ZERO, 900, 600);
    const p = worldToScreen({ x: 0, y: 0 }, v);
    expect(p.x).toBe(450);
    expect(p.y).toBe(300);
  });

  it('does not change the answer for a real box', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 400, maxY: 200 }, 800, 600, 0);
    expect(v.scale).toBeCloseTo(2, 10);
  });
});
