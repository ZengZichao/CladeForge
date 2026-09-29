// Reconciliation reference logic for gene-tree / species-tree (DTL) editing.
//
// Pure functions only: label-based tip mapping, an LCA-based suggested
// scenario, per-scenario validation issues, and manual-scenario cost totals.
// The functions never mutate inputs — results are fresh objects the panels
// write back through store.apply() recipes (see model/geneTrees.ts).
//
// Loss accounting follows the classic minimal-count convention for the
// (parent-map → child-map) transition: descending d edges inside the species
// tree implies d−1 dropped lineages; a lateral move (neither side contains
// the other) prices both descents through their MRCA. A move UPWARD — the child
// mapped onto an ANCESTOR of its parent's node — is not a loss at all but time
// travel: no number of lost lineages makes it legal, so `minLossesBetween`
// reports it as infeasible (Infinity) and `validateScenario` names the node with
// an `upward-move` error. Charging it 0 and leaving the check to validation
// would let a hand-built scenario send a lineage back into the past for free,
// so the infeasibility is priced here, not deferred.
//
// A loss belongs to the INCOMING BRANCH of the gene node below it — including a
// gene TIP's incoming branch. `suggestLcaScenario`, `dtlScenarioToAssumptions`
// and `scenarioSummary` therefore all use the same set of edges; if the cost
// tally skipped tips, the LCA-suggested and DP-applied scenarios of the very
// same document would be priced differently.

import { tr } from '../ui/strings';
import type {
  GeneNodeAssumption,
  NodeId,
  Project,
  ReconCosts,
  ReconEventType,
  TreeNode,
} from './types';
import { mrcaOf, pathToRoot } from './treeOps';

export interface ReconIssue {
  severity: 'error' | 'warning';
  kind:
    | 'unmatched-tip'
    | 'unresolved'
    | 'dangling'
    | 'event-conflict'
    | 'mislabelled'
    | 'loss-shortfall'
    | 'timing'
    | 'upward-move'
    | 'tip-on-internal'
    | 'leaf-event';
  /** Gene node the issue is about (click-to-focus target in the UI). */
  nodeId?: NodeId;
  message: string;
}

export type TipMapping = Record<NodeId /* gene tip */, NodeId | null /* species tip */>;

/** Species tips indexed by label, with the collisions recorded. */
interface TipIndex {
  exact: Map<string, NodeId>;
  norm: Map<string, NodeId>;
  /** Labels claimed by more than one species tip — never matched automatically. */
  ambiguousExact: Set<string>;
  /** Normalized keys claimed by more than one species tip. */
  ambiguousNorm: Set<string>;
}

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/_/g, ' ');
}

/** Index species tips by exact and normalized label, flagging collisions. */
function tipLabelIndex(project: Project): TipIndex {
  const exact = new Map<string, NodeId>();
  const norm = new Map<string, NodeId>();
  const ambiguousExact = new Set<string>();
  const ambiguousNorm = new Set<string>();
  for (const n of Object.values(project.nodes)) {
    if (!n.label || n.childrenIds.length > 0) continue;
    if (exact.has(n.label)) ambiguousExact.add(n.label);
    else exact.set(n.label, n.id);
    const k = normalizeLabel(n.label);
    if (norm.has(k)) ambiguousNorm.add(k);
    else norm.set(k, n.id);
  }
  return { exact, norm, ambiguousExact, ambiguousNorm };
}

/**
 * Map every gene tip to a species tip by label. Exact match first, then
 * normalized (case / underscore-insensitive).
 *
 * A normalized key that several species tips share is NOT resolved by "first
 * one wins": taxa that differ only in case or an underscore (`sp.` aggregates,
 * abbreviations of congenerics) would be silently paired with the wrong
 * organism and the entire reconciliation would then rest on a false
 * correspondence. Such tips stay unmapped and are listed in
 * `ambiguousLabels` so the panels can ask the user to map them by hand.
 */
