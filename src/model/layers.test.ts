// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { createEmptyProject, createFeatureTourSample } from './sampleTree';
import { addCharacter, addChildren, deleteNode, removeCharacter, rerootAtNode, setNodeState } from './treeOps';
import { newCharacter } from './characters';
import { addBlankLayer, duplicateActiveLayer, layerDiff, layerRecordCounts, pruneLayerStore, switchLayer } from './layers';
import { newEvent } from './events';

describe('hypothesis layers', () => {
  it('isolates internal-node hypotheses across layers while sharing tips', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 2); // a, b tips under the (internal) root
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, a, char.id, s0); // tip observation (shared)
    setNodeState(p, p.rootId, char.id, s0); // root hypothesis in layer 1

    const layer1 = p.activeLayerId;
    const layer2 = duplicateActiveLayer(p, 'H2');
    switchLayer(p, layer2);
    expect(p.nodes[p.rootId].charStates?.[char.id]).toBe(s0); // copied

    setNodeState(p, p.rootId, char.id, s1); // diverge in layer 2
    expect(p.nodes[a].charStates?.[char.id]).toBe(s0); // tip untouched

    switchLayer(p, layer1);
    expect(p.nodes[p.rootId].charStates?.[char.id]).toBe(s0); // layer 1 preserved
    expect(p.nodes[a].charStates?.[char.id]).toBe(s0);

    switchLayer(p, layer2);
    expect(p.nodes[p.rootId].charStates?.[char.id]).toBe(s1); // layer 2 preserved
    expect(p.nodes[a].charStates?.[char.id]).toBe(s0);
  });

  it('keeps hypothesis notes inside their layer and clears them in a blank layer', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 2);
    p.nodes[a].hypothesisNote = 'layer 1 statement';
    const layer1 = p.activeLayerId;
    const layer2 = duplicateActiveLayer(p, 'H2');

    switchLayer(p, layer2);
    expect(p.nodes[a].hypothesisNote).toBe('layer 1 statement'); // duplicated
    p.nodes[a].hypothesisNote = 'layer 2 statement';
    switchLayer(p, layer1);
    expect(p.nodes[a].hypothesisNote).toBe('layer 1 statement');
    switchLayer(p, layer2);
    expect(p.nodes[a].hypothesisNote).toBe('layer 2 statement');

    const blank = addBlankLayer(p, 'blank');
    switchLayer(p, blank);
    expect(p.nodes[a].hypothesisNote).toBeUndefined();
  });

  it('a blank layer clears internal hypotheses but keeps tips', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const s0 = char.states[0].id;
    setNodeState(p, a, char.id, s0);
    setNodeState(p, p.rootId, char.id, s0);

    const blank = addBlankLayer(p, 'blank');
    switchLayer(p, blank);
    expect(p.nodes[p.rootId].charStates?.[char.id]).toBeUndefined(); // internal cleared
    expect(p.nodes[a].charStates?.[char.id]).toBe(s0); // tip kept
  });
});

// --- a stored layer must not re-publish deleted characters -------------------

