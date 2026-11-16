// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Regression tests for the 2026-11-15 UI review fixes that live at the
// store/model boundary (the component layer is covered by
// reviewComponentTests.test.ts / commandPaletteLabels.test.ts):
//   * multi-step history jumps (OP-06),
//   * batched find & replace across tabs (OP-02),
//   * document rename / provenance (P-3 / OP-09 / FN-5),
//   * persisted export settings + named presets (P-7 / OP-12),
//   * NeXML round-trip: export → import (FN-4).

import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren, renameNode } from '../model/treeOps';
import {
  applyReplacements,
  collectReplacements,
  type Replacement,
} from '../model/replace';
import { parseNexml, serializeNexml } from '../io/nexml';
import type { Project } from '../model/types';

function threeTipProject(): Project {
  const p = createEmptyProject();
  const [a] = addChildren(p, p.rootId, 2);
  const [b] = addChildren(p, a, 2);
  void b;
  renameNode(p, a, 'Alpha');
  return p;
}

beforeEach(() => {
  localStorage.clear();
  const p = createEmptyProject();
  useStore.getState().loadProject(p);
});

describe('undoSteps / redoSteps (OP-06)', () => {
  it('jumps back N steps atomically and forward again', () => {
    const s = useStore.getState();
    s.apply((d) => renameNode(d, d.rootId, 'one'));
    s.apply((d) => renameNode(d, d.rootId, 'two'));
    s.apply((d) => renameNode(d, d.rootId, 'three'));
    expect(useStore.getState().project.name).not.toBe('three');
    // loadProject keeps ONE undo step pointing at the document it replaced
    // (PM-23), so three edits give four snapshots.
    expect(useStore.getState().past).toHaveLength(4);

    useStore.getState().undoSteps(2);
    const mid = useStore.getState();
    expect(mid.project.nodes[mid.project.rootId].label).toBe('one');
    // One jump, not two separate undos: exactly one entry between target and
    // the abandoned state.
    expect(mid.future).toHaveLength(2);

    useStore.getState().redoSteps(2);
    expect(useStore.getState().project.nodes[useStore.getState().project.rootId].label).toBe('three');
  });

  it('clamps to the stack depth instead of throwing', () => {
    useStore.getState().apply((d) => renameNode(d, d.rootId, 'x'));
    useStore.getState().undoSteps(99);
    expect(useStore.getState().past).toHaveLength(0);
  });
});

describe('find & replace (OP-02)', () => {
  it('previews without mutating and applies only matching fields', () => {
    const p = threeTipProject();
    useStore.getState().loadProject(p);
    const reps = collectReplacements(useStore.getState().project, {
      find: 'alpha',
      replace: 'Beta',
      fields: ['nodeName'],
      caseSensitive: false,
    });
    expect(reps).toHaveLength(1);
    expect(reps[0].newValue).toBe('Beta');
    expect(useStore.getState().project.nodes[p.rootId].label).not.toBe('Beta');

    const applied = useStore.getState().applyReplaceJobs({ [useStore.getState().activeTabId]: reps });
    expect(applied).toBe(1);
    expect(useStore.getState().project.nodes[reps[0].id].label).toBe('Beta');
  });

  it('rewrites PARKED tabs through the snapshot store', () => {
    // openInNewTab parks the PREVIOUSLY active document, so the second call
    // leaves `parked` in tabStore under the middle tab id.
    const parked = threeTipProject();
    useStore.getState().openInNewTab(parked);
    useStore.getState().openInNewTab(threeTipProject());
    const parkedTabId = useStore.getState().tabs[1];
    const reps = collectReplacements(parked, {
      find: 'Alpha',
      replace: 'Parked',
      fields: ['nodeName'],
      caseSensitive: true,
    });
    const applied = useStore.getState().applyReplaceJobs({ [parkedTabId]: reps });
    expect(applied).toBe(1);
    const snap = useStore.getState().tabStore[parkedTabId];
    expect(snap.project.nodes[reps[0].id].label).toBe('Parked');
    // Revision advances so the tab reports unsaved-but-on-disk truthfully.
    expect(snap.revision).toBeGreaterThan(0);
  });

  it('a stale preview cannot overwrite an edit made after collection', () => {
    const p = threeTipProject();
    useStore.getState().loadProject(p);
    const stale: Replacement[] = [
      { field: 'nodeName', id: p.rootId, oldValue: 'Alpha', newValue: 'Stale' },
    ];
    useStore.getState().apply((d) => renameNode(d, d.rootId, 'Fresh'));
    const applied = useStore.getState().applyReplaceJobs({ [useStore.getState().activeTabId]: stale });
    expect(applied).toBe(0);
    expect(useStore.getState().project.nodes[p.rootId].label).toBe('Fresh');
  });

  it('replaces state labels without touching state ids', () => {
    const p = createEmptyProject();
    p.characters = [
      {
        id: 'c1',
        name: 'Habitat',
        type: 'discrete',
        states: [
          { id: 'marine', label: 'marine', color: '#000000' },
          { id: 'terrestrial', label: 'terrestrial', color: '#ffffff' },
        ],
      },
    ];
    useStore.getState().loadProject(p);
    const reps = collectReplacements(useStore.getState().project, {
      find: 'marine',
      replace: 'Marine',
      fields: ['stateLabel'],
      caseSensitive: false,
    });
    expect(reps).toHaveLength(1);
    useStore.getState().apply((d) => {
      applyReplacements(d, reps);
    });
    const ch = useStore.getState().project.characters[0];
    expect(ch.states[0].id).toBe('marine');
    expect(ch.states[0].label).toBe('Marine');
  });
});