export function mapTipsByLabel(
  species: Project,
  gene: Project,
): { mappings: TipMapping; unmatchedLabels: string[]; ambiguousLabels: string[] } {
  const { exact, norm, ambiguousExact, ambiguousNorm } = tipLabelIndex(species);
  const mappings: TipMapping = {};
  const unmatchedLabels: string[] = [];
  const ambiguousLabels: string[] = [];
  for (const n of Object.values(gene.nodes)) {
    if (n.childrenIds.length > 0 || !n.label) continue;
    let direct: NodeId | null = null;
    let ambiguous = false;
    if (exact.has(n.label)) {
      direct = exact.get(n.label) as NodeId;
    } else if (ambiguousExact.has(n.label)) {
      ambiguous = true;
    } else if (norm.has(normalizeLabel(n.label))) {
      direct = norm.get(normalizeLabel(n.label)) as NodeId;
    } else if (ambiguousNorm.has(normalizeLabel(n.label))) {
      ambiguous = true;
    }
    if (ambiguous) {
      direct = null;
      ambiguousLabels.push(n.label);
    }
    mappings[n.id] = direct;
    if (!direct && !ambiguous) unmatchedLabels.push(n.label);
  }
  return { mappings, unmatchedLabels, ambiguousLabels };
}

/** Edge-step distance on the unique species-tree path `from → to`. */
function stepsOnPath(project: Project, from: NodeId, to: NodeId): number {
  const a = mrcaOf(project, from, to);
  if (a === null) return Number.POSITIVE_INFINITY;
  // Index of the MRCA on each upward chain equals that chain's step count.
  const up = pathToRoot(project, from).indexOf(a);
  const down = pathToRoot(project, to).indexOf(a);
  return up + down;
}

/**
 * Minimal number of lost lineages implied by placing a gene node's parent at
 * species node `u` and the node itself at `v`. Canonical conventions: staying
 * put costs 0; moving downward d>0 edges costs d−1 (one dropped copy per
 * un-taken junction); a lateral move costs both descents through the MRCA.
 *
 * MOVING UPWARD (v is a strict ancestor of u) returns `Number.POSITIVE_INFINITY`
 * = infeasible. Such a placement is not a lineage that died, it is a lineage that
 * travelled back in time; charging it 0 and leaving the check to validation would
 * let a manual scenario do it for free, so it is priced as infeasible here and
 * `validateScenario` emits an `upward-move` error for it. Writers that merely price
 * a document skip non-finite counts instead of storing `Infinity` as a loss number.
 */
export function minLossesBetween(project: Project, u: NodeId | null, v: NodeId | null): number {
  if (!u || !v || u === v) return 0;
  const a = mrcaOf(project, u, v);
  if (a === null) return 0;
  if (a === v) return Number.POSITIVE_INFINITY; // upward move: infeasible, not free
  if (a === u) return Math.max(0, stepsOnPath(project, u, v) - 1);
  // Lateral: descend from a to u (dropping siblings) then a to v.
  const left = Math.max(0, stepsOnPath(project, a, u) - 1);
  const right = Math.max(0, stepsOnPath(project, a, v) - 1);
  return left + right;
}

/** True when `v` is a strict ANCESTOR of `u` — a gene lineage mapping back in time. */
export function isUpwardMove(project: Project, u: NodeId | null, v: NodeId | null): boolean {
  if (!u || !v || u === v) return false;
  return mrcaOf(project, u, v) === v;
}

/** Nearest surviving species ancestor-or-self fallback used when remapping. */
export function nearestSurvivingAncestor(project: Project, id: NodeId): NodeId | null {
  if (project.nodes[id]) return id;
  return null;
}

/**
 * Bottom-up LCA suggestion over the gene tree. Internal classification: any
 * child mapped onto the node's own map ⇒ duplication, otherwise speciation.
 * Transfers are never inferred — they stay a manual assertion. Per-node
 * HypothesisMeta already present in `keepMetaFrom` is preserved so applying
 * suggestions does not wipe recorded evidence.
 *
 * Losses are written on the incoming branch of every mapped node that has a
 * parent, INCLUDING tips — the same edge set `scenarioSummary` prices and
 * `dtlScenarioToAssumptions` fills in.
 */
