// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Gene-tree management for species-tree (DTL) reconciliation.
//
// A GeneTreeEntry embeds a full standalone mini-Project so Newick/NEXUS
// parsing, the topology helpers and computeLayout all work on it unchanged.
// The embedded topology is treated as read-only: assumptions key by gene node
// id and structural edits would invalidate them silently. All exports are
// immer recipes mutating a project draft, so callers go through store.apply()
// and inherit undo/redo + autosave for free.

import { tr } from '../ui/strings';
import type {
  GeneNodeAssumption,
  GeneTreeEntry,
  NodeId,
  Project,
  ReconCosts,
} from './types';
import { DEFAULT_RECON_COSTS } from './types';
import { newId, rerootAtNode } from './treeOps';
import { solveDtl, type DtlOptions, type DtlScenario, type DtlSolveResult } from './dtl';
import type { TipMapping } from './reconciliation';

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
    // An invalid species target used to DELETE the whole assumption row in
    // silence — data loss with no message (M6). The caller's intent was an
    // update, not a wipe, so the existing row is left untouched; a missing
    // species mapping is exactly what validateScenario reports, so the user
    // still hears about it through the normal channel.
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

// --- polytomy handling ---------------------------------------------------------
// The DP requires a binary gene tree, but majority-rule consensus trees, fast
// clustering trees and many published gene trees carry polytomies. Refusing them
// outright cut the "build consensus → reconcile" pipeline at its last step, so
// the solver-facing alternative is a RANDOM binary resolution with replicates:
// each replicate resolves every polytomy into an arbitrary binary shape, the
// solve runs per replicate, and the spread of the event counts IS the reported
// uncertainty ("resolution-sensitive" is a finding, not noise to hide).

export interface PolytomyResolution {
  /** A resolved (binary) copy of `gene`; polytomy nodes replaced by new binary nodes. */
  doc: Project;
  /** How many polytomies were split. */
  resolved: number;
}

/**
 * A deterministic mulberry32 stream OWNED by one resolution pass. The seed used
 * to live in a module-level mutable that every `resolvePolytomiesRandom` call
 * reset — two overlapping resolutions (a future async worker, a replay) would
 * have polluted each other's streams. A closure keeps each call's stream private.
 */
function polytomyRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle a polytomy's child list; the fold into fresh binary joiners happens
 *  in `resolvePolytomiesRandom` — this helper only orders the children. */
