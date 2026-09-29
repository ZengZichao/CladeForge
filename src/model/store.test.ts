import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useStore, isReconActive } from './store';
import { IDENTITY_VIEW } from './types';
import { createEmptyProject, createArchaeaSample } from './sampleTree';
import { addChildren, deleteNode, moveNode } from './treeOps';

const s = () => useStore.getState();

describe('relocalizeSamples (locale switch)', () => {
  it('rebuilds a PRISTINE sample document, keeping its sample identity', () => {
    useStore.getState().openInNewTab(createArchaeaSample());
    expect(s().project.sampleId).toBe('archaea');
    const before = s().project;

    s().relocalizeSamples();
    // A fresh document object (rebuilt from the catalogue), same sample id,
    // and still pristine — so a later switch re-localises it again.
    expect(s().project).not.toBe(before);
    expect(s().project.sampleId).toBe('archaea');
    expect(s().past).toHaveLength(0);
  });

  it('leaves an EDITED sample document alone (user data is not thrown away)', () => {
    useStore.getState().openInNewTab(createArchaeaSample());
    s().apply((d) => {
      addChildren(d, d.rootId, 1);
    });
    const before = s().project;
    expect(s().past.length).toBeGreaterThan(0);

    s().relocalizeSamples();
    // The SAME frozen object: an edited document is user data, not sample content.
    expect(s().project).toBe(before);
    expect(s().past.length).toBeGreaterThan(0);
  });

  it('ignores documents that did not come from the sample catalogue', () => {
    useStore.getState().loadProject(createEmptyProject('mine'));
    const before = s().project;
    s().relocalizeSamples();
    expect(s().project).toBe(before);
    expect(s().project.name).toBe('mine');
  });
});

describe('store undo/redo', () => {
  beforeEach(() => {
    useStore.getState().loadProject(createEmptyProject());
  });

  it('apply records history and undo/redo restore state', () => {
    const rootId = s().project.rootId;
    expect(s().past).toHaveLength(0);

    s().apply((d) => addChildren(d, rootId, 2));
    expect(Object.keys(s().project.nodes)).toHaveLength(3);
    expect(s().canUndo()).toBe(true);

    s().undo();
    expect(Object.keys(s().project.nodes)).toHaveLength(1);
    expect(s().canRedo()).toBe(true);

    s().redo();
    expect(Object.keys(s().project.nodes)).toHaveLength(3);
  });

  it('a fresh edit clears the redo stack', () => {
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    s().undo();
    expect(s().canRedo()).toBe(true);
    s().apply((d) => addChildren(d, rootId, 1));
    expect(s().canRedo()).toBe(false);
  });

  it('begin/live/commit collapses a drag into one undo step', () => {
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    const childId = s().project.nodes[rootId].childrenIds[0];
    const pastLen = s().past.length;

    s().beginInteraction();
    s().live((d) => moveNode(d, childId, { x: 10, y: 10 }));
    s().live((d) => moveNode(d, childId, { x: 20, y: 20 }));
    s().commitInteraction();

    expect(s().past).toHaveLength(pastLen + 1);
    expect(s().project.nodes[childId].position).toEqual({ x: 20, y: 20 });

    s().undo();
    expect(s().project.nodes[childId].position).toBeUndefined();
  });

  it('cancelInteraction reverts live changes without recording history', () => {
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    const childId = s().project.nodes[rootId].childrenIds[0];
    const pastLen = s().past.length;

    s().beginInteraction();
    s().live((d) => moveNode(d, childId, { x: 99, y: 99 }));
    s().cancelInteraction();

    expect(s().past).toHaveLength(pastLen);
    expect(s().project.nodes[childId].position).toBeUndefined();
  });

  it('tracks draggingId across the interaction lifecycle', () => {
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    const childId = s().project.nodes[rootId].childrenIds[0];

    expect(s().draggingId).toBeNull();
    s().beginInteraction(childId);
    expect(s().draggingId).toBe(childId);
    s().live((d) => moveNode(d, childId, { x: 5, y: 5 }));
    expect(s().draggingId).toBe(childId);
    s().commitInteraction();
    expect(s().draggingId).toBeNull();

    // cancel path also clears it
    s().beginInteraction(childId);
    s().cancelInteraction();
    expect(s().draggingId).toBeNull();
  });

  it('undo/redo restore the view and active character of that moment', () => {
    // Every history entry carries the view and active character in force at the
    // time: rolling the document back while leaving the canvas zoomed where the
    // user had since panned, or the colouring character switched, would not
    // return them to the state they had been shown.
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    s().setView({ scale: 2, tx: 30, ty: 40 });
    s().setActiveCharacter('some-later-character');

    s().apply((d) => addChildren(d, rootId, 2));
    // The snapshot taken before this edit carries the view in force at the time.
    const entry = s().past[s().past.length - 1];
    expect(entry.view).toEqual({ scale: 2, tx: 30, ty: 40 });
    expect(entry.activeCharacterId).toBe('some-later-character');

    s().setView({ scale: 0.5, tx: 0, ty: 0 });
    s().setActiveCharacter(null);
    s().undo();
    expect(s().view).toEqual({ scale: 2, tx: 30, ty: 40 });
    expect(s().activeCharacterId).toBe('some-later-character');

    s().redo();
    expect(s().view).toEqual({ scale: 0.5, tx: 0, ty: 0 });
    expect(s().activeCharacterId).toBeNull();
  });

  it('a collapsed drag records one entry, with the pre-drag view', () => {
    const rootId = s().project.rootId;
    s().apply((d) => addChildren(d, rootId, 1));
    const childId = s().project.nodes[rootId].childrenIds[0];
    s().setView({ scale: 3, tx: 1, ty: 1 });
    const pastLen = s().past.length;

    s().beginInteraction(childId);
    s().live((d) => moveNode(d, childId, { x: 40, y: 40 }));
    s().setView({ scale: 1, tx: 0, ty: 0 }); // user zoomed mid-drag
    s().commitInteraction();

    expect(s().past).toHaveLength(pastLen + 1);
    // The stored snapshot is the state BEFORE the drag, so its view is the one
    // the user was looking at when the gesture began.
    expect(s().past[s().past.length - 1].view).toEqual({ scale: 3, tx: 1, ty: 1 });
  });
});

