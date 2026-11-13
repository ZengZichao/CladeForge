// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Effective gene-node placements for the EMBEDDED reconciliation layout
// (docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md §5.1).
//
// This module answers the SEMANTIC questions of the nested view and never
// touches React or geometry:
//   * where does each gene node effectively sit on the species tree
//     (explicit assumption > tip label match > display inference via child MRCA);
//   * which species branch hosts a species node (branch id = the child node id,
//     because the Project has no species edge table);
//   * what path a lineage takes between two species nodes and how many
//     lineages each fork on that path drops (same semantics as
//     `minLossesBetween`, cross-tested against it);
//   * which child donates a horizontal transfer (the established convention:
//     the child placed OUTSIDE the recipient's species subtree).
//
// Display inference is layout-only: an inferred MRCA placeholder never enters
// `entry.assumptions`, never changes `scenarioSummary` and never changes
// `validateScenario` output — it exists so an unannotated internal node (the
// `recon-family` sample's β4) keeps the gene tree CONNECTED instead of dropping
// it into the orphan gutter.

import type { GeneNodeAssumption, NodeId, Project, TreeNode } from './types';
import { mapTipsByLabel } from './reconciliation';
import { mrcaOf, pathToRoot } from './treeOps';

/** Where an effective placement came from. */
export type PlacementSource = 'assumption' | 'tip-label' | 'inferred-mrca';

export interface EffectivePlacement {
  geneNodeId: NodeId;
  speciesNodeId: NodeId;
  source: PlacementSource;
  /** true = display-only inferred position; never written into assumptions. */
  inferred: boolean;
}

export interface EffectivePlacements {
  byGeneNode: Map<NodeId, EffectivePlacement>;
  /** Gene nodes whose placement is a display inference (MRCA placeholder). */
  inferredGeneNodes: NodeId[];
  /** Gene nodes with no placement at all (neither assumed, matched, nor inferable). */
  unmappedGeneNodes: NodeId[];
  /**
   * Gene nodes whose explicit assumption pointed at a species node that no
   * longer exists (or was otherwise unusable). The layout turns these into
   * `dangling-assumption` issues; tips fall back to the label mapping, internal
   * nodes may be display-inferred.
   */
  danglingAssumptions: NodeId[];
}

/**
 * Merge the three placement sources bottom-up over the gene tree:
 *   1. an explicit `assumptions[gid].speciesNode` that still exists wins;
 *   2. a gene TIP falls back to its label match (`mapTipsByLabel`);
 *   3. an internal node with NO usable assumption but ALL children placed is
 *      display-inferred to the children's MRCA.
 *
 * Deterministic: children are visited in `childrenIds` order, ties resolved by
 * node id, so the same input always yields the same placements.
 */
export function resolveEffectiveGenePlacements(
  species: Project,
  gene: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
): EffectivePlacements {
  const { mappings } = mapTipsByLabel(species, gene);
  const byGeneNode = new Map<NodeId, EffectivePlacement>();
  const inferredGeneNodes: NodeId[] = [];
  const unmappedGeneNodes: NodeId[] = [];
  const danglingAssumptions: NodeId[] = [];

  // Iterative post-order over the gene tree (a deep caterpillar must not blow
  // the call stack), visiting children in `childrenIds` order for determinism.
  const root = gene.nodes[gene.rootId];
  const order: TreeNode[] = [];
  if (root) {
    const seen = new Set<NodeId>([root.id]);
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      order.push(n);
      for (let i = n.childrenIds.length - 1; i >= 0; i -= 1) {
        const c = gene.nodes[n.childrenIds[i]];
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        stack.push(c);
      }
    }
  }

  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const a = assumptions[n.id];
    if (a) {
      const target = a.speciesNode;
      if (target && species.nodes[target]) {
        byGeneNode.set(n.id, {
          geneNodeId: n.id,
          speciesNodeId: target,
          source: 'assumption',
          inferred: false,
        });
        continue;
      }
      // Dangling assumption: record it, then fall through to the fallbacks.
      danglingAssumptions.push(n.id);
    }
    if (n.childrenIds.length === 0) {
      const tipTarget = mappings[n.id];
      if (tipTarget) {
        byGeneNode.set(n.id, {
          geneNodeId: n.id,
          speciesNodeId: tipTarget,
          source: 'tip-label',
          inferred: false,
        });
      } else {
        unmappedGeneNodes.push(n.id);
      }
      continue;
    }
    // Internal node without a usable assumption: display-infer to the MRCA of
    // the children ONLY when every child already has a placement.
    const childPlacements: EffectivePlacement[] = [];
    let allPlaced = true;
    for (const cid of n.childrenIds) {
      const cp = byGeneNode.get(cid);
      if (cp) childPlacements.push(cp);
      else allPlaced = false;
    }
    if (allPlaced && childPlacements.length > 0) {
      let m = childPlacements[0].speciesNodeId;
      for (let k = 1; k < childPlacements.length; k += 1) {
        const next = mrcaOf(species, m, childPlacements[k].speciesNodeId);
        if (next === null) {
          m = '';
          break;
        }
        m = next;
      }
      if (m) {
        byGeneNode.set(n.id, {
          geneNodeId: n.id,
          speciesNodeId: m,
          source: 'inferred-mrca',
          inferred: true,
        });
        inferredGeneNodes.push(n.id);
        continue;
      }
    }
    unmappedGeneNodes.push(n.id);
  }

  return { byGeneNode, inferredGeneNodes, unmappedGeneNodes, danglingAssumptions };
}

