// Tests for the 协调映射编辑 pane-editing helpers (用户反馈 2026-11-23):
// deleting gene subtrees must clean the assumptions that referenced removed
// nodes, and deleting species nodes must not leave dangling mapping targets.

import { describe, it, expect } from 'vitest';
import { createEmptyProject, createReconciliationSample } from './sampleTree';
import { makeGeneTreeEntry } from './geneTrees';
import { deleteGeneSubtree, pruneAssumptionsForSpeciesNodes } from './geneTrees';
import { addChildren } from './treeOps';
import type { GeneNodeAssumption } from './types';

describe('deleteGeneSubtree (协调映射编辑 pane editing)', () => {
  it('removes the subtree and every assumption that referenced a removed node', () => {
    const project = createEmptyProject('sp');
    const entry = makeGeneTreeEntry(createEmptyProject('g'), 'g');
    const [a, b] = addChildren(entry.doc, entry.doc.rootId, 2);
    const [a1] = addChildren(entry.doc, a, 1);
    project.geneTrees = [entry];
    const assumptions: Record<string, GeneNodeAssumption> = {
      [a]: { speciesNode: 'sp1' },
      [a1]: { speciesNode: 'sp2' },
      [b]: { speciesNode: 'sp3' },
    };
    entry.assumptions = assumptions;

    const before = Object.keys(entry.doc.nodes).length;
    const removed = deleteGeneSubtree(project, entry.id, a);

    expect(removed.has(a)).toBe(true);
    expect(removed.has(a1)).toBe(true);
    expect(Object.keys(entry.doc.nodes)).toHaveLength(before - 2);
    expect(entry.assumptions[a]).toBeUndefined();
    expect(entry.assumptions[a1]).toBeUndefined();
    // The untouched branch keeps its assumption.
    expect(entry.assumptions[b]).toEqual({ speciesNode: 'sp3' });
  });

  it('refuses to delete the gene root', () => {
    const project = createEmptyProject('sp');
    const entry = makeGeneTreeEntry(createEmptyProject('g'), 'g');
    project.geneTrees = [entry];
    const removed = deleteGeneSubtree(project, entry.id, entry.doc.rootId);
    expect(removed.size).toBe(0);
    expect(Object.keys(entry.doc.nodes)).toHaveLength(1);
  });
});

describe('pruneAssumptionsForSpeciesNodes (协调映射编辑 pane editing)', () => {
  it('drops gene assumptions whose species target was deleted', () => {
    const project = createReconciliationSample();
    const entry = project.geneTrees![0];
    // Pick two mapped gene nodes and pretend their species targets vanished.
    const rows = Object.entries(entry.assumptions).filter(([, a]) => a.speciesNode);
    expect(rows.length).toBeGreaterThan(1);
    const removed = new Set([rows[0][1].speciesNode, rows[1][1].speciesNode]);

    pruneAssumptionsForSpeciesNodes(project, removed);

    expect(entry.assumptions[rows[0][0]]).toBeUndefined();
    expect(entry.assumptions[rows[1][0]]).toBeUndefined();
    const remaining = Object.values(entry.assumptions).filter(
      (a) => a.speciesNode && removed.has(a.speciesNode),
    );
    expect(remaining).toHaveLength(0);
  });
});