export function suggestLcaScenario(
  species: Project,
  gene: Project,
  tipMappings: TipMapping,
  keepMetaFrom?: Record<NodeId, GeneNodeAssumption>,
): Record<NodeId, GeneNodeAssumption> {
  const mapOf = new Map<NodeId, NodeId | null>();
  const eventOf = new Map<NodeId, ReconEventType>();

  // Iterative post-order over the gene tree (visited-guarded): a deep,
  // caterpillar-shaped gene tree must not overflow the call stack.
  const order: TreeNode[] = [];
  const geneRoot = gene.nodes[gene.rootId];
  if (geneRoot) {
    const seen = new Set<NodeId>([geneRoot.id]);
    const stack: TreeNode[] = [geneRoot];
    while (stack.length) {
      const n = stack.pop() as TreeNode;
      order.push(n);
      for (const cid of n.childrenIds) {
        const c = gene.nodes[cid];
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        stack.push(c);
      }
    }
  }

  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    if (n.childrenIds.length === 0) {
      mapOf.set(n.id, tipMappings[n.id] ?? null);
      continue;
    }
    const childMaps: (NodeId | null)[] = n.childrenIds.map((cid) => mapOf.get(cid) ?? null);
    if (childMaps.some((m) => m === null)) {
      mapOf.set(n.id, null);
      continue;
    }
    const distinct = new Set(childMaps as NodeId[]);
    let m: NodeId | null;
    let ev: ReconEventType;
    if (childMaps.length === 1) {
      // A single child cannot be a speciation: the lineage simply continues.
      m = childMaps[0];
      ev = 'duplication';
    } else if (distinct.size === 1) {
      m = childMaps[0];
      ev = 'duplication';
    } else {
      // Fold pairwise MRCAs from an explicit null seed so every element is
      // actually combined (a non-null initial would short-circuit the fold).
      m = childMaps.reduce<NodeId | null>((acc, cur) => {
        if (acc === null) return cur;
        if (cur === null) return acc;
        return mrcaOf(species, acc, cur);
      }, null);
      if (m === null) {
        mapOf.set(n.id, null);
        continue;
      }
      ev = childMaps.includes(m) ? 'duplication' : 'speciation';
    }
    eventOf.set(n.id, ev);
    mapOf.set(n.id, m);
  }

  const out: Record<NodeId, GeneNodeAssumption> = {};
  for (const [gid, m] of mapOf) {
    if (m === null) continue;
    const n = gene.nodes[gid];
    const base: GeneNodeAssumption = { speciesNode: m };
    if (n.childrenIds.length > 0) base.event = eventOf.get(gid);
    const prevMeta = keepMetaFrom?.[gid]?.meta;
    if (prevMeta) base.meta = { ...prevMeta };
    out[gid] = base;
  }

  // Second pass: attach the minimal implied losses on the incoming branch of
  // every mapped node — tips included (the gene root has no incoming branch).
  // A non-finite count means an infeasible (upward) move: `validateScenario`
  // reports that as an error, so it is never stored as a loss number here.
  for (const gid of Object.keys(out)) {
    const n = gene.nodes[gid];
    if (!n?.parentId) continue;
    const parentMap = mapOf.get(n.parentId);
    if (!parentMap) continue;
    const losses = minLossesBetween(species, parentMap, out[gid].speciesNode);
    if (losses > 0 && Number.isFinite(losses)) out[gid].losses = losses;
  }
  return out;
}

/** Child branch of `s` that strictly contains `v`, or null (equal / outside). */
function containingBranch(project: Project, s: NodeId, v: NodeId): NodeId | null {
  const sNode = project.nodes[s];
  if (!sNode) return null;
  for (const cid of sNode.childrenIds) {
    if (cid === v) return cid;
    const ancSet = pathToRoot(project, v);
    if (ancSet.includes(cid)) return cid;
  }
  return null;
}

function isInSubtree(project: Project, root: NodeId, id: NodeId): boolean {
  return id === root || pathToRoot(project, id).includes(root);
}

/**
 * Counts + total cost of a manual scenario under the given cost vector.
 *
 * Event classes are only meaningful on internal nodes, but LOSSES are counted on
 * every incoming branch — gene tips included. Tallying the losses of internal
 * nodes only would silently discard the tip-branch losses that
 * `suggestLcaScenario` records, so the panel's λ count and `cost` would depend on
 * which writer produced the document.
 */
