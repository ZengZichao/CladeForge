// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Contracts for the EMBEDDED reconciliation placement resolver
// (docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md §5.1 / §9.1):
//   * explicit assumptions beat tip-label matches; unmatched tips stay unmapped;
//   * display inference (child MRCA) keeps unannotated internal nodes connected
//     WITHOUT touching `assumptions` (the sample's β4 contract);
//   * dangling assumptions never act as placements and are always reported;
//   * speciesPathBetween / lossesAlongSpeciesPath agree with the established
//     `minLossesBetween` semantics (cross-tested pair by pair);
//   * the transfer donor follows the "child outside the recipient subtree"
//     convention shared with validateScenario / geneTreeNhk.

import { describe, it, expect } from 'vitest';
import type { GeneNodeAssumption, NodeId, Project, TreeNode } from './types';
import { DEFAULT_RECON_COSTS } from './types';
import {
  branchIdOf,
  lossesAlongSpeciesPath,
  resolveEffectiveGenePlacements,
  resolveTransferDonor,
  speciesPathBetween,
} from './reconPlacements';
import { minLossesBetween, validateScenario } from './reconciliation';
import { createReconciliationSample } from './sampleTree';

// --- fixture helpers -----------------------------------------------------------

type Spec = [id: string, label: string, parent: string | null, children: string[]];

function buildDoc(rootId: string, specs: Spec[]): Project {
  const nodes: Record<NodeId, TreeNode> = {};
  const base = createReconciliationSample(); // reuse a valid shell (layers etc.)
  const fresh: Record<NodeId, TreeNode> = {};
  for (const [id, label, parent, children] of specs) {
    fresh[id] = { id, label, parentId: parent, childrenIds: [...children] };
  }
  nodes[rootId] = fresh[rootId];
  for (const [id, label, parent, children] of specs) {
    if (id === rootId) continue;
    nodes[id] = { id, label, parentId: parent, childrenIds: [...children] };
  }
  return {
    ...base,
    id: 'fixture',
    name: 'fixture',
    nodes,
    rootId,
    geneTrees: [],
  };
}

/**
 * Species tree (labelled tips; a 3-way fork to exercise m−1 losses):
 *   R ─ N1 ─ A / B
 *     └ N2 ─ C / N3 ─ D / E / F   (N3 has three children)
 */
function speciesDoc(): Project {
  return buildDoc('R', [
    ['R', 'Root', null, ['N1', 'N2']],
    ['N1', 'N1', 'R', ['A', 'B']],
    ['A', 'Taxon_A', 'N1', []],
    ['B', 'Taxon_B', 'N1', []],
    ['N2', 'N2', 'R', ['C', 'N3']],
    ['C', 'Taxon_C', 'N2', []],
    ['N3', 'N3', 'N2', ['D', 'E', 'F']],
    ['D', 'Taxon_D', 'N3', []],
    ['E', 'Taxon_E', 'N3', []],
    ['F', 'Taxon_F', 'N3', []],
  ]);
}

/** Gene tree: gR ─ g1 ─ gA(Taxon_A) / gB(Taxon_B); gR ─ gC(Taxon_C) */
function geneDoc(): Project {
  return buildDoc('gR', [
    ['gR', 'gR', null, ['g1', 'gC']],
    ['g1', 'g1', 'gR', ['gA', 'gB']],
    ['gA', 'Taxon_A', 'g1', []],
    ['gB', 'Taxon_B', 'g1', []],
    ['gC', 'Taxon_C', 'gR', []],
  ]);
}

const noAssumptions = {} as Record<NodeId, GeneNodeAssumption>;

// --- resolveEffectiveGenePlacements ----------------------------------------------