/**
 * The species branch ENTERING `speciesNodeId`, keyed by the node id itself
 * (the branch id = its child node id — the Project has no species edge table).
 * The species ROOT has no incoming branch and returns null.
 */
export function branchIdOf(species: Project, speciesNodeId: NodeId): NodeId | null {
  return species.nodes[speciesNodeId]?.parentId != null ? speciesNodeId : null;
}

/** How a gene lineage moves between two species nodes. */
export type SpeciesPath =
  | { kind: 'same'; node: NodeId }
  | { kind: 'down'; from: NodeId; to: NodeId; branches: NodeId[] }
  | { kind: 'up'; from: NodeId; to: NodeId; branches: NodeId[] }
  | {
      kind: 'lateral';
      from: NodeId;
      to: NodeId;
      mrca: NodeId;
      upBranches: NodeId[];
      downBranches: NodeId[];
    };

/**
 * Classify the species-tree path from `from` to `to`:
 *  - `same`: identical node (no movement);
 *  - `down`: `to` is strictly inside `from`'s subtree — the normal descent,
 *    `branches` lists the species branches traversed (each keyed by its child
 *    node id), parent end first;
 *  - `up`: `to` is a strict ANCESTOR of `from` — time travel, flagged for the
 *    renderer to draw as an infeasible dashed warning;
 *  - `lateral`: neither contains the other; climb to the MRCA then descend.
 */
export function speciesPathBetween(species: Project, from: NodeId, to: NodeId): SpeciesPath {
  if (from === to) return { kind: 'same', node: from };
  const upChain = pathToRoot(species, from); // [from, parent, …, root]
  const downSet = new Set(upChain);
  if (downSet.has(to)) {
    // `to` is an ancestor of `from`: climbing. Branches visited, child-end
    // first (walking up from `from` each visited node's own incoming branch).
    const branches: NodeId[] = [];
    let cur: NodeId | null = from;
    const seen = new Set<NodeId>();
    while (cur !== null && cur !== to && !seen.has(cur)) {
      seen.add(cur);
      branches.push(cur);
      cur = species.nodes[cur]?.parentId ?? null;
    }
    return { kind: 'up', from, to, branches };
  }
  const upToChain = pathToRoot(species, to);
  const mrca = upToChain.find((id) => downSet.has(id));
  if (mrca === undefined) {
    // Disconnected fragments: degrade to an `up`-style infeasible warning path.
    return { kind: 'up', from, to, branches: [] };
  }
  if (mrca === from) {
    // `to` is strictly below `from`: the descent path, parent end first.
    const branches: NodeId[] = [];
    const chain = pathToRoot(species, to);
    for (let i = chain.indexOf(from) - 1; i >= 0; i -= 1) branches.push(chain[i]);
    return { kind: 'down', from, to, branches };
  }
  const upBranches: NodeId[] = [];
  const seenUp = new Set<NodeId>();
  let cur: NodeId | null = from;
  while (cur !== null && cur !== mrca && !seenUp.has(cur)) {
    seenUp.add(cur);
    upBranches.push(cur);
    cur = species.nodes[cur]?.parentId ?? null;
  }
  const downBranches: NodeId[] = [];
  const downChain = pathToRoot(species, to);
  for (let i = downChain.indexOf(mrca) - 1; i >= 0; i -= 1) downBranches.push(downChain[i]);
  return { kind: 'lateral', from, to, mrca, upBranches, downBranches };
}

