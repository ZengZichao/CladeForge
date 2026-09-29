import { describe, it, expect } from 'vitest';
import { createSampleProject, createEmptyProject } from '../model/sampleTree';
import { addChildren, toggleCollapse } from '../model/treeOps';
import { computeLayout } from './autoLayout';

describe('computeLayout', () => {
  it('assigns a position to every visible node', () => {
    const p = createSampleProject();
    const { positions, visible } = computeLayout(p);
    expect(visible.size).toBe(Object.keys(p.nodes).length);
    for (const id of visible) expect(positions.has(id)).toBe(true);
  });

  it('hides descendants of a collapsed node', () => {
    const p = createSampleProject();
    const child = p.nodes[p.rootId].childrenIds[0];
    const grandchild = p.nodes[child].childrenIds[0];
    toggleCollapse(p, child);
    const { visible } = computeLayout(p);
    expect(visible.has(child)).toBe(true);
    expect(visible.has(grandchild)).toBe(false);
  });

  it('lets a manual position override the computed one', () => {
    const p = createSampleProject();
    p.nodes[p.rootId].position = { x: 999, y: 777 };
    p.nodes[p.rootId].pinned = true;
    const { positions } = computeLayout(p);
    expect(positions.get(p.rootId)).toEqual({ x: 999, y: 777 });
  });

  it('produces distinct leaf positions in a cladogram', () => {
    const p = createEmptyProject();
    const kids = addChildren(p, p.rootId, 3);
    const { positions } = computeLayout(p);
    const ys = kids.map((id) => positions.get(id)?.y);
    expect(new Set(ys).size).toBe(3);
  });

  it('never shares a row between a shallow leaf and a deeper cousin (no "box" for multifurcations)', () => {
    // In a trifurcation whose MIDDLE child is itself a clade, d3.tree() would
    // place the two sibling leaves on the same rows as the middle clade's outer
    // leaves, rendering a rectangle. The dendrogram layout
    // gives every leaf a unique row, so the clade nests between its siblings.
    const p = createEmptyProject();
    const [c1, c2, c3] = addChildren(p, p.rootId, 3);
    const [g1, g2, g3] = addChildren(p, c2, 3);
    const { positions } = computeLayout(p);

    // Every leaf sits on its own distinct row (LR layout -> y is the row).
    const leafYs = [c1, g1, g2, g3, c3].map((id) => positions.get(id)!.y);
    expect(new Set(leafYs).size).toBe(5);

    // The middle child's clade is nested strictly between the sibling leaves.
    const yc1 = positions.get(c1)!.y;
    const yc3 = positions.get(c3)!.y;
    const lo = Math.min(yc1, yc3);
    const hi = Math.max(yc1, yc3);
    for (const g of [g1, g2, g3]) {
      const y = positions.get(g)!.y;
      expect(y).toBeGreaterThan(lo);
      expect(y).toBeLessThan(hi);
    }
  });

  it('handles a single-node tree without throwing', () => {
    const p = createEmptyProject();
    const { positions, visible } = computeLayout(p);
    expect(visible.size).toBe(1);
    expect(positions.get(p.rootId)).toBeDefined();
  });

  it('time-calibrated layout places older nodes toward the root and builds a time axis', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.layout.type = 'time-calibrated';
    p.nodes[p.rootId].age = 10; // oldest
    p.nodes[a].age = 0;
    p.nodes[b].age = 0; // tips at present
    const { positions, timeAxis } = computeLayout(p);
    expect(timeAxis).toBeDefined();
    // LR: the older root sits left (smaller x) of the present-day tips.
    expect(positions.get(p.rootId)!.x).toBeLessThan(positions.get(a)!.x);
  });

  it('reserves room for the axis label stack in the bounds (LR and TB)', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.layout.type = 'time-calibrated';
    p.nodes[p.rootId].age = 10;
    p.nodes[a].age = 0;
    p.nodes[b].age = 0;

    for (const orientation of ['LR', 'TB'] as const) {
      p.layout.orientation = orientation;
      // Tick numerals render whether or not eras are shown, so the baseline
      // reservation (no overlay opts / eras off) already includes their row.
      const ticksOnly = computeLayout(p);
      const withEras = computeLayout(p, { showEras: true, eraLevel: 'both' });
      // The overlay expands the bounds; the axis geometry itself is unchanged
      // (no feedback loop through the expanded bounds).
      expect(ticksOnly.timeAxis).toBeDefined();
      expect(withEras.timeAxis!.ticks).toEqual(ticksOnly.timeAxis!.ticks);
      expect(withEras.timeAxis!.periods).toEqual(ticksOnly.timeAxis!.periods);
      // Expanded bounds still contain the tree and grow strictly on the label
      // side only (minY for LR, minX for TB); the tick side is unchanged.
      const base = ticksOnly.bounds;
      const grown = withEras.bounds;
      expect(grown.minX).toBeLessThanOrEqual(base.minX);
      expect(grown.minY).toBeLessThanOrEqual(base.minY);
      expect(grown.maxX).toBeGreaterThanOrEqual(base.maxX);
      expect(grown.maxY).toBeGreaterThanOrEqual(base.maxY);
      if (orientation === 'LR') {
        // Label rows stack above (minY); tick numerals below (maxY).
        expect(base.minY - grown.minY).toBeGreaterThan(0);
        expect(grown.maxY - base.maxY).toBeLessThan(1e-9);
        expect(grown.maxX - base.maxX).toBeLessThan(1e-9);
      } else {
        // Label rows stack left (minX); tick numerals right (maxX) are
        // reserved in both calls, so only minX grows.
        expect(base.minX - grown.minX).toBeGreaterThan(0);
        expect(grown.minY - base.minY).toBeLessThan(1e-9);
        expect(grown.maxX - base.maxX).toBeLessThan(1e-9);
        expect(grown.maxY - base.maxY).toBeLessThan(1e-9);
      }
    }
  });
});