describe('resolveEffectiveGenePlacements', () => {
  const sp = speciesDoc();
  const ge = geneDoc();

  it('maps gene tips by label and leaves unmatched tips unmapped', () => {
    const eff = resolveEffectiveGenePlacements(sp, ge, noAssumptions);
    expect(eff.byGeneNode.get('gA')?.source).toBe('tip-label');
    expect(eff.byGeneNode.get('gA')?.speciesNodeId).toBe('A');
    expect(eff.byGeneNode.get('gC')?.speciesNodeId).toBe('C');
    // g1 is inferred from its children; gR from its children.
    expect(eff.inferredGeneNodes).toContain('g1');
    expect(eff.inferredGeneNodes).toContain('gR');
    expect(eff.unmappedGeneNodes).toEqual([]);
    expect(eff.byGeneNode.get('gR')?.speciesNodeId).toBe('R');
  });

  it('gives an explicit assumption priority over the label match', () => {
    const eff = resolveEffectiveGenePlacements(sp, ge, { gA: { speciesNode: 'B' } });
    expect(eff.byGeneNode.get('gA')).toMatchObject({
      speciesNodeId: 'B',
      source: 'assumption',
      inferred: false,
    });
  });

  it('never writes display inference back into assumptions', () => {
    const assumptions: Record<NodeId, GeneNodeAssumption> = {};
    const snapshot = JSON.stringify(assumptions);
    resolveEffectiveGenePlacements(sp, ge, assumptions);
    expect(JSON.stringify(assumptions)).toBe(snapshot);
    expect(Object.keys(assumptions)).toEqual([]);
  });

  it('does not infer a parent when any child is unplaceable', () => {
    const partial = buildDoc('gR', [
      ['gR', 'gR', null, ['g1', 'gC']],
      ['g1', 'g1', 'gR', ['gA', 'gB']],
      ['gA', 'Taxon_A', 'g1', []],
      ['gB', 'no-such-species', 'g1', []],
      ['gC', 'Taxon_C', 'gR', []],
    ]);
    const eff = resolveEffectiveGenePlacements(sp, partial, noAssumptions);
    expect(eff.inferredGeneNodes).not.toContain('g1');
    expect(eff.unmappedGeneNodes).toContain('g1');
    expect(eff.unmappedGeneNodes).toContain('gB');
    // gR cannot be inferred either (its child g1 is unmapped).
    expect(eff.unmappedGeneNodes).toContain('gR');
  });

  it('reports dangling assumptions and still falls back for tips', () => {
    const eff = resolveEffectiveGenePlacements(sp, ge, {
      gA: { speciesNode: 'GONE' },
      gC: { speciesNode: 'ALSO-GONE' },
    });
    expect([...eff.danglingAssumptions].sort()).toEqual(['gA', 'gC']);
    // Tip gA falls back to the label match; gC likewise.
    expect(eff.byGeneNode.get('gA')?.source).toBe('tip-label');
    expect(eff.byGeneNode.get('gC')?.source).toBe('tip-label');
  });

  it('recon-family β4 is display-inferred to N4 while E/F keep label sources', () => {
    const project = createReconciliationSample();
    const beta = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    const eff = resolveEffectiveGenePlacements(project, beta.doc, beta.assumptions);
    const b4 = Object.values(beta.doc.nodes).find((n) => n.label === 'β4')!;
    const n4 = Object.values(project.nodes).find((n) => n.label === 'N4')!;
    expect(eff.byGeneNode.get(b4.id)).toMatchObject({
      speciesNodeId: n4.id,
      source: 'inferred-mrca',
      inferred: true,
    });
    const kids = b4.childrenIds.map((c) => eff.byGeneNode.get(c));
    expect(kids.map((k) => k?.source)).toEqual(['tip-label', 'tip-label']);
    // And the display inference did not touch the stored scenario.
    expect(beta.assumptions[b4.id]).toBeUndefined();
  });
});

// --- branchIdOf / speciesPathBetween ----------------------------------------------

describe('branchIdOf', () => {
  it('returns null at the species root and the node id elsewhere', () => {
    const sp = speciesDoc();
    expect(branchIdOf(sp, 'R')).toBeNull();
    expect(branchIdOf(sp, 'N1')).toBe('N1');
    expect(branchIdOf(sp, 'A')).toBe('A');
  });
});

describe('speciesPathBetween', () => {
  const sp = speciesDoc();

  it('classifies same / down / up / lateral', () => {
    expect(speciesPathBetween(sp, 'A', 'A')).toEqual({ kind: 'same', node: 'A' });
    const down = speciesPathBetween(sp, 'R', 'E');
    expect(down).toMatchObject({ kind: 'down', from: 'R', to: 'E' });
    expect(down.kind === 'down' && down.branches).toEqual(['N2', 'N3', 'E']);
    const up = speciesPathBetween(sp, 'E', 'R');
    expect(up.kind).toBe('up');
    const lateral = speciesPathBetween(sp, 'A', 'C');
    expect(lateral.kind).toBe('lateral');
    if (lateral.kind === 'lateral') {
      expect(lateral.mrca).toBe('R');
      expect(lateral.upBranches).toEqual(['A', 'N1']);
      expect(lateral.downBranches).toEqual(['N2', 'C']);
    }
  });
});

// --- lossesAlongSpeciesPath ---------------------------------------------------------