function shuffleChildren(children: NodeId[], rng: () => number): NodeId[] {
  const pool = [...children];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * Randomly resolve every polytomy of a gene tree into a binary shape.
 * Original node ids are preserved (only NEW internal joiners are minted), so a
 * scenario solved on the resolved copy can still be read against the original.
 * Not written into the document — this is a solver-side expansion.
 */
export function resolvePolytomiesRandom(gene: Project, seed = 20260919): PolytomyResolution {
  const rng = polytomyRng(seed);
  const doc = JSON.parse(JSON.stringify(gene)) as Project;
  delete doc.geneTrees;
  let resolved = 0;
  // Repeated passes: a resolved node's parent gains a child, never a polytomy,
  // so one pass per polytomy suffices — but walk until stable defensively.
  for (let pass = 0; pass < 8; pass += 1) {
    const polytomies = Object.values(doc.nodes).filter((n) => n.childrenIds.length > 2);
    if (polytomies.length === 0) break;
    for (const node of polytomies) {
      const shuffled = shuffleChildren(node.childrenIds, rng);
      // Fold the shuffled child list into a binary tree of fresh internal nodes.
      let current: NodeId[] = shuffled;
      while (current.length > 2) {
        const next: NodeId[] = [];
        for (let i = 0; i < current.length; i += 2) {
          if (i + 1 === current.length) {
            next.push(current[i]);
            continue;
          }
          const joiner = newId();
          const a = doc.nodes[current[i]];
          const b = doc.nodes[current[i + 1]];
          a.parentId = joiner;
          b.parentId = joiner;
          doc.nodes[joiner] = {
            id: joiner,
            label: '',
            parentId: node.id,
            childrenIds: [current[i], current[i + 1]],
          };
          next.push(joiner);
        }
        current = next;
      }
      node.childrenIds = current;
      for (const c of current) doc.nodes[c].parentId = node.id;
      resolved += 1;
    }
  }
  return { doc, resolved };
}

export interface PolytomySolveSummary {
  scenario: DtlScenario;
  replicates: number;
  /** Per event class: min / mean / max across replicates (losses included). */
  counts: Record<'speciation' | 'duplication' | 'transfer' | 'losses', { min: number; mean: number; max: number }>;
  /** True when the event totals vary across resolutions — i.e. the answer is resolution-sensitive. */
  sensitive: boolean;
}

/**
 * Solve a possibly-polytomic gene tree: random binary resolutions × `replicates`,
 * each solved independently; the FIRST finite-cost scenario is returned as the
 * representative (its per-node events are readable), and the count spread across
 * replicates travels with it so the UI can report the resolution sensitivity
 * instead of presenting one arbitrary resolution as the answer.
 */
export function solveDtlWithPolytomies(
  species: Project,
  gene: Project,
  costs: ReconCosts,
  tipOverride?: TipMapping,
  options: DtlOptions = {},
  replicates = 8,
  seed = 20260919,
): DtlSolveResult & { polytomySummary?: PolytomySolveSummary } {
  const hasPolytomy = Object.values(gene.nodes).some((n) => n.childrenIds.length > 2);
  if (!hasPolytomy) {
    const r = solveDtl(species, gene, costs, tipOverride, options);
    return r;
  }
  const perReplicate: { events: Record<string, number>; cost: number }[] = [];
  let representative: DtlScenario | undefined;
  let lastError: string | undefined;
  for (let i = 0; i < Math.max(1, replicates); i += 1) {
    const { doc } = resolvePolytomiesRandom(gene, seed + i * 7919);
    const r = solveDtl(species, doc, costs, tipOverride, options);
    if (!r.scenario) {
      lastError = r.error;
      continue;
    }
    if (!representative) representative = r.scenario;
    const tally: Record<string, number> = { speciation: 0, duplication: 0, transfer: 0, losses: r.scenario.totalLosses };
    for (const ev of Object.values(r.scenario.events)) tally[ev] += 1;
    perReplicate.push({ events: tally, cost: r.scenario.cost });
  }
  if (!representative) return { error: lastError };
  const stats = (key: string): { min: number; mean: number; max: number } => {
    const vals = perReplicate.map((r) => r.events[key] ?? 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, mean, max };
  };
  const counts = {
    speciation: stats('speciation'),
    duplication: stats('duplication'),
    transfer: stats('transfer'),
    losses: stats('losses'),
  };
  const sensitive =
    counts.speciation.min !== counts.speciation.max ||
    counts.duplication.min !== counts.duplication.max ||
    counts.transfer.min !== counts.transfer.max ||
    counts.losses.min !== counts.losses.max;
  const polytomySummary: PolytomySolveSummary = {
    scenario: representative,
    replicates: perReplicate.length,
    counts,
    sensitive,
  };
  return { scenario: representative, polytomySummary };
}

// --- gene-tree reroot -----------------------------------------------------------
// DTL event counts are notoriously sensitive to the gene tree's root position,
// yet the embedded topology used to be frozen: no reroot entry point existed.
// Rerooting PRESERVES every node id (only parent/child links move), so the
// assumption records stay keyed correctly and only need re-validation — the
// same `rerootAtNode` used on the main canvas carries the branch-length/age
// bookkeeping.

export function rerootGeneTree(
  project: Project,
  geneTreeId: string,
  targetGeneNodeId: NodeId,
  fraction = 0.5,
): boolean {
  const g = findGeneTree(project, geneTreeId);
  if (!g) return false;
  return rerootAtNode(g.doc, targetGeneNodeId, fraction);
}

/**
 * Apply a tip→species mapping table (e.g. from a CSV: gene label, species node
 * id or label). Unknown gene labels are ignored and reported by count so a
 * stale table cannot silently narrow the mapping.
 */
export function applyTipMappingTable(
  project: Project,
  geneTreeId: string,
  table: { geneLabel: string; speciesNodeId: NodeId }[],
): { applied: number; unknownGeneLabels: string[]; unknownSpeciesNodes: string[] } {
  const g = findGeneTree(project, geneTreeId);
  if (!g) return { applied: 0, unknownGeneLabels: [], unknownSpeciesNodes: [] };
  const byLabel = new Map<string, NodeId>();
  for (const n of Object.values(g.doc.nodes)) {
    if (n.childrenIds.length === 0 && n.label) byLabel.set(n.label, n.id);
  }
  const appliedSet = new Map<NodeId, NodeId>();
  const unknownGeneLabels: string[] = [];
  const unknownSpeciesNodes: string[] = [];
  for (const row of table) {
    const geneNode = byLabel.get(row.geneLabel);
    if (!geneNode) {
      unknownGeneLabels.push(row.geneLabel);
      continue;
    }
    if (!project.nodes[row.speciesNodeId]) {
      unknownSpeciesNodes.push(row.speciesNodeId);
      continue;
    }
    appliedSet.set(geneNode, row.speciesNodeId);
  }
  for (const [geneNode, speciesNode] of appliedSet) {
    setAssumption(project, geneTreeId, geneNode, {}, speciesNode);
  }
  return {
    applied: appliedSet.size,
    unknownGeneLabels: [...new Set(unknownGeneLabels)],
    unknownSpeciesNodes: [...new Set(unknownSpeciesNodes)],
  };
}
