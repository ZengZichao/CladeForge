import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren, renameNode } from './treeOps';
import type { NodeId, Project } from './types';
import {
  isUpwardMove,
  mapTipsByLabel,
  minLossesBetween,
  normalizeLabel,
  scenarioSummary,
  suggestLcaScenario,
  validateScenario,
} from './reconciliation';
import { dtlScenarioToAssumptions, solveDtl } from './dtl';

const COSTS = { dup: 1, transfer: 2, loss: 1 };

/** Build a rooted subtree under `parentId` from a nested "(X,Y)Name" spec;
 *  returns label → node id for every NAMED node. */
function makeTree(
  p: Project,
  parentId: NodeId,
  spec: string,
  ids: Map<string, NodeId> = new Map(),
): Map<string, NodeId> {
  const m = /^\((.*)\)([^()]*)$/.exec(spec);
  if (!m) {
    // Bare label: THIS node is the tip.
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

function setAgeForTest(p: Project, id: NodeId, age: number): void {
  p.nodes[id].age = age;
}

describe('normalizeLabel / mapTipsByLabel', () => {
  it('normalizes underscores and case', () => {
    expect(normalizeLabel('Homo_sapiens')).toBe('homo sapiens');
    expect(normalizeLabel(' X_1 ')).toBe('x 1');
  });

  it('maps exact then normalized and reports unmatched', () => {
    const s = createEmptyProject();
    const sp = makeTree(s, s.rootId, '(Homo_sapiens,M_musculus)');
    const g = createEmptyProject();
    const gp = makeTree(g, g.rootId, '(Homo_sapiens,M_Musculus,Neur_out)');
    const r = mapTipsByLabel(s, g);
    expect(r.mappings[gp.get('Homo_sapiens')!]).toBe(sp.get('Homo_sapiens'));
    expect(r.mappings[gp.get('M_Musculus')!]).toBe(sp.get('M_musculus')); // case-normalized
    expect(r.mappings[gp.get('Neur_out')!]).toBeNull();
    expect(r.unmatchedLabels).toEqual(['Neur_out']);
  });
});

describe('minLossesBetween', () => {
  it('charges 0 for staying put and prices an upward move as infeasible', () => {
    const p = createEmptyProject();
    const sp = makeTree(p, p.rootId, '(A,B)');
    const a = sp.get('A')!;
    expect(minLossesBetween(p, p.rootId, p.rootId)).toBe(0);
    // Mapping a gene node onto an ANCESTRAL species node is time travel, not a
    // cheap descent. Charging it 0 would let a hand-built scenario send a lineage
    // back into the past for free, so it is infeasible (Infinity) AND flagged by
    // validateScenario as `upward-move`: price and check agree.
    expect(minLossesBetween(p, a, p.rootId)).toBe(Number.POSITIVE_INFINITY);
    expect(isUpwardMove(p, a, p.rootId)).toBe(true);
    expect(isUpwardMove(p, p.rootId, a)).toBe(false); // the ordinary descent
    expect(isUpwardMove(p, a, a)).toBe(false);
  });

  it('charges edges−1 per junction passed on descent', () => {
    const p = createEmptyProject();
    const sp = makeTree(p, p.rootId, '((A1,X),(B1,Y))');
    const root = p.rootId;
    const left = p.nodes[root].childrenIds[0];
    const a1 = sp.get('A1')!;
    const b1 = sp.get('B1')!;
    // Root→A1 passes exactly one intermediate junction (the left clade).
    expect(minLossesBetween(p, root, a1)).toBe(1);
    // Descending onto a direct child crosses nothing in between.
    expect(minLossesBetween(p, left, a1)).toBe(0);
    // Lateral move crosses one junction per leg through their MRCA.
    expect(minLossesBetween(p, a1, b1)).toBe(2);
  });
});

describe('suggestLcaScenario', () => {
  it('classifies the plain mirror tree as one speciation', () => {
    const s = createEmptyProject();
    makeTree(s, s.rootId, '(A,B)');
    const g = createEmptyProject();
    makeTree(g, g.rootId, '(a,b)');
    const { mappings } = mapTipsByLabel(s, g);
    const sc = suggestLcaScenario(s, g, mappings);
    expect(sc[g.rootId]).toMatchObject({ speciesNode: s.rootId, event: 'speciation' });
    expect(Object.keys(sc)).toHaveLength(3); // root + both tips
  });

  it('flags retention duplication on same-species gene pairs', () => {
    const s = createEmptyProject();
    const sp = makeTree(s, s.rootId, '(A,B)');
    const g = createEmptyProject();
    // Two gene lines whose tips both match species A.
    makeTree(g, g.rootId, '((A,A),B)');
    const pairId = g.nodes[g.rootId].childrenIds[0];
    const sc = suggestLcaScenario(s, g, mapTipsByLabel(s, g).mappings);
    expect(sc[pairId]).toMatchObject({ speciesNode: sp.get('A'), event: 'duplication' });
    expect(sc[g.rootId]?.event).toBe('speciation');
  });

  it('preserves prior meta evidence via keepMetaFrom', () => {
    const s = createEmptyProject();
    makeTree(s, s.rootId, '(A,B)');
    const g = createEmptyProject();
    makeTree(g, g.rootId, '(a,b)');
    const sc = suggestLcaScenario(s, g, mapTipsByLabel(s, g).mappings, {
      [g.rootId]: { speciesNode: s.rootId, meta: { confidence: 'high', support: 'lit' } },
    });
    expect(sc[g.rootId]?.meta).toEqual({ confidence: 'high', support: 'lit' });
  });
});

describe('validateScenario', () => {
  /** Species (A,B); gene ((A1,A2),B). Returns the ids needed by the rules. */
  function base() {
    const species = createEmptyProject();
    const sp = makeTree(species, species.rootId, '(A,B)');
    const A = sp.get('A')!;
    const B = sp.get('B')!;
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((A1,A2),B)');
    const gtips = Object.values(gene.nodes).filter((n) => !n.childrenIds.length);
    const pairId = gene.nodes[gene.rootId].childrenIds[0];
    return {
      species,
      A,
      B,
      gene,
      rootId: gene.rootId,
      pairId,
      A1: gtips.find((n) => n.label === 'A1')!.id,
      A2: gtips.find((n) => n.label === 'A2')!.id,
      BT: gtips.find((n) => n.label === 'B')!.id,
    };
  }

  function assumptionsFor(b: ReturnType<typeof base>) {
    return {
      [b.A1]: { speciesNode: b.A },
      [b.A2]: { speciesNode: b.A },
      [b.BT]: { speciesNode: b.B },
      [b.pairId]: { speciesNode: b.A, event: 'duplication' as const },
      [b.rootId]: { speciesNode: b.species.rootId, event: 'speciation' as const },
    };
  }

  it('reports completely unmapped tips once, aggregated', () => {
    const s = createEmptyProject();
    makeTree(s, s.rootId, '(A,B)');
    const g = createEmptyProject();
    makeTree(g, g.rootId, '(a,Z_MISSING)');
    const issues = validateScenario(s, g, {}, COSTS);
    expect(issues.filter((i) => i.kind === 'unmatched-tip')).toHaveLength(1);
    expect(issues.find((i) => i.kind === 'unmatched-tip')?.severity).toBe('error');
  });

  it('does not flag manually-assumed tips that failed label matching', () => {
    const b = base();
    const ass = assumptionsFor(b);
    const issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.filter((i) => i.kind === 'unmatched-tip')).toHaveLength(0);
  });

  it('warns about unresolved internal nodes with their ids', () => {
    const b = base();
    const ass: Record<string, { speciesNode: NodeId }> = {
      [b.A1]: { speciesNode: b.A },
      [b.A2]: { speciesNode: b.A },
      [b.BT]: { speciesNode: b.B },
      // pair + root deliberately unresolved
    };
    const issues = validateScenario(b.species, b.gene, ass, COSTS);
    const unresolved = issues.filter((i) => i.kind === 'unresolved');
    expect(unresolved.map((i) => i.nodeId).sort()).toEqual([b.pairId, b.rootId].sort());
    expect(unresolved.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('warns on dangling mapping targets', () => {
    const b = base();
    const ass = assumptionsFor(b) as Record<string, { speciesNode: NodeId; event?: string }>;
    ass[b.pairId] = { speciesNode: 'ghost-node', event: 'duplication' };
    const issues = validateScenario(b.species, b.gene, ass as never, COSTS);
    expect(issues.some((i) => i.kind === 'dangling' && i.nodeId === b.pairId)).toBe(true);
  });

  it('rejects speciation when children co-locate on the same node/branch', () => {
    const b = base();
    const ass = assumptionsFor(b);
    // Both children sit ON the mapped node itself ⇒ must be duplication.
    (ass[b.pairId] as { event: string }).event = 'speciation';
    let issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.some((i) => i.kind === 'event-conflict' && i.nodeId === b.pairId)).toBe(true);

    // Both children entering the SAME branch of the mapping node also conflicts.
    (ass[b.pairId] as { speciesNode: NodeId }).speciesNode = b.species.rootId;
    issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.some((i) => i.kind === 'event-conflict' && i.nodeId === b.pairId)).toBe(true);

    // Sanity: spreading A1→A / A2→B turns it into a legitimate speciation.
    (ass[b.A2] as { speciesNode: NodeId }).speciesNode = b.B;
    issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.some((i) => i.kind === 'event-conflict' && i.nodeId === b.pairId)).toBe(false);
  });

  it('warns when a duplication looks like a speciation (spread children)', () => {
    const b = base();
    const ass = assumptionsFor(b);
    (ass[b.pairId] as { speciesNode: NodeId }).speciesNode = b.species.rootId;
    (ass[b.A2] as { speciesNode: NodeId }).speciesNode = b.B;
    const issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.some((i) => i.kind === 'mislabelled' && i.nodeId === b.pairId)).toBe(true);
  });

  it('requires donor + receiver children for transfers', () => {
    const b = base();
    const ass = assumptionsFor(b);
    (ass[b.rootId] as { event: string }).event = 'transfer'; // both children inside Root
    const issues = validateScenario(b.species, b.gene, ass, COSTS);
    expect(issues.some((i) => i.kind === 'event-conflict' && i.nodeId === b.rootId)).toBe(true);
  });

  it('checks coarse transfer timing against explicit ages', () => {
    const species = createEmptyProject();
    const sp = makeTree(species, species.rootId, '((A,B),C)');
    const cClade = species.nodes[species.rootId].childrenIds[1];
    const ABclade = species.nodes[species.rootId].childrenIds[0];
    const cTip = sp.get('C')!;
    // Feasibility needs a transfer instant t with donorAge ≤ t ≤ recvAge
    // (ages are Ma before present, larger = older). Contradiction iff
    // donorAge > recvAge: recipient OLD (10), donor YOUNG (100).
    setAgeForTest(species, ABclade, 10);
    setAgeForTest(species, cTip, 100);
    void cClade;
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((a1,a2),c)');
    const gtips = Object.values(gene.nodes).filter((n) => !n.childrenIds.length);
    const pairId = gene.nodes[gene.rootId].childrenIds[0];
    const ass: Record<string, unknown> = {
      [gtips.find((n) => n.label === 'a1')!.id]: { speciesNode: sp.get('A') },
      [gtips.find((n) => n.label === 'a2')!.id]: { speciesNode: sp.get('B') },
      [gtips.find((n) => n.label === 'c')!.id]: { speciesNode: sp.get('C') },
      [pairId]: { speciesNode: ABclade, event: 'duplication' },
      [gene.rootId]: { speciesNode: ABclade, event: 'transfer' }, // c child outside ⇒ donor
    };
    const issues = validateScenario(species, gene, ass as never, COSTS);
    expect(issues.some((i) => i.kind === 'timing')).toBe(true);
  });

  it('flags a gene node mapped onto an ANCESTRAL species node as an error', () => {
    // Species (A,(B,C)); the gene's (b,c) clade sits on the (B,C) junction, but
    // its child b is pushed all the way up to the species ROOT — the lineage
    // would have had to exist before the lineage it descends from.
    const species = createEmptyProject();
    const sp = makeTree(species, species.rootId, '(A,(B,C))');
    const bc = species.nodes[species.rootId].childrenIds[1];
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((b,c),a)');
    const gtips = Object.values(gene.nodes).filter((n) => !n.childrenIds.length);
    const pairId = gene.nodes[gene.rootId].childrenIds[0];
    const ass: Record<string, unknown> = {
      [gtips.find((n) => n.label === 'b')!.id]: { speciesNode: species.rootId }, // ← time travel
      [gtips.find((n) => n.label === 'c')!.id]: { speciesNode: sp.get('C') },
      [gtips.find((n) => n.label === 'a')!.id]: { speciesNode: sp.get('A') },
      [pairId]: { speciesNode: bc, event: 'speciation' },
      [gene.rootId]: { speciesNode: species.rootId, event: 'speciation' },
    };
    const issues = validateScenario(species, gene, ass as never, COSTS);
    const upward = issues.filter((i) => i.kind === 'upward-move');
    expect(upward).toHaveLength(1);
    expect(upward[0].severity).toBe('error');
    expect(upward[0].nodeId).toBe(gtips.find((n) => n.label === 'b')!.id);
    // The infeasible placement is named once, not also mis-reported as a plain
    // loss shortfall.
    expect(issues.filter((i) => i.kind === 'loss-shortfall' && i.nodeId === upward[0].nodeId)).toHaveLength(0);
    // A legal scenario over the same trees raises no upward-move error.
    (ass[upward[0].nodeId as string] as { speciesNode: string }).speciesNode = sp.get('B')!;
    expect(
      validateScenario(species, gene, ass as never, COSTS).filter((i) => i.kind === 'upward-move'),
    ).toHaveLength(0);
  });

  it('warns when asserted losses fall below the structural minimum', () => {
    // Species: (M,(N1,N2)) — the Root→N1 descent crosses the K junction.
    const species = createEmptyProject();
    const sp = makeTree(species, species.rootId, '(M,(N1,N2))');
    const N1 = sp.get('N1')!;
    const M = sp.get('M')!;
    const N2 = sp.get('N2')!;
    const rootS = species.rootId;
    // Gene: ((m, n1a), n2b) — lineage pair for K plus a single-copy side.
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((m,n1a),n2b)');
    const gtips = Object.values(gene.nodes).filter((n) => !n.childrenIds.length);
    const kPair = gene.nodes[gene.rootId].childrenIds[0];
    const n2b = gtips.find((n) => n.label === 'n2b')!.id;
    const mTip = gtips.find((n) => n.label === 'm')!.id;
    const ass: Record<string, unknown> = {
      // kPair sits at N1 while its child m maps to M: that lateral move crosses
      // the root junction, so it forces one loss on m's own (terminal) branch.
      [mTip]: { speciesNode: M, losses: 1 },
      [gtips.find((n) => n.label === 'n1a')!.id]: { speciesNode: N1 },
      // n2b descends from the gene root (mapped at the species Root) onto N2, so
      // the Root→N2 descent forces one loss ON THE TIP BRANCH itself. Tip
      // branches are checked like internal ones: a scenario that forgot this loss
      // must not pass validation with its cost tally quietly agreeing with it.
      [n2b]: { speciesNode: N2, losses: 1 },
      [kPair]: { speciesNode: N1, event: 'duplication', losses: 1 }, // parent(gene root) sits at species Root
      [gene.rootId]: { speciesNode: rootS, event: 'speciation' },
    };
    const ok = validateScenario(species, gene, ass as never, COSTS);
    expect(ok.filter((i) => i.kind === 'loss-shortfall')).toHaveLength(0);

    (ass[kPair] as { losses?: number }).losses = 0;
    const bad = validateScenario(species, gene, ass as never, COSTS);
    expect(bad.some((i) => i.kind === 'loss-shortfall' && i.nodeId === kPair)).toBe(true);

    // Tip branches are covered too.
    (ass[kPair] as { losses?: number }).losses = 1;
    (ass[n2b] as { losses?: number }).losses = 0;
    const badTip = validateScenario(species, gene, ass as never, COSTS);
    expect(badTip.some((i) => i.kind === 'loss-shortfall' && i.nodeId === n2b)).toBe(true);
  });

  it('warns when an extant gene tip sits on an ancestral species node with no loss', () => {
    // Species ((a1,a2),b); gene (a1,a2). Read straight, the pair is one
    // speciation on the (a1,a2) junction and costs nothing. Pushing a2 up ONTO
    // that junction instead — "this sampled taxon IS the ancestor" — forces the
    // user to assert a retention duplication to satisfy the event rules, so
    // without this warning the fabricated event is the only trace.
    const species = createEmptyProject();
    makeTree(species, species.rootId, '((a1,a2),b)');
    const clade = species.nodes[species.rootId].childrenIds[0];
    const [spA1, spA2] = species.nodes[clade].childrenIds;
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '(a1,a2)');
    const gt = Object.values(gene.nodes).filter((n) => n.childrenIds.length === 0);
    const t1 = gt.find((n) => n.label === 'a1')!.id;
    const t2 = gt.find((n) => n.label === 'a2')!.id;

    const coherent: Record<string, unknown> = {
      [t1]: { speciesNode: spA1 },
      [t2]: { speciesNode: spA2 },
      [gene.rootId]: { speciesNode: clade, event: 'speciation' },
    };
    expect(validateScenario(species, gene, coherent as never, COSTS)).toEqual([]);

    const ancestral: Record<string, unknown> = {
      [t1]: { speciesNode: spA1 },
      [t2]: { speciesNode: clade },
      [gene.rootId]: { speciesNode: clade, event: 'duplication' },
    };
    const issues = validateScenario(species, gene, ancestral as never, COSTS);
    const tip = issues.filter((i) => i.kind === 'tip-on-internal');
    expect(tip).toHaveLength(1);
    expect(tip[0].nodeId).toBe(t2);
    expect(tip[0].severity).toBe('warning');

    // The solver's own convention stays clean: it writes the same placement when
    // it buys that lineage out with a loss (an extinct lineage ending there), so
    // one asserted loss is enough to silence the warning.
    (ancestral[t2] as { losses: number }).losses = 1;
    expect(
      validateScenario(species, gene, ancestral as never, COSTS).filter(
        (i) => i.kind === 'tip-on-internal',
      ),
    ).toEqual([]);
  });
});

