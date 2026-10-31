// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { branchCaps } from '../model/types';
import {
  branchMidpoint,
  branchMidpointOn,
  branchPath,
  curvedBranchPath,
  elbowPath,
} from './paths';

describe('curved branch geometry (PhyloRecViewer tube style)', () => {
  it('bends at the depth-axis midpoint for LR/RL branches', () => {
    expect(curvedBranchPath({ x: 0, y: 10 }, { x: 100, y: 60 }, 'LR')).toBe(
      'M 0 10 C 50 10 50 60 100 60',
    );
    expect(curvedBranchPath({ x: 100, y: 10 }, { x: 0, y: 60 }, 'RL')).toBe(
      'M 100 10 C 50 10 50 60 0 60',
    );
  });

  it('bends at the depth-axis midpoint for TB/BT branches', () => {
    expect(curvedBranchPath({ x: 10, y: 0 }, { x: 60, y: 100 }, 'TB')).toBe(
      'M 10 0 C 10 50 60 50 60 100',
    );
    expect(curvedBranchPath({ x: 10, y: 100 }, { x: 60, y: 0 }, 'BT')).toBe(
      'M 10 100 C 10 50 60 50 60 0',
    );
  });

  it('keeps non-curved rectangular branches on the elbow', () => {
    const from = { x: 0, y: 10 };
    const to = { x: 100, y: 60 };
    expect(branchPath(from, to, 'LR', 'rectangular-cladogram', 'line')).toBe(
      elbowPath(from, to, 'LR'),
    );
    expect(branchPath(from, to, 'LR', 'rectangular-phylogram', 'rounded')).toBe(
      elbowPath(from, to, 'LR'),
    );
  });

  it('keeps circular branches as arcs whatever the branch shape says', () => {
    const d = branchPath({ x: 100, y: 0 }, { x: 0, y: 100 }, 'LR', 'circular', 'curved');
    expect(d).toContain('A 100 100');
  });

  it('puts the curved midpoint on the curve, not on the elbow corner', () => {
    const from = { x: 0, y: 10 };
    const to = { x: 100, y: 60 };
    expect(branchMidpoint(from, to, 'LR', true)).toEqual({ x: 50, y: 35 });
    expect(branchMidpoint(from, to, 'LR', false)).toEqual({ x: 50, y: 60 });
    expect(branchMidpointOn(from, to, 'LR', 'rectangular-cladogram', true)).toEqual({
      x: 50,
      y: 35,
    });
  });

  it('uses round caps for curved branches', () => {
    expect(branchCaps('curved')).toEqual({ linecap: 'round', linejoin: 'round' });
  });
});
