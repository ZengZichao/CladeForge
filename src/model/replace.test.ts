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
  it('refuses a replacement that would blank a node name (A#7)', () => {
    const p = projectWithNames(['Taxon_A', 'Taxon_B']);
    const reps = collectReplacements(p, {
      find: 'Taxon_A',
      replace: '',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    expect(reps).toEqual([]);
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