describe('scenarioSummary', () => {
  it('counts events and prices the scenario under the cost vector', () => {
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((t1,t2),(t3,t4))');
    const root = gene.rootId;
    const [left, right] = gene.nodes[root].childrenIds;
    const ass: Record<string, unknown> = {
      [root]: { speciesNode: 'sp_root', event: 'speciation' },
      [left]: { speciesNode: 'sp_a', event: 'duplication', losses: 2 },
      [right]: { speciesNode: 'sp_b', event: 'transfer' },
    };
    const s = scenarioSummary(gene, ass as never, { dup: 3, transfer: 5, loss: 2 });
    expect(s.speciation).toBe(1);
    expect(s.duplication).toBe(1);
    expect(s.transfer).toBe(1);
    expect(s.losses).toBe(2);
    expect(s.cost).toBe(3 + 5 + 2 * 2);
    expect(s.mappedInternal).toBe(3);
    expect(s.totalInternal).toBe(3);
  });

  it('tallies losses that sit on a gene TIP\'s incoming branch', () => {
    // Species ((A,B),(C,D)); a gene whose two-leaf clade sits on the (C,D)
    // junction and whose third lineage ends on species A. Every one of those
    // terminal branches carries a loss, so tip branches are in the tally: leave
    // them out and the LCA-suggested and DP-applied paths price the same document
    // differently.
    const species = createEmptyProject();
    const sp = makeTree(species, species.rootId, '((A,B),(C,D))');
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((x,y),z)');
    const gtips = Object.values(gene.nodes).filter((n) => !n.childrenIds.length);
    const pair = gene.nodes[gene.rootId].childrenIds[0];
    const C = sp.get('C')!;
    const D = sp.get('D')!;
    const A = sp.get('A')!;
    const rootClade = species.nodes[species.rootId].childrenIds[1]; // (C,D)
    const ass: Record<string, unknown> = {
      [gene.rootId]: { speciesNode: species.rootId, event: 'speciation' },
      [pair]: { speciesNode: rootClade, event: 'duplication', losses: 1 },
      [gtips.find((n) => n.label === 'x')!.id]: { speciesNode: C, losses: 1 }, // TIP branch
      [gtips.find((n) => n.label === 'y')!.id]: { speciesNode: D, losses: 1 }, // TIP branch
      [gtips.find((n) => n.label === 'z')!.id]: { speciesNode: A, losses: 1 }, // root→A junction
    };
    const zTip = gtips.find((n) => n.label === 'z')!.id;
    const s = scenarioSummary(gene, ass as never, { dup: 2, transfer: 1, loss: 3 });
    expect(s.tipLosses).toBe(3);
    expect(s.internalLosses).toBe(1);
    expect(s.losses).toBe(4);
    expect(s.cost).toBe(2 /* one duplication */ + 4 * 3 /* four losses */);
    expect(s.mappedInternal).toBe(2);
    // A complete document is consistent: no node claims fewer losses than its
    // placement forces.
    const clean = validateScenario(species, gene, ass as never, COSTS);
    expect(clean.filter((i) => i.kind === 'loss-shortfall').map((i) => i.nodeId)).toEqual([]);
    // Drop the loss on the TIP branch and validation must see it.
    (ass[zTip] as { losses: number }).losses = 0;
    const short = validateScenario(species, gene, ass as never, COSTS);
    expect(short.filter((i) => i.kind === 'loss-shortfall').map((i) => i.nodeId)).toEqual([zTip]);
    expect(scenarioSummary(gene, ass as never, { dup: 2, transfer: 1, loss: 3 }).cost).toBe(2 + 3 * 3);
  });

  it('prices the applied DP optimum at or above what the solver reported', () => {
    const species = createEmptyProject();
    makeTree(species, species.rootId, '(A,(B,(C,D)))');
    const gene = createEmptyProject();
    makeTree(gene, gene.rootId, '((A,(C,(B,D))),(A,(C,(B,D))))');
    const r = solveDtl(species, gene, COSTS);
    expect(r.error).toBeUndefined();
    const dp = r.scenario!;
    const ass = dtlScenarioToAssumptions(species, gene, dp);
    const applied = scenarioSummary(gene, ass, COSTS);
    // "current ≥ optimal" must hold by construction, never by coincidence:
    // straight after applying the DP optimum the document can never read
    // 当前 0 / 最优 2.
    expect(applied.cost).toBeGreaterThanOrEqual(dp.cost - dp.rootFees);
    expect(applied.losses).toBeGreaterThanOrEqual(dp.totalLosses);
    // Every loss the DP charged is visible in the document, split by branch kind.
    expect(applied.internalLosses + applied.tipLosses).toBe(applied.losses);
    expect(
      validateScenario(species, gene, ass, COSTS).filter((i) => i.severity === 'error'),
    ).toEqual([]);
  });
});
