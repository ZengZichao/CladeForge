// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Collision-aware canvas annotation layout (BUG-4 + the label-label overlap it
// uncovered). The browser acceptance test walks the real SVG with
// getBoundingClientRect; these unit tests pin the same contract in world
// coordinates, which is what the solver reasons about — a uniform pan/zoom
// transform cannot change whether two boxes intersect.
//
// The Cetacean sample is the document the bug report is about: in the
// phylogram / time-calibrated layouts "Basilosauridae" sits so close to its child
// "Neoceti" that the two labels overlapped, and Neoceti's KI / AR badges landed
// on the "Basilosauridae" label in every rectangular layout.

import { describe, it, expect } from 'vitest';
import { computeLayout } from '../layout/autoLayout';
import type { LayoutResult } from '../layout/autoLayout';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import { EVENT_BADGE_RADIUS } from '../model/events';
import { labelBoxForNode, type Box } from './labelBounds';
import {
  BADGE_LEADER_MIN_SHIFT,
  MAX_COLLISION_PLAN_NODES,
  badgeCandidateOffsets,
  boxesIntersect,
  getCanvasCollisionPlan,
  getLastCanvasCollisionPlan,
  naturalBadgeAnchor,
  nodeMarkerBox,
  planEventAnchors,
  planLabelNudges,
  timeAxisTextBoxes,
  translateBox,
  unionBoxes,
  type AxisOverlayOptions,
  type EventAnchorInput,
} from './eventBadgeLayout';
import type { LayoutType, Project } from '../model/types';

const LAYOUTS: LayoutType[] = [
  'rectangular-cladogram',
  'rectangular-phylogram',
  'time-calibrated',
  'circular',
];

const AXIS: AxisOverlayOptions = { showEras: false, eraLevel: 'both' };

/** The Cetacean sample, switched to one layout (fresh objects per call). */
function cetacean(type: LayoutType): Project {
  const project = SAMPLE_PROJECTS.find((s) => s.id === 'cetacean')!.build();
  project.layout.type = type;
  return project;
}

function nodeByLabel(project: Project, label: string): string {
  const node = Object.values(project.nodes).find((n) => n.label === label);
  if (!node) throw new Error(`no node labelled ${label}`);
  return node.id;
}

/** Tight label boxes (the boxes the stagger solver uses) after applying nudges. */
function staggeredLabelBoxes(
  project: Project,
  layout: LayoutResult,
  nudges: ReadonlyMap<string, number>,
): { id: string; label: string; box: Box }[] {
  const out: { id: string; label: string; box: Box }[] = [];
  for (const id of layout.visible) {
    const node = project.nodes[id];
    const box = labelBoxForNode(project, layout.positions, node, { widthFactor: 1, heightFactor: 0.68 });
    if (!box) continue;
    out.push({ id, label: node.label, box: translateBox(box, 0, nudges.get(id) ?? 0) });
  }
  return out;
}

function anchorInput(project: Project, layout: LayoutResult): EventAnchorInput {
  const plan = getCanvasCollisionPlan(project, AXIS);
  return {
    project,
    events: project.events,
    positions: layout.positions,
    nodes: project.nodes,
    culled: layout.visible,
    orientation: project.layout.orientation,
    layoutType: project.layout.type,
    labelNudges: plan?.nudges ?? new Map(),
    axisBoxes: plan?.axisBoxes ?? [],
  };
}

describe('boxesIntersect — touching boxes do not count as a collision', () => {
  const a: Box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it('detects genuine overlap', () => {
    expect(boxesIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });
  it('treats shared edges as clear (adjacent labels must be allowed)', () => {
    expect(boxesIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(boxesIntersect(a, { minX: 0, minY: 10, maxX: 10, maxY: 20 })).toBe(false);
  });
});

describe('badgeCandidateOffsets — nearest-first, along the branch before across it', () => {
  it('starts at the natural anchor and never gets closer', () => {
    const offsets = badgeCandidateOffsets('rectangular-cladogram', 'LR', { x: 40, y: 40 });
    expect(offsets[0]).toEqual({ x: 0, y: 0 });
    const distances = offsets.map((p) => Math.hypot(p.x, p.y));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] - 1e-9);
    }
  });

  it('tries the branch axis first for a horizontal layout', () => {
    const offsets = badgeCandidateOffsets('rectangular-cladogram', 'LR', { x: 0, y: 0 });
    // First ring is 12 world px; index 1 is along the branch (+x), index 2 back.
    expect(offsets[1].x).toBeCloseTo(12, 8);
    expect(offsets[1].y).toBeCloseTo(0, 8);
    expect(offsets[2].x).toBeCloseTo(-12, 8);
  });

  it('tries the branch axis first for a vertical layout', () => {
    const offsets = badgeCandidateOffsets('rectangular-cladogram', 'TB', { x: 0, y: 0 });
    expect(offsets[1].x).toBeCloseTo(0, 8);
    expect(offsets[1].y).toBeCloseTo(12, 8);
  });
});

