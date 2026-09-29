import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren, renameNode } from './treeOps';
import type { NodeId, Project } from './types';
import type { GeneNodeAssumption } from './types';
import { mapTipsByLabel, minLossesBetween, scenarioSummary, validateScenario } from './reconciliation';
import { solveDtl, dtlScenarioToAssumptions } from './dtl';

/** Build a rooted tree from a "(X,Y)L" spec; bare labels rename THIS node. */
function makeTree(
  p: Project,
  parentId: NodeId,
  spec: string,
  ids: Map<string, NodeId> = new Map(),
): Map<string, NodeId> {
  const m = /^\((.*)\)([^()]*)$/.exec(spec);
  if (!m) {
    renameNode(p, parentId, spec);
    ids.set(spec, parentId);
    return ids;
  }
  const [, inner] = m;
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const kidIds = addChildren(p, parentId, parts.length);
  parts.forEach((part, i) => makeTree(p, kidIds[i], part, ids));
  return ids;
}

/**
 * A `k`-tip pectinate ("caterpillar") tree, built ITERATIVELY so the test helper
 * itself survives species depths the solver must handle. Tip `i` is
 * labelled `t((i + off) % mod)`, so a deep gene tree can be expressed over a
 * small species label set.
 */
function makePectinate(k: number, mod = k, off = 0): Project {
  const p = createEmptyProject();
  let cur = p.rootId;
  for (let i = 0; i < k - 1; i += 1) {
    const [a, b] = addChildren(p, cur, 2);
    renameNode(p, a, `t${(i + off) % mod}`);
    cur = b;
  }
  renameNode(p, cur, `t${(k - 1 + off) % mod}`);
  return p;
}

/** Deterministic LCG so every "random" instance is replayable. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Random balanced-ish Newick spec over the given tip labels. */
function randomSpec(labels: string[], rnd: () => number): string {
  if (labels.length === 1) return labels[0];
  const a = [...labels];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const c = 1 + Math.floor(rnd() * (a.length - 1));
  return `(${randomSpec(a.slice(0, c), rnd)},${randomSpec(a.slice(c), rnd)})`;
}

const NO_TRANSFER = { dup: 1, transfer: 999, loss: 1 };

function depthOfGene(gene: Project, id: NodeId): number {
  let d = 0;
  let cur: NodeId | null = id;
  while (cur && gene.nodes[cur].parentId !== null) {
    cur = gene.nodes[cur].parentId;
    d += 1;
  }
  return d;
}

function subtreeNodes(species: Project, root: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [root];
  while (stack.length) {
    const x = stack.pop() as NodeId;
    out.push(x);
    stack.push(...species.nodes[x].childrenIds);
  }
  return out;
}

function withinSubtree(species: Project, anc: NodeId, id: NodeId): boolean {
  return subtreeNodes(species, anc).includes(id);
}

/** Ancestor-or-self closure of `ids` — which species branches "need" explaining. */
function ancestorsOrSelf(species: Project, ids: NodeId[]): Set<NodeId> {
  const out = new Set<NodeId>();
  for (const id of ids) {
    let cur: NodeId | null = id;
    while (cur) {
      out.add(cur);
      cur = species.nodes[cur]?.parentId ?? null;
    }
  }
  return out;
}

/** Every gene tip below each internal gene node. */
function geneTipsUnder(gene: Project, internals: NodeId[]): Map<NodeId, NodeId[]> {
  const out = new Map<NodeId, NodeId[]>();
  for (const gid of internals) {
    const acc: NodeId[] = [];
    const stack = [gid];
    while (stack.length) {
      const x = stack.pop() as NodeId;
      const nd = gene.nodes[x];
      if (!nd.childrenIds.length) acc.push(x);
      else stack.push(...nd.childrenIds);
    }
    out.set(gid, acc);
  }
  return out;
}

