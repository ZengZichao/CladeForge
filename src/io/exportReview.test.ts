// Regression tests for the figure-export review findings (S9/M13/M14 + deep trees).
import { describe, it, expect } from 'vitest';
import { parseNewick } from './newick';
import { buildSVG } from './exportImage';
import { computeLayout } from '../layout/autoLayout';
import { setBranchLength } from '../model/treeOps';

const tip = (p: ReturnType<typeof parseNewick>, label: string) =>
  Object.values(p.nodes).find((n) => n.label === label)!;

describe('review: scale bar (M14)', () => {
  it('is sized from the layout depthScale and labelled substitutions/site', () => {
    const p = parseNewick('(A:1,B:2)R;');
    p.layout.type = 'rectangular-phylogram';
    tip(p, 'A').branchLength = 1;
    tip(p, 'B').branchLength = 2;
    const layout = computeLayout(p, { showEras: false, eraLevel: 'both' });
    expect(layout.depthScale).toBeDefined();
    const { svg } = buildSVG(p, { includeScaleBar: true });
    // The bar claims substitution units, never the project's time unit.
    expect(svg).toMatch(/subst/);
    expect(svg).not.toMatch(/\d\s*Ma<\/text>/);
    // The bar's pixel length = nice value × depthScale (the canvas's own bar
    // uses the same product, so figure and screen measure identically).
    const bar = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="\2" stroke="#1d1d1f" stroke-width="2"\/>/.exec(svg);
    expect(bar).toBeTruthy();
    const length = Number(bar![3]) - Number(bar![1]);
    const label = /fill="#1d1d1f">([\d.]+) subst/.exec(svg);
    expect(label).toBeTruthy();
    expect(Math.abs(length - Number(label![1]) * (layout.depthScale as number))).toBeLessThan(1e-6);
  });

  it('a single pinned node does not change the bar', () => {
    const p = parseNewick('((A:1,B:1)X:1,C:2)R;');
    p.layout.type = 'rectangular-phylogram';
    for (const id of ['A', 'B', 'X', 'C']) tip(p, id).branchLength = id === 'C' ? 2 : 1;
    const before = buildSVG(p, { includeScaleBar: true }).svg.match(/>([\d.]+) subst/)![1];
    // Pin C far from where the layout would put it: a re-estimate from drawn
    // positions used to move the bar; depthScale must not.
    tip(p, 'C').position = { x: 900, y: 5 };
    tip(p, 'C').pinned = true;
    const after = buildSVG(p, { includeScaleBar: true }).svg.match(/>([\d.]+) subst/)![1];
    expect(after).toBe(before);
  });
});

describe('review: transition markers on elbow branches (M13)', () => {
  it('the marker sits on the polyline, at the child end of the horizontal run', () => {
    const p = parseNewick('(A:1,B:1)R;');
    p.layout.type = 'rectangular-phylogram';
    tip(p, 'A').branchLength = 1;
    tip(p, 'B').branchLength = 2;
    p.characters = [
      {
        id: 'c1',
        name: 'c',
        type: 'discrete',
        states: [
          { id: 's0', label: '0', color: '#000000' },
          { id: 's1', label: '1', color: '#ffffff' },
        ],
      },
    ];
    tip(p, 'A').charStates = { c1: 's0' };
    tip(p, 'B').charStates = { c1: 's1' };
    const layout = computeLayout(p, { showEras: false, eraLevel: 'both' });
    const aPos = layout.positions.get(tip(p, 'A').id)!;
    const bPos = layout.positions.get(tip(p, 'B').id)!;
    const { svg } = buildSVG(p, { showTransitions: true, activeCharacterId: 'c1' });
    // LR elbow: the horizontal run is at the CHILD's y, so the marker's cy is
    // the child's y — not the bounding-box midpoint.
    const marker = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="5\.5" fill="#ffffff"/.exec(svg);
    expect(marker).toBeTruthy();
    const expectedY = Math.min(aPos.y, bPos.y);
    expect(Number(marker![2])).toBeCloseTo(expectedY, 6);
  });
});

describe('review: deep-tree export safety', () => {
  it('a 6000-level unifurcate tree builds an SVG without a stack overflow', () => {
    let spec = '';
    for (let i = 0; i < 6000; i += 1) spec += '(';
    spec += 'A,B';
    for (let i = 0; i < 6000; i += 1) spec += ')';
    spec += 'R;';
    const p = parseNewick(spec);
    p.layout.type = 'rectangular-phylogram';
    setBranchLength(p, tip(p, 'A').id, 1);
    setBranchLength(p, tip(p, 'B').id, 1);
    expect(() => buildSVG(p, {})).not.toThrow();
  });
});