describe('layer switching after a character deletion', () => {
  it('does not resurrect a deleted character\'s states or evidence', () => {
    // `removeCharacter` cleans the live nodes and the copies parked in the
    // non-active layers alike: a stale copy would reappear on the next
    // `switchLayer` — then go out through `hypothesisExport` as evidence for a
    // trait the document does not have.
    const p = createFeatureTourSample();
    expect(p.layers).toHaveLength(2);
    const matrixChar = p.characters.find((c) => c.costMatrix)!;
    expect(p.nodes[p.rootId].charStates?.[matrixChar.id]).toBeDefined();

    removeCharacter(p, matrixChar.id);
    switchLayer(p, p.layers[1].id);
    for (const n of Object.values(p.nodes)) {
      expect(n.charStates?.[matrixChar.id]).toBeUndefined();
      expect(n.charMeta?.[matrixChar.id]).toBeUndefined();
    }
    switchLayer(p, p.layers[0].id);
    for (const n of Object.values(p.nodes)) {
      expect(n.charStates?.[matrixChar.id]).toBeUndefined();
      expect(n.charMeta?.[matrixChar.id]).toBeUndefined();
    }
    // The surviving character's tip observations are shared across layers and
    // must be untouched by either the deletion or the switches.
    const plainChar = p.characters[0];
    expect(plainChar.id).not.toBe(matrixChar.id);
    const scoredTips = Object.values(p.nodes).filter(
      (n) => n.childrenIds.length === 0 && n.charStates?.[plainChar.id],
    );
    expect(scoredTips.length).toBe(4);
    expect(pruneLayerStore(p).changed).toBe(false); // nothing left to prune
  });

  it('pruneLayerStore removes orphan keys a load may still carry, then converges', () => {
    const p = createEmptyProject();
    addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const second = addBlankLayer(p, 'empty');
    // Simulate a loaded file carrying a stored layer keyed by a character id
    // the document no longer declares.
    const doomed = char.id;
    p.layerStore[second].states[p.rootId] = { [doomed]: 'gone-state' };
    p.layerStore[second].meta[p.rootId] = { [doomed]: { confidence: 'low', support: 'x' } };
    p.layerStore[second].notes = { 'node-that-no-longer-exists': 'orphan note' };
    p.characters = [];

    const summary = pruneLayerStore(p);
    expect(summary.changed).toBe(true);
    expect(summary.states).toBe(1);
    expect(summary.meta).toBe(1);
    expect(summary.notes).toBe(1);
    expect(p.layerStore[second].states[p.rootId]).toBeUndefined();
    expect(p.layerStore[second].meta[p.rootId]).toBeUndefined();
    expect(p.layerStore[second].notes).toEqual({});
    expect(pruneLayerStore(p).changed).toBe(false); // idempotent

    switchLayer(p, second);
    expect(p.nodes[p.rootId].charStates).toBeUndefined();
    expect(p.nodes[p.rootId].charMeta).toBeUndefined();
  });

  // Regression for the review finding "re-rooting silently destroys the events
  // and notes of INACTIVE hypothesis layers": the splice-out of the old root
  // used to migrate only the live layer's references, so a stored layer's
  // events kept pointing at the dead node id and were pruned unread on the
  // next load.
  it('migrates stored-layer events and notes when a re-root splices the old root', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const layer1 = p.activeLayerId;
    const layer2 = duplicateActiveLayer(p, 'H2');

    // Layer 2 owns an event on the root and a note on the root. Park it in the
    // store by switching away.
    switchLayer(p, layer2);
    const ev = newEvent('hgt', 'node', p.rootId);
    p.events = [ev];
    p.nodes[a].hypothesisNote = 'H2 note on a';
    p.nodes[p.rootId].hypothesisNote = 'H2 note on root';
    switchLayer(p, layer1);
    expect(p.layerStore[layer2].events.length).toBe(1);

    // Re-root onto tip `b`: the old root has one child left, so it is spliced
    // out and every reference on it must move to the survivor.
    expect(rerootAtNode(p, b)).toBe(true);
    const stored = p.layerStore[layer2];
    expect(stored.events.length).toBe(1);
    expect(p.nodes[stored.events[0].nodeId]).toBeDefined();
    expect(stored.events[0].nodeId).toBe(a); // migrated off the dying root
    const notes = stored.notes ?? {};
    for (const nid of Object.keys(notes)) {
      expect(p.nodes[nid]).toBeDefined();
    }
    expect(notes[a]).toBe('H2 note on a'); // survivor's own note wins the merge

    // Loading the document back must not report anything pruned: nothing is
    // dangling any more.
    expect(pruneLayerStore(p).changed).toBe(false);
  });

  // Regression for the review finding (M3): deleteNode used to clean only the
  // LIVE layer's events plus the stored layers' NOTES — the stored layers'
  // events/states/meta kept the dead node ids, and switching back to such a
  // layer resurrected orphan events into the live document.
  it('deleteNode cleans stored layers so no orphan event revives on switch', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 2);
    const layer1 = p.activeLayerId;
    const layer2 = addBlankLayer(p, 'H2');
    // Park an event on node `a` inside layer 2: make it the live event list
    // while layer 2 is active, then switch away (the switch captures it).
    switchLayer(p, layer2);
    p.events = [newEvent('hgt', 'node', a)];
    switchLayer(p, layer1);
    expect(p.layerStore[layer2].events.length).toBe(1);
    // A stale state key for `a` in the parked snapshot (as a pre-guard
    // document could carry).
    p.layerStore[layer2].states[a] = { 'gone-char': 's0' };

    // Delete `a` from the live (layer 1) document.
    expect(deleteNode(p, a, true)).toBe(true);
    expect(p.layerStore[layer2].events.length).toBe(0);
    expect(p.layerStore[layer2].states[a]).toBeUndefined();

    // Switching to layer 2 must NOT resurrect the orphan event.
    switchLayer(p, layer2);
    expect(p.events.length).toBe(0);
    expect(pruneLayerStore(p).changed).toBe(false);
  });

  it('layerDiff reports state and event differences between two layers without mutating the document', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    const char = newCharacter('t');
    addCharacter(p, char);
    const [s0, s1] = char.states.map((s) => s.id);
    setNodeState(p, p.rootId, char.id, s0);
    const layer1 = p.activeLayerId;
    const layer2 = duplicateActiveLayer(p, 'H2');
    switchLayer(p, layer2);
    setNodeState(p, p.rootId, char.id, s1);
    setNodeState(p, a, char.id, s0); // stored as an internal hypothesis? a is a tip — ignored
    const ev = newEvent('hgt', 'node', b);
    p.events = [ev];
    switchLayer(p, layer1);

    const diff = layerDiff(p, layer1, layer2);
    expect(diff.stateDiffs.length).toBe(1);
    expect(diff.stateDiffs[0].nodeId).toBe(p.rootId);
    expect(diff.stateDiffs[0].a).toBe(s0);
    expect(diff.stateDiffs[0].b).toBe(s1);
    expect(diff.eventsOnlyB.length).toBe(1);
    expect(diff.eventsOnlyA.length).toBe(0);

    const counts1 = layerRecordCounts(p, layer1);
    const counts2 = layerRecordCounts(p, layer2);
    expect(counts1.events).toBe(0);
    expect(counts2.events).toBe(1);
  });
});