describe('store tabs', () => {
  beforeEach(() => {
    useStore.getState().loadWorkspace([createEmptyProject()], 0);
  });

  it('newTab opens an isolated document and switching restores each tab', () => {
    expect(s().tabs).toHaveLength(1);
    const firstTab = s().activeTabId;
    s().apply((d) => addChildren(d, s().project.rootId, 2));
    expect(Object.keys(s().project.nodes)).toHaveLength(3);

    s().newTab();
    expect(s().tabs).toHaveLength(2);
    expect(s().activeTabId).not.toBe(firstTab);
    expect(Object.keys(s().project.nodes)).toHaveLength(1); // fresh empty doc
    expect(s().canUndo()).toBe(false); // independent history

    s().switchTab(firstTab);
    expect(Object.keys(s().project.nodes)).toHaveLength(3); // first tab restored
    expect(s().canUndo()).toBe(true);
  });

  it('closeTab activates a neighbour and protects the last tab', () => {
    s().newTab();
    expect(s().tabs).toHaveLength(2);
    const activeId = s().activeTabId;
    s().closeTab(activeId);
    expect(s().tabs).toHaveLength(1);
    expect(s().activeTabId).not.toBe(activeId);
    // the final tab cannot be closed
    s().closeTab(s().activeTabId);
    expect(s().tabs).toHaveLength(1);
  });
});

