// Optimal DTL reconciliation via dynamic programming (asymmetric model).
//
// State per (gene node, species node): minimal cost of placing the gene node
// ON that species node. Internal gene nodes consider duplication, speciation
// and transfer events at their mapping; transfers may not receive into own
// subtree or proper ancestors (discrete analogue of temporal feasibility).
// Absence of a lineage under a region costs one loss event — the standard
// convention.
//
// Requires BINARY gene trees (polytomies blow up the lineage bookkeeping;
// users are pointed at resolving them first). Gene nodes with a single child
// ("unary") are tolerated but have an explicit, documented meaning: they are
// never a speciation, so the DP chooses between (a) a duplication whose extra
// copy is lost at the same species node, (b) a plain pass-through into exactly
// one species child, and (c) a relocation out of that subtree. Species trees
// may have any arity: speciation enumerates ordered distinct child pairs, and
// unconstrained branches are not charged speculative losses (their clades
// simply did not carry this gene's ancestry).
//
// COMPARABILITY OF THE ABSOLUTE NUMBERS: this is a minimum-cost
// parsimony reconciliation, not a likelihood, and three deliberate choices make
// its event/loss totals systematically LOWER than RAINIEFF / RaGTeP / Treerecon
// output:
//   * the gene-tree root may be placed on any species node without paying for
//     the arrival of the family there (charge `rootTransferCost` to model it);
//   * lineages that pass a species-node junction without entering one of its
//     sibling branches are not charged per junction the way an explicit
//     "loss set" enumeration would be;
//   * unconstrained species clades are not charged speculative losses at all.
// Losses on a gene TIP's incoming branch ARE counted, so the "LCA suggestion"
// and "apply DP optimum" paths price the same scenario identically.
// Quote the numbers as "events under this model", not as counts comparable with
// another program's output.
//
// Pure module: solve() returns the optimal cost plus a back-traced scenario
// suitable as the starting point for manual refinement.

import { tr } from '../ui/strings';
import type {
  GeneNodeAssumption,
  NodeId,
  Project,
  ReconCosts,
  ReconEventType,
} from './types';
import { mapTipsByLabel, minLossesBetween, type TipMapping } from './reconciliation';

/** One gene node whose event class was not uniquely determined by the costs. */
export interface AmbiguousGeneNode {
  nodeId: NodeId;
  /** Species placement of the gene root / node when the tie was resolved. */
  speciesNode: NodeId;
  /** Every event class achieving the optimum at this node, in `TIE_PRIORITY` order. */
  alternatives: ReconEventType[];
  /** The transfer's receiver/donor roles are interchangeable at equal cost. */
  directionTie?: boolean;
}

export interface DtlScenario {
  /** Optimal scenario cost: Σ events·cost + Σ losses·cost (+ root/origin fees). */
  cost: number;
  /** Event class per resolved internal gene node. */
  events: Record<NodeId, ReconEventType>;
  /** Species-tree placement of every resolved gene node (tips included). */
  placements: Record<NodeId, NodeId>;
  /** Number of individual loss events. */
  totalLosses: number;
  /**
   * Species node where each loss occurred, PLUS the gene node whose incoming
   * lineage it prunes. The gene node is what lets the loss set be written back
   * into a document: without it the converted scenario keeps the DP's cost but
   * loses the events, i.e. it is only a partial trace.
   */
  lossMarks: { at: NodeId; geneNode: NodeId }[];
  /**
   * Root/origin fees included in `cost` that a manual-assumption document cannot
   * express (there is no "the family arrived here" field on a gene node). The
   * applied-vs-optimal invariant is therefore stated against `cost - rootFees`.
   */
  rootFees: number;
  /**
   * Gene nodes where another event class costs exactly the same: the classic
   * duplication/speciation non-identifiability (and the mirror-image transfer
   * direction). `events` reports ONE of them under the documented priority
   * duplication > speciation > transfer, but the alternatives are recorded so
   * the UI can say "k equally optimal scenarios exist".
   */
  ambiguous: AmbiguousGeneNode[];
  /** True when the gene root was allowed to float below the species root. */
  freeRoot: boolean;
  /** Species node carrying the gene root. */
  rootSpeciesNode: NodeId;
}

