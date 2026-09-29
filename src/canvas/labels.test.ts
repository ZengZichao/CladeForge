// In the circular layout the four cardinal rectangular branches cannot express
// "away from the parent", so labels are placed along the node's radial angle.
// The plain LR case would put every label right of the node, anchored at its
// start, which on the left half of a polar tree drives the text straight into
// the centre, over the branches and over each other. The angle rule is what
// keeps the contract of `labels.ts` — "the label is always placed on the far
// side of the node — the side away from the parent". These tests pin that rule.

import { describe, it, expect } from 'vitest';
import { labelAngleOf, labelPlacement, radialPlacement } from './labels';

const GAP = 6;
const size = 8;

describe('radialPlacement — away from the parent, by angle', () => {
  it('pushes the label outward at every angle, with a constant standoff', () => {
    for (let deg = -180; deg < 180; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const p = radialPlacement(a, size);
      const dist = Math.hypot(p.dx, p.dy);
      expect(dist).toBeCloseTo(size + GAP, 8);
      // The offset points the same way as the parent → node ray: dot > 0, and in
      // fact the offset IS that ray scaled — never the opposite direction.
      const dot = p.dx * Math.cos(a) + p.dy * Math.sin(a);
      expect(dot).toBeGreaterThan(0);
      expect(p.dx).toBeCloseTo(Math.cos(a) * (size + GAP), 8);
      expect(p.dy).toBeCloseTo(Math.sin(a) * (size + GAP), 8);
    }
  });

  it('a node to the RIGHT of its parent stays outward, start-anchored', () => {
    const p = radialPlacement(0, size);
    expect(p.dx).toBeGreaterThan(0);
    expect(p.dy).toBeCloseTo(0, 8);
    expect(p.anchor).toBe('start');
  });

  it('a node to the LEFT of its parent is anchored at its END, not into the tree', () => {
    const p = radialPlacement(Math.PI, size);
    expect(p.dx).toBeLessThan(0); // the LR case would give +14 here
    expect(p.anchor).toBe('end'); // so the text runs outward, not over the circle
    expect(p.dy).toBeCloseTo(0, 8);
  });

  it('top and bottom labels are centred above / below the node', () => {
    const up = radialPlacement(-Math.PI / 2, size);
    expect(up.dx).toBeCloseTo(0, 8);
    expect(up.dy).toBeLessThan(0);
    expect(up.anchor).toBe('middle');
    const down = radialPlacement(Math.PI / 2, size);
    expect(down.dx).toBeCloseTo(0, 8);
    expect(down.dy).toBeGreaterThan(0);
    expect(down.anchor).toBe('middle');
  });

  it('the anchor flips at the hemispheres and not before', () => {
    expect(radialPlacement(-1.4, size).anchor).toBe('middle'); // ~80°, mostly vertical
    expect(radialPlacement(-1.2, size).anchor).toBe('start'); // ~69° still right-leaning
    expect(radialPlacement(Math.PI - 0.1, size).anchor).toBe('end');
    expect(radialPlacement(-(Math.PI - 0.1), size).anchor).toBe('end');
  });
});

describe('labelAngleOf — the parent → node ray', () => {
  it('is undefined without a usable parent', () => {
    expect(labelAngleOf(undefined, { x: 3, y: 4 })).toBeUndefined();
    expect(labelAngleOf({ x: 3, y: 4 }, { x: 3, y: 4 })).toBeUndefined(); // coincident
    expect(labelAngleOf({ x: Number.NaN, y: 0 }, { x: 1, y: 1 })).toBeUndefined();
  });

  it('follows the direction the branch travels', () => {
    expect(labelAngleOf({ x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(0, 8);
    expect(labelAngleOf({ x: 0, y: 0 }, { x: -2, y: 0 })).toBeCloseTo(Math.PI, 8);
    expect(labelAngleOf({ x: 0, y: 0 }, { x: 0, y: -2 })).toBeCloseTo(-Math.PI / 2, 8);
    expect(labelAngleOf({ x: 1, y: 1 }, { x: -1, y: -1 })).toBeCloseTo((-3 * Math.PI) / 4, 8);
  });
});

describe('labelPlacement — angle wins over the orientation branch', () => {
  it('falls back to the rectangular sides when no angle is given', () => {
    expect(labelPlacement('LR', false, size)).toEqual({
      dx: size + GAP, dy: 0, anchor: 'start', baseline: 'central',
    });
    expect(labelPlacement('RL', false, size)).toEqual({
      dx: -(size + GAP), dy: 0, anchor: 'end', baseline: 'central',
    });
    expect(labelPlacement('TB', false, size).dy).toBe(size + GAP);
    expect(labelPlacement('BT', false, size).dy).toBe(-(size + GAP));
    expect(labelPlacement('TB', true, size).anchor).toBe('middle');
  });

  it('uses the radial side when the caller passes the circular angle', () => {
    const p = labelPlacement('LR', false, size, undefined, undefined, undefined, Math.PI);
    expect(p.dx).toBeLessThan(0);
    expect(p.anchor).toBe('end');
    expect(p).toEqual(radialPlacement(Math.PI, size));
  });

  it('an explicit labelPosition still overrides the radial rule', () => {
    const p = labelPlacement('LR', false, size, 'top', undefined, undefined, Math.PI);
    expect(p.dx).toBeCloseTo(0, 8);
    expect(p.dy).toBe(-(size + GAP));
    expect(p.anchor).toBe('middle');
  });

  it('manual offsets are added on top of the radial placement', () => {
    const plain = labelPlacement('LR', false, size, undefined, undefined, undefined, 0);
    const offset = labelPlacement('LR', false, size, undefined, 3, -4, 0);
    expect(offset.dx - plain.dx).toBeCloseTo(3, 8);
    expect(offset.dy - plain.dy).toBeCloseTo(-4, 8);
  });

  it('a non-finite angle degrades to the orientation default instead of NaN', () => {
    const p = labelPlacement('RL', false, size, undefined, undefined, undefined, Number.NaN);
    expect(p.anchor).toBe('end');
    expect(Number.isFinite(p.dx)).toBe(true);
  });
});