describe('computeLayout never invents branch lengths or ages', () => {
  it('a missing branch length is reported as unknown, not priced as 1', () => {
    const p = createEmptyProject();
    const [m, u] = addChildren(p, p.rootId, 2);
    p.nodes[m].branchLength = 4;
    const [u1] = addChildren(p, u, 1);
    p.nodes[u1].branchLength = 1;
    p.layout.type = 'rectangular-phylogram';
    const { positions, unknownDepth, issues, depthScale } = computeLayout(p);
    expect(depthScale).toBeGreaterThan(0);
    // u has no length → it and everything below it are unknown (the length is
    // never guessed at 1 the way `branchLength ?? 1` would).
    expect([...(unknownDepth ?? [])].sort()).toEqual([u, u1].sort());
    expect(issues?.some((i) => i.kind === 'phylogram-partial-lengths' && i.count === 2)).toBe(true);
    // An unknown node is parked on the topological grid, NOT beyond its parent:
    // it must not read as a measured 4-unit branch plus an invented 1.
    const rootX = positions.get(p.rootId)!.x;
    expect(positions.get(u)!.x).toBeGreaterThan(rootX);
    expect(positions.get(u)!.x).toBeLessThan(positions.get(m)!.x);
  });

  it('a phylogram with no usable lengths says it degraded to a cladogram', () => {
    const p = createEmptyProject();
    addChildren(p, p.rootId, 3);
    p.layout.type = 'rectangular-phylogram';
    const { depthScale, unknownDepth, issues } = computeLayout(p);
    expect(depthScale).toBeUndefined(); // the scale bar would be meaningless
    expect(unknownDepth!.size).toBe(3);
    const issue = issues!.find((i) => i.kind === 'phylogram-no-lengths');
    expect(issue).toBeDefined();
    expect(issue!.count).toBe(3);
  });

  it('zero-length branches only (a valid contemporaneous split) are still reported', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[a].branchLength = 0;
    p.nodes[b].branchLength = 0;
    p.layout.type = 'rectangular-phylogram';
    const { issues, depthScale } = computeLayout(p);
    expect(depthScale).toBeUndefined();
    expect(issues!.some((i) => i.kind === 'phylogram-no-lengths')).toBe(true);
  });

  it('an undated node is not pinned to the present-day line', () => {
    const p = createEmptyProject();
    const [old1, old2] = addChildren(p, p.rootId, 2);
    p.nodes[p.rootId].age = 100;
    p.nodes[old1].age = 50;
    const [tip] = addChildren(p, old2, 1);
    p.nodes[tip].age = 0;
    p.layout.type = 'time-calibrated';
    const { positions, unknownAge, issues, timeAxis } = computeLayout(p);
    expect(timeAxis).toBeDefined();
    expect([...(unknownAge ?? [])]).toEqual([old2]);
    expect(issues!.some((i) => i.kind === 'time-partial-ages')).toBe(true);
    // The undated internal node sits strictly between the root and the present
    // line: a missing age read as `0` would draw it exactly on top of the tips.
    const xRoot = positions.get(p.rootId)!.x;
    const xTip = positions.get(tip)!.x;
    const xUnknown = positions.get(old2)!.x;
    expect(xUnknown).toBeGreaterThan(xRoot);
    expect(xUnknown).toBeLessThan(xTip);
  });

  it('a tree whose only ages are 0 has no time axis at all', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[p.rootId].age = 0;
    p.nodes[a].age = 0;
    p.nodes[b].age = 0;
    p.layout.type = 'time-calibrated';
    const { timeAxis, issues } = computeLayout(p);
    expect(timeAxis).toBeUndefined();
    // …and the degradation is reported instead of being drawn as a chronogram.
    expect(issues!.some((i) => i.kind === 'time-no-ages' && i.count === 3)).toBe(true);
  });

  it('the circular layout says it does not consume the tree’s ages', () => {
    const p = createSampleProject();
    p.layout.type = 'circular';
    const { issues } = computeLayout(p);
    expect(issues!.some((i) => i.kind === 'circular-ignores-ages')).toBe(true);
    // A cladogram with no ages gets no such warning.
    const q = createEmptyProject();
    addChildren(q, q.rootId, 2);
    q.layout.type = 'circular';
    expect(computeLayout(q).issues!.some((i) => i.kind === 'circular-ignores-ages')).toBe(false);
  });

  it('a fully measured phylogram keeps its previous, data-driven depths', () => {
    const p = createSampleProject();
    p.layout.type = 'rectangular-phylogram';
    const { positions, unknownDepth, issues, depthScale } = computeLayout(p);
    expect(unknownDepth!.size).toBe(0);
    expect(issues).toEqual([]);
    expect(depthScale).toBeGreaterThan(0);
    // Every child sits deeper than its parent by exactly its own branch length.
    const root = p.nodes[p.rootId];
    for (const cid of root.childrenIds) {
      const child = p.nodes[cid];
      const dx = positions.get(cid)!.x - positions.get(root.id)!.x;
      expect(dx).toBeCloseTo((child.branchLength ?? 0) * depthScale!, 6);
    }
  });
});
