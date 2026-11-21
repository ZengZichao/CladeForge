// Regression tests for style presets:
//   * BUG-10: 「默认」 must FULLY restore the default branch/gradient after a
//     restyling preset — a partial write left curved tubes, 12 px width and a
//     live gradient in place. The tube preset itself was removed from the UI
//     (curves are now chosen in 分支样式 › 分支形状), so this test applies an
//     equivalent synthetic preset to keep the restore contract covered.
//   * A#8 / P-06: every preset states the complete set of fields it owns, so a
//     switch can never inherit `dash` or gradient residue from its predecessor.

import { describe, it, expect } from 'vitest';
import { STYLE_PRESETS, applyStylePreset, type StylePreset } from './presets';
import { createEmptyProject } from './sampleTree';
import { DEFAULT_BRANCH_STYLE, DEFAULT_BRANCH_GRADIENT } from './types';

describe('style presets', () => {
  it('Default fully restores the default branch look after a tube preset (BUG-10)', () => {
    const p = createEmptyProject('theme');
    const tube: StylePreset = {
      id: 'tube',
      label: 'Tube',
      labelEn: 'Tube',
      background: '#f9f9fb',
      nodeFill: '#fcfcfd',
      nodeStroke: '#1c2024',
      labelColor: '#1c2024',
      branchColor: '#d9d9e0',
      branch: { shape: 'curved', width: 12, opacity: 1, dash: 'solid' },
      gradient: { enabled: true, from: '#f0f0f3', to: '#d9d9e0' },
    };
    const def = STYLE_PRESETS.find((x) => x.id === 'default')!;

    applyStylePreset(p, tube);
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
