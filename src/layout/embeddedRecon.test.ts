// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Contracts for the EMBEDDED reconciliation layout
// (docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md §9.1):
//   * every validly placed gene node sits INSIDE its host tube; unmapped nodes
//     land in the orphan gutter instead of vanishing;
//   * σ children enter different sub-tubes; δ children share a tube on
//     different lanes; τ produces a donor→recipient arc (never a normal
//     descent — sample α's αAC case); λ structural stubs match
//     lossesAlongSpeciesPath with the three-state display strategy;
//   * the mask skeleton (tubes + hubs) covers every drawn gene-segment point;
//   * deterministic output, finite bounds, lane-overflow capping.

import { describe, it, expect } from 'vitest';
import type { GeneNodeAssumption, NodeId } from '../model/types';
import { DEFAULT_RECON_COSTS } from '../model/types';
import { validateScenario } from '../model/reconciliation';
import { createReconciliationSample } from '../model/sampleTree';
import { computeLayout } from './autoLayout';
import {
  computeEmbeddedReconLayout,
  defaultEmbeddedLayoutOptions,
  fitEmbeddedBounds,
  hitTestTube,
  laneOffsetOf,
  pointOnTube,
  prepareEmbeddedSpeciesDoc,
  type EmbeddedReconLayout,
} from './embeddedRecon';

type Assumptions = Record<NodeId, GeneNodeAssumption>;

function layoutFor(
  project: ReturnType<typeof createReconciliationSample>,
  geneName: string,
  assumptions?: Assumptions,
  overrides: Partial<ReturnType<typeof defaultEmbeddedLayoutOptions>> = {},
): { scene: EmbeddedReconLayout; geneIdByName: Map<string, NodeId> } {
  const entry = (project.geneTrees ?? []).find((g) => g.name.includes(geneName))!;
  const speciesLayout = computeLayout(prepareEmbeddedSpeciesDoc(project));
  const opts = { ...defaultEmbeddedLayoutOptions(), ...overrides };
  const scene = computeEmbeddedReconLayout({
    speciesDoc: project,
    speciesLayout,
    geneDoc: entry.doc,
    assumptions: assumptions ?? entry.assumptions,
    options: opts,
  });
  const geneIdByName = new Map<string, NodeId>();
  for (const n of Object.values(entry.doc.nodes)) {
    if (n.label) geneIdByName.set(n.label, n.id);
  }
  return { scene, geneIdByName };
}