/** Optional explicit pricing of the events the plain model leaves free. */
export interface DtlOptions {
  /**
   * Charged once for the existence of the gene family (a "gene origin" event).
   * Default 0 = not charged, matching the parsimony convention of the solver.
   */
  originCost?: number;
  /**
   * Charged when the optimum places the gene root somewhere other than the
   * species root — the ancestral lineage arriving from a part of the species
   * tree that is not represented (implicit transfer / unsampled relative).
   * Default 0 charges nothing, leaving the root free to place anywhere, which is
   * the plain parsimony convention.
   */
  rootTransferCost?: number;
}

export interface DtlSolveResult {
  scenario?: DtlScenario;
  error?: string;
  /** Labels that collide after normalization and were therefore left unmapped. */
  ambiguousLabels?: string[];
}

const INF = Number.POSITIVE_INFINITY;

/** One DP cell with just enough backtrace info to replay the decision. */
interface Cell {
  cost: number;
  kind: 'dup' | 'sigma' | 'transfer' | 'leaf' | 'none';
  /** sigma: chosen ordered pair indices into species.childrenIds. */
  argI?: number;
  argJ?: number;
  /** sigma / transfer: gene children roles were swapped relative to ids order. */
  flip?: boolean;
  /** Event classes that achieve exactly this cost (length > 1 ⇒ a tie). */
  ties?: ReconEventType[];
  /** Receiver and donor children are interchangeable at equal cost. */
  directionTie?: boolean;
}

const NONE_CELL: Cell = { cost: INF, kind: 'none' };

/** Event class a cell kind reports, or null for the non-event kinds. */
const KIND_EVENT: Record<Cell['kind'], ReconEventType | null> = {
  dup: 'duplication',
  sigma: 'speciation',
  transfer: 'transfer',
  leaf: null,
  none: null,
};

/** Priority used when several event classes tie (documented, not evidence). */
const TIE_PRIORITY: ReconEventType[] = ['duplication', 'speciation', 'transfer'];

/** Union of `alts` and `ev`, kept in `TIE_PRIORITY` order. */
function withAlt(alts: ReconEventType[], ev: ReconEventType): ReconEventType[] {
  return TIE_PRIORITY.filter((e) => e === ev || alts.includes(e));
}

