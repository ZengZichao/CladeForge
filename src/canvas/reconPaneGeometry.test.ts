// Reconciliation pane geometry: the gene pane is mirrored (root on the
// right, tips on the left) and its labels reserve room on the opposite side.
// These contracts keep the mapping bridge and Fit-to-view honest.

import { describe, expect, it } from 'vitest';
import { computeLayout } from '../layout/autoLayout';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import type { NodeId, Orientation, Project } from '../model/types';
import { DEFAULT_RECON_VIEW_OPTIONS } from '../model/types';
import { reconPaneBounds } from './ReconPane';

function twoTipTree(): { doc: Project; root: NodeId; tipA: NodeId } {
  const doc = createEmptyProject('geometry');
  const root = doc.rootId;
  doc.nodes[root].label = 'Root';
  const [a, b] = addChildren(doc, root, 2);
  doc.nodes[a].label = 'Alpha';
  doc.nodes[b].label = 'Beta';
  return { doc, root, tipA: a };
}

function horizontal(doc: Project, orientation: Orientation): Project {
  return { ...doc, layout: { ...doc.layout, type: 'rectangular-cladogram', orientation } };
}

describe('reconciliation pane geometry', () => {
  it('places the gene root on the right and its tips on the left (RL)', () => {
    const { doc, root, tipA } = twoTipTree();
    const layout = computeLayout(horizontal(doc, 'RL'));
    expect(layout.positions.get(root)!.x).toBeGreaterThan(layout.positions.get(tipA)!.x);
  });

  it('keeps the species tree growing rightwards (LR)', () => {
    const { doc, root, tipA } = twoTipTree();
    const layout = computeLayout(horizontal(doc, 'LR'));
    expect(layout.positions.get(root)!.x).toBeLessThan(layout.positions.get(tipA)!.x);
  });

  it('reserves label space on the outside of the mirrored gene pane', () => {
    const { doc, root } = twoTipTree();
    // Isolate the tip-label side: the root carries no label of its own.
    doc.nodes[root].label = '';
    const speciesLayout = computeLayout(horizontal(doc, 'LR'));
    const geneLayout = computeLayout(horizontal(doc, 'RL'));
    const species = reconPaneBounds(doc, speciesLayout, DEFAULT_RECON_VIEW_OPTIONS, 'species');
    const gene = reconPaneBounds(doc, geneLayout, DEFAULT_RECON_VIEW_OPTIONS, 'gene');
    // Species tips face right, so their labels extend maxX; gene tips face
    // left, so the same labels extend minX instead. The shared 6px selection
    // ring padding is present on both panes.
    expect(species.maxX).toBeGreaterThan(speciesLayout.bounds.maxX + 6);
    expect(species.minX).toBe(speciesLayout.bounds.minX - 6);
    expect(gene.minX).toBeLessThan(geneLayout.bounds.minX - 6);
    expect(gene.maxX).toBe(geneLayout.bounds.maxX + 6);
  });
});
