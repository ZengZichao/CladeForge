import { describe, it, expect } from 'vitest';
import { boundsWithLabels, labelBoxes, labelBoxForNode } from './labelBounds';
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

  it('includes the hypothesis-note line in the box (fit and export cropping)', () => {
    const project = SAMPLE_PROJECTS[0].build();
    const layout = computeLayout(project);
    const internal = Object.values(project.nodes).find((n) => n.childrenIds.length > 0)!;
    const before = labelBoxForNode(project, layout.positions, internal)!;
    internal.hypothesisNote = 'A long hypothesis statement that must not be cropped away from the figure.';
    const after = labelBoxForNode(project, layout.positions, internal)!;
    expect(after.maxY).toBeGreaterThan(before.maxY);
    expect(after.maxX).toBeGreaterThan(before.maxX);
  });

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

/**
 * D-P9 / G-P7: fit-to-window on a tiny new tree stretched a handful of nodes
 * across the window (~600%), because the only upper clamp was MAX_SCALE. The
 * optional ceiling lets the store's zoom limit bound the fit.
 */
describe('fitView honours an optional max-scale ceiling', () => {
  const ZERO = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // Two nodes one unit apart: the unconstrained fit wants ~400x.
  const TINY = { minX: 0, minY: 0, maxX: 2, maxY: 1 };

  it('clamps to the given ceiling instead of MAX_SCALE', () => {
    expect(fitView(TINY, 800, 600, 0).scale).toBe(8);
    expect(fitView(TINY, 800, 600, 0, 1.5).scale).toBe(1.5);
  });

  it('leaves a box that already fits under the ceiling untouched', () => {
    const box = { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    expect(fitView(box, 800, 600, 0, 8).scale).toBeCloseTo(2, 10);
    expect(fitView(box, 800, 600, 0, 1.5).scale).toBe(1.5);
  });

  it('falls back to MAX_SCALE when the ceiling is omitted or undefined', () => {
    expect(fitView(TINY, 800, 600, 0).scale).toBe(8);
    expect(fitView(TINY, 800, 600, 0, undefined).scale).toBe(8);
  });

  it('does not affect the degenerate-box 1:1 behaviour', () => {
    expect(fitView(ZERO, 900, 600, undefined, 2).scale).toBe(1);
  });
});
