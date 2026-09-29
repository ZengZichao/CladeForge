// Gene-tree management for species-tree (DTL) reconciliation.
//
// A GeneTreeEntry embeds a full standalone mini-Project so Newick/NEXUS
// parsing, the topology helpers and computeLayout all work on it unchanged.
// The embedded topology is treated as read-only: assumptions key by gene node
// id and structural edits would invalidate them silently. All exports are
// immer recipes mutating a project draft, so callers go through store.apply()
// and inherit undo/redo + autosave for free.

import { tr } from '../ui/strings';
import type { GeneNodeAssumption, GeneTreeEntry, NodeId, Project, ReconCosts } from './types';
import { DEFAULT_RECON_COSTS } from './types';
import { newId } from './treeOps';

/**
 * Wrap a parsed standalone document as an embedded gene tree. The doc is
 * JSON-cloned to sever object aliasing with any other container (the store
 * freezes produced documents; two live references to the same subtree would
 * couple unrelated edits), and its own geneTrees slot is dropped so embedded
 * projects never nest.
 */
export function makeGeneTreeEntry(doc: Project, name?: string): GeneTreeEntry {
  const clean = JSON.parse(JSON.stringify(doc)) as Project;
  delete clean.geneTrees;
  const id = newId();
  return {
    id,
    name: name?.trim() || clean.name || `Gene ${id.slice(0, 4)}`,
    doc: clean,
    assumptions: {},
  };
}

export function findGeneTree(project: Project, id: string | null | undefined): GeneTreeEntry | undefined {
  if (!id || !project.geneTrees) return undefined;
  return project.geneTrees.find((g) => g.id === id);
}

/** Embed a parsed document as a gene tree; returns the new entry id. */
export function addGeneTree(project: Project, doc: Project, name?: string): string {
  const entry = makeGeneTreeEntry(doc, name);
  if (!project.geneTrees) project.geneTrees = [];
  project.geneTrees.push(entry);
  return entry.id;
}

export function removeGeneTree(project: Project, id: string): void {
  if (!project.geneTrees) return;
  project.geneTrees = project.geneTrees.filter((g) => g.id !== id);
}

export function renameGeneTree(project: Project, id: string, name: string): void {
  const g = findGeneTree(project, id);
  if (g) g.name = name;
}

/**
 * Set (patch != null) or clear (patch == null) one gene node's assumption.
 * Tips never carry an event; clearing speciesNode removes the whole row.
 */
export function setAssumption(
  project: Project,
  geneTreeId: string,
  nodeId: NodeId,
  patch: Partial<Omit<GeneNodeAssumption, 'speciesNode'>> | null,
  speciesNode?: NodeId,
): void {
  const g = findGeneTree(project, geneTreeId);
  if (!g) return;
  if (patch === null) {
    delete g.assumptions[nodeId];
    return;
  }
  const cur = g.assumptions[nodeId] ?? { speciesNode: '' };
  const nextSpecies = speciesNode !== undefined ? speciesNode : cur.speciesNode;
  if (!nextSpecies || !project.nodes[nextSpecies]) {
    delete g.assumptions[nodeId];
    return;
  }
  g.assumptions[nodeId] = { ...cur, ...patch, speciesNode: nextSpecies };
}

export function clearAssumptions(project: Project, geneTreeId: string): void {
  const g = findGeneTree(project, geneTreeId);
  if (g) g.assumptions = {};
}

/**
 * Write the DTL cost vector, rejecting values the solver cannot use.
 *
 * Returns a human-readable problem description (null when everything was
 * accepted) so the panel can tell the user instead of silently storing garbage:
 * `Math.max(0, …)` on its own lets `null` / `''` / `NaN` through untouched (NaN
 * in, NaN out — every DP comparison then fails), and a vector of three zeros
 * turns the optimisation into "any feasible placement is equally optimal" with a
 * cost of 0, which is not an analysis at all. A zero LOSS is refused for
 * the same reason: losses then carry no price and the DP drowns the tree in
 * them.
 */
export function setReconCosts(project: Project, patch: Partial<ReconCosts>): string | null {
  const cur = { ...(project.reconCosts ?? DEFAULT_RECON_COSTS) };
  const problems: string[] = [];
  const keys: (keyof ReconCosts)[] = ['dup', 'transfer', 'loss'];
  for (const key of keys) {
    const raw = patch[key];
    if (raw === undefined) continue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      problems.push(`${key}=${String(raw)}`);
      continue; // keep the previous value
    }
    cur[key] = n;
  }
  if (cur.loss <= 0) {
    problems.push(tr('丢失代价必须大于 0', 'the loss cost must be greater than 0'));
    cur.loss = DEFAULT_RECON_COSTS.loss;
  }
  if (cur.dup <= 0 && cur.transfer <= 0) {
    problems.push(
      tr(
        '加倍与转移代价不能同时为 0（此时任何放置方案代价相同）',
        'duplication and transfer cannot both be 0 (every placement is then equally optimal)',
      ),
    );
    cur.dup = DEFAULT_RECON_COSTS.dup;
    cur.transfer = DEFAULT_RECON_COSTS.transfer;
  }
  project.reconCosts = cur;
  return problems.length > 0 ? problems.join('；') : null;
}
