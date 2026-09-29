import { describe, it, expect } from 'vitest';
import { createEmptyProject, createCetaceanSample } from './sampleTree';
import { addCharacter, addChildren, removeCharacter, setNodeState } from './treeOps';
import { newCharacter } from './characters';
import { addBlankLayer, duplicateActiveLayer, pruneLayerStore, switchLayer } from './layers';

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
    const p = createCetaceanSample();
    expect(p.layers).toHaveLength(2);
    const habitat = p.characters.find((c) => c.costMatrix)!;
    expect(p.nodes[p.rootId].charStates?.[habitat.id]).toBeDefined();

    removeCharacter(p, habitat.id);
    const other = p.characters[0];
    switchLayer(p, p.layers[1].id);
    for (const n of Object.values(p.nodes)) {
      expect(n.charStates?.[habitat.id]).toBeUndefined();
      expect(n.charMeta?.[habitat.id]).toBeUndefined();
    }
    switchLayer(p, p.layers[0].id);
    for (const n of Object.values(p.nodes)) {
      expect(n.charStates?.[habitat.id]).toBeUndefined();
      expect(n.charMeta?.[habitat.id]).toBeUndefined();
    }
    // The surviving character's tip observations are shared across layers and
    // must be untouched by either the deletion or the switches.
    const locomotion = p.characters[0];
    expect(locomotion.id).not.toBe(habitat.id);
    const scoredTips = Object.values(p.nodes).filter(
      (n) => n.childrenIds.length === 0 && n.charStates?.[locomotion.id],
    );
    expect(scoredTips.length).toBe(4);
    expect(pruneLayerStore(p)).toBe(false); // nothing left to prune
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
    p.characters = [];

    expect(pruneLayerStore(p)).toBe(true);
    expect(p.layerStore[second].states[p.rootId]).toBeUndefined();
    expect(p.layerStore[second].meta[p.rootId]).toBeUndefined();
    expect(pruneLayerStore(p)).toBe(false); // idempotent

    switchLayer(p, second);
    expect(p.nodes[p.rootId].charStates).toBeUndefined();
    expect(p.nodes[p.rootId].charMeta).toBeUndefined();
  });
});
