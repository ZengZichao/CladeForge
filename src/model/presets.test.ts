// Regression tests for the GUI report findings on style presets:
//   * BUG-10: 「默认」 must FULLY restore the default branch/gradient after a
//     restyling preset (PhyloRec 管道) — a partial write left curved tubes,
//     12 px width and a live gradient in place.
//   * A#8 / P-06: every preset states the complete set of fields it owns, so a
//     switch can never inherit `dash` or gradient residue from its predecessor.

import { describe, it, expect } from 'vitest';
import { STYLE_PRESETS, applyStylePreset } from './presets';
import { createEmptyProject } from './sampleTree';
import { DEFAULT_BRANCH_STYLE, DEFAULT_BRANCH_GRADIENT } from './types';

describe('style presets', () => {
  it('Default fully restores the default branch look after PhyloRec 管道 (BUG-10)', () => {
    const p = createEmptyProject('theme');
    const phylo = STYLE_PRESETS.find((x) => x.id === 'phylo')!;
    const def = STYLE_PRESETS.find((x) => x.id === 'default')!;

    applyStylePreset(p, phylo);
    expect(p.defaults.branch.shape).toBe('curved');
    expect(p.defaults.branch.width).toBe(12);
    expect(p.defaults.branchGradient.enabled).toBe(true);

    applyStylePreset(p, def);
    expect(p.defaults.branch.shape).toBe(DEFAULT_BRANCH_STYLE.shape);
    expect(p.defaults.branch.width).toBe(DEFAULT_BRANCH_STYLE.width);
    expect(p.defaults.branch.dash).toBe(DEFAULT_BRANCH_STYLE.dash);
    expect(p.defaults.branch.opacity).toBe(1);
    expect(p.defaults.branchGradient.enabled).toBe(DEFAULT_BRANCH_GRADIENT.enabled);
  });

  it('every preset declares shape/width/dash/opacity and an explicit gradient state', () => {
    for (const preset of STYLE_PRESETS) {
      expect(preset.branch?.shape, `${preset.id} shape`).toBeDefined();
      expect(preset.branch?.width, `${preset.id} width`).toBeDefined();
      expect(preset.branch?.dash, `${preset.id} dash`).toBeDefined();
      expect(preset.branch?.opacity, `${preset.id} opacity`).toBeDefined();
      expect(preset.gradient?.enabled, `${preset.id} gradient`).toBeDefined();
    }
  });
});