describe('label stagger — no two rendered labels overlap', () => {
  for (const type of LAYOUTS) {
    it(`${type}: labels are pairwise disjoint`, () => {
      const project = cetacean(type);
      const layout = computeLayout(project);
      const plan = getCanvasCollisionPlan(project, AXIS)!;
      const boxes = staggeredLabelBoxes(project, layout, plan.nudges);
      expect(boxes.length).toBeGreaterThan(5);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(
            boxesIntersect(boxes[i].box, boxes[j].box),
            `${boxes[i].label} × ${boxes[j].label}`,
          ).toBe(false);
        }
      }
    });
  }

  it('fixes the reported Basilosauridae × Neoceti overlap in short-branch layouts', () => {
    for (const type of ['rectangular-phylogram', 'time-calibrated'] as LayoutType[]) {
      const project = cetacean(type);
      const layout = computeLayout(project);
      const plan = getCanvasCollisionPlan(project, AXIS)!;
      const boxes = staggeredLabelBoxes(project, layout, plan.nudges);
      const basilo = boxes.find((b) => b.label === 'Basilosauridae')!;
      const neoceti = boxes.find((b) => b.label === 'Neoceti')!;
      expect(boxesIntersect(basilo.box, neoceti.box), `${type}: sample labels still overlap`).toBe(false);
      expect(plan.nudges.get(neoceti.id), `${type}: child label must yield`).toBeLessThan(0);
      expect(plan.nudges.get(basilo.id) ?? 0, `${type}: parent label keeps its row`).toBe(0);
    }
  });

  it('does not stagger the circular layout, whose radial labels are already placed apart', () => {
    const project = cetacean('circular');
    const layout = computeLayout(project);
    const plan = getCanvasCollisionPlan(project, AXIS)!;
    for (const nudge of plan.nudges.values()) expect(nudge).toBe(0);
  });

  it('is deterministic', () => {
    const project = cetacean('rectangular-phylogram');
    const layout = computeLayout(project);
    const a = planLabelNudges(project, layout.positions, layout.visible, []);
    const b = planLabelNudges(project, layout.positions, layout.visible, []);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('never pushes a label into time-axis text', () => {
    const project = cetacean('time-calibrated');
    project.environmentalEvents = [];
    const layout = computeLayout(project);
    const axis = timeAxisTextBoxes(project, layout, { showEras: true, eraLevel: 'both' });
    expect(axis.length).toBeGreaterThan(3);
    const nudges = planLabelNudges(project, layout.positions, layout.visible, axis);
    const labels = staggeredLabelBoxes(project, layout, nudges);
    for (const label of labels) for (const box of axis) expect(boxesIntersect(label.box, box)).toBe(false);
  });
});