export function solveDtl(
  species: Project,
  gene: Project,
  costs: ReconCosts,
  tipOverride?: TipMapping,
  options: DtlOptions = {},
): DtlSolveResult {
  const auto = tipOverride
    ? { mappings: tipOverride, unmatchedLabels: [] as string[], ambiguousLabels: [] as string[] }
    : mapTipsByLabel(species, gene);
  const tipMap = auto.mappings;
  const ambiguousLabels = auto.ambiguousLabels;
  const originCost = Number.isFinite(options.originCost) ? Math.max(0, options.originCost as number) : 0;
  const rootTransferCost = Number.isFinite(options.rootTransferCost)
    ? Math.max(0, options.rootTransferCost as number)
    : 0;

  // --- structural guards -----------------------------------------------------
  if (!species.nodes[species.rootId]) {
    return { error: tr('物种树缺少有效根节点', 'The species tree has no valid root node') };
  }
  if (!gene.nodes[gene.rootId]) {
    return { error: tr('基因树缺少有效根节点', 'The gene tree has no valid root node') };
  }
  const polytomies = Object.values(gene.nodes).filter((n) => n.childrenIds.length > 2);
  if (polytomies.length > 0) {
    return {
      error: tr(
        `基因树存在 ${polytomies.length} 处多歧分支；动态规划需要二叉基因树，请先解析多歧枝`,
        `The gene tree has ${polytomies.length} polytomy/polymoties; resolve them before running the solver`,
      ),
    };
  }
  const unmappedTips = Object.values(gene.nodes).filter(
    (n) => n.childrenIds.length === 0 && !tipMap[n.id],
  );
  if (unmappedTips.length > 0) {
    const ambiguousNote =
      ambiguousLabels.length > 0
        ? tr(
            `（其中 ${ambiguousLabels.length} 个因物种树中标签冲突而无法自动匹配，请手工映射）`,
            ` (${ambiguousLabels.length} of them collide with several species labels and need a manual mapping)`,
          )
        : '';
    return {
      error: tr(
        `${unmappedTips.length} 个基因尖端无法映射到物种树（如 ${unmappedTips
          .slice(0, 3)
          .map((n) => n.label || n.id.slice(0, 5))
          .join(', ')}）${ambiguousNote}，无法求解`,
        `${unmappedTips.length} gene tip(s) cannot be mapped (e.g. ${unmappedTips
          .slice(0, 3)
          .map((n) => n.label || n.id.slice(0, 5))
          .join(', ')})${ambiguousNote}`,
      ),
      ambiguousLabels,
    };
  }
  const danglingTargets = Object.values(gene.nodes).filter(
    (n) => n.childrenIds.length === 0 && tipMap[n.id] && !species.nodes[tipMap[n.id] as NodeId],
  );
  if (danglingTargets.length > 0) {
    return {
      error: tr(
        `${danglingTargets.length} 个基因尖端映射到物种树中已不存在的节点，请重新映射`,
        `${danglingTargets.length} gene tip(s) map to species nodes that no longer exist; re-map them`,
      ),
    };
  }

  // --- species-tree indices ----------------------------------------------------
  // Only nodes reachable from the species root take part in the DP. The rest are
  // reported as a structural error rather than left to produce `undefined`
  // lookups that throw a raw `TypeError` far away from the cause.
  const spIds: NodeId[] = [];
  const childrenOf = new Map<NodeId, NodeId[]>();
  {
    const seenSpecies = new Set<NodeId>([species.rootId]);
    const walk: NodeId[] = [species.rootId];
    while (walk.length) {
      const id = walk.pop() as NodeId;
      spIds.push(id);
      const kids = (species.nodes[id].childrenIds ?? []).filter((c) => {
        if (!species.nodes[c] || seenSpecies.has(c)) return false;
        seenSpecies.add(c);
        return true;
      });
      childrenOf.set(id, kids);
      walk.push(...kids);
    }
    const unreachable = Object.keys(species.nodes).length - seenSpecies.size;
    if (unreachable > 0) {
      return {
        error: tr(
          `物种树有 ${unreachable} 个无法从根到达的节点，请先修复树结构`,
          `The species tree has ${unreachable} node(s) unreachable from the root; repair its structure first`,
        ),
      };
    }
  }

  // DFS pre-order intervals: `z ∈ subtree(s)` and "`z` is an ancestor-or-self of
  // `s`" become O(1) numeric tests, avoiding the per-node copies of every
  // ancestor chain (O(n²) time and memory).
  const inTime = new Map<NodeId, number>();
  const outTime = new Map<NodeId, number>();
  {
    let clock = 0;
    for (const id of spIds) {
      inTime.set(id, clock);
      clock += 1;
    }
    // spIds is a pre-order list, so walking it backwards visits children first.
    for (let i = spIds.length - 1; i >= 0; i -= 1) {
      const id = spIds[i];
      let last = inTime.get(id) as number;
      for (const c of childrenOf.get(id) ?? []) last = Math.max(last, outTime.get(c) ?? last);
      outTime.set(id, last);
    }
  }
  /** Is `z` inside (or equal to) the subtree of `s`? */
  const inSubtree = (s: NodeId, z: NodeId): boolean =>
    (inTime.get(s) ?? INF) <= (inTime.get(z) ?? -INF) && (inTime.get(z) ?? INF) <= (outTime.get(s) ?? -INF);
  /** Is `z` an ancestor-or-self of `s`? */
  const isAncestorOf = (z: NodeId, s: NodeId): boolean =>
    (inTime.get(z) ?? INF) <= (inTime.get(s) ?? -INF) && (inTime.get(s) ?? INF) <= (outTime.get(z) ?? -INF);
  /** A transfer may not land inside subtree(s) ∪ ancestors(s) of its own node. */
  const forbiddenFor = (s: NodeId, z: NodeId): boolean => inSubtree(s, z) || isAncestorOf(z, s);

  const kidsOf = new Map<NodeId, NodeId[]>();
  for (const n of Object.values(gene.nodes)) kidsOf.set(n.id, n.childrenIds);

  // --- DP tables ----------------------------------------------------------------
  const M = new Map<string, Cell>();
  const Down = new Map<string, number>(); // min M over nodes inside subtree(s)
  const Out = new Map<string, number>(); // min M outside subtree(s) ∪ ancestors(s)
  /** Per gene node: species placements ordered by their exact-placement cost. */
  const ranked = new Map<NodeId, { z: NodeId; cost: number }[]>();

  const key = (g: NodeId, s: NodeId) => `${g}|${s}`;

  /** Cheapest fate for a child lineage entering region s: present below it, or lost. */
  const childOpt = (g: NodeId, region: NodeId): number =>
    Math.min(downOf(g, region), costs.loss);

  /**
   * Cells of gene node `g` ordered by cost. Scanning this from the front and
   * skipping forbidden regions avoids a per-query sweep over EVERY species
   * node — O(|G|·|S|²) for the whole DP, unusable at a thousand tips — giving a
   * memoised lookup that is O(1) in the common case.
   */
  function rankedCells(g: NodeId): { z: NodeId; cost: number }[] {
    let list = ranked.get(g);
    if (!list) {
      list = spIds
        .map((z) => ({ z, cost: cellFor(g, z).cost }))
        .sort((a, b) => a.cost - b.cost || a.z.localeCompare(b.z));
      ranked.set(g, list);
    }
    return list;
  }

  /**
   * Recursion guard. `downOf` walks the species tree with an
   * explicit stack and `trace`/`descArgmin` are iterative, so species depth does
   * not contribute to the JavaScript call stack at all. What remains is the
   * cell recursion through NESTED GENE LEVELS (a cell of gene node g needs the
   * child lineage optima of g's children, and so on down to the tips), which a
   * pathologically unbalanced gene tree could still make too deep. Rather than
   * die with an uncatchable `RangeError` in the middle of a solve, the chain is
   * counted and the solve refused with a readable message.
   */
  const MAX_CELL_DEPTH = 400;
  let cellDepth = 0;
  let depthExceeded = false;

  function cellFor(g: NodeId, s: NodeId): Cell {
    const k = key(g, s);
    const cached = M.get(k);
    if (cached) return cached;
    if (cellDepth >= MAX_CELL_DEPTH) {
      depthExceeded = true;
      return NONE_CELL;
    }
    cellDepth += 1;
    try {
      return computeCell(g, s, k);
    } finally {
      cellDepth -= 1;
    }
  }

  function computeCell(g: NodeId, s: NodeId, k: string): Cell {

    // A fresh object: `cell` is mutated with its tie set below, so it must never
    // alias a shared constant.
    let cell: Cell = { cost: INF, kind: 'none' };
    /** Event classes achieving `cell.cost` — kept so ties are visible. */
    let alts: ReconEventType[] = [];
    /** Both transfer directions optimal (receiver/donor interchangeable). */
    let directionTie = false;
    const kids = kidsOf.get(g) ?? [];

    if (kids.length === 0) {
      cell = tipMap[g] === s ? { cost: 0, kind: 'leaf' } : { cost: INF, kind: 'none' };
      M.set(k, cell);
      return cell;
    }
    const unary = kids.length === 1;

    // 1) Duplication: coexistence at s, each lineage proceeds below-or-lost.
    const dupCost =
      costs.dup + childOpt(kids[0], s) + (unary ? costs.loss : childOpt(kids[1], s));
    cell = { cost: dupCost, kind: 'dup' };
    alts = Number.isFinite(dupCost) ? ['duplication'] : [];

    // 2) Speciation: lineages diverge into distinct species-children of s.
    const spKids = childrenOf.get(s) ?? [];
    if (spKids.length >= 2 && !unary) {
      let best = INF;
      let bi = -1;
      let bj = -1;
      let flip = false;
      for (let i = 0; i < spKids.length; i += 1) {
        for (let j = 0; j < spKids.length; j += 1) {
          if (i === j) continue;
          const vStraight = childOpt(kids[0], spKids[i]) + childOpt(kids[1], spKids[j]);
          const vFlipped = childOpt(kids[1], spKids[i]) + childOpt(kids[0], spKids[j]);
          if (vStraight < best) {
            best = vStraight;
            bi = i;
            bj = j;
            flip = false;
          }
          if (vFlipped < best) {
            best = vFlipped;
            bi = i;
            bj = j;
            flip = true;
          }
        }
      }
      if (best < cell.cost) {
        cell = { cost: best, kind: 'sigma', argI: bi, argJ: bj, flip };
        alts = ['speciation'];
      } else if (best === cell.cost) {
        // Duplication and speciation cost the same — the textbook
        // non-identifiability. The reported class follows the documented
        // priority, and the tie is recorded instead of silently resolved.
        alts = withAlt(alts, 'speciation');
      }
    } else if (spKids.length >= 1 && unary) {
      // Unary pass-through: the lineage continues into exactly one branch.
      let best = INF;
      let bi = -1;
      for (let i = 0; i < spKids.length; i += 1) {
        const v = childOpt(kids[0], spKids[i]);
        if (v < best) {
          best = v;
          bi = i;
        }
      }
      if (best < cell.cost) {
        cell = { cost: best, kind: 'sigma', argI: bi };
        alts = ['speciation'];
      } else if (best === cell.cost) {
        alts = withAlt(alts, 'speciation');
      }
    }

    // 3) Transfer: one lineage stays with s, the other arrives from beyond
    //    subtree(s)∪ancestors(s). Unary form = plain relocation outward.
    const jumpCost = (leave: NodeId): number => {
      const outMin = outOf(leave, s);
      return outMin === INF ? INF : costs.transfer + outMin;
    };
    const acceptTransfer = (v: number, flip: boolean): void => {
      if (v < cell.cost) {
        cell = { cost: v, kind: 'transfer', flip };
        alts = ['transfer'];
        return;
      }
      if (v === cell.cost && Number.isFinite(v)) alts = withAlt(alts, 'transfer');
    };
    if (unary) {
      acceptTransfer(jumpCost(kids[0]), false);
    } else {
      const vAB = costs.transfer + childOpt(kids[0], s) + outOf(kids[1], s);
      const vBA = costs.transfer + childOpt(kids[1], s) + outOf(kids[0], s);
      acceptTransfer(vAB, false);
      acceptTransfer(vBA, true);
      // Receiver/donor exchanged at identical cost: which gene child is the
      // immigrant cannot be told from the costs alone.
      directionTie = vAB === vBA && Number.isFinite(vAB) && cell.kind === 'transfer';
    }

    cell.ties = alts;
    cell.directionTie = directionTie;
    M.set(k, cell);
    return cell;
  }

  /**
   * min M(g, x) over the subtree of species node `s`. Iterative on purpose: a
   * recursive form would overflow the stack on deep / pectinate SPECIES trees
   * — precisely the shape fossil-calibrated trees tend to have.
   */
  function downOf(g: NodeId, s: NodeId): number {
    const k = key(g, s);
    if (Down.has(k)) return Down.get(k) as number;
    // Collect the unresolved part of subtree(s) in pre-order. A node that
    // already has a Down entry carries its whole subtree's answer, so it is
    // neither expanded nor recomputed.
    const fresh: NodeId[] = [];
    const exact = new Map<NodeId, number>();
    const walk: NodeId[] = [s];
    while (walk.length) {
      const x = walk.pop() as NodeId;
      if (Down.has(key(g, x))) continue;
      exact.set(x, cellFor(g, x).cost);
      fresh.push(x);
      for (const c of childrenOf.get(x) ?? []) walk.push(c);
    }
    // Pre-order reversed ⇒ children before parents, so the sweep fills in the
    // same minima a recursive descent would.
    for (let i = fresh.length - 1; i >= 0; i -= 1) {
      const x = fresh[i];
      let best = exact.get(x) as number;
      for (const c of childrenOf.get(x) ?? []) {
        const v = Down.get(key(g, c));
        if (v !== undefined && v < best) best = v;
      }
      Down.set(key(g, x), best);
    }
    return Down.get(k) as number;
  }

  function outOf(g: NodeId, s: NodeId): number {
    const k = key(g, s);
    const cached = Out.get(k);
    if (cached !== undefined) return cached;
    // Cheapest placement outside subtree(s) ∪ ancestors(s): scan the cost-sorted
    // cell list and stop at the first allowed species node.
    let best = INF;
    for (const { z, cost } of rankedCells(g)) {
      if (forbiddenFor(s, z)) continue;
      best = cost;
      break;
    }
    Out.set(k, best);
    return best;
  }

  const rootCell = cellFor(gene.rootId, species.rootId);
  const rootDown = downOf(gene.rootId, species.rootId);
  if (depthExceeded) {
    return {
      error: tr(
        `基因树嵌套过深（超过 ${MAX_CELL_DEPTH} 层），动态规划已中止以避免栈溢出；请先分解该基因家族或解析多歧枝`,
        `The gene tree nests deeper than ${MAX_CELL_DEPTH} levels; the dynamic program was stopped instead of overflowing the stack. Split the family or resolve the topology first`,
      ),
    };
  }
  const freeRoot = rootDown < rootCell.cost;
  // A free-floating root pays `rootTransferCost` (default 0) because the model
  // otherwise gets the arrival of the whole family at that depth for nothing,
  // which is what makes the absolute totals incomparable with standard DTL
  // implementations. `originCost` prices the family origin.
  const optimal =
    (freeRoot ? rootDown + rootTransferCost : rootCell.cost) + originCost;
  if (!Number.isFinite(optimal)) {
    return { error: tr('无可行协同重建方案', 'No feasible reconciliation exists') };
  }

  // Deepest-free starting placement when the root itself need not sit at the
  // species root: walk down to the argmin mapping (iterative; the ties are
  // broken by species pre-order so the result never depends on object key
  // insertion order).
  const descArgmin = (g: NodeId, region: NodeId): NodeId => {
    let bestS = region;
    let bestV = cellFor(g, region).cost;
    const walk: NodeId[] = [region];
    while (walk.length) {
      const x = walk.pop() as NodeId;
      for (const c of childrenOf.get(x) ?? []) {
        const v = cellFor(g, c).cost;
        if (v < bestV) {
          bestV = v;
          bestS = c;
        }
        walk.push(c);
      }
    }
    return bestS;
  };

  const startS = freeRoot ? descArgmin(gene.rootId, species.rootId) : species.rootId;

  const scenario: DtlScenario = {
    cost: optimal,
    events: {},
    placements: {},
    totalLosses: 0,
    lossMarks: [],
    ambiguous: [],
    freeRoot,
    rootFees: (freeRoot ? rootTransferCost : 0) + originCost,
    rootSpeciesNode: startS,
  };

  /**
   * Realise the optimal cells into a concrete scenario.
   *
   * Two properties this walk guarantees:
   *  * it is ITERATIVE (explicit stack), so a deep gene tree cannot overflow;
   *  * every gene node is accounted for — it either gets a placement or a loss
   *    mark naming ITSELF. Returning early when a region holds no placement
   *    (`direct === INF`) would leave the subtree below it unreached, so the
   *    converted document could hold a fraction of the gene nodes while the DP had
   *    already charged losses for the rest; `scenarioSummary` would then price a
   *    nearly empty document and the "current" cost would come out BELOW the
   *    reported optimum.
   */
  type TraceTask =
    | { t: 'place'; g: NodeId; s: NodeId }
    | { t: 'lineage'; g: NodeId; region: NodeId }
    | { t: 'loss'; g: NodeId; at: NodeId };

  const registerLoss = (g: NodeId, at: NodeId): void => {
    scenario.totalLosses += 1;
    scenario.lossMarks.push({ at, geneNode: g });
  };

  const walk: TraceTask[] = [{ t: 'place', g: gene.rootId, s: startS }];
  while (walk.length) {
    const task = walk.pop() as TraceTask;
    // LIFO, so continuations are pushed in reverse document order, preserving the
    // pre-order a recursive tracer would produce.
    if (task.t === 'loss') {
      registerLoss(task.g, task.at);
      continue;
    }
    if (task.t === 'lineage') {
      const direct = downOf(task.g, task.region);
      // `direct === INF` (no placement anywhere below the entry point) and
      // "pricier than one loss" both mean the DP bought this lineage's absence
      // with a single loss: register it instead of dropping the subtree.
      if (direct > costs.loss) registerLoss(task.g, task.region);
      else walk.push({ t: 'place', g: task.g, s: descArgmin(task.g, task.region) });
      continue;
    }

    const { g, s } = task;
    const cell = cellFor(g, s);
    const kids = kidsOf.get(g) ?? [];
    scenario.placements[g] = s;
    if (cell.kind === 'leaf') continue;

    // Ties at the placement actually taken: record every equally optimal event
    // class so the UI can say "k equally optimal scenarios exist" instead of
    // presenting the priority-ordered pick as the only answer.
    const reported = KIND_EVENT[cell.kind];
    const alts = cell.ties ?? [];
    if ((reported && alts.length > 1) || cell.directionTie) {
      scenario.ambiguous.push({
        nodeId: g,
        speciesNode: s,
        alternatives: alts.length > 0 ? alts : reported ? [reported] : [],
        directionTie: cell.directionTie,
      });
    }

    const first = cell.flip && kids.length === 2 ? kids[1] : kids[0];
    const second = cell.flip && kids.length === 2 ? kids[0] : kids[1];

    if (cell.kind === 'dup') {
      scenario.events[g] = 'duplication';
      if (kids.length === 1) {
        // Unary duplication keeps one continuation; the surplus copy of THIS
        // node's lineage dies at s, so that loss rides on g's incoming branch.
        walk.push({ t: 'lineage', g: kids[0], region: s }, { t: 'loss', g, at: s });
      } else {
        walk.push({ t: 'lineage', g: kids[1], region: s }, { t: 'lineage', g: first, region: s });
      }
      continue;
    }

    if (cell.kind === 'sigma') {
      scenario.events[g] = 'speciation';
      const spKids = childrenOf.get(s) ?? [];
      const ci = spKids[cell.argI ?? -1];
      const cj = spKids[cell.argJ ?? -1];
      if (!ci) {
        // No usable branch (dirty data): record the lineages that cannot proceed
        // as losses, rather than letting them vanish from the document.
        walk.push({ t: 'loss', g: second ?? g, at: s }, { t: 'loss', g: first, at: s });
        continue;
      }
      if (kids.length === 1) {
        walk.push({ t: 'lineage', g: first, region: ci });
        continue;
      }
      // `first` is pushed last so it is popped (and therefore processed) first.
      if (cj) walk.push({ t: 'lineage', g: second, region: cj });
      else walk.push({ t: 'loss', g: second, at: s });
      walk.push({ t: 'lineage', g: first, region: ci });
      continue;
    }

    // transfer
    scenario.events[g] = 'transfer';
    const stayKid = kids.length === 1 ? null : first;
    const leaveKid = kids.length === 1 ? kids[0] : second;
    // Cheapest donor placement outside subtree(s) ∪ ancestors(s) — same
    // cost-ordered lookup as `outOf`, so the two cannot disagree.
    let donorZ: NodeId | null = null;
    for (const { z } of rankedCells(leaveKid)) {
      if (forbiddenFor(s, z)) continue;
      donorZ = z;
      break;
    }
    if (donorZ) walk.push({ t: 'place', g: leaveKid, s: donorZ });
    // A relocation with nowhere to land must still be written down: one loss at
    // the entry point, naming the lineage that never arrived.
    else walk.push({ t: 'loss', g: leaveKid, at: s });
    if (stayKid) walk.push({ t: 'lineage', g: stayKid, region: s });
  }

  if (depthExceeded) {
    return {
      error: tr(
        `基因树嵌套过深（超过 ${MAX_CELL_DEPTH} 层），动态规划已中止以避免栈溢出；请先分解该基因家族或解析多歧枝`,
        `The gene tree nests deeper than ${MAX_CELL_DEPTH} levels; the dynamic program was stopped instead of overflowing the stack. Split the family or resolve the topology first`,
      ),
    };
  }
  return { scenario, ambiguousLabels: ambiguousLabels.length > 0 ? ambiguousLabels : undefined };
}