/** All coordinate pairs inside an SVG path string (M/L/C commands). */
function pathPoints(d: string): { x: number; y: number }[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

describe('computeEmbeddedReconLayout — sample α (full σ/δ/τ/λ scenario)', () => {
  const project = createReconciliationSample();
  const { scene, geneIdByName } = layoutFor(project, 'α');

  it('places every mapped gene node inside its host tube (root-anchored at the species root)', () => {
    for (const p of scene.placements.values()) {
      if (p.unmapped) continue;
      if (p.hostBranchId === null) {
        // Anchored at the species root position.
        const rootPos = scene.speciesLayout.positions.get(project.rootId)!;
        expect(p.x, p.geneNodeId).toBeCloseTo(rootPos.x, 5);
        expect(p.y, p.geneNodeId).toBeCloseTo(rootPos.y, 5);
        continue;
      }
      const tube = scene.tubes.get(p.hostBranchId as string);
      expect(tube, p.geneNodeId).toBeTruthy();
      const half = (tube as { width: number }).width / 2 + 0.5;
      expect(p.y, p.geneNodeId).toBeGreaterThanOrEqual((tube as { y: number }).y - half);
      expect(p.y, p.geneNodeId).toBeLessThanOrEqual((tube as { y: number }).y + half);
      expect(p.x, p.geneNodeId).toBeGreaterThanOrEqual(
        Math.min((tube as { x0: number }).x0, (tube as { x1: number }).x1) - 0.5,
      );
      expect(p.x, p.geneNodeId).toBeLessThanOrEqual(
        Math.max((tube as { x0: number }).x0, (tube as { x1: number }).x1) + 0.5,
      );
    }
  });

  it('draws the speciation αR with its children entering the two root branches', () => {
    const aR = geneIdByName.get('αR')!;
    const aAC = geneIdByName.get('αAC')!;
    const aN3 = geneIdByName.get('αN3')!;
    const rootPlacement = scene.placements.get(aR)!;
    expect(rootPlacement.event).toBe('speciation');
    // αAC is the transfer recipient (host = N1's branch); αN3 descends into
    // N2's side — different sub-branches of the species root.
    const left = scene.placements.get(aAC)!.hostBranchId;
    const right = scene.placements.get(aN3)!.hostBranchId;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left).not.toBe(right);
  });

  it('routes the duplication αAB legally: one child stays, one climbs through N1 (no infeasible warning)', () => {
    const aAB = geneIdByName.get('αAB')!;
    const aTipA = geneIdByName.get('Taxon_A')!;
    const aTipB = geneIdByName.get('Taxon_B')!;
    const p = scene.placements.get(aAB)!;
    expect(p.event).toBe('duplication');
    // The A copy stays inside the host branch (straight line).
    const segA = scene.segments.find((s) => s.geneNodeId === aTipA)!;
    expect(segA.dashed).toBe(false);
    // The B copy is a lateral move through the MRCA N1 — legal and priced by
    // minLossesBetween, so it must NOT be flagged infeasible.
    const segB = scene.segments.find((s) => s.geneNodeId === aTipB)!;
    expect(segB.dashed).toBe(false);
    expect(scene.issues.some((i) => i.kind === 'infeasible-lateral')).toBe(false);
  });

  it('annotates the transfer αAC with an arc from the donor branch to the recipient branch — never a normal descent', () => {
    const aAC = geneIdByName.get('αAC')!;
    const aR = geneIdByName.get('αR')!;
    // No multi-branch descent for the parent edge of the τ node: its only
    // segment is the τ stub (t0 === t1, drawn straight).
    const segs = scene.segments.filter((s) => s.geneNodeId === aAC);
    expect(segs).toHaveLength(1);
    expect(segs[0].event).toBe('transfer');
    expect(segs[0].t0).toBe(segs[0].t1);
    // The arc runs donor → recipient.
    expect(scene.transfers).toHaveLength(1);
    const arc = scene.transfers[0];
    expect(arc.geneNodeId).toBe(aAC);
    const cTipId = [...scene.placements.entries()].find(
      ([, p]) => p.kind === 'tip' && p.hostBranchId === arc.donorBranchId,
    )?.[0];
    expect(cTipId).toBe(geneIdByName.get('Taxon_C'));
    expect(arc.recipientBranchId).toBe(scene.placements.get(aAC)!.hostBranchId);
    expect(arc.donorBranchId).not.toBe(arc.recipientBranchId);
    // The arc is a real curve leaving the donor position.
    expect(arc.d.startsWith('M')).toBe(true);
    void aR;
  });

  it('draws a structural loss stub for αN3 (2 edges below the root ⇒ 1 loss)', () => {
    const structural = scene.losses.filter((l) => l.source === 'structural');
    expect(structural.length).toBeGreaterThanOrEqual(1);
    const total = structural.reduce((a, b) => a + b.count, 0);
    // αR→αN3 spans root→N2→N3: one binary junction (N2) ⇒ 1 structural loss;
    // αN3→D and αN3→E/F add none (αN3 IS N3; tips below it are direct).
    expect(total).toBe(1);
  });

  it('keeps the α segment geometry inside the mask skeleton (tubes ∪ hubs)', () => {
    const tubes = [...scene.tubes.values()];
    const hubs = [...scene.hubs.values()];
    for (const seg of scene.segments) {
      for (const pt of pathPoints(seg.d)) {
        const inTube = tubes.some(
          (t) =>
            pt.x >= Math.min(t.x0, t.x1) - 0.5 &&
            pt.x <= Math.max(t.x0, t.x1) + 0.5 &&
            Math.abs(pt.y - t.y) <= t.width / 2 + 0.5,
        );
        const inHub = hubs.some(
          (h) =>
            Math.abs(pt.x - h.x) <= h.width / 2 + 0.5 &&
            pt.y >= Math.min(h.y0, h.y1) - h.width / 2 - 0.5 &&
            pt.y <= Math.max(h.y0, h.y1) + h.width / 2 + 0.5,
        );
        expect(inTube || inHub, `${seg.id} point ${pt.x},${pt.y}`).toBe(true);
      }
    }
  });

  it('produces finite bounds and no orphan nodes for the complete scenario', () => {
    expect(scene.orphans).toEqual([]);
    for (const v of [scene.bounds.minX, scene.bounds.minY, scene.bounds.maxX, scene.bounds.maxY]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('is deterministic across runs', () => {
    const again = layoutFor(project, 'α').scene;
    expect(JSON.stringify(again.segments.map((s) => s.d))).toBe(
      JSON.stringify(scene.segments.map((s) => s.d)),
    );
    expect(JSON.stringify([...again.placements.values()].map((p) => [p.x, p.y, p.lane]))).toBe(
      JSON.stringify([...scene.placements.values()].map((p) => [p.x, p.y, p.lane])),
    );
  });
});

describe('computeEmbeddedReconLayout — sample β (display inference)', () => {
  const project = createReconciliationSample();

  it('keeps β4 connected via display inference and leaves validation untouched', () => {
    const { scene, geneIdByName } = layoutFor(project, 'β');
    const b4 = geneIdByName.get('β4')!;
    const p = scene.placements.get(b4)!;
    expect(p.inferred).toBe(true);
    expect(p.placementSource).toBe('inferred-mrca');
    expect(p.unmapped).toBe(false);
    // β4's children (E/F tips) descend into N4's two sub-branches.
    const eTip = scene.placements.get(geneIdByName.get('Taxon_E')!)!;
    const fTip = scene.placements.get(geneIdByName.get('Taxon_F')!)!;
    expect(eTip.hostBranchId).not.toBeNull();
    expect(fTip.hostBranchId).not.toBeNull();
    expect(eTip.hostBranchId).not.toBe(fTip.hostBranchId);
    // And the displayed inference did not change the stored scenario.
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    const issues = validateScenario(project, entry.doc, entry.assumptions, DEFAULT_RECON_COSTS);
    expect(issues.filter((i) => i.kind === 'unresolved')).toHaveLength(1);
  });

  it('gives every gene segment a UNIQUE id even when one edge crosses several branches', () => {
    // A gene edge whose path spans multiple species branches yields one
    // segment per step; identical ids used to collide as React keys
    // (`Encountered two children with the same key`).
    const { scene } = layoutFor(project, 'β');
    const ids = scene.segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Multi-step edges actually occur in this sample — the guard must bite.
    expect(scene.segments.length).toBeGreaterThan(new Set(scene.segments.map((s) => `${s.parentGeneNodeId}->${s.geneNodeId}`)).size);
  });
});

describe('computeEmbeddedReconLayout — loss display strategy', () => {
  it('marks structural losses as inferred when no loss is asserted', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const bare: Assumptions = {};
    for (const [gid, a] of Object.entries(entry.assumptions)) {
      bare[gid] = { speciesNode: a.speciesNode, event: a.event };
    }
    const { scene } = layoutFor(project, 'α', bare);
    const structural = scene.losses.filter((l) => l.source === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    for (const l of structural) expect(l.inferred).toBe(true);
  });

  it('marks a shortfall explicitly when the asserted λ is below the structural minimum', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const short: Assumptions = {
      ...entry.assumptions,
      ...Object.fromEntries(
        Object.entries(entry.assumptions).map(([gid, a]) => [
          gid,
          a.event === 'speciation' && (a.losses ?? 0) > 0
            ? { ...a, losses: 0 }
            : a,
        ]),
      ),
    };
    const { scene } = layoutFor(project, 'α', short);
    const structural = scene.losses.filter((l) => l.source === 'structural');
    expect(structural.some((l) => l.shortfall)).toBe(true);
  });

  it('draws extra asserted losses beside the asserting gene node', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const extra: Assumptions = {
      ...entry.assumptions,
      ...Object.fromEntries(
        Object.entries(entry.assumptions).map(([gid, a]) => [
          gid,
          a.speciesNode && a.event === 'speciation'
            ? { ...a, losses: (a.losses ?? 0) + 2 }
            : a,
        ]),
      ),
    };
    const { scene } = layoutFor(project, 'α', extra);
    const asserted = scene.losses.filter((l) => l.source === 'asserted');
    expect(asserted.length).toBeGreaterThan(0);
    expect(asserted.reduce((a, b) => a + b.count, 0)).toBe(2);
  });
});

describe('computeEmbeddedReconLayout — unmapped nodes and infeasible paths', () => {
  it('sends an unmapped tip to the orphan gutter and reports unknown-path', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    const betaAssumptions: Assumptions = {};
    // Strip the assumptions of one mapped tip by re-mapping it to a missing
    // species node is impossible — instead drop ALL assumptions except keep
    // the tips label-matched, then break one label.
    for (const [gid, a] of Object.entries(entry.assumptions)) {
      betaAssumptions[gid] = { ...a };
    }
    const { scene } = layoutFor(project, 'β', betaAssumptions);
    expect(scene.orphans.length).toBe(0); // sanity: intact β has no orphans
    void scene;

    // Now an actually unmatchable tip: relabel one tip so nothing maps it.
    const entry2 = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    const renamed = JSON.parse(JSON.stringify(entry2.doc)) as typeof entry2.doc;
    const tip = Object.values(renamed.nodes).find(
      (n) => n.childrenIds.length === 0 && n.label === 'Taxon_A',
    )!;
    tip.label = 'Totally_unknown';
    const speciesLayout = computeLayout(prepareEmbeddedSpeciesDoc(project));
    const scene2 = computeEmbeddedReconLayout({
      speciesDoc: project,
      speciesLayout,
      geneDoc: renamed,
      assumptions: entry2.assumptions,
      options: defaultEmbeddedLayoutOptions(),
    });
    expect(scene2.orphans.length).toBe(1);
    expect(scene2.issues.some((i) => i.kind === 'unmapped-gene-node')).toBe(true);
    // The orphan sits right of the species tree, not on it.
    const orphan = scene2.orphans[0];
    expect(orphan.x).toBeGreaterThan(speciesLayout.bounds.maxX);
  });

  it('draws an infeasible upward move dashed and reports it', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
    const upward: Assumptions = { ...entry.assumptions };
    // Map αEF (below N3) onto the species root — an upward move from αN3 (N3).
    const n3 = Object.values(project.nodes).find((n) => n.label === 'N3')!;
    const root = project.rootId;
    const byLabel = new Map<string, NodeId>();
    for (const n of Object.values(entry.doc.nodes)) byLabel.set(n.label, n.id);
    upward[byLabel.get('αEF')!] = { speciesNode: root, event: 'speciation' };
    // The species root is an ancestor of N3, so αEF maps ABOVE its parent's
    // mapping — the time-travel case.
    expect(speciesAncestorOf(project, root, n3.id)).toBe(true);
    const { scene, geneIdByName } = layoutFor(project, 'α', upward);
    const aEFId = geneIdByName.get('αEF')!;
    const seg = scene.segments.find((s) => s.geneNodeId === aEFId);
    expect(seg?.dashed).toBe(true);
    expect(
      scene.issues.some((i) => i.kind === 'infeasible-lateral' && i.geneNodeId === aEFId),
    ).toBe(true);
  });
});

