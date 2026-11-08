// Regression tests for store history findings (M3/M27/M25 + cancel restore).
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { createEmptyProject } from './sampleTree';
import { addChildren, moveNode, sortTipsByCharacter, deleteNode } from './treeOps';

const s = () => useStore.getState();

function smallDoc(): void {
  const p = createEmptyProject('hist');
  addChildren(p, p.rootId, 2);
  useStore.getState().loadProject(p);
}

describe('review: dirty tracking (M3)', () => {
  beforeEach(() => {
    smallDoc();
  });

  it('undo back to the saved content reports the document clean', () => {
    s().markSaved();
    expect(s().revision).toBe(s().lastSavedRevision);
    const savedProject = s().project;
    s().apply((d) => {
      moveNode(d, Object.values(d.nodes).find((n) => n.childrenIds.length === 0)!.id, { x: 10, y: 10 });
    });
    expect(s().revision).not.toBe(s().lastSavedRevision);
    s().undo();
    expect(s().project).toBe(savedProject); // the exact saved object restored
    expect(s().revision).toBe(s().lastSavedRevision);
  });
});

describe('review: interaction history (M27)', () => {
  beforeEach(() => {
    smallDoc();
  });

  it('apply inside an interaction collapses into ONE undo step', () => {
    const a = Object.values(s().project.nodes).find((n) => n.childrenIds.length === 0)!.id;
    s().beginInteraction(a);
    s().live((d) => {
      moveNode(d, a, { x: 10, y: 10 });
    });
    s().apply((d) => {
      deleteNode(d, a, true);
    });
    s().commitInteraction();
    s().undo();
    // One undo lands on the PRE-INTERACTION document: the node exists at its
    // original spot, not at the half-finished drag position (10,10).
    expect(s().project.nodes[a]).toBeTruthy();
    expect(s().project.nodes[a].position?.x ?? 0).not.toBe(10);
  });
});

describe('review: cancel interaction (store contract)', () => {
  beforeEach(() => {
    smallDoc();
  });

  it('cancel restores the pre-interaction view alongside the document', () => {
    const a = Object.values(s().project.nodes).find((n) => n.childrenIds.length === 0)!.id;
    const viewBefore = { ...s().view };
    s().beginInteraction(a);
    s().live((d) => {
      moveNode(d, a, { x: 5, y: 5 });
    });
    // ViewTransform carries scale/tx/ty; nudge all of them so the restore is visible.
    useStore.setState({ view: { ...s().view, tx: 999, ty: 999, scale: 3 } });
    s().cancelInteraction();
    expect(s().view).toEqual(viewBefore);
    expect(s().project.nodes[a].position?.x ?? 0).not.toBe(5);
  });
});

describe('review: sort tips by state inside the draft (M25)', () => {
  it('runs on the frozen document without throwing and records one undo step', () => {
    smallDoc();
    const p = createEmptyProject('sort');
    const [l, r] = addChildren(p, p.rootId, 2);
    const [l1, l2] = addChildren(p, l, 2);
    p.nodes[l1].label = 'A';
    p.nodes[l2].label = 'B';
    void r;
    p.characters = [
      {
        id: 'c1',
        name: 'c',
        type: 'discrete',
        states: [
          { id: 's0', label: '0', color: '#000000' },
          { id: 's1', label: '1', color: '#ffffff' },
        ],
      },
    ];
    p.nodes[l1].charStates = { c1: 's1' };
    p.nodes[l2].charStates = { c1: 's0' };
    useStore.getState().loadProject(p);
    const frozen = s().project;
    const pastBefore = s().past.length;
    let reordered = 0;
    expect(() => {
      s().apply((d) => {
        reordered = sortTipsByCharacter(d, 'c1');
      });
    }).not.toThrow();
    expect(reordered).toBeGreaterThan(0);
    expect(s().past.length).toBe(pastBefore + 1);
    void frozen;
  });
});
