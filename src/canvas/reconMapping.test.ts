// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Pure-function contracts for the reconciliation mapping layer (§6.4):
// scope/event filtering, selection emphasis, missing endpoints, bundling and
// colour tokens — the rules that keep 21-node families from becoming line
// spaghetti must be testable without rendering anything.

import { describe, it, expect } from 'vitest';
import { collectMappingLines, eventToken, scopePasses, eventFilterPasses, bridgeLine, bundleTotals, type PaneView } from './reconMapping';
import { computeLayout } from '../layout/autoLayout';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import type { GeneNodeAssumption, NodeId, Project, ReconViewOptions } from '../model/types';
import { DEFAULT_RECON_VIEW_OPTIONS } from '../model/types';

/** Build a binary 3-tip species tree; returns its node ids by label. */
function speciesFixture(): { doc: Project; ids: Record<string, NodeId> } {
  const doc = createEmptyProject('species');
  const root = doc.rootId;
  doc.nodes[root].label = 'R';
  const [ab] = addChildren(doc, root, 2);
  doc.nodes[ab].label = 'AB';
  const [a, b] = addChildren(doc, ab, 2);
  doc.nodes[a].label = 'A';
  doc.nodes[b].label = 'B';
  const [c] = addChildren(doc, root, 1);
  addChildren(doc, c, 0);
  doc.nodes[c].label = 'C';
  return { doc, ids: { R: root, AB: ab, A: a, B: b, C: c } };
}

/** Gene tree: root g0 with two internal children (g1, g2), g1 holding tips tA, tB. */
function geneFixture(): { doc: Project; ids: Record<string, NodeId> } {
  const doc = createEmptyProject('gene');
  const root = doc.rootId;
  doc.nodes[root].label = 'g0';
  const [g1, g2] = addChildren(doc, root, 2);
  doc.nodes[g1].label = 'g1';
  doc.nodes[g2].label = 'g2';
  const [tA, tB] = addChildren(doc, g1, 2);
  doc.nodes[tA].label = 'tA';
  doc.nodes[tB].label = 'tB';
  return { doc, ids: { g0: root, g1, g2, tA, tB } };
}

// One shared fixture pair for ALL builds: node ids are random per
// createEmptyProject call, so a fresh fixture per `build()` would invalidate
// assumption keys captured from an earlier call.
let FIXTURES: { sp: ReturnType<typeof speciesFixture>; ge: ReturnType<typeof geneFixture> } | null = null;
function fixtures() {
  if (!FIXTURES) FIXTURES = { sp: speciesFixture(), ge: geneFixture() };
  return FIXTURES;
}

const pane = (transform: PaneView['transform']): PaneView => ({
  left: 0,
  top: 0,
  width: 400,
  height: 300,
  transform,
});

const PANE: PaneView = pane({ tx: 10, ty: 10, scale: 1 });
const PANE2: PaneView = pane({ tx: 10, ty: 10, scale: 1 });

function options(over: Partial<ReconViewOptions> = {}): ReconViewOptions {
  return { ...DEFAULT_RECON_VIEW_OPTIONS, ...over };
}

function build(
  assumptions: Record<NodeId, GeneNodeAssumption>,
  over: {
    options?: Partial<ReconViewOptions>;
    selected?: NodeId[];
    hovered?: NodeId | null;
    geneDoc?: Project;
    speciesDoc?: Project;
  } = {},
) {
  const { sp, ge } = fixtures();
  return {
    sp,
    ge,
    lines: collectMappingLines({
      speciesDoc: over.speciesDoc ?? sp.doc,
      geneDoc: over.geneDoc ?? ge.doc,
      assumptions,
      speciesLayout: computeLayout(sp.doc),
      geneLayout: computeLayout(ge.doc),
      speciesPane: PANE,
      genePane: PANE2,
      options: options(over.options),
      selectedGeneIds: over.selected ?? [],
      hoveredGeneId: over.hovered ?? null,
    }),
  };
}