function speciesAncestorOf(project: ReturnType<typeof createReconciliationSample>, anc: NodeId, id: NodeId): boolean {
  let cur: NodeId | null = id;
  const seen = new Set<NodeId>();
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    if (cur === anc) return true;
    cur = project.nodes[cur]?.parentId ?? null;
  }
  return false;
}

describe('computeEmbeddedReconLayout — lane overflow', () => {
  it('caps the tube width and reports lane-overflow for a huge gene family', () => {
    const project = createReconciliationSample();
    const entry = (project.geneTrees ?? []).find((g) => g.name.includes('β'))!;
    // Duplicate tips B..F labels do not matter; map MANY gene tips onto one
    // species branch via explicit assumptions.
    const huge: Assumptions = { ...entry.assumptions };
    const tipA = Object.values(entry.doc.nodes).find(
      (n) => n.childrenIds.length === 0 && n.label === 'Taxon_A',
    )!;
    const tipB = Object.values(entry.doc.nodes).find(
      (n) => n.childrenIds.length === 0 && n.label === 'Taxon_B',
    )!;
    // 40 extra tips on Taxon_B's branch: build a synthetic gene tree doc.
    const doc = JSON.parse(JSON.stringify(entry.doc)) as typeof entry.doc;
    const b1 = Object.values(doc.nodes).find((n) => n.label === 'β1')!;
    const newTips: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const id = `dup${i}`;
      doc.nodes[id] = { id, label: `D${i}`, parentId: b1.id, childrenIds: [] };
      newTips.push(id);
    }
    b1.childrenIds = [...b1.childrenIds, ...newTips];
    const bSpecies = Object.values(project.nodes).find((n) => n.label === 'Taxon_B')!;
    for (const id of newTips) huge[id] = { speciesNode: bSpecies.id };
    void tipA;
    void tipB;
    const speciesLayout = computeLayout(prepareEmbeddedSpeciesDoc(project));
    const scene = computeEmbeddedReconLayout({
      speciesDoc: project,
      speciesLayout,
      geneDoc: doc,
      assumptions: huge,
      options: defaultEmbeddedLayoutOptions(32, 3),
    });
    expect(scene.issues.some((i) => i.kind === 'lane-overflow')).toBe(true);
    for (const t of scene.tubes.values()) expect(t.width).toBeLessThanOrEqual(32);
  });
});

