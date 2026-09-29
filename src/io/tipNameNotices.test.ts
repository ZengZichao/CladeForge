import { describe, it, expect } from 'vitest';
import { tipNames, tipNameNotices } from './nexus';
import { addChildren, renameNode } from '../model/treeOps';
import { createEmptyProject } from '../model/sampleTree';

/**
 * NEXUS TAXLABELS and the exported R script require unique, non-empty tip names,
 * so duplicates and blanks are rewritten on export. The rewrite is not silent:
 * tipNameNotices is what the export actions surface.
 */
function projectWith(labels: string[]) {
  const p = createEmptyProject('t');
  const root = Object.values(p.nodes)[0];
  const ids = addChildren(p, root.id, labels.length);
  labels.forEach((l, i) => renameNode(p, ids[i], l));
  return p;
}

describe('tip name notices', () => {
  it('says nothing when every label is already usable', () => {
    const p = projectWith(['Alpha', 'Beta', 'Gamma']);
    expect(tipNameNotices(p)).toEqual([]);
    expect([...tipNames(p).values()]).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reports each label the export had to change', () => {
    const p = projectWith(['Escherichia', 'Escherichia', '  ']);
    const names = [...tipNames(p).values()];
    expect(names[0]).toBe('Escherichia');
    expect(names[1]).toBe('Escherichia_2');
    expect(names[2]).toBeTruthy(); // the blank label falls back to its node id
    // Only the names the file could not carry verbatim are reported: the second
    // 'Escherichia' and the blank one, which falls back to its node id.
    expect(tipNameNotices(p)).toEqual(['Escherichia_2', names[2]]);
  });

  it('reports a padded label because the file will not carry the padding', () => {
    const p = projectWith([' Meta ', 'Beta']);
    expect([...tipNames(p).values()]).toEqual(['Meta', 'Beta']);
    expect(tipNameNotices(p)).toEqual(['Meta']);
  });
});