describe('time-axis text boxes', () => {
  it('mirrors the tick row drawn by TimeAxis', () => {
    const project = cetacean('time-calibrated');
    const layout = computeLayout(project);
    const info = layout.timeAxis!;
    const boxes = timeAxisTextBoxes(project, layout, AXIS);
    // One box per tick, plus one per environmental-event label.
    expect(boxes.length).toBe(info.ticks.length + project.environmentalEvents.length);
    // The tick labels sit below the bands (breadth extent + PAD + 13).
    const tickY = info.breadthMax + 24 + 13;
    for (const box of boxes.slice(0, info.ticks.length)) {
      expect(box.minY).toBeLessThan(tickY);
      expect(box.maxY).toBeGreaterThan(tickY);
    }
  });

  it('adds era-label rows when the geological bands are shown', () => {
    const project = cetacean('time-calibrated');
    const layout = computeLayout(project);
    const hidden = timeAxisTextBoxes(project, layout, { showEras: false, eraLevel: 'both' });
    const shown = timeAxisTextBoxes(project, layout, { showEras: true, eraLevel: 'both' });
    expect(shown.length).toBeGreaterThan(hidden.length);
  });

  it('returns nothing for layouts without a time axis', () => {
    const project = cetacean('rectangular-cladogram');
    const layout = computeLayout(project);
    expect(timeAxisTextBoxes(project, layout, AXIS)).toEqual([]);
  });
});

describe('event badge placement — clears labels, markers, axis text and other badges', () => {
  for (const type of LAYOUTS) {
    it(`${type}: every badge clears the drawing`, () => {
      const project = cetacean(type);
      const layout = computeLayout(project);
      const plan = getCanvasCollisionPlan(project, AXIS)!;
      const anchors = planEventAnchors(anchorInput(project, layout)).anchors;
      expect(anchors.size).toBe(project.events.length);

      const labelBoxes: Box[] = [];
      for (const id of layout.visible) {
        const node = project.nodes[id];
        const box = labelBoxForNode(project, layout.positions, node);
        if (box) labelBoxes.push(translateBox(box, 0, plan.nudges.get(id) ?? 0));
      }
      const markerBoxes = [...layout.visible]
        .map((id) => nodeMarkerBox(project, layout.positions, project.nodes[id]))
        .filter((b): b is Box => b !== null);
      const half = EVENT_BADGE_RADIUS + 1.5;
      for (const [eventId, a] of anchors) {
        const badge: Box = { minX: a.x - half, minY: a.y - half, maxX: a.x + half, maxY: a.y + half };
        for (const label of labelBoxes) expect(boxesIntersect(badge, label)).toBe(false);
        for (const marker of markerBoxes) expect(boxesIntersect(badge, marker)).toBe(false);
        for (const axis of plan.axisBoxes) expect(boxesIntersect(badge, axis)).toBe(false);
        expect(Number.isFinite(a.x) && Number.isFinite(a.y), `${eventId} finite`).toBe(true);
      }
    });
  }

  it('keeps a node’s events together as one stack (KI + AR of Neoceti)', () => {
    for (const type of LAYOUTS) {
      const project = cetacean(type);
      const layout = computeLayout(project);
      const plan = getCanvasCollisionPlan(project, AXIS)!;
      const planAnchors = planEventAnchors(anchorInput(project, layout));
      const input = anchorInput(project, layout);
      const events = project.events;
      const natural = events.map((e) => naturalBadgeAnchor(e, 0, input)!);
      const placed = events.map((e) => planAnchors.anchors.get(e.id)!);
      // Both badges moved by the same offset: the pair still reads as one cluster.
      const dx = placed[0].x - natural[0].x;
      const dy = placed[0].y - natural[0].y;
      for (let i = 1; i < events.length; i++) {
        expect(placed[i].x - natural[i].x).toBeCloseTo(dx, 6);
        expect(placed[i].y - natural[i].y).toBeCloseTo(dy, 6);
      }
      // On-branch / near-branch natural anchors are 16–18 world px apart.
      const separation = Math.hypot(natural[0].x - natural[1].x, natural[0].y - natural[1].y);
      expect(separation).toBeGreaterThan(12);
      expect(separation).toBeLessThan(20);
    }
  });

  it('reports a leader line when a stack is displaced, and not otherwise', () => {
    const cladogram = (() => {
      const project = cetacean('rectangular-cladogram');
      const layout = computeLayout(project);
      return planEventAnchors(anchorInput(project, layout));
    })();
    expect(cladogram.leaders).toHaveLength(1);
    const leader = cladogram.leaders[0];
    expect(Math.hypot(leader.from.x - leader.to.x, leader.from.y - leader.to.y)).toBeGreaterThanOrEqual(
      BADGE_LEADER_MIN_SHIFT,
    );

    const circular = (() => {
      const project = cetacean('circular');
      const layout = computeLayout(project);
      return planEventAnchors(anchorInput(project, layout));
    })();
    expect(circular.leaders).toHaveLength(0);
  });

  it('does not let the two badges of one stack be confused with another node’s badge', () => {
    const project = cetacean('rectangular-cladogram');
    // Add a second cluster on a different node to exercise badge-vs-badge spacing.
    const pakicetus = nodeByLabel(project, 'Pakicetus');
    project.events.push({
      id: 'extra-event',
      typeId: 'extinction-local',
      target: 'node',
      nodeId: pakicetus,
      triggers: [],
    });
    const layout = computeLayout(project);
    const plan = getCanvasCollisionPlan(project, AXIS)!;
    const input: EventAnchorInput = {
      ...anchorInput(project, layout),
      events: project.events,
      labelNudges: plan.nudges,
      axisBoxes: plan.axisBoxes,
    };
    const anchors = planEventAnchors(input).anchors;
    const half = EVENT_BADGE_RADIUS + 1.5;
    const boxOf = (id: string): Box => {
      const a = anchors.get(id)!;
      return { minX: a.x - half, minY: a.y - half, maxX: a.x + half, maxY: a.y + half };
    };
    expect(boxesIntersect(boxOf('extra-event'), boxOf(project.events[0].id))).toBe(false);
    expect(boxesIntersect(boxOf('extra-event'), boxOf(project.events[1].id))).toBe(false);
  });
});