describe('document identity (P-3 / OP-09 / FN-5)', () => {
  it('renameProject trims, refuses empty names and is one undo step', () => {
    const before = useStore.getState().project.name;
    useStore.getState().renameProject('   ');
    expect(useStore.getState().project.name).toBe(before);
    useStore.getState().renameProject('  My tree  ');
    expect(useStore.getState().project.name).toBe('My tree');
    useStore.getState().undo();
    expect(useStore.getState().project.name).toBe(before);
  });

  it('setProvenance merges fields and keeps existing ones', () => {
    useStore.getState().setProvenance({ topologySource: 'RAxML', author: 'A' });
    useStore.getState().setProvenance({ traitSource: 'Table S2' });
    const prov = useStore.getState().project.provenance;
    expect(prov?.topologySource).toBe('RAxML');
    expect(prov?.author).toBe('A');
    expect(prov?.traitSource).toBe('Table S2');
  });
});

describe('export settings persistence & presets (P-7 / OP-12)', () => {
  it('settings survive a simulated restart and presets round-trip', () => {
    useStore.getState().setExportSettings({ dpi: 600, followView: false });
    // A fresh module-level read is what the next launch does.
    expect(JSON.parse(localStorage.getItem('cladeforge:exportSettings') ?? '{}').dpi).toBe(600);

    useStore.getState().saveExportPreset('Journal 600');
    useStore.getState().setExportSettings({ dpi: 150, grayscale: true });
    expect(useStore.getState().exportSettings.dpi).toBe(150);

    const preset = useStore.getState().exportPresets.find((p) => p.name === 'Journal 600');
    expect(preset).toBeDefined();
    useStore.getState().applyExportPreset(preset!.id);
    expect(useStore.getState().exportSettings.dpi).toBe(600);
    expect(useStore.getState().exportSettings.grayscale).toBe(false);

    useStore.getState().deleteExportPreset(preset!.id);
    expect(useStore.getState().exportPresets).toHaveLength(0);
  });
});

describe('NeXML round-trip (FN-4)', () => {
  it('export → import preserves tip labels, characters and branch lengths', () => {
    const p = threeTipProject();
    p.characters = [
      {
        id: 'c1',
        name: 'Habitat',
        type: 'discrete',
        states: [
          { id: 'marine', label: 'marine', color: '#000000' },
          { id: 'terrestrial', label: 'terrestrial', color: '#ffffff' },
        ],
      },
    ];
    // Give the root's child a branch length, and score one TIP (NeXML carries
    // observed states on OTUs; internal-node hypotheses are not exported).
    const child = p.nodes[p.rootId].childrenIds[0];
    p.nodes[child].branchLength = 0.5;
    const tip = p.nodes[child].childrenIds[0];
    p.nodes[tip].charStates = { c1: 'marine' };

    const xml = serializeNexml(p);
    const parsed = parseNexml(xml, 'roundtrip');
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.issues).toEqual([]);

    const q = parsed.projects[0];
    const origTips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.label).sort();
    const newTips = Object.values(q.nodes).filter((n) => n.childrenIds.length === 0).map((n) => n.label).sort();
    expect(newTips).toEqual(origTips);

    expect(q.characters).toHaveLength(1);
    expect(q.characters[0].name).toBe('Habitat');
    // The XML state id is generated from the exported symbol, so the imported
    // assignment points at the matching STATE RECORD, not the original id —
    // what matters is that it lands on a real state of this character.
    const marineState = q.characters[0].states.find((s) => s.label === 'marine');
    expect(marineState).toBeDefined();
    const assigned = Object.values(q.nodes).find((n) => n.charStates?.[q.characters[0].id] === marineState!.id);
    expect(assigned).toBeDefined();

    // Branch lengths travel as edge attributes; at least one is restored.
    const hasHalf = Object.values(q.nodes).some((n) => n.branchLength === 0.5);
    expect(hasHalf).toBe(true);
  });
});
