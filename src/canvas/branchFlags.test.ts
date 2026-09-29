// `computeLayout` reports which branches it could not measure. These tests pin
// the read-only rule the canvas applies to that report: an unmeasured tree must
// not be drawn like a measured one, and the scale bar must appear only against
// a real scale — never silently disappear without the notice that explains it.

import { describe, it, expect } from 'vitest';
import { createEmptyProject, createSampleProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { computeLayout } from '../layout/autoLayout';
import {
  hasScaleBar,
  isUnmeasured,
  unmeasuredMark,
  UNMEASURED_DASH,
  UNMEASURED_MIN_WIDTH,
  unmeasuredNodeIds,
} from './branchFlags';
import { C_UNKNOWN } from './colors';

describe('unmeasuredNodeIds', () => {
  it('unions the length-unknown and age-unknown sets', () => {
    const ids = unmeasuredNodeIds(new Set(['a', 'b']), new Set(['b', 'c']));
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('tolerates the layouts that only fill one of them', () => {
    // rectangular-phylogram fills unknownDepth; time-calibrated fills unknownAge;
    // the circular / cladogram layouts fill neither.
    expect([...unmeasuredNodeIds(new Set(['a']))]).toEqual(['a']);
    expect([...unmeasuredNodeIds(undefined, new Set(['b']))]).toEqual(['b']);
    expect(unmeasuredNodeIds(undefined, undefined).size).toBe(0);
    expect(unmeasuredNodeIds(new Set(), new Set()).size).toBe(0);
  });

  it('does not mutate the layout\'s own sets', () => {
    const depth = new Set(['a']);
    const out = unmeasuredNodeIds(depth, new Set(['b']));
    expect(depth.size).toBe(1);
    expect(out.has('b')).toBe(true);
  });

  it('isUnmeasured answers per branch', () => {
    const ids = unmeasuredNodeIds(new Set(['a']), undefined);
    expect(isUnmeasured(ids, 'a')).toBe(true);
    expect(isUnmeasured(ids, 'z')).toBe(false);
  });
});

describe('unmeasuredMark', () => {
  it('draws grey dashed, the legend\'s promise, and keeps at least the branch weight', () => {
    expect(unmeasuredMark(3)).toEqual({ color: C_UNKNOWN, width: 3, dash: UNMEASURED_DASH });
    expect(unmeasuredMark(0)).toEqual({ color: C_UNKNOWN, width: UNMEASURED_MIN_WIDTH, dash: UNMEASURED_DASH });
    expect(unmeasuredMark(-4).width).toBe(UNMEASURED_MIN_WIDTH);
  });

  it('survives a non-finite branch width instead of emitting NaN into the DOM', () => {
    const mark = unmeasuredMark(Number.NaN);
    expect(Number.isFinite(mark.width)).toBe(true);
    expect(mark.width).toBe(UNMEASURED_MIN_WIDTH);
  });

  it('the dash is a real SVG pattern with two positive numbers', () => {
    const parts = UNMEASURED_DASH.trim().split(/\s+/).map(Number);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p).toBeGreaterThan(0);
  });
});

describe('hasScaleBar', () => {
  it('is true only for a usable positive scale', () => {
    expect(hasScaleBar(2.5)).toBe(true);
    // `computeLayout` clears depthScale exactly when nothing was measurable.
    expect(hasScaleBar(undefined)).toBe(false);
    expect(hasScaleBar(0)).toBe(false);
    expect(hasScaleBar(-1)).toBe(false);
    expect(hasScaleBar(Number.NaN)).toBe(false);
    expect(hasScaleBar(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// --- the wiring itself: layout output -> renderer decisions ------------------
//
// `TreeCanvas` is a `.tsx` and outside the test net, so these compose the real
// `computeLayout` with the flags the canvas reads. They fail if the layout stops
// reporting, if the canvas stops unioning the two sets, or if the scale-bar
// predicate stops agreeing with `depthScale`.

describe('branchFlags composed with computeLayout', () => {
  it('marks the branches a phylogram could not measure, and hides the scale bar', () => {
    const p = createEmptyProject();
    const [m, u] = addChildren(p, p.rootId, 2);
    p.nodes[m].branchLength = 4;
    const [u1] = addChildren(p, u, 1);
    p.nodes[u1].branchLength = 1;
    p.layout.type = 'rectangular-phylogram';

    const layout = computeLayout(p);
    const ids = unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge);
    // The branch entering `u`, and everything below it — not the measured `m`.
    expect([...ids].sort()).toEqual([u, u1].sort());
    expect(isUnmeasured(ids, m)).toBe(false);
    expect(layout.issues?.some((i) => i.kind === 'phylogram-partial-lengths')).toBe(true);
    // Partial data still has a meaningful scale bar.
    expect(hasScaleBar(layout.depthScale)).toBe(true);
  });

  it('a document with no lengths at all flags every branch and drops the bar', () => {
    const p = createEmptyProject();
    addChildren(p, p.rootId, 3);
    p.layout.type = 'rectangular-phylogram';
    const layout = computeLayout(p);
    const ids = unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge);
    expect(ids.size).toBe(3);
    expect(hasScaleBar(layout.depthScale)).toBe(false);
    // …and the notice that replaces the bar explains the bar is gone.
    const issue = layout.issues?.find((i) => i.kind === 'phylogram-no-lengths');
    expect(issue?.message).toMatch(/比例尺不显示|scale bar is hidden/);
  });

  it('the time-calibrated layout contributes unknownAge to the same set', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[a].age = 100;
    p.nodes[b].age = 50;
    p.layout.type = 'time-calibrated';
    const layout = computeLayout(p);
    const ids = unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge);
    // The undated tip(s) are the marked ones; nothing here is a length problem.
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(layout.visible.has(id)).toBe(true);
    expect(layout.issues?.some((i) => i.kind === 'time-partial-ages')).toBe(true);
  });

  it('the shipped sample project has no unmeasured branches', () => {
    // Guards against the marking lighting up on healthy data, which would make
    // the grey dashes meaningless.
    const p = createSampleProject();
    for (const type of ['rectangular-phylogram', 'time-calibrated', 'circular'] as const) {
      p.layout.type = type;
      const layout = computeLayout(p);
      expect(unmeasuredNodeIds(layout.unknownDepth, layout.unknownAge).size, type).toBe(0);
    }
  });
});