describe('lossesAlongSpeciesPath', () => {
  const sp = speciesDoc();

  it('agrees with minLossesBetween for every ordered node pair', () => {
    const ids = ['R', 'N1', 'A', 'B', 'N2', 'C', 'N3', 'D', 'E', 'F'];
    for (const from of ids) {
      for (const to of ids) {
        const path = speciesPathBetween(sp, from, to);
        if (path.kind === 'up') continue; // infeasible moves price as Infinity
        const structural = [...lossesAlongSpeciesPath(sp, path).values()].reduce((a, b) => a + b, 0);
        const reference = minLossesBetween(sp, from, to);
        expect(structural, `${from}→${to}`).toBe(reference);
      }
    }
  });

  it('charges m−1 at a multifurcation and 0 through a unifurcation', () => {
    // R → E passes N2 (binary: 1) and N3 (three children: 2) = 3.
    const path = speciesPathBetween(sp, 'R', 'E');
    const perFork = lossesAlongSpeciesPath(sp, path);
    expect(perFork.get('N2')).toBe(1);
    expect(perFork.get('N3')).toBe(2);
    expect([...perFork.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });
});

// --- resolveTransferDonor -------------------------------------------------------------

describe('resolveTransferDonor', () => {
  // Gene: tR (transfer, maps R) with donor child dC (maps C, outside N1) and
  // recipient child rA (maps A, inside N1).
  function transferGene(): Project {
    return buildDoc('tR', [
      ['tR', 'tR', null, ['dC', 'rA']],
      ['dC', 'Taxon_C', 'tR', []],
      ['rA', 'Taxon_A', 'tR', []],
    ]);
  }

  it('derives the donor as the child outside the recipient subtree', () => {
    const sp = speciesDoc();
    const ge = transferGene();
    const eff = resolveEffectiveGenePlacements(sp, ge, {
      tR: { speciesNode: 'N1', event: 'transfer' },
      dC: { speciesNode: 'C' },
      rA: { speciesNode: 'A' },
    });
    const donor = resolveTransferDonor(sp, ge, 'tR', eff);
    expect(donor).toMatchObject({ donorGeneNodeId: 'dC', donorSpeciesNodeId: 'C' });
  });

  it('lets an explicit donor species node override the auto-derivation', () => {
    const sp = speciesDoc();
    const ge = buildDoc('tR', [
      ['tR', 'tR', null, ['dC', 'dD', 'rA']],
      ['dC', 'Taxon_C', 'tR', []],
      ['dD', 'Taxon_D', 'tR', []],
      ['rA', 'Taxon_A', 'tR', []],
    ]);
    const eff = resolveEffectiveGenePlacements(sp, ge, {
      tR: { speciesNode: 'N1', event: 'transfer' },
      dC: { speciesNode: 'C' },
      dD: { speciesNode: 'D' },
      rA: { speciesNode: 'A' },
    });
    // Auto-derivation picks the FIRST outside child (C).
    expect(resolveTransferDonor(sp, ge, 'tR', eff)).toMatchObject({ donorGeneNodeId: 'dC' });
    // What the assumption stores is a node of the OUTER species tree (see the
    // repair in projectIO and the hint in GeneAssumptionInspector), and the gene
    // child placed on it becomes the donor.
    expect(resolveTransferDonor(sp, ge, 'tR', eff, 'D')).toMatchObject({
      donorGeneNodeId: 'dD',
      donorSpeciesNodeId: 'D',
    });
    // A species node inside the recipient subtree is not a donor, and one no
    // child occupies selects nothing: either way auto-derivation still applies.
    expect(resolveTransferDonor(sp, ge, 'tR', eff, 'A')).toMatchObject({ donorGeneNodeId: 'dC' });
    expect(resolveTransferDonor(sp, ge, 'tR', eff, 'N2')).toMatchObject({ donorGeneNodeId: 'dC' });
  });

  it('returns null when every child stays inside the recipient subtree', () => {
    const sp = speciesDoc();
    const ge = buildDoc('tR', [
      ['tR', 'tR', null, ['rA', 'rB']],
      ['rA', 'Taxon_A', 'tR', []],
      ['rB', 'Taxon_B', 'tR', []],
    ]);
    const eff = resolveEffectiveGenePlacements(sp, ge, {
      tR: { speciesNode: 'N1', event: 'transfer' },
      rA: { speciesNode: 'A' },
      rB: { speciesNode: 'B' },
    });
    expect(resolveTransferDonor(sp, ge, 'tR', eff)).toBeNull();
  });

  it('keeps the sample α scenario free of transfer errors (shared convention)', () => {
    const project = createReconciliationSample();
    const alpha = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const issues = validateScenario(project, alpha.doc, alpha.assumptions, DEFAULT_RECON_COSTS);
    expect(issues.filter((i) => i.kind === 'event-conflict')).toEqual([]);
  });
});