export function scenarioSummary(
  gene: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
  costs: ReconCosts,
): {
  speciation: number;
  duplication: number;
  transfer: number;
  losses: number;
  /** Losses on internal-node / tip incoming branches (accounting transparency). */
  internalLosses: number;
  tipLosses: number;
  mappedInternal: number;
  totalInternal: number;
  cost: number;
} {
  let speciation = 0;
  let duplication = 0;
  let transfer = 0;
  let internalLosses = 0;
  let tipLosses = 0;
  let mappedInternal = 0;
  let totalInternal = 0;
  for (const n of Object.values(gene.nodes)) {
    const a = assumptions[n.id];
    const isTip = n.childrenIds.length === 0;
    if (!isTip) {
      totalInternal += 1;
      if (a) {
        mappedInternal += 1;
        if (a.event === 'speciation') speciation += 1;
        else if (a.event === 'duplication') duplication += 1;
        else if (a.event === 'transfer') transfer += 1;
      }
    }
    const lost = Math.max(0, a?.losses ?? 0);
    if (isTip) tipLosses += lost;
    else internalLosses += lost;
  }
  const losses = internalLosses + tipLosses;
  const cost =
    speciation * 0 +
    duplication * costs.dup +
    transfer * costs.transfer +
    losses * costs.loss;
  return {
    speciation,
    duplication,
    transfer,
    losses,
    internalLosses,
    tipLosses,
    mappedInternal,
    totalInternal,
    cost,
  };
}

/**
 * Validate a manual scenario against topology + event semantics. Every issue
 * carries the gene node id so the UI can focus it. Never mutates anything.
 */