// ── the selection must never outlive the nodes it names ──
describe('selection invariant across edits', () => {
  it('apply() prunes ids the edit removed', () => {
    useStore.getState().loadProject(createEmptyProject());
    const root = s().project.rootId;
    s().apply((d) => addChildren(d, root, 2));
    const kids = Object.keys(s().project.nodes).filter((id) => id !== root);
    const doomed = kids[0];
    s().select(doomed);
    expect(s().selection).toEqual([doomed]);

    // An edit that deletes that node: the selection has to drop the dead id.
    s().apply((d) => deleteNode(d, doomed, true));
    expect(s().project.nodes[doomed]).toBeUndefined();
    expect(s().selection).not.toContain(doomed);
  });

  it('commitInteraction() prunes too', () => {
    useStore.getState().loadProject(createEmptyProject());
    const root = s().project.rootId;
    s().apply((d) => addChildren(d, root, 2));
    const kids = Object.keys(s().project.nodes).filter((id) => id !== root);
    s().beginInteraction('x');
    s().select(kids[0]);
    s().commitInteraction((d) => deleteNode(d, kids[0], true));
    expect(s().selection).not.toContain(kids[0]);
  });

  it('leaves an untouched selection array identity alone (no per-frame churn)', () => {
    useStore.getState().loadProject(createEmptyProject());
    const root = s().project.rootId;
    s().apply((d) => addChildren(d, root, 2));
    const a = Object.keys(s().project.nodes).find((id) => id !== root)!;
    s().select(a);
    const before = s().selection;
    s().apply((d) => { d.nodes[a].label = 'renamed'; });
    expect(s().selection).toBe(before); // nothing dropped -> same array
  });
});

// ── loading a document must reset per-document view state ──
describe('loadProject resets the whole per-document state', () => {
  it('drops reconciliation state left over from the previous document', () => {
    useStore.getState().loadProject(createEmptyProject());
    useStore.setState({ reconMode: true } as never);
    expect(s().reconMode).toBe(true);
    useStore.getState().loadProject(createEmptyProject());
    expect(s().reconMode).toBe(false);
  });
});

// ── the keyboard handler must read LIVE state ──
describe('isReconActive', () => {
  function shape(over: Record<string, unknown>) {
    const project = createEmptyProject();
    project.geneTrees = [
      { id: 'g1', name: 'gene 1', doc: createEmptyProject() } as never,
    ];
    return {
      reconMode: false,
      activeGeneTreeId: 'g1',
      project,
      ...over,
    } as never;
  }

  it('needs all three of mode, a selection, and that gene tree still existing', () => {
    expect(isReconActive(shape({}))).toBe(false); // mode off
    expect(isReconActive(shape({ reconMode: true }))).toBe(true);
    expect(isReconActive(shape({ reconMode: true, activeGeneTreeId: null }))).toBe(false);
    expect(isReconActive(shape({ reconMode: true, activeGeneTreeId: 'gone' }))).toBe(false);
  });

  it('App’s keydown handler reads it from getState(), not from the render scope', () => {
    // The handler is installed once with `[]` deps, so it reads the store on
    // every keypress. Gating the "⌘F is unavailable in this view" notice on the
    // render-scope `reconActive` would use a value frozen at its initial `false`
    // inside that closure, leaving a branch that can never be taken.
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
    const start = app.indexOf('const onKey = (e: KeyboardEvent)');
    const end = app.indexOf("window.addEventListener('keydown', onKey)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = app.slice(start, end);
    expect(handler).toContain('isReconActive(useStore.getState())');
    const bare = handler.match(/(?<!is)[\b]reconActive\b/g) ?? [];
    expect(bare, `render-scope reads inside the handler: ${bare.join(', ')}`).toEqual([]);
  });
});

// ── `newProject` must reset exactly like `loadProject` ──
describe('newProject shares loadProject’s reset set', () => {
  it('clears reconciliation view state and the previous document’s view', () => {
    useStore.getState().loadProject(createEmptyProject());
    useStore.setState({
      reconMode: true,
      activeGeneTreeId: 'stale-gene-tree',
      geneSelection: ['stale-node'],
      view: { x: 999, y: 999, scale: 4 },
    } as never);
    useStore.getState().newProject();
    const after = s();
    expect(after.reconMode).toBe(false);
    expect(after.activeGeneTreeId).toBeNull();
    expect(after.geneSelection).toEqual([]);
    expect(after.view).toEqual(IDENTITY_VIEW);
    expect(after.project.rootId).toBeTruthy();
    expect(after.past).toEqual([]);
  });
});
