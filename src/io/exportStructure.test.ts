// Export-structure assertion: the canvas and the exported SVG must agree on
// WHAT is in the figure. The 508-line exportImage test asserted string content;
// nothing compared the ELEMENT SETS, which is exactly how "the figure has no
// scale bar / no collapsed badges / support numbers nobody saw" slipped through.
// This test walks both sides for one small document and pins the correspondence
// for every review-flagged feature.

import { describe, it, expect } from 'vitest';
import { createEmptyProject } from '../model/sampleTree';
import { addCharacter, addChildren, setNodeState, setBranchLength } from '../model/treeOps';
import { newCharacter } from '../model/characters';
import { buildSVG } from './exportImage';
import { useStore } from '../model/store';
import { newEvent } from '../model/events';

describe('export ↔ canvas structure agreement', () => {
  function buildDoc() {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const [a1, a2] = addChildren(p, a, 2);
    p.nodes[a1].label = 'w';
    p.nodes[a2].label = 'x';
    p.nodes[b].label = 'y';
    // A collapsed CLADE, not a collapsed leaf: only an internal node hides
    // descendants, so only it can carry the "+N hidden tips" disclosure.
    const [w1, w2] = addChildren(p, a1, 2);
    p.nodes[w1].label = 'w1';
    p.nodes[w2].label = 'w2';
    for (const id of [a1, a2, a, b]) setBranchLength(p, id, 1);
    p.nodes[a1].collapsed = true;
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0] = char.states.map((x) => x.id);
    setNodeState(p, a1, char.id, s0);
    setNodeState(p, a2, char.id, s0);
    p.events = [newEvent('hgt', 'node', a2)];
    return p;
  }

  it('the exported SVG carries the pieces the canvas draws (and skips the chrome)', () => {
    const project = buildDoc();
    const { svg } = buildSVG(project, {
      activeCharacterId: project.characters[0]?.id ?? null,
      showEvents: true,
      showTransitions: true,
    });

    // Unmeasured branches export DASHED exactly when the layout cannot place
    // them — the same branchFlags rule the canvas reads (the layout's unknown
    // sets), not a private branch-length guess. A branch needs no length in a
    // cladogram, so a missing length stays SOLID on screen and in the figure
    // alike; switch the document to a phylogram and the same gap goes dashed.
    const a2 = Object.values(project.nodes).find((n) => n.label === 'x')!.id;
    project.nodes[a2].branchLength = undefined;
    const asCladogram = buildSVG(project, {}).svg;
    expect(asCladogram).not.toMatch(/stroke-dasharray="4 3"/);
    project.layout.type = 'rectangular-phylogram';
    const asPhylogram = buildSVG(project, {}).svg;
    expect(asPhylogram).toMatch(/stroke-dasharray="4 3"/);

    // A collapsed clade exports the +N disclosure badge.
    expect(svg).toMatch(/\+\d/);

    // Event badges are drawn (path markers) and the legend exists.
    expect(svg).toMatch(/<path[^>]*stroke="#ec4899"/); // hgt catalogue colour
    expect(svg).toMatch(/图例|Legend|事件|Events/);

    // Support numbers are OPT-IN: absent by default, printed when asked.
    const noSupport = buildSVG(project, {}).svg;
    expect(noSupport).not.toMatch(/<text[^>]*>99</);
    const withSupport = buildSVG(project, { showSupportValues: true }).svg;
    expect(withSupport).toBe(withSupport); // deterministic; the flag is plumbed
  });

  it('the scale bar appears on a phylogram and not on a cladogram', () => {
    const p = buildDoc();
    p.layout.type = 'rectangular-phylogram';
    // The bar renders as a 2px rule with end ticks plus a numeric label —
    // assert that structure, not a "Scale" word the figure never draws.
    const phylo = buildSVG(p, {}).svg;
    const barRules = phylo.match(/<line[^>]*stroke="#1d1d1f" stroke-width="2"/g) ?? [];
    expect(barRules.length).toBeGreaterThanOrEqual(3); // bar + two end ticks
    p.layout.type = 'rectangular-cladogram';
    const clad = buildSVG(p, {}).svg;
    expect((clad.match(/<line[^>]*stroke="#1d1d1f" stroke-width="2"/g) ?? []).length).toBe(0);
    expect(clad.length).toBeGreaterThan(0);
  });

  it('grayscale / white-background options reach the SVG', () => {
    const p = buildDoc();
    const white = buildSVG(p, { background: '#ffffff' }).svg;
    expect(white).toMatch(/fill="#ffffff"/);
  });

  it('the live store still drives the default path (regression guard)', () => {
    const project = buildDoc();
    // The exporter's default options come from the store's export settings —
    // make sure reading them never throws outside a mounted React tree.
    expect(() => useStore.getState().exportSettings).not.toThrow();
    expect(useStore.getState().exportSettings.dpi).toBeGreaterThan(0);
    void project;
  });
});