describe('label geometry helpers', () => {
  it('labelBoxForNode mirrors the union box of labelBoxes()', () => {
    const project = cetacean('rectangular-cladogram');
    const layout = computeLayout(project);
    const boxes = [...layout.visible]
      .map((id) => labelBoxForNode(project, layout.positions, project.nodes[id]))
      .filter((b): b is Box => b !== null);
    const union = unionBoxes(boxes)!;
    for (const b of boxes) {
      expect(b.minX).toBeGreaterThanOrEqual(union.minX);
      expect(b.maxX).toBeLessThanOrEqual(union.maxX);
    }
  });

  it('measures CJK labels at full em width, not the Latin advance', () => {
    const project = cetacean('rectangular-cladogram');
    const layout = computeLayout(project);
    const id = nodeByLabel(project, 'Cetacea');
    const node = project.nodes[id];
    const latin = labelBoxForNode(project, layout.positions, node, { widthFactor: 1 })!;
    node.label = '鲸类水生适应'; // 6 full-width glyphs
    const cjk = labelBoxForNode(project, layout.positions, node, { widthFactor: 1 })!;
    const latinWidth = latin.maxX - latin.minX;
    const cjkWidth = cjk.maxX - cjk.minX;
    expect(cjkWidth).toBeGreaterThan(latinWidth);
    // 6 CJK glyphs at fontSize 14 ≈ 84 world px; the Latin "Cetacea" is ~0.62em each.
    expect(cjkWidth).toBeGreaterThan(6 * 14 * 0.9);
  });
});

describe('cached canvas plan', () => {
  it('returns the same plan object for the same project revision', () => {
    const project = cetacean('rectangular-phylogram');
    const a = getCanvasCollisionPlan(project, AXIS);
    const b = getCanvasCollisionPlan(project, AXIS);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(getLastCanvasCollisionPlan(AXIS)).toBe(a);
  });

  it('separates plans by time-axis options', () => {
    const project = cetacean('time-calibrated');
    const withoutEras = getCanvasCollisionPlan(project, { showEras: false, eraLevel: 'both' })!;
    const withEras = getCanvasCollisionPlan(project, { showEras: true, eraLevel: 'both' })!;
    expect(withoutEras).not.toBe(withEras);
    expect(withEras.axisBoxes.length).toBeGreaterThan(withoutEras.axisBoxes.length);
  });

  it('skips the fix for documents above the size gate', () => {
    const project = cetacean('rectangular-cladogram');
    const template = project.nodes[project.rootId];
    for (let i = 0; i <= MAX_COLLISION_PLAN_NODES; i++) {
      project.nodes[`filler-${i}`] = { ...template, id: `filler-${i}`, parentId: null, childrenIds: [] };
    }
    expect(getCanvasCollisionPlan(project, AXIS)).toBeNull();
  });
});