export function validateScenario(
  species: Project,
  gene: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
  costs: ReconCosts,
): ReconIssue[] {
  const issues: ReconIssue[] = [];
  const { mappings } = mapTipsByLabel(species, gene);

  // Tips that neither matched a label nor carry a manual assumption cannot
  // take part in any reconstruction — reported once, aggregated.
  const unmatchedLabels: string[] = [];
  for (const n of Object.values(gene.nodes)) {
    if (n.childrenIds.length > 0 || !n.label) continue;
    if (!mappings[n.id] && !assumptions[n.id]) unmatchedLabels.push(n.label);
  }
  if (unmatchedLabels.length > 0) {
    const shown = unmatchedLabels.slice(0, 4).join(', ');
    const more = unmatchedLabels.length > 4 ? tr(' 等', ' …') : '';
    issues.push({
      severity: 'error',
      kind: 'unmatched-tip',
      message: tr(
        `${unmatchedLabels.length} 个基因尖端未匹配到物种（${shown}${more}），无法参与重建`,
        `${unmatchedLabels.length} gene tip(s) unmatched (${shown}${more}); excluded from reconstruction`,
      ),
    });
  }

  // Effective per-gene-node species placement: manual assumption, else the
  // label-derived tip mapping for leaves.
  const placeOf = new Map<NodeId, NodeId>();
  for (const n of Object.values(gene.nodes)) {
    const a = assumptions[n.id];
    if (a) {
      placeOf.set(n.id, a.speciesNode);
      continue;
    }
    const tipMapValue = n.childrenIds.length === 0 ? mappings[n.id] : null;
    if (tipMapValue) placeOf.set(n.id, tipMapValue);
  }

  /**
   * Time travel, reported per gene node: a child mapped onto an ANCESTOR of its
   * parent's species node means the lineage existed before the lineage it came
   * from. No loss count makes that legal, so it is an error and the placement is
   * priced as infeasible by `minLossesBetween`.
   */
  const checkUpwardMove = (n: TreeNode, place: NodeId): void => {
    const parentGene = n.parentId ? gene.nodes[n.parentId] : undefined;
    const parentAssumed = parentGene ? placeOf.get(parentGene.id) : undefined;
    if (!parentAssumed) return;
    if (isUpwardMove(species, parentAssumed, place)) {
      issues.push({
        severity: 'error',
        kind: 'upward-move',
        nodeId: n.id,
        message: tr(
          `${n.label || n.id.slice(0, 6)} 映射到了其父节点映射的物种节点的祖先（${
            species.nodes[place]?.label || place.slice(0, 6)
          } 早于 ${species.nodes[parentAssumed]?.label || parentAssumed.slice(0, 6)}）：谱系不能回到过去，该映射不可行`,
          `${n.label || n.id.slice(0, 6)} maps to an ancestor of its parent's species node (${
            species.nodes[place]?.label || place.slice(0, 6)
          } is older than ${species.nodes[parentAssumed]?.label || parentAssumed.slice(0, 6)}): a lineage cannot travel back in time, so this placement is infeasible`,
        ),
      });
    }
  };

  /**
   * Asserted losses below the structural minimum are almost always typos. Runs
   * for tips and unary nodes too: the loss that the parent's placement forces on
   * a tip's incoming branch is part of the priced scenario, so it belongs to the
   * validation rather than bailing out early for tips.
   */
  const checkLossShortfall = (n: TreeNode, place: NodeId): void => {
    const a = assumptions[n.id];
    const parentGene = n.parentId ? gene.nodes[n.parentId] : undefined;
    const parentAssumed = parentGene ? assumptions[parentGene.id] : undefined;
    if (!parentAssumed || !species.nodes[parentAssumed.speciesNode]) return;
    const minLoss = minLossesBetween(species, parentAssumed.speciesNode, place);
    if (!Number.isFinite(minLoss)) return; // infeasible move: `upward-move` already says so
    if ((a?.losses ?? 0) < minLoss) {
      issues.push({
        severity: 'warning',
        kind: 'loss-shortfall',
        nodeId: n.id,
        message: tr(
          `${n.label || n.id.slice(0, 6)} 的损失数低于结构最小值（建议 ≥ ${minLoss}）`,
          `Loss count on ${n.label || n.id.slice(0, 6)} is below the structural minimum (≥ ${minLoss})`,
        ),
      });
    }
  };

  /**
   * A gene TIP asserted on an INTERNAL species node with no loss on its incoming
   * branch claims that a sampled taxon IS the ancestor of another sampled taxon —
   * a placement this model cannot express, so it is called out here rather than
   * left to the event rules: without this check a plain mirror tree could come
   * back priced as "1 duplication" with no hint that a tip had been moved off its
   * own species.
   *
   * The solver writes the SAME shape on purpose (see `dtlScenarioToAssumptions`):
   * a lineage it bought out with a loss is recorded at the species node where it
   * ended, which may be internal. That reading is carried by the loss, so the
   * warning is dropped whenever one is asserted — applied scenarios stay clean.
   */
  const checkTipOnSpeciesNode = (n: TreeNode, place: NodeId): void => {
    const target = species.nodes[place];
    if (!target || target.childrenIds.length === 0) return;
    if ((assumptions[n.id]?.losses ?? 0) > 0) return;
    issues.push({
      severity: 'warning',
      kind: 'tip-on-internal',
      nodeId: n.id,
      message: tr(
        `尖端 ${n.label || n.id.slice(0, 6)} 被指到物种内部节点 ${
          target.label || place.slice(0, 6)
        } 上，而其入枝没有任何损失：这等于宣称一个已采集的分类单元就是另一个的祖先。若该谱系在此终止，请至少记 1 次损失`,
        `Tip ${n.label || n.id.slice(0, 6)} is asserted on the internal species node ${
          target.label || place.slice(0, 6)
        } with no loss on its incoming branch: that claims a sampled taxon is the ancestor of another. Record ≥ 1 loss if the lineage ends here`,
      ),
    });
  };

  for (const n of Object.values(gene.nodes)) {
    const a = assumptions[n.id];

    if (n.childrenIds.length === 0) {
      if (!placeOf.has(n.id)) continue; // covered by the aggregated unmatched error
      if (a?.event) {
        issues.push({
          severity: 'warning',
          kind: 'leaf-event',
          nodeId: n.id,
          message: tr(
            `尖端 ${n.label || n.id.slice(0, 6)} 不应设置事件类型`,
            `Tip ${n.label || n.id.slice(0, 6)} should not carry an event type`,
          ),
        });
      }
      const place = placeOf.get(n.id) as NodeId;
      checkUpwardMove(n, place); // true even for a label-derived mapping under a manual parent
      if (!a) continue; // label-derived mapping only: nothing asserted, nothing short
      checkTipOnSpeciesNode(n, place);
      checkLossShortfall(n, place);
      continue;
    }

    if (!a || !a.event) {
      issues.push({
        severity: 'warning',
        kind: 'unresolved',
        nodeId: n.id,
        message: tr(
          `内部节点 ${n.label || n.id.slice(0, 6)} 尚未解析（缺少映射或事件）`,
          `Internal node ${n.label || n.id.slice(0, 6)} is unresolved (missing mapping or event)`,
        ),
      });
      continue;
    }

    if (!species.nodes[a.speciesNode]) {
      issues.push({
        severity: 'warning',
        kind: 'dangling',
        nodeId: n.id,
        message: tr(
          `${n.label || n.id.slice(0, 6)} 的映射目标在物种树中已不存在`,
          `Mapping target of ${n.label || n.id.slice(0, 6)} no longer exists in the species tree`,
        ),
      });
      continue;
    }

    const s = a.speciesNode;
    checkUpwardMove(n, s);
    checkLossShortfall(n, s);
    const childPlacements = n.childrenIds
      .map((cid) => ({ cid, p: placeOf.get(cid) }))
      .filter((x): x is { cid: NodeId; p: NodeId } => Boolean(x.p));

    if (n.childrenIds.length === 1) continue; // unary chains: nothing to classify
    if (childPlacements.length < n.childrenIds.length) continue; // wait until children resolve

    if (a.event === 'speciation') {
      const branches = childPlacements.map(({ p }) =>
        p === s ? s : containingBranch(species, s, p),
      );
      if (branches.some((b) => b === null)) {
        issues.push({
          severity: 'error',
          kind: 'event-conflict',
          nodeId: n.id,
          message: tr(
            `${n.label || n.id.slice(0, 6)} 标记为物种化，但有子代落在节点 ${species.nodes[s]?.label || s.slice(0, 6)} 子树之外`,
            `${n.label || n.id.slice(0, 6)} marked speciation, but a child maps outside the subtree of ${
              species.nodes[s]?.label || s.slice(0, 6)
            }`,
          ),
        });
      } else if (branches.includes(s)) {
        issues.push({
          severity: 'error',
          kind: 'event-conflict',
          nodeId: n.id,
          message: tr(
            `${n.label || n.id.slice(0, 6)} 标记为物种化，但有子代仍映射到同一节点，应为加倍`,
            `${n.label || n.id.slice(0, 6)} marked speciation with a child on the same node; should be duplication`,
          ),
        });
      } else {
        const seen = new Set<NodeId>();
        let shared: NodeId | null = null;
        for (const b of branches as NodeId[]) {
          if (seen.has(b)) shared = b;
          seen.add(b);
        }
        if (shared !== null) {
          issues.push({
            severity: 'error',
            kind: 'event-conflict',
            nodeId: n.id,
            message: tr(
              `${n.label || n.id.slice(0, 6)} 标记为物种化，但两个子代进入物种节点 ${species.nodes[shared]?.label || shared.slice(0, 6)} 的同一分支`,
              `${n.label || n.id.slice(0, 6)} marked speciation, but two children enter the same branch of ${
                species.nodes[shared]?.label || shared.slice(0, 6)
              }`,
            ),
          });
        }
      }
    } else if (a.event === 'duplication') {
      const coLocated = childPlacements.some(({ p }) => p === s);
      const sharedBranch = (() => {
        const seen = new Set<string>();
        for (const { p } of childPlacements) {
          const b = p === s ? `=${s}` : (containingBranch(species, s, p) ?? '?');
          if (seen.has(b)) return true;
          seen.add(b);
        }
        return false;
      })();
      if (!coLocated && !sharedBranch) {
        issues.push({
          severity: 'warning',
          kind: 'mislabelled',
          nodeId: n.id,
          message: tr(
            `${n.label || n.id.slice(0, 6)} 标记为加倍，但各子代分散在不同分支——更像物种化`,
            `${n.label || n.id.slice(0, 6)} marked duplication while children spread across distinct branches — looks like speciation`,
          ),
        });
      }
    } else if (a.event === 'transfer') {
      const outside = childPlacements.filter(({ p }) => p !== s && !isInSubtree(species, s, p));
      const inside = childPlacements.filter(({ p }) => p === s || isInSubtree(species, s, p));
      if (outside.length === 0 || inside.length === 0) {
        issues.push({
          severity: 'error',
          kind: 'event-conflict',
          nodeId: n.id,
          message: tr(
            `${n.label || n.id.slice(0, 6)} 标记为转移，需要同时存在子树内与子树外的接收/供体子代`,
            `${n.label || n.id.slice(0, 6)} marked transfer; needs both an in-subtree child and an out-of-subtree donor child`,
          ),
        });
      } else {
        // Coarse temporal sanity: a donor must not be strictly younger than
        // the recipient (ages are "before present", larger = older). Skipped
        // silently whenever either side lacks an explicit age.
        const recvAge = species.nodes[s]?.age;
        const donorAge = species.nodes[outside[0].p]?.age;
        if (recvAge !== undefined && donorAge !== undefined && donorAge > recvAge) {
          issues.push({
            severity: 'warning',
            kind: 'timing',
            nodeId: n.id,
            message: tr(
              `${n.label || n.id.slice(0, 6)} 的转移方向与时间轴矛盾：供体晚于接收方`,
              `Transfer on ${n.label || n.id.slice(0, 6)} contradicts the time axis: donor younger than recipient`,
            ),
          });
        }
      }
    }
  }

  return issues;
}