export function dtlTipMap(species: Project, gene: Project): TipMapping {
  return mapTipsByLabel(species, gene).mappings;
}

/**
 * Convert a solved scenario into the manual-assumption shape so it can be
 * applied through store.apply() and refined by hand.
 *
 * Losses are attributed to the incoming branch of EVERY mapped gene node that
 * has a parent — gene TIPS included. Skipping tips here or in the cost tally,
 * while `suggestLcaScenario` writes tip losses, would make the two ways of
 * populating a document price the same scenario differently and leave the losses
 * a lineage really must have suffered on its way to a terminal species node
 * counted nowhere.
 *
 * THE DP'S OWN LOSS SET IS WRITTEN TOO. Each `scenario.lossMarks` entry names the
 * gene node whose lineage was bought out, so a lineage the solver declared absent
 * is recorded in the document as one loss on that node's incoming branch — and a
 * node that was never placed is written down at the species node where its
 * lineage ended, event-free. Together with the trace's rule that every gene node
 * is placed or explicitly lost, the converted document is never a partial
 * scenario whose recomputed cost sits BELOW the optimum the solver just reported.
 *
 * The invariant the tests pin:
 *   scenarioSummary(gene, these, costs).cost >= scenario.cost - scenario.rootFees
 * with equality whenever the DP never had to pass a species-node junction on the
 * way down. `>=` is the honest direction: the DP prices an absences region-wise
 * (a lineage that skips junctions is not charged for them — see the module
 * header), the applied tally prices the same document edge-wise via
 * `minLossesBetween`, which charges one loss per un-taken junction. The two
 * root/origin fees cannot be expressed on a gene node at all, hence `rootFees`.
 */