describe('embedded geometry helpers', () => {
  const project = createReconciliationSample();
  const { scene } = layoutFor(project, 'α');

  it('pointOnTube interpolates t=0/1 to the parent/child ends', () => {
    const tube = [...scene.tubes.values()][0];
    const at0 = pointOnTube(tube, 0);
    const at1 = pointOnTube(tube, 1);
    expect(at0.x).toBeCloseTo(tube.x0, 5);
    expect(at1.x).toBeCloseTo(tube.x1, 5);
    expect(at0.y).toBe(tube.y);
  });

  it('lane offsets stay inside the tube half-width', () => {
    for (const t of scene.tubes.values()) {
      for (let lane = 0; lane < t.lanes; lane += 1) {
        expect(Math.abs(laneOffsetOf(lane, t.lanes, 3))).toBeLessThanOrEqual(t.width / 2);
      }
    }
  });

  it('hitTestTube resolves branch and t inside a tube and null outside', () => {
    const tube = [...scene.tubes.values()].find((t) => t.x1 - t.x0 > 50)!;
    const mid = pointOnTube(tube, 0.5);
    const hit = hitTestTube(scene.tubes.values(), mid, 2);
    expect(hit?.tube.branchId).toBe(tube.branchId);
    expect(hit?.t).toBeGreaterThan(0.4);
    expect(hit?.t).toBeLessThan(0.6);
    expect(hitTestTube(scene.tubes.values(), { x: mid.x, y: mid.y + 500 }, 2)).toBeNull();
  });

  it('fitEmbeddedBounds keeps the scene inside the viewport with padding', () => {
    const fit = fitEmbeddedBounds(scene.bounds, 1200, 800);
    expect(fit.scale).toBeGreaterThan(0);
    expect(fit.tx * 1 + scene.bounds.minX * fit.scale).toBeGreaterThanOrEqual(0);
  });
});
