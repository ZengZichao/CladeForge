// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Contracts for the reconciliation sample project (§7):
// two gene trees shipped with the demo, tree α validating with ZERO errors and
// carrying one duplication, one transfer and one loss, tree β showing exactly
// one resolvable warning, and the descriptor opening into the reconciliation
// workspace. The six standard samples stay gene-free so their behaviour (and
// the fixture cross-checks) cannot drift.

import { describe, it, expect } from 'vitest';
import {
  SAMPLE_PROJECTS,
  createReconciliationSample,
  createSampleProject,
} from './sampleTree';
import { validateScenario, scenarioSummary, mapTipsByLabel } from './reconciliation';
import { computeLayout } from '../layout/autoLayout';

const reconDescriptor = () => SAMPLE_PROJECTS.find((d) => d.id === 'recon-family');

function isBinary(doc: { nodes: Record<string, { childrenIds: string[] }> }): boolean {
  return Object.values(doc.nodes).every(
    (n) => n.childrenIds.length === 0 || n.childrenIds.length === 2,
  );
}

describe('the reconciliation sample descriptor', () => {
  it('is registered with entryView=recon alongside the six standard samples', () => {
    expect(reconDescriptor()).toBeTruthy();
    expect(reconDescriptor()?.entryView).toBe('recon');
    // The 6 pre-existing samples keep their ids and stay standard-entry.
    for (const id of ['archaea', 'bacteria', 'virus', 'cetacean', 'plant', 'animal']) {
      const d = SAMPLE_PROJECTS.find((s) => s.id === id);
      expect(d, id).toBeTruthy();
      expect(d?.entryView ?? 'standard').toBe('standard');
    }
    expect(SAMPLE_PROJECTS).toHaveLength(7);
  });
});

describe('the reconciliation sample document', () => {
  const project = createReconciliationSample();
  const costs = project.reconCosts ?? { dup: 1, transfer: 2, loss: 1 };

  it('ships exactly two gene trees, both strictly binary and layable', () => {
    expect(project.geneTrees).toHaveLength(2);
    for (const g of project.geneTrees ?? []) {
      expect(isBinary(g.doc), g.name).toBe(true);
      const layout = computeLayout(g.doc);
      expect(layout.visible.size).toBe(Object.keys(g.doc.nodes).length);
    }
    expect(isBinary(project)).toBe(true);
  });

  it('α carries a complete σ/δ/τ/λ scenario with ZERO validation errors', () => {
    const alpha = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const issues = validateScenario(project, alpha.doc, alpha.assumptions, costs);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
    // And no warnings either: the default demo must look CLEAN.
    expect(issues, issues.map((e) => e.message).join('\n')).toEqual([]);

    const summary = scenarioSummary(alpha.doc, alpha.assumptions, costs);
    expect(summary.duplication).toBeGreaterThanOrEqual(1);
    expect(summary.transfer).toBeGreaterThanOrEqual(1);
    expect(summary.losses).toBeGreaterThanOrEqual(1);
    expect(summary.speciation).toBeGreaterThanOrEqual(1);
    // Every internal node resolved.
    expect(summary.mappedInternal).toBe(summary.totalInternal);
  });

  it('every α tip maps by label, and no assumption references a missing node', () => {
    const alpha = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const { mappings, unmatchedLabels, ambiguousLabels } = mapTipsByLabel(project, alpha.doc);
    expect(unmatchedLabels).toEqual([]);
    expect(ambiguousLabels).toEqual([]);
    for (const tip of Object.values(alpha.doc.nodes)) {
      if (tip.childrenIds.length > 0) continue;
      expect(mappings[tip.id] != null || alpha.assumptions[tip.id], tip.label).toBe(true);
    }
    for (const [gid, a] of Object.entries(alpha.assumptions)) {
      expect(alpha.doc.nodes[gid], gid).toBeTruthy();
      expect(project.nodes[a.speciesNode], a.speciesNode).toBeTruthy();
    }
  });

  it('β shows exactly ONE warning (an unresolved internal node) and no errors', () => {
    const beta = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    const issues = validateScenario(project, beta.doc, beta.assumptions, costs);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('unresolved');
  });

  it('gene tips label-match the species tips (auto-mapping works after rebuilds)', () => {
    const speciesTips = Object.values(project.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort();
    for (const g of project.geneTrees ?? []) {
      const geneTips = Object.values(g.doc.nodes)
        .filter((n) => n.childrenIds.length === 0)
        .map((n) => n.label)
        .sort();
      expect(geneTips).toEqual(speciesTips);
    }
  });

  it('is byte-stable in structure across rebuilds (random ids aside)', () => {
    const a = createReconciliationSample();
    const b = createReconciliationSample();
    expect(a.geneTrees).toHaveLength(b.geneTrees!.length);
    expect(a.name).toBe(b.name);
    // Same tip labels in the same tree order.
    const labelsOf = (p: typeof a) =>
      (p.geneTrees ?? []).map((g) =>
        Object.values(g.doc.nodes).map((n) => n.label).sort().join('|'),
      );
    expect(labelsOf(a)).toEqual(labelsOf(b));
  });
});

describe('the standard samples stay untouched', () => {
  it('the default sample and all six standard entries still have no gene trees', () => {
    expect(createSampleProject().geneTrees).toEqual([]);
    for (const id of ['archaea', 'bacteria', 'virus', 'cetacean', 'plant', 'animal']) {
      const d = SAMPLE_PROJECTS.find((s) => s.id === id)!;
      expect(d.build().geneTrees).toEqual([]);
    }
  });
});
