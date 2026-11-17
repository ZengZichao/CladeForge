// GUI-report regressions for global find & replace:
//   * A#7 / BUG-14: a replacement may not leave a node nameless (that is how
//     the canvas label silently disappeared).
//   * A#6: node names are never truncated by the text pipeline.

import { describe, it, expect } from 'vitest';
import { collectReplacements, applyReplacements } from './replace';
import { createEmptyProject } from './sampleTree';
import { addChildren, renameNode } from './treeOps';

function projectWithNames(names: string[]) {
  const p = createEmptyProject('find');
  for (const name of names) {
    const [id] = addChildren(p, p.rootId, 1);
    renameNode(p, id, name);
  }
  return p;
}

describe('find & replace — node-name guards', () => {
  it('shows a blanking node-name replacement as blocked in the preview (A#7 / H-D1)', () => {
    const p = projectWithNames(['Taxon_A', 'Taxon_B']);
    const reps = collectReplacements(p, {
      find: 'Taxon_A',
      replace: '',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    // H-D1: the hit must stay visible instead of vanishing as "No matches".
    // `blocked` marks it preview-only; applyReplacements still refuses it.
    expect(reps).toEqual([
      expect.objectContaining({
        field: 'nodeName',
        oldValue: 'Taxon_A',
        newValue: '',
        blocked: true,
      }),
    ]);
    const applied = applyReplacements(p, reps);
    expect(applied).toBe(0);
    expect(Object.values(p.nodes).some((n) => n.label.trim() === '')).toBe(false);
    expect(p.nodes[reps[0].id].label).toBe('Taxon_A');
  });

  it('keeps a complete-name hit visible (blocked) while a substring hit is applicable (H-D1)', () => {
    const p = projectWithNames(['Taxon_A', 'Taxon_B']);
    const exact = collectReplacements(p, {
      find: 'Taxon_A',
      replace: '',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ oldValue: 'Taxon_A', newValue: '', blocked: true });

    // The same empty replacement on a substring leaves a non-empty label, so
    // both hits are applicable and the preview must offer them.
    const partial = collectReplacements(p, {
      find: 'Taxon',
      replace: '',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    expect(partial).toHaveLength(2);
    expect(partial.every((r) => !r.blocked)).toBe(true);
    const applied = applyReplacements(p, partial);
    expect(applied).toBe(2);
    expect(Object.values(p.nodes).map((n) => n.label).sort()).toEqual(['Root', '_A', '_B']);
  });

  it('applyReplacements re-checks the guard against a stale preview', () => {
    const p = projectWithNames(['Taxon_A', 'Taxon_B']);
    const applied = applyReplacements(p, [
      { field: 'nodeName', id: Object.keys(p.nodes).find((id) => p.nodes[id].label === 'Taxon_A')!, oldValue: 'Taxon_A', newValue: '   ' },
    ]);
    expect(applied).toBe(0);
    expect(Object.values(p.nodes).some((n) => n.label.trim() === '')).toBe(false);
  });

  it('still replaces ordinary substrings case-insensitively (P-05 engine intact)', () => {
    const p = projectWithNames(['Taxon_A', 'Taxon_B']);
    const reps = collectReplacements(p, {
      find: 'taxon',
      replace: 'Q',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    expect(reps).toHaveLength(2);
    const applied = applyReplacements(p, reps);
    expect(applied).toBe(2);
    expect(Object.values(p.nodes).map((n) => n.label).sort()).toEqual(['Q_A', 'Q_B', 'Root']);
  });
});
