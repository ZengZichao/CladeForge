// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addBlankLayer, captureLayer } from './layers';
import { addChildren, deleteNode, setHypothesisNote } from './treeOps';

describe('hypothesis annotations', () => {
  it('trims a note, stores it on the live node, and clears it when emptied', () => {
    const p = createEmptyProject('notes');
    const [a] = addChildren(p, p.rootId, 2);
    setHypothesisNote(p, a, '  this clade dispersed in the Miocene  ');
    expect(p.nodes[a].hypothesisNote).toBe('this clade dispersed in the Miocene');
    setHypothesisNote(p, a, '   ');
    expect(p.nodes[a].hypothesisNote).toBeUndefined();
  });

  it('removes the note from stored layers when the node is deleted', () => {
    const p = createEmptyProject('notes-prune');
    const [a] = addChildren(p, p.rootId, 2);
    setHypothesisNote(p, a, 'layer 1 note');
    const second = addBlankLayer(p, 'H2');
    p.layerStore[second].notes = { [a]: 'layer 2 note' };

    expect(deleteNode(p, a, true)).toBe(true);
    expect(p.nodes[a]).toBeUndefined();
    expect(p.layerStore[second].notes?.[a]).toBeUndefined();
  });

  it('captures only non-empty notes into the layer snapshot', () => {
    const p = createEmptyProject('notes-capture');
    const [a, b] = addChildren(p, p.rootId, 2);
    setHypothesisNote(p, a, 'kept');
    setHypothesisNote(p, b, '');
    const captured = captureLayer(p);
    expect(captured.notes).toEqual({ [a]: 'kept' });
  });
});
