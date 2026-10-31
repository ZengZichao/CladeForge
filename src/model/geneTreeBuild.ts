// Direct gene-tree construction for reconciliation.
//
// Importing a Newick/NEXUS file (or borrowing another tab) is not the only way
// into the reconciliation view anymore: users can build a gene tree topology in
// the app, start from a copy of the species topology, or edit an existing gene
// tree's topology. These helpers keep the construction pure so the dialog and
// tests use exactly the same rules.

import type { GeneNodeAssumption, NodeId, Project } from './types';
import { createEmptyProject } from './sampleTree';
import { addChildren } from './treeOps';
import { addGeneTree, findGeneTree } from './geneTrees';
import { mapTipsByLabel, suggestLcaScenario } from './reconciliation';
import { tr } from '../ui/strings';

export interface GeneTreeAutoScenario {
  /** Suggested mapping/event/loss assertions for every node that can be placed. */
  assumptions: Record<NodeId, GeneNodeAssumption>;
  mappedTips: number;
  totalTips: number;
  unmatchedLabels: string[];
  ambiguousLabels: string[];
}

/** A fresh gene tree document with a single named root. */
export function createBlankGeneDoc(name: string): Project {
  const doc = createEmptyProject(name || tr('基因树', 'Gene tree'));
  const root = doc.nodes[doc.rootId];
  if (root) root.label = tr('基因根', 'Gene root');
  return doc;
}

/**
 * Copy the species topology (labels, branch lengths, ages) into a standalone
 * gene-tree document. Tip labels are intentionally identical, so the name-based
 * auto-mapping can map every tip immediately.
 */
export function createGeneDocFromSpecies(species: Project, name: string): Project {
  const doc = createEmptyProject(name || `${species.name} gene`);
  const copy = (speciesId: NodeId, geneId: NodeId) => {
    const from = species.nodes[speciesId];
    const to = doc.nodes[geneId];
    if (!from || !to) return;
    to.label = from.label;
    to.branchLength = from.branchLength;
    to.age = from.age;
    to.support = from.support;
    for (const childId of from.childrenIds) {
      const [geneChild] = addChildren(doc, geneId, 1);
      if (geneChild) copy(childId, geneChild);
    }
  };
  copy(species.rootId, doc.rootId);
  return doc;
}

/**
 * Map gene tips onto species tips by name and derive an LCA suggestion for the
 * nodes whose children could be placed. Unmatched tips stay unmapped; the
 * caller shows the counts, so nothing is silently invented.
 */
export function autoScenarioForGene(species: Project, geneDoc: Project): GeneTreeAutoScenario {
  const { mappings, unmatchedLabels, ambiguousLabels } = mapTipsByLabel(species, geneDoc);
  const tips = Object.values(geneDoc.nodes).filter((n) => n.childrenIds.length === 0);
  return {
    assumptions: suggestLcaScenario(species, geneDoc, mappings),
    mappedTips: Object.values(mappings).filter((m): m is NodeId => Boolean(m)).length,
    totalTips: tips.length,
    unmatchedLabels,
    ambiguousLabels,
  };
}

/** Add a prepared gene-tree document with automatic name mapping/scenario. */
export function addBuiltGeneTree(
  project: Project,
  doc: Project,
  name?: string,
): { id: string; scenario: GeneTreeAutoScenario } {
  const id = addGeneTree(project, doc, name);
  const entry = findGeneTree(project, id);
  const scenario = entry
    ? autoScenarioForGene(project, entry.doc)
    : { assumptions: {}, mappedTips: 0, totalTips: 0, unmatchedLabels: [], ambiguousLabels: [] };
  if (entry) entry.assumptions = scenario.assumptions;
  return { id, scenario };
}

/**
 * Replace an existing gene tree's topology and rebuild the suggested scenario.
 * This is an explicit edit path: old assumptions key by node id and would be
 * invalid after a structural change, so they are intentionally rebuilt.
 */
export function updateBuiltGeneTree(
  project: Project,
  id: string,
  doc: Project,
  name: string,
): GeneTreeAutoScenario | null {
  const entry = findGeneTree(project, id);
  if (!entry) return null;
  const clean = JSON.parse(JSON.stringify(doc)) as Project;
  delete clean.geneTrees;
  entry.doc = clean;
  if (name.trim()) entry.name = name.trim();
  const scenario = autoScenarioForGene(project, entry.doc);
  entry.assumptions = scenario.assumptions;
  return scenario;
}
