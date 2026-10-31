// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { createSampleProject } from './sampleTree';
import {
  addBuiltGeneTree,
  autoScenarioForGene,
  createBlankGeneDoc,
  createGeneDocFromSpecies,
  updateBuiltGeneTree,
} from './geneTreeBuild';
import { findGeneTree } from './geneTrees';
import type { Project } from './types';

describe('direct gene-tree construction', () => {
  it('creates a blank gene doc with one named root', () => {
    const doc = createBlankGeneDoc('My gene');
    expect(doc.name).toBe('My gene');
    expect(doc.nodes[doc.rootId].label).toMatch(/Gene root|基因根/);
    expect(doc.nodes[doc.rootId].childrenIds).toHaveLength(0);
  });

  it('copies the species topology with matching tip labels', () => {
    const species = createSampleProject();
    const doc = createGeneDocFromSpecies(species, 'Species copy');
    const speciesTips = Object.values(species.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort();
    const geneTips = Object.values(doc.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort();
    expect(geneTips).toEqual(speciesTips);
    // Every species node has a gene counterpart, and the embedded doc has no
    // nested gene-tree slot.
    expect(Object.keys(doc.nodes)).toHaveLength(Object.keys(species.nodes).length);
    expect(doc.geneTrees).toEqual([]);
  });

  it('auto-maps every copied tip and suggests a scenario', () => {
    const species = createSampleProject();
    const doc = createGeneDocFromSpecies(species, 'Mapped copy');
    const scenario = autoScenarioForGene(species, doc);
    expect(scenario.totalTips).toBeGreaterThan(1);
    expect(scenario.mappedTips).toBe(scenario.totalTips);
    expect(scenario.unmatchedLabels).toEqual([]);
    // Tips and internal nodes receive a suggested placement.
    expect(Object.keys(scenario.assumptions).length).toBeGreaterThan(1);
    const tips = Object.values(doc.nodes).filter((n) => n.childrenIds.length === 0);
    for (const tip of tips) {
      expect(scenario.assumptions[tip.id]?.speciesNode).toBeTruthy();
    }
  });

  it('adds a built tree to the project and rebuilds the scenario after an edit', () => {
    const species = createSampleProject();
    const doc = createGeneDocFromSpecies(species, 'Built');
    const { id, scenario } = addBuiltGeneTree(species, doc, 'Built tree');
    expect(scenario.mappedTips).toBe(scenario.totalTips);
    const entry = findGeneTree(species, id)!;
    expect(entry.name).toBe('Built tree');
    expect(Object.keys(entry.assumptions).length).toBeGreaterThan(0);

    // Rename one gene tip to something absent from the species tree: the edit
    // path must rebuild the scenario rather than keep stale id-keyed mappings.
    const edited = JSON.parse(JSON.stringify(entry.doc)) as Project;
    const tip = Object.values(edited.nodes).find((n) => n.childrenIds.length === 0)!;
    tip.label = 'No such species';
    const rebuilt = updateBuiltGeneTree(species, id, edited, 'Built tree v2')!;
    expect(rebuilt.mappedTips).toBe(rebuilt.totalTips - 1);
    expect(rebuilt.unmatchedLabels).toEqual(['No such species']);
    expect(findGeneTree(species, id)!.name).toBe('Built tree v2');
  });
});