/**
 * Exhaustive reference for the nested (σ/δ) world, priced WITH LOSSES: a
 * duplication-only oracle could never see the loss accounting, and would agree
 * with the solver on any instance that happens to need no losses.
 *
 * An assignment costs
 *   + costs.dup per internal node with a co-located child (the same rule the
 *     solver and `scenarioSummary` use),
 *   + costs.loss × `minLossesBetween` per parent→child transition (the
 *     edge-wise count the applied document is priced with), and
 *   + costs.loss per CONSTRAINED species branch below the node — one holding a
 *     gene tip of that node's own subtree — that no child lineage enters: the
 *     lineage that had to be dropped there.
 */
function bruteNestedMin(species: Project, gene: Project, costs: typeof NO_TRANSFER): number {
  const tipsMap = mapTipsByLabel(species, gene).mappings;
  const internals: NodeId[] = Object.values(gene.nodes)
    .filter((n) => n.childrenIds.length > 0)
    .map((n) => n.id);
  const tipsUnder = geneTipsUnder(gene, internals);
  const order = [...internals].sort((a, b) => depthOfGene(gene, a) - depthOfGene(gene, b));
  let best = Number.POSITIVE_INFINITY;

  const evalAssignment = (assign: Map<NodeId, NodeId>): void => {
    // Nested-forest feasibility over every gene node: each child (tip or
    // internal) must sit inside-or-equal its parent's placement.
    for (const n of Object.values(gene.nodes)) {
      const pm = n.parentId === null ? species.rootId : assign.get(n.parentId);
      const cm = n.childrenIds.length ? assign.get(n.id) : tipsMap[n.id];
      if (!pm || !cm) return; // tip unmatched ⇒ no valid assignment at all
      if (!(cm === pm || withinSubtree(species, pm, cm))) return;
    }
    let cost = 0;
    for (const gid of internals) {
      const kids = gene.nodes[gid].childrenIds;
      const self = assign.get(gid)!;
      const kidMaps = kids.map((cid) =>
        gene.nodes[cid].childrenIds.length ? assign.get(cid)! : tipsMap[cid]!,
      );
      if (kids.length > 1 && kidMaps.includes(self)) cost += costs.dup;
      for (const cm of kidMaps) {
        const l = minLossesBetween(species, self, cm);
        if (!Number.isFinite(l)) return; // upward move: not a legal assignment
        cost += l * costs.loss;
      }
      if (!kidMaps.includes(self)) {
        const needed = ancestorsOrSelf(
          species,
          (tipsUnder.get(gid) ?? []).map((t) => tipsMap[t] as NodeId),
        );
        for (const c of species.nodes[self].childrenIds) {
          if (!needed.has(c)) continue; // unconstrained clade: no speculative loss
          if (subtreeNodes(species, c).some((z) => kidMaps.includes(z))) continue;
          cost += costs.loss; // a lineage had to be dropped from this branch
        }
      }
    }
    best = Math.min(best, cost);
  };

  const recurse = (idx: number, assign: Map<NodeId, NodeId>): void => {
    if (idx === order.length) {
      evalAssignment(assign);
      return;
    }
    const gid = order[idx];
    const parentId = gene.nodes[gid].parentId;
    const regionRoot = parentId === null ? species.rootId : assign.get(parentId)!;
    for (const sp of subtreeNodes(species, regionRoot)) {
      assign.set(gid, sp);
      recurse(idx + 1, assign);
    }
    assign.delete(gid);
  };
  recurse(0, new Map());
  return best;
}

/** Convert a DP scenario into a manual-assumption record for validation. */
function scenarioToAssumptions(
  gene: Project,
  scenario: { events: Record<string, string>; placements: Record<string, NodeId> },
): Record<NodeId, GeneNodeAssumption> {
  const out: Record<NodeId, GeneNodeAssumption> = {};
  for (const n of Object.values(gene.nodes)) {
    const p = scenario.placements[n.id];
    if (!p) continue;
    const a: GeneNodeAssumption = { speciesNode: p };
    if (n.childrenIds.length > 0) {
      const e = scenario.events[n.id];
      if (e) a.event = e as GeneNodeAssumption['event'];
    }
    out[n.id] = a;
  }
  return out;
}

