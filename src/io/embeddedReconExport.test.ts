// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Contracts for the EMBEDDED-view exports and persistence (plan §8.3 / §9.3 / §9.4):
//   * buildEmbeddedReconSVG shares the canvas geometry (same layout call) and
//     produces parseable, NaN-free SVG with mask/tubes/arcs/losses/legend;
//   * the optional visual path fields (branchFraction / transferDonor)
//     round-trip through projectIO, with out-of-range fractions clamped and
//     dangling donors dropped;
//   * dtlScenarioToAssumptions keeps those fields only while the mapping
//     target is unchanged.

import { describe, it, expect } from 'vitest';
import { createReconciliationSample } from '../model/sampleTree';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren, renameNode } from '../model/treeOps';
import { DEFAULT_RECON_VIEW_OPTIONS, type GeneNodeAssumption, type NodeId } from '../model/types';
import { dtlScenarioToAssumptions, type DtlScenario } from '../model/dtl';
import { readProjectFile, serializeProject } from './projectIO';
import { buildEmbeddedReconSVG } from './embeddedReconExport';

describe('buildEmbeddedReconSVG', () => {
  const project = createReconciliationSample();
  const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;

  it('emits parseable SVG sharing the canvas geometry', () => {
    const { svg, width, height } = buildEmbeddedReconSVG(project, entry, DEFAULT_RECON_VIEW_OPTIONS, {});
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // No NaN / Infinity anywhere in the markup.
    expect(svg).not.toMatch(/NaN|Infinity/);
    // The mask skeleton and the masked gene-lineage group exist.
    expect(svg).toContain('<mask');
    expect(svg).toContain('mask="url(#er-export-mask)"');
    // Tubes (species branches) and at least one transfer arc + loss stub.
    expect(svg).toContain('stroke-width="20"'); // border = width 18 + 2
    expect(svg).toContain('λ');
    expect(svg).toContain('σ');
    // CJK legend present, metadata stamped.
    expect(svg).toContain('物种枝管道');
    expect(svg).toContain('<metadata>');
    // Element counts agree with the scene the canvas would paint: each species
    // branch draws exactly one tube BORDER (hubs draw no border).
    const branchCount = Object.values(project.nodes).filter(
      (n) => n.parentId !== null && n.parentId !== undefined,
    ).length;
    const tubeBorders = (svg.match(/stroke="#a1a1aa"/g) ?? []).length;
    expect(tubeBorders).toBe(branchCount);
  });

  it('can omit the legend and metadata and use the dark palette', () => {
    const { svg } = buildEmbeddedReconSVG(project, entry, DEFAULT_RECON_VIEW_OPTIONS, {
      includeLegend: false,
      includeMetadata: false,
      dark: true,
    });
    expect(svg).not.toContain('<metadata>');
    expect(svg).not.toContain('物种枝管道');
    expect(svg).toContain('#3f3f46'); // dark tube fill
  });
});

describe('embedded path-field persistence (projectIO round trip)', () => {
  function projectWith(build: (speciesRoot: NodeId, speciesChild: NodeId) => GeneNodeAssumption) {
    const p = createEmptyProject('sp');
    const [a] = addChildren(p, p.rootId, 1);
    renameNode(p, a, 'A');
    const gene = createEmptyProject('g');
    const [t] = addChildren(gene, gene.rootId, 1);
    renameNode(gene, t, 'a');
    p.geneTrees = [
      {
        id: 'gt_1',
        name: 'Gene family X',
        doc: gene,
        assumptions: { [gene.rootId]: build(p.rootId, a) },
      },
    ];
    return { p, geneRoot: gene.rootId, speciesChild: a };
  }

  it('round-trips branchFraction and a valid transferDonor', () => {
    const { p, geneRoot, speciesChild } = projectWith((root, child) => ({
      speciesNode: root,
      event: 'transfer',
      branchFraction: 0.42,
      transferDonor: child,
    }));
    const text = serializeProject(p);
    const { project: back } = readProjectFile(text);
    const a = back.geneTrees![0].assumptions[geneRoot];
    expect(a.branchFraction).toBeCloseTo(0.42, 6);
    expect(a.transferDonor).toBe(speciesChild);
  });

  it('clamps an out-of-range branchFraction and drops a dangling transferDonor', () => {
    const { p, geneRoot } = projectWith((root) => ({
      speciesNode: root,
      branchFraction: 7.5,
      transferDonor: 'no-such-node',
    }));
    const text = serializeProject(p);
    const { project: back } = readProjectFile(text);
    const a = back.geneTrees![0].assumptions[geneRoot];
    expect(a.branchFraction).toBe(1);
    expect(a.transferDonor).toBeUndefined();
  });
});

describe('dtlScenarioToAssumptions keeps visual fields on unchanged targets', () => {
  const project = createReconciliationSample();
  const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
  const geneRootId = entry.doc.rootId;
  const alphaRootAssumption = entry.assumptions[geneRootId];

  it('preserves branchFraction/transferDonor when the target is unchanged and drops them otherwise', () => {
    const withVisual: Record<NodeId, GeneNodeAssumption> = {
      ...entry.assumptions,
      [geneRootId]: { ...alphaRootAssumption, branchFraction: 0.7, transferDonor: project.rootId },
    };
    // A minimal valid-shaped scenario reusing the current placements/events.
    const scenario: DtlScenario = {
      placements: Object.fromEntries(
        Object.values(entry.doc.nodes)
          .map((n) => [n.id, entry.assumptions[n.id]?.speciesNode])
          .filter(([, s]) => Boolean(s)),
      ) as Record<NodeId, NodeId>,
      events: Object.fromEntries(
        Object.values(entry.doc.nodes)
          .map((n) => [n.id, entry.assumptions[n.id]?.event])
          .filter(([, e]) => Boolean(e)),
      ) as Record<NodeId, 'speciation' | 'duplication' | 'transfer'>,
      cost: 0,
      rootFees: 0,
      ambiguous: [],
      totalLosses: 0,
      lossMarks: [],
      freeRoot: false,
      rootSpeciesNode: project.rootId,
    };
    const kept = dtlScenarioToAssumptions(project, entry.doc, scenario, withVisual);
    expect(kept[geneRootId].branchFraction).toBe(0.7);
    expect(kept[geneRootId].transferDonor).toBe(project.rootId);

    // Change the root's placement to a DIFFERENT species node: the visual
    // fields must vanish (they pointed into the old branch).
    const other = Object.values(project.nodes).find(
      (n) => n.parentId !== null && n.id !== alphaRootAssumption.speciesNode,
    )!;
    const moved: DtlScenario = {
      ...scenario,
      placements: { ...scenario.placements, [geneRootId]: other.id },
    };
    const dropped = dtlScenarioToAssumptions(project, entry.doc, moved, withVisual);
    expect(dropped[geneRootId].branchFraction).toBeUndefined();
    expect(dropped[geneRootId].transferDonor).toBeUndefined();
  });
});