export function dtlScenarioToAssumptions(
  species: Project,
  gene: Project,
  scenario: DtlScenario,
): Record<NodeId, GeneNodeAssumption> {
  const out: Record<NodeId, GeneNodeAssumption> = {};
  /** Explicit DP losses per gene node: how many, and where the lineage ended. */
  const marks = new Map<NodeId, { count: number; at: NodeId }>();
  for (const m of scenario.lossMarks ?? []) {
    if (!m || !m.geneNode || !m.at) continue;
    const hit = marks.get(m.geneNode);
    if (hit) hit.count += 1;
    else marks.set(m.geneNode, { count: 1, at: m.at });
  }
  for (const n of Object.values(gene.nodes)) {
    const place = scenario.placements[n.id];
    if (place && species.nodes[place]) {
      const a: GeneNodeAssumption = { speciesNode: place };
      const ev = scenario.events[n.id];
      // Only internal nodes carry an event, and only when the solver resolved one:
      // writing `event: undefined` explicitly would make the row indistinguishable
      // from "never set" after a JSON round-trip.
      if (ev && n.childrenIds.length > 0) a.event = ev;
      out[n.id] = a;
      continue;
    }
    const lost = marks.get(n.id);
    if (lost && species.nodes[lost.at]) {
      // An extinct lineage: recorded at the species node where it entered and
      // died, with no event (validation reports it as merely "unresolved").
      out[n.id] = { speciesNode: lost.at };
    }
  }
  // Canonical per-edge loss minimums — on tip branches too — plus the DP's own
  // loss set. The gene ROOT can carry a mark as well (a unary duplication's
  // surplus copy dies on the branch entering it), so the root is not skipped.
  for (const n of Object.values(gene.nodes)) {
    const self = out[n.id];
    if (!self) continue;
    const parentPlace = n.parentId ? out[n.parentId]?.speciesNode : undefined;
    const edge = parentPlace
      ? minLossesBetween(species, parentPlace, self.speciesNode)
      : 0;
    const total = (Number.isFinite(edge) ? edge : 0) + (marks.get(n.id)?.count ?? 0);
    if (total > 0) self.losses = total;
  }
  return out;
}