/** Solve a "(A,B)" / "((a,b),c)" spec pair; throws if the solver refuses. */
function solvePair(
  spSpec: string,
  gSpec: string,
  costs: typeof NO_TRANSFER = NO_TRANSFER,
): { species: Project; gene: Project; dp: NonNullable<ReturnType<typeof solveDtl>['scenario']> } {
  const species = createEmptyProject();
  makeTree(species, species.rootId, spSpec);
  const gene = createEmptyProject();
  makeTree(gene, gene.rootId, gSpec);
  const r = solveDtl(species, gene, costs);
  if (!r.scenario) throw new Error(`solver refused ${spSpec} × ${gSpec}: ${r.error}`);
  return { species, gene, dp: r.scenario };
}

describe('solveDtl', () => {
  it('prices a plain mirror tree at zero', () => {
    const species = createEmptyProject();
    makeTree(species, species.rootId, '(A,B)');
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '(a,b)');
    const r = solveDtl(species, gene, NO_TRANSFER);
    expect(r.error).toBeUndefined();
    expect(r.scenario!.cost).toBe(0);
    expect(r.scenario!.totalLosses).toBe(0);
  });

  it('charges exactly one duplication for a retained in-species pair', () => {
    const species = createEmptyProject();
    makeTree(species, species.rootId, '(A,B)');
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((A,A),B)');
    const r = solveDtl(species, gene, NO_TRANSFER);
    expect(r.scenario!.cost).toBe(NO_TRANSFER.dup);
    expect(Object.values(r.scenario!.events)).toContain('duplication');
  });

  it('rejects polytomous gene trees with an error', () => {
    const species = createEmptyProject();
    makeTree(species, species.rootId, '(A,B)');
    // Manually give the gene root three children.
    const gene = createEmptyProject();
    addChildren(gene, gene.rootId, 3);
    const r = solveDtl(species, gene, NO_TRANSFER);
    expect(r.error).toBeTruthy();
  });

  it('produces scenarios free of structural errors per validateScenario', () => {
    const cases: Array<[string, string]> = [
      ['(A,B)', '((A,A),B)'],
      ['((A,B),C)', '((b,c),a)'],
      ['((A,B),(C,D))', '((b,a),(d,c))'],
      ['(A,(B,(C,D)))', '((c,d),(a,b))'],
    ];
    for (const [spSpec, gSpec] of cases) {
      const species = createEmptyProject();
      makeTree(species, species.rootId, spSpec);
      const gene = createEmptyProject();
      makeTree(gene, gene.rootId, gSpec);
      const r = solveDtl(species, gene, NO_TRANSFER);
      expect(r.error).toBeUndefined();
      const ass = scenarioToAssumptions(gene, r.scenario!);
      const issues = validateScenario(species, gene, ass, NO_TRANSFER);
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('converts an optimum into assumptions that validate cleanly', () => {
    const species = createEmptyProject();
    makeTree(species, species.rootId, '(A,B)');
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((A,A),B)');
    const r = solveDtl(species, gene, NO_TRANSFER);
    const ass = dtlScenarioToAssumptions(species, gene, r.scenario!);
    // Every node resolved (2 internals + 3 tips).
    expect(Object.keys(ass)).toHaveLength(5);
    expect(ass[gene.rootId]?.event).toBeTruthy();
    const issues = validateScenario(species, gene, ass, NO_TRANSFER);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('matches the loss-priced exhaustive reference on small instances', () => {
    // Instances whose optimum needs neither a junction descent nor an abandoned
    // branch: here region-wise (DP) and edge-wise (oracle) pricing coincide.
    const equalCases: Array<[string, string, number]> = [
      ['(A,B)', '(a,b)', 0],
      ['((A,B),(C,D))', '((b,a),(d,c))', 0],
      ['(A,B)', '((a,b),(b,a))', 1],
    ];
    for (const [spSpec, gSpec, expected] of equalCases) {
      const { species, gene, dp } = solvePair(spSpec, gSpec);
      const oracle = bruteNestedMin(species, gene, NO_TRANSFER);
      expect(oracle).toBe(expected);
      expect(dp.cost).toBe(expected);
    }
    // Where the DP buys a descent through junctions for nothing (the documented
    // reason its totals run low) the oracle must be STRICTLY pricier, never
    // cheaper — the DP cannot report more than the best loss-priced scenario.
    const diverging: Array<[string, string]> = [
      ['((A,B),C)', '((b,c),a)'],
      ['(A,(B,(C,D)))', '((c,d),(a,b))'],
      ['((A,B),(C,(D,E)))', '(((a,b),c),((d,e),a))'],
    ];
    for (const [spSpec, gSpec] of diverging) {
      const { species, gene, dp } = solvePair(spSpec, gSpec);
      const oracle = bruteNestedMin(species, gene, NO_TRANSFER);
      expect(oracle).toBeGreaterThanOrEqual(dp.cost);
      expect(oracle).toBeGreaterThan(dp.cost);
    }
  });

  it('never lets the loss-priced oracle undercut the DP on enumerated instances', () => {
    const rnd = seeded(20260921);
    let checked = 0;
    for (let t = 0; t < 40; t += 1) {
      const n = 4 + Math.floor(rnd() * 2); // 4–5 tips: exhaustive in milliseconds
      const labs = Array.from({ length: n }, (_, i) => `t${i}`);
      const species = createEmptyProject();
      makeTree(species, species.rootId, randomSpec(labs, rnd));
      const geneLabs = [...labs];
      if (rnd() < 0.5) geneLabs.push(labs[Math.floor(rnd() * labs.length)]);
      const gene = createEmptyProject();
      makeTree(gene, gene.rootId, randomSpec(geneLabs, rnd));
      const r = solveDtl(species, gene, NO_TRANSFER);
      if (!r.scenario) continue;
      checked += 1;
      const oracle = bruteNestedMin(species, gene, NO_TRANSFER);
      const ass = dtlScenarioToAssumptions(species, gene, r.scenario);
      const applied = scenarioSummary(gene, ass, NO_TRANSFER).cost;
      expect(oracle).toBeGreaterThanOrEqual(r.scenario.cost - r.scenario.rootFees);
      expect(applied).toBeGreaterThanOrEqual(r.scenario.cost - r.scenario.rootFees);
    }
    expect(checked).toBeGreaterThan(20); // the enumeration really ran
  });

  it('writes the DP loss set into the document instead of a partial trace', () => {
    // The minimal counterexample: the DP reports 2 losses (cost 2) while the trace
    // places 1 of 15 gene nodes, so an unwritten document prices at cost 0 —
    // "current 0 / optimal 2" straight after applying the optimum.
    const { species, gene, dp } = solvePair('(A,(B,(C,D)))', '((A,(C,(B,D))),(A,(C,(B,D))))');
    expect(dp.cost).toBe(2);
    expect(dp.totalLosses).toBe(2);
    expect(Object.keys(dp.placements).length).toBeLessThan(Object.keys(gene.nodes).length);
    const ass = dtlScenarioToAssumptions(species, gene, dp);
    const applied = scenarioSummary(gene, ass, NO_TRANSFER);
    expect(applied.cost).toBeGreaterThanOrEqual(dp.cost); // the promised invariant
    expect(applied.cost).toBe(dp.cost);
    expect(applied.losses).toBeGreaterThanOrEqual(dp.totalLosses);
    // Every lost lineage is IN the document: each carries the species node where
    // its lineage ends, so nothing the solver charged is left unwritten.
    expect(Object.keys(ass).length).toBeGreaterThan(Object.keys(dp.placements).length);
    const markCount = new Map<NodeId, number>();
    for (const m of dp.lossMarks) markCount.set(m.geneNode, (markCount.get(m.geneNode) ?? 0) + 1);
    let marksTotal = 0;
    for (const [gid, n] of markCount) {
      marksTotal += n;
      expect(ass[gid], `loss mark for gene node ${gid} has no row`).toBeTruthy();
      expect(ass[gid].losses ?? 0).toBeGreaterThanOrEqual(n);
    }
    expect(marksTotal).toBe(dp.totalLosses);
    // No partial traces: every gene node is either placed/lost itself or sits
    // below a node the DP explicitly marked lost.
    for (const nd of Object.values(gene.nodes)) {
      if (ass[nd.id] || markCount.has(nd.id)) continue;
      let cur: NodeId | null = nd.parentId;
      let covered = false;
      while (cur) {
        if (markCount.has(cur)) covered = true;
        cur = gene.nodes[cur].parentId;
      }
      expect(covered, `gene node ${nd.id} is neither placed nor below a loss`).toBe(true);
    }
  });

  it('keeps applied cost ≥ DP optimum across a seeded random survey', () => {
    const rnd = seeded(987654321);
    let solved = 0;
    let below = 0;
    let equal = 0;
    let above = 0;
    let unaccounted = 0;
    let structuralErrors = 0;
    let tipOnInternal = 0;
    let tipWarningsOnApplied = 0;
    for (let t = 0; t < 90; t += 1) {
      const n = 6 + Math.floor(rnd() * 2); // ≥6 tips, the size where tip-branch losses appear
      const labs = Array.from({ length: n }, (_, i) => `t${i}`);
      const species = createEmptyProject();
      makeTree(species, species.rootId, randomSpec(labs, rnd));
      const geneLabs = [...labs];
      if (rnd() < 0.5) geneLabs.push(labs[Math.floor(rnd() * labs.length)]);
      const gene = createEmptyProject();
      makeTree(gene, gene.rootId, randomSpec(geneLabs, rnd));
      const r = solveDtl(species, gene, NO_TRANSFER);
      if (!r.scenario) continue;
      solved += 1;
      const floor = r.scenario.cost - r.scenario.rootFees;
      const ass = dtlScenarioToAssumptions(species, gene, r.scenario);
      const applied = scenarioSummary(gene, ass, NO_TRANSFER);
      if (applied.cost < floor) below += 1;
      else if (applied.cost === floor) equal += 1;
      else above += 1;
      expect(applied.losses).toBeGreaterThanOrEqual(r.scenario.totalLosses);
      // No partial traces: a gene node is either placed or sits below a node the
      // DP explicitly marked lost.
      const marks = new Set(r.scenario.lossMarks.map((m) => m.geneNode));
      for (const nd of Object.values(gene.nodes)) {
        if (ass[nd.id]) continue;
        let cur: NodeId | null = nd.parentId;
        let covered = false;
        while (cur) {
          if (marks.has(cur)) covered = true;
          cur = gene.nodes[cur].parentId;
        }
        if (!covered) unaccounted += 1;
      }
      const issues = validateScenario(species, gene, ass, NO_TRANSFER);
      if (issues.some((i) => i.severity === 'error')) structuralErrors += 1;
      // A gene TIP placed on an INTERNAL species node is how this solver
      // records a lineage it bought out with a loss (see dtlScenarioToAssumptions).
      // The matching validation warning must therefore never fire on an applied
      // scenario — and every such placement must carry the loss it claims.
      if (issues.some((i) => i.kind === 'tip-on-internal')) tipWarningsOnApplied += 1;
      for (const nd of Object.values(gene.nodes)) {
        const a = ass[nd.id];
        if (!a || nd.childrenIds.length > 0) continue;
        if (species.nodes[a.speciesNode].childrenIds.length === 0) continue;
        tipOnInternal += 1;
        expect(a.losses ?? 0, `extinct-lineage tip ${nd.id} carries no loss`).toBeGreaterThan(0);
      }
    }
    expect(solved).toBeGreaterThan(40);
    expect(below).toBe(0); // applied cost never falls under the DP optimum
    expect(unaccounted).toBe(0);
    expect(structuralErrors).toBe(0);
    expect(tipWarningsOnApplied).toBe(0);
    expect(tipOnInternal).toBeGreaterThan(0); // the extinct-lineage shape is really reached
    expect(equal).toBeGreaterThan(0); // and the bound is not vacuous
    expect(above).toBeGreaterThan(0); // region-wise vs edge-wise divergence is real
  });

  it('reaches the optimum exactly on ≥6-tip instances whose losses sit on tip branches', () => {
    // Hand-checked instances (all ≥6 tips) where the DP's region-wise price and
    // the applied document's edge-wise price coincide AND at least one loss lands
    // on a gene TIP's incoming branch — the branch kind a tips-only tally misses.
    const cases: Array<[string, string]> = [
      ['(((t5,(t1,t0)),t3),(t4,t2))', '((t3,(t5,t2)),(t0,(t1,t4)))'],
      ['(((t5,t3),t0),(t1,(t2,t4)))', '((t0,(t2,t3)),(t3,((t5,t4),t1)))'],
      ['((t1,(t4,t0)),((t2,t3),t5))', '(((t4,t5),(t0,t3)),(t5,(t2,t1)))'],
      ['((t2,t1),((t0,(t5,t3)),t4))', '((((t5,t3),t1),t2),(t4,(t0,t1)))'],
      ['((t5,(t4,t0)),((t3,t1),(t6,t2)))', '((t5,(t2,t0)),((t1,t4),(t6,t3)))'],
      ['((t3,(t4,t2)),(t0,((t5,t1),t6)))', '(((t2,t0),t3),(t4,(t1,((t3,t5),t6))))'],
    ];
    let checked = 0;
    for (const [spSpec, gSpec] of cases) {
      const { species, gene, dp } = solvePair(spSpec, gSpec);
      const ass = dtlScenarioToAssumptions(species, gene, dp);
      const applied = scenarioSummary(gene, ass, NO_TRANSFER);
      expect(applied.cost).toBe(dp.cost - dp.rootFees);
      expect(applied.losses).toBe(dp.totalLosses);
      expect(applied.tipLosses).toBeGreaterThan(0);
      expect(applied.internalLosses + applied.tipLosses).toBe(applied.losses);
      checked += 1;
    }
    expect(checked).toBe(cases.length);
  });

  it('survives a 6000-deep pectinate species tree without blowing the stack', () => {
    // The sweep runs as a loop, so species depth never lands on the call stack: a
    // recursive `downOf` over the same tree dies with `RangeError: Maximum call
    // stack size exceeded` from ~5000 species levels up.
    const species = makePectinate(6000);
    const gene = makePectinate(2);
    let r: ReturnType<typeof solveDtl> | null = null;
    expect(() => {
      r = solveDtl(species, gene, NO_TRANSFER);
    }).not.toThrow();
    expect(r!.error).toBeUndefined();
    expect(Number.isFinite(r!.scenario!.cost)).toBe(true);
    expect(r!.scenario!.placements[gene.rootId]).toBeTruthy();
  });

  it('refuses a pathologically deep gene tree with a readable error', () => {
    const species = makePectinate(50);
    const gene = makePectinate(420, 50); // 420 nested levels over 50 species
    let r: ReturnType<typeof solveDtl> | null = null;
    expect(() => {
      r = solveDtl(species, gene, NO_TRANSFER);
    }).not.toThrow(); // no RangeError escaping to the caller
    expect(r!.error).toBeTruthy();
    expect(r!.error).toMatch(/过深|deeper than/);
    // A tree just under the guard still solves.
    const ok = solveDtl(species, makePectinate(300, 50), NO_TRANSFER);
    expect(ok.error).toBeUndefined();
    expect(ok.scenario).toBeTruthy();
  });
});
