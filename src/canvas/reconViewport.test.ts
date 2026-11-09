// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Viewport culling for the reconciliation panes: a fitted tree must show
// everything (all nodes on screen), while a zoomed/panned view must stop
// mounting the off-screen majority. A zero-sized box (not measured yet) keeps
// the old render-everything behaviour so the first paint is never blank.

import { describe, expect, it } from 'vitest';
import { computeLayout } from '../layout/autoLayout';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren, setBranchLength } from '../model/treeOps';
import { cullPaneNodes, paneWorldViewport } from './reconViewport';

/** A binary tree with `depth` levels (2^depth tips). */
function buildTree(depth: number, labelPrefix: string) {
  const p = createEmptyProject('cull');
  const grow = (parent: string, level: number): void => {
    if (level === 0) return;
    const [a, b] = addChildren(p, parent, 2);
    setBranchLength(p, a, 1);
    setBranchLength(p, b, 1);
    grow(a, level - 1);
    grow(b, level - 1);
  };
  grow(p.rootId, depth);
  let i = 0;
  for (const n of Object.values(p.nodes)) {
    if (n.childrenIds.length === 0) n.label = `${labelPrefix}${i++}`;
  }
  return p;
}

describe('paneWorldViewport', () => {
  it('maps the pane box back through the transform, with a configurable buffer', () => {
    const v = paneWorldViewport({ tx: 100, ty: 50, scale: 2 }, 400, 200, 0);
    expect(v).toEqual({ minX: -50, maxX: 150, minY: -25, maxY: 75 });
    const buffered = paneWorldViewport({ tx: 100, ty: 50, scale: 2 }, 400, 200, 1);
    // One box-width / height on every side.
    expect(buffered.minX).toBe(-250);
    expect(buffered.maxX).toBe(350);
    expect(buffered.minY).toBe(-125);
    expect(buffered.maxY).toBe(175);
  });

  it('an unmeasured box is unbounded (render everything)', () => {
    const v = paneWorldViewport({ tx: 10, ty: 10, scale: 1 }, 0, 0);
    expect(v.minX).toBe(-Infinity);
    expect(v.maxY).toBe(Infinity);
  });
});

describe('cullPaneNodes', () => {
  const doc = buildTree(5, 'T'); // 63 nodes
  const layout = computeLayout(doc);
  const all = [...layout.visible];

  it('returns every visible node before the box is measured', () => {
    expect(cullPaneNodes(layout, { tx: 0, ty: 0, scale: 1 }, 0, 0)).toEqual(all);
  });

  it('returns every visible node when the whole tree fits in the pane (plus buffer)', () => {
    // A large box centred on the layout with a generous buffer must not drop
    // nodes: a fitted view is the common case and must stay complete.
    const b = layout.bounds;
    const w = (b.maxX - b.minX) * 2;
    const h = (b.maxY - b.minY) * 2;
    const t = { scale: 1, tx: -b.minX * 1 + w / 4, ty: -b.minY + h / 4 };
    expect(cullPaneNodes(layout, t, w, h).length).toBe(all.length);
  });

  it('drops off-screen nodes when zoomed in, and keeps the buffered edge band', () => {
    const b = layout.bounds;
    const scale = 8;
    // Anchor the viewport on the first node: only its neighbourhood survives.
    const p = layout.positions.get(all[0])!;
    const t = { scale, tx: -p.x * scale, ty: -p.y * scale };
    const culled = cullPaneNodes(layout, t, 100, 100, 0);
    expect(culled).toContain(all[0]);
    expect(culled.length).toBeLessThan(all.length);
    for (const id of culled) {
      const q = layout.positions.get(id)!;
      expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(100 / scale);
      expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(100 / scale);
    }
    // One screen of buffer admits at least as many nodes as no buffer.
    const buffered = cullPaneNodes(layout, t, 100, 100, 1);
    expect(buffered.length).toBeGreaterThanOrEqual(culled.length);
  });
});