/**
 * Losses implied by a species path, located at each fork the lineage passes
 * THROUGH: `childrenIds.length − 1` per junction, exactly `descentLosses`'s
 * semantics (cross-tested against `minLossesBetween`). Keys are species node
 * ids of the forks; for a `down` path the forks are the strict ancestors of
 * `to` below `from` plus `from` itself when it has several children.
 */
export function lossesAlongSpeciesPath(
  species: Project,
  path: SpeciesPath,
): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  const addFork = (fork: NodeId | null) => {
    if (!fork) return;
    const node = species.nodes[fork];
    if (!node) return;
    const losses = Math.max(0, node.childrenIds.length - 1);
    if (losses <= 0) return;
    out.set(fork, (out.get(fork) ?? 0) + losses);
  };
  const walkDown = (from: NodeId, to: NodeId) => {
    // Forks on the descent: every species node strictly between `from` and
    // `to` (both exclusive) — exactly `descentLosses`'s junction set. `from`
    // itself is where the lineage already IS (its sibling branches belong to
    // the sibling gene nodes' own paths) and `to` is where it arrives.
    const chain = pathToRoot(species, to);
    const stop = chain.indexOf(from);
    if (stop < 0) return;
    for (let i = stop - 1; i >= 1; i -= 1) addFork(chain[i]);
  };
  if (path.kind === 'same') return out;
  if (path.kind === 'up') return out; // infeasible: no structural losses drawn
  if (path.kind === 'down') {
    walkDown(path.from, path.to);
    return out;
  }
  // Lateral: drop siblings climbing to the MRCA (the junctions strictly
  // between `from` and the MRCA — `upBranches[0]` is `from` itself) and again
  // descending to `to`.
  for (let i = 1; i < path.upBranches.length; i += 1) addFork(path.upBranches[i]);
  walkDown(path.mrca, path.to);
  return out;
}

export interface TransferDonorInfo {
  /** The gene child whose lineage donates (outside the recipient subtree). */
  donorGeneNodeId: NodeId;
  /** The species node that child maps to (the donor branch's child end). */
  donorSpeciesNodeId: NodeId;
}

/**
 * Resolve the DONOR side of a horizontal transfer on gene node `geneNodeId`,
 * sharing the exact convention `validateScenario` and `geneTreeNhk` use:
 * the donor is a gene child whose effective species placement lies OUTSIDE
 * the recipient subtree (`speciesNode`'s subtree). The stored
 * `assumptions.transferDonor` names a node of the OUTER species tree — that is
 * what `projectIO`'s repair validates it against, what the inspector's hint
 * says, and what `geneTreeNhk` labels — so an explicit value wins when one of
 * the gene children is effectively placed on exactly that species node and the
 * node lies outside the subtree; otherwise auto-derivation applies and the
 * FIRST such child in `childrenIds` order is taken (matching `geneTreeNhk`).
 * Returns null when no child is placeable outside the subtree.
 */
export function resolveTransferDonor(
  species: Project,
  gene: Project,
  geneNodeId: NodeId,
  effective: EffectivePlacements,
  explicitDonorSpeciesNode?: NodeId,
): TransferDonorInfo | null {
  const self = effective.byGeneNode.get(geneNodeId);
  if (!self) return null;
  const node = gene.nodes[geneNodeId];
  if (!node) return null;
  const inside = new Set<NodeId>();
  const stack: NodeId[] = [self.speciesNodeId];
  while (stack.length) {
    const cur = stack.pop() as NodeId;
    if (inside.has(cur)) continue;
    inside.add(cur);
    for (const c of species.nodes[cur]?.childrenIds ?? []) stack.push(c);
  }
  const children = node.childrenIds
    .map((cid) => ({ cid, p: effective.byGeneNode.get(cid) }))
    .filter((x): x is { cid: NodeId; p: EffectivePlacement } => Boolean(x.p));
  // Explicit donor: a species node, matched against the children's placements.
  if (explicitDonorSpeciesNode) {
    const hit = children.find(
      (c) => c.p.speciesNodeId === explicitDonorSpeciesNode && !inside.has(c.p.speciesNodeId),
    );
    if (hit) return { donorGeneNodeId: hit.cid, donorSpeciesNodeId: hit.p.speciesNodeId };
  }
  const first = children.find((c) => !inside.has(c.p.speciesNodeId));
  return first ? { donorGeneNodeId: first.cid, donorSpeciesNodeId: first.p.speciesNodeId } : null;
}