describe('collectMappingLines', () => {
  it('empty assumptions produce zero lines', () => {
    const { lines } = build({});
    expect(lines).toEqual([]);
  });

  it('a dangling species target (missing endpoint) produces no line', () => {
    const { ge } = build({});
    const { lines } = build({ [ge.ids.tA]: { speciesNode: 'nope' } });
    expect(lines).toEqual([]);
  });

  it('scope=tips excludes internal mappings, scope=internal excludes tips', () => {
    const { ge, sp } = build({});
    const assumptions: Record<NodeId, GeneNodeAssumption> = {
      [ge.ids.g1]: { speciesNode: sp.ids.AB, event: 'speciation' },
      [ge.ids.tA]: { speciesNode: sp.ids.A },
    };
    const tips = build(assumptions, { options: { mappingScope: 'tips' } }).lines;
    expect(tips.map((l) => l.geneNodeId)).toEqual([ge.ids.tA]);
    const internal = build(assumptions, { options: { mappingScope: 'internal' } }).lines;
    expect(internal.map((l) => l.geneNodeId)).toEqual([ge.ids.g1]);
    const all = build(assumptions, { options: { mappingScope: 'all' } }).lines;
    expect(all).toHaveLength(2);
  });

  it('a SELECTED internal node stays visible even when the scope is tips, others mute', () => {
    const { ge, sp } = build({});
    const assumptions: Record<NodeId, GeneNodeAssumption> = {
      [ge.ids.g1]: { speciesNode: sp.ids.AB, event: 'speciation' },
      [ge.ids.tA]: { speciesNode: sp.ids.A },
    };
    const { lines } = build(assumptions, {
      options: { mappingScope: 'tips' },
      selected: [ge.ids.g1],
    });
    const byId = new Map(lines.map((l) => [l.geneNodeId, l]));
    expect(byId.get(ge.ids.g1)?.state).toBe('selected');
    expect(byId.get(ge.ids.tA)?.state).toBe('muted');
  });

  it('hover emphasises one line and mutes the rest', () => {
    const { ge, sp } = build({});
    const assumptions: Record<NodeId, GeneNodeAssumption> = {
      [ge.ids.g1]: { speciesNode: sp.ids.AB, event: 'speciation' },
      [ge.ids.tA]: { speciesNode: sp.ids.A },
    };
    // Scope 'all': with the default tips-only scope the internal line would be
    // scope-filtered before the emphasis rules even apply.
    const { lines } = build(assumptions, { options: { mappingScope: 'all' }, hovered: ge.ids.tA });
    const byId = new Map(lines.map((l) => [l.geneNodeId, l]));
    expect(byId.get(ge.ids.tA)?.state).toBe('hovered');
    expect(byId.get(ge.ids.g1)?.state).toBe('muted');
  });

  it('the event filter keeps only matching events; unresolved keeps event-less lines', () => {
    const { ge, sp } = build({});
    const assumptions: Record<NodeId, GeneNodeAssumption> = {
      [ge.ids.g1]: { speciesNode: sp.ids.AB, event: 'duplication' },
      [ge.ids.g2]: { speciesNode: sp.ids.C, event: 'transfer' },
      [ge.ids.tA]: { speciesNode: sp.ids.A },
    };
    const allOpts = { mappingScope: 'all' as const };
    const dupOnly = build(assumptions, { options: { ...allOpts, eventFilter: 'duplication' } }).lines;
    expect(dupOnly.map((l) => l.event)).toEqual(['duplication']);
    const unresolved = build(assumptions, { options: { ...allOpts, eventFilter: 'unresolved' } }).lines;
    expect(unresolved.map((l) => l.geneNodeId)).toEqual([ge.ids.tA]);
    // The default tips scope ALSO drops the internal lines before the filter:
    // tips + unresolved = the event-less tip line only.
    const tipsUnresolved = build(assumptions, { options: { eventFilter: 'unresolved' } }).lines;
    expect(tipsUnresolved.map((l) => l.geneNodeId)).toEqual([ge.ids.tA]);
  });

  it('lines bundling onto the same species node + event collapse into one with a count', () => {
    const { ge, sp } = build({});
    // Two tips mapped to the same species node: one entry, bundleCount 2.
    const assumptions: Record<NodeId, GeneNodeAssumption> = {
      [ge.ids.tA]: { speciesNode: sp.ids.A },
      [ge.ids.tB]: { speciesNode: sp.ids.A },
    };
    const { lines } = build(assumptions);
    expect(lines).toHaveLength(1);
    expect(lines[0].bundleCount).toBe(2);
    expect(bundleTotals(lines).total).toBe(2);
    // Selected lines are exempt from collapsing? No — bundling is identity-based;
    // selection emphasis still applies to the surviving line.
    const { lines: selLines } = build(assumptions, { selected: [ge.ids.tA] });
    expect(selLines).toHaveLength(1);
    expect(selLines[0].state).toBe('selected');
  });

  it('endpoints run from the species pane right edge to the gene pane left edge', () => {
    const { ge, sp } = build({});
    const { lines } = build({ [ge.ids.tA]: { speciesNode: sp.ids.A } });
    expect(lines).toHaveLength(1);
    // A tip mapping with no event asserted carries the TIP token (solid), not
    // the unresolved one (dashed grey) — unresolved is for internal nodes.
    expect(lines[0].token).toBe('tip');
    expect(lines[0].from.x).toBe(PANE.left + PANE.width);
    expect(lines[0].to.x).toBe(PANE2.left);
    // y = pane.top + layoutY * scale + ty
    expect(lines[0].from.y).toBeGreaterThan(0);
    expect(lines[0].to.y).toBeGreaterThan(0);
    expect(bridgeLine(lines[0].from, lines[0].to)).toMatch(/^M [^ ]+ [^ ]+ L [^ ]+ [^ ]+$/);
  });
});

describe('event tokens and small predicates', () => {
  it('bridge paths are straight segments, never curves', () => {
    const d = bridgeLine({ x: 10, y: 20 }, { x: 310, y: 120 });
    expect(d).toBe('M 10 20 L 310 120');
    expect(d).not.toContain('C');
  });

  it('event tokens map to the four colour classes', () => {
    expect(eventToken('speciation')).toBe('sigma');
    expect(eventToken('duplication')).toBe('dup');
    expect(eventToken('transfer')).toBe('transfer');
    expect(eventToken(null)).toBe('unresolved');
    expect(eventToken(undefined)).toBe('unresolved');
  });

  it('scope predicates', () => {
    expect(scopePasses('tip', 'tips')).toBe(true);
    expect(scopePasses('internal', 'tips')).toBe(false);
    expect(scopePasses('internal', 'internal')).toBe(true);
    expect(scopePasses('tip', 'all')).toBe(true);
  });

  it('event filter predicates', () => {
    expect(eventFilterPasses('duplication', 'all')).toBe(true);
    expect(eventFilterPasses('duplication', 'duplication')).toBe(true);
    expect(eventFilterPasses('transfer', 'duplication')).toBe(false);
    expect(eventFilterPasses(null, 'unresolved')).toBe(true);
    expect(eventFilterPasses('speciation', 'unresolved')).toBe(false);
  });
});
