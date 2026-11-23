// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useStore, isReconActive, hasActiveGeneTree, persistedProject } from './store';
import { makeGeneTreeEntry } from './geneTrees';
import { IDENTITY_VIEW } from './types';
import { createEmptyProject, createLargeTreeSample } from './sampleTree';
import { addChildren, deleteNode, moveNode } from './treeOps';
import { changeLanguage, currentLanguage } from '../ui/i18n';
import { useToasts } from '../ui/toast';

const s = () => useStore.getState();

describe('relocalizeSamples (locale switch)', () => {
  it('rebuilds a PRISTINE sample document, keeping its sample identity', () => {
    useStore.getState().openInNewTab(createLargeTreeSample());
    expect(s().project.sampleId).toBe('large-tree');
    const before = s().project;

    s().relocalizeSamples();
    // A fresh document object (rebuilt from the catalogue), same sample id,
    // and still pristine — so a later switch re-localises it again.
    expect(s().project).not.toBe(before);
    expect(s().project.sampleId).toBe('large-tree');
    expect(s().past).toHaveLength(0);
  });

  it('leaves an EDITED sample document alone (user data is not thrown away)', () => {
    useStore.getState().openInNewTab(createLargeTreeSample());
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
    // PM-23: a document load keeps ONE undo step pointing at the outgoing
    // document (⌘Z right after an import restores it), so the freshly loaded
    // document starts with exactly that step rather than an empty stack.
    expect(s().past).toHaveLength(1);

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

  it('App’s keydown handler reads the LIVE store, not a render-scope value', () => {
    // The handler is installed once with `[]` deps, so any value closed over
    // from the first render is frozen forever. The workspace switch is
    // `reconMode` and the handler must read it through `useStore.getState()`
    // (directly or via the `s` alias of the same call) — never a render-scope
    // capture, or the "⌘F is unavailable here" branch could never fire.
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
    const start = app.indexOf('const onKey = (e: KeyboardEvent)');
    const end = app.indexOf("window.addEventListener('keydown', onKey)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = app.slice(start, end);
    expect(handler).toContain('useStore.getState()');
    expect(handler).toMatch(/reconMode/);
    const bare = handler.match(/(?<![.\w])reconMode\b/g) ?? [];
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

// ── the reconciliation WORKSPACE state machine ──
// One mode, one workspace: `reconMode` alone decides the workspace; the active
// gene tree only decides content-vs-empty-state inside it. Deleting the last
// gene tree must NOT flip the user back to the standard canvas (review R-03),
// and undoing that deletion must restore a usable active tree.
describe('recon workspace state', () => {
  beforeEach(() => {
    useStore.getState().loadProject(createEmptyProject());
  });

  function seedGeneTree(name = 'g'): string {
    let id = '';
    useStore.getState().apply((d) => {
      const entry = makeGeneTreeEntry(createEmptyProject(name), name);
      entry.doc.nodes[entry.doc.rootId].label = 'root';
      const [child] = addChildren(entry.doc, entry.doc.rootId, 2);
      void child;
      d.geneTrees = [...(d.geneTrees ?? []), entry];
      id = entry.id;
    });
    return id;
  }

  it('enterReconWorkspace picks the first gene tree when none is active', () => {
    const id = seedGeneTree();
    s().enterReconWorkspace();
    expect(s().reconMode).toBe(true);
    expect(s().activeGeneTreeId).toBe(id);
    // §9.2 default: with content the rail opens on the SCENARIO section.
    expect(s().reconSection).toBe('scenario');
  });

  it('enterReconWorkspace works with NO gene tree: the empty state is reachable', () => {
    s().enterReconWorkspace();
    expect(s().reconMode).toBe(true);
    expect(s().activeGeneTreeId).toBeNull();
    // Empty state: the rail opens on TREES, where the primary actions live.
    expect(s().reconSection).toBe('trees');
    // The workspace is still recon; content is what is empty.
    expect(hasActiveGeneTree(s())).toBe(false);
    expect(isReconActive(s())).toBe(false);
    s().exitReconWorkspace();
    expect(s().reconMode).toBe(false);
  });

  it('deleting the LAST gene tree keeps reconMode on and clears the pointer', () => {
    const id = seedGeneTree();
    s().enterReconWorkspace();
    expect(s().activeGeneTreeId).toBe(id);
    s().apply((d) => {
      d.geneTrees = d.geneTrees?.filter((g) => g.id !== id);
    });
    expect(s().reconMode).toBe(true); // no more standard-canvas chimera
    expect(s().activeGeneTreeId).toBeNull();
    expect(s().geneSelection).toEqual([]);
  });

  it('undoing that deletion restores a usable active gene tree', () => {
    const id = seedGeneTree();
    s().enterReconWorkspace();
    s().apply((d) => {
      d.geneTrees = d.geneTrees?.filter((g) => g.id !== id);
    });
    expect(s().activeGeneTreeId).toBeNull();
    s().undo();
    expect(s().reconMode).toBe(true);
    expect(s().activeGeneTreeId).toBe(id);
    expect(hasActiveGeneTree(s())).toBe(true);
  });

  it('redo re-applies the deletion and lands on the empty state again', () => {
    const id = seedGeneTree();
    s().enterReconWorkspace();
    s().apply((d) => {
      d.geneTrees = d.geneTrees?.filter((g) => g.id !== id);
    });
    s().undo();
    s().redo();
    expect(s().reconMode).toBe(true);
    expect(s().activeGeneTreeId).toBeNull();
  });

  it('stale gene selections are pruned when the active tree changes', () => {
    const id = seedGeneTree();
    s().setActiveGeneTree(id);
    const nodeId = Object.keys(s().project.geneTrees![0].doc.nodes)[0];
    s().selectGeneNode(nodeId);
    expect(s().geneSelection).toEqual([nodeId]);
    s().setActiveGeneTree(null);
    expect(s().geneSelection).toEqual([]);
  });

  it('reconViewOptions and reconSection are pure UI state with defaults', () => {
    s().setReconSection('scenario');
    expect(s().reconSection).toBe('scenario');
    s().setReconViewOptions({ mappingScope: 'all', showLabels: false });
    expect(s().reconViewOptions.mappingScope).toBe('all');
    expect(s().reconViewOptions.showLabels).toBe(false);
    // Untouched keys keep their defaults.
    expect(s().reconViewOptions.syncZoom).toBe(true);
    // Loading a document resets them.
    s().loadProject(createEmptyProject());
    expect(s().reconSection).toBe('trees');
  });

  it('switching tabs restores reconMode but heals a stale gene pointer', () => {
    const first = seedGeneTree('first');
    useStore.getState().openInNewTab(createEmptyProject('other'));
    expect(s().tabs).toHaveLength(2);
    // Parked snapshots restore with healed pointers.
    useStore.getState().switchTab(s().tabs[0]);
    expect(s().activeGeneTreeId).toBe(first);
  });
});

// 用户反馈 (2026-11-16): 物种树编辑 / 基因树编辑 hand the tree to the STANDARD
// editor. The gene tree gets there through a document swap: entering the mode
// puts the gene doc into `project` (so every standard gesture edits it), and
// leaving writes it back into the reconciliation. These tests pin that
// round-trip — including the tab-switch guard that must merge BEFORE parking.
describe('gene document edit swap (基因树编辑)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(createEmptyProject('species'));
  });

  function seedGeneTree(name = 'g'): string {
    let id = '';
    useStore.getState().apply((d) => {
      const entry = makeGeneTreeEntry(createEmptyProject(name), name);
      entry.doc.nodes[entry.doc.rootId].label = 'root';
      const [child] = addChildren(entry.doc, entry.doc.rootId, 2);
      void child;
      d.geneTrees = [...(d.geneTrees ?? []), entry];
      id = entry.id;
    });
    return id;
  }

  it('entering swaps the gene doc into project; exiting writes edits back', () => {
    const id = seedGeneTree();
    const speciesBefore = s().project;
    const pastBefore = s().past.length;
    const geneTipCount = Object.keys(speciesBefore.geneTrees![0].doc.nodes).length;

    s().setReconEditTarget('gene');
    expect(s().reconEditTarget).toBe('gene');
    expect(s().geneEditBackup).not.toBeNull();
    expect(s().past).toHaveLength(0); // species history parked on the backup
    // The editable document IS the gene doc now.
    expect(Object.keys(s().project.nodes)).toHaveLength(geneTipCount);
    expect(s().project).toBe(speciesBefore.geneTrees![0].doc);

    // A standard-canvas style edit targets the gene doc…
    s().apply((d) => {
      addChildren(d, d.rootId, 1);
    });
    expect(s().past).toHaveLength(1); // fresh gene-mode undo stack

    // …and exiting the mode lands it back inside the species project.
    s().setReconEditTarget('recon');
    expect(s().geneEditBackup).toBeNull();
    expect(s().project).not.toBe(speciesBefore); // merged write-back
    const entry = s().project.geneTrees!.find((g) => g.id === id)!;
    expect(Object.keys(entry.doc.nodes)).toHaveLength(geneTipCount + 1);
    // The species tree itself is untouched…
    expect(Object.keys(s().project.nodes)).toHaveLength(1);
    // …and the parked species undo history resumes where it was.
    expect(s().past).toHaveLength(pastBefore);
    expect(s().activeGeneTreeId).toBe(id);
  });

  it('exiting without edits restores the exact species project (no dirty noise)', () => {
    seedGeneTree();
    const speciesBefore = s().project; // AFTER seeding
    const revisionBefore = s().revision;

    s().setReconEditTarget('gene');
    s().setReconEditTarget('recon');
    expect(s().project).toBe(speciesBefore);
    expect(s().revision).toBe(revisionBefore);
  });

  it('gene-mode undo cannot resurrect a species snapshot', () => {
    seedGeneTree();
    const pastBefore = s().past.length;
    s().apply((d) => {
      addChildren(d, d.rootId, 1); // species edit → history
    });
    expect(s().past).toHaveLength(pastBefore + 1);

    s().setReconEditTarget('gene');
    expect(s().past).toHaveLength(0); // history parked on the backup
    s().apply((d) => {
      addChildren(d, d.rootId, 1); // gene edit
    });
    s().undo();
    // The undo stays inside the gene doc — never the species snapshot.
    expect(s().geneEditBackup).not.toBeNull();
    s().setReconEditTarget('recon');
    expect(Object.keys(s().project.nodes)).toHaveLength(2); // 1 root + 1 species child
    expect(s().past).toHaveLength(pastBefore + 1);
  });

  it('switching tabs merges the gene doc back BEFORE parking the snapshot', () => {
    const id = seedGeneTree();
    const geneTipCount = Object.keys(s().project.geneTrees![0].doc.nodes).length;

    s().setReconEditTarget('gene');
    s().apply((d) => {
      addChildren(d, d.rootId, 1);
    });
    // Two tabs: the current (species + gene) one and a fresh one.
    useStore.getState().newTab();
    // The parked snapshot must hold the MERGED project, not the swapped doc.
    const parked = s().tabStore[s().tabs[0]];
    const entry = parked.project.geneTrees!.find((g) => g.id === id)!;
    expect(Object.keys(entry.doc.nodes)).toHaveLength(geneTipCount + 1);
    expect(Object.keys(parked.project.nodes)).toHaveLength(1);
    expect(s().geneEditBackup).toBeNull();
  });

  it('persistedProject merges the edited gene doc while swapped', () => {
    seedGeneTree();
    s().setReconEditTarget('gene');
    s().apply((d) => {
      addChildren(d, d.rootId, 1);
    });
    const persisted = persistedProject(s());
    expect(Object.keys(persisted.nodes)).toHaveLength(1); // species tree
    expect(Object.keys(persisted.geneTrees![0].doc.nodes)).toHaveLength(4);
    s().setReconEditTarget('recon');
  });
});

// 用户反馈 (2026-11-23): the canvas layout is not a free toggle any more —
// 「协调映射编辑」 IS the side-by-side canvas and 「协调嵌套预览」 IS the
// embedded canvas, so setReconEditTarget drives reconViewOptions.layoutMode.
describe('reconciliation edit targets drive the canvas layout', () => {
  beforeEach(() => {
    useStore.getState().loadProject(createEmptyProject('species'));
  });

  it('embedded ⇄ recon switch the layout mode; tree-edit targets keep it side-by-side', () => {
    expect(s().reconEditTarget).toBe('recon');
    expect(s().reconViewOptions.layoutMode).toBe('side-by-side');

    s().setReconEditTarget('embedded');
    expect(s().reconEditTarget).toBe('embedded');
    expect(s().reconViewOptions.layoutMode).toBe('embedded');

    s().setReconEditTarget('recon');
    expect(s().reconViewOptions.layoutMode).toBe('side-by-side');

    // Leaving the nested preview for a tree-edit surface must not leave the
    // coordination canvas stuck in the embedded mode on return.
    s().setReconEditTarget('embedded');
    s().setReconEditTarget('species');
    expect(s().reconViewOptions.layoutMode).toBe('side-by-side');
  });

  it('restoring a tab reconciles the session-global layout mode with that tab’s target', () => {
    // Park the mapping-editor tab, then preview the nested canvas on a new tab.
    // (Use the active-tab ids — the store keeps tabs from earlier tests.)
    const reconTab = s().activeTabId;
    useStore.getState().openInNewTab(createEmptyProject('preview'));
    const previewTab = s().activeTabId;
    s().setReconEditTarget('embedded');
    expect(s().reconViewOptions.layoutMode).toBe('embedded');

    // Back to the mapping-editor tab: it must not inherit the stale embedded
    // mode (reconEditTarget is per-tab, reconViewOptions is session-global).
    useStore.getState().switchTab(reconTab);
    expect(s().reconEditTarget).toBe('recon');
    expect(s().reconViewOptions.layoutMode).toBe('side-by-side');

    // And the parked nested-preview tab restores its embedded mode.
    useStore.getState().switchTab(previewTab);
    expect(s().reconEditTarget).toBe('embedded');
    expect(s().reconViewOptions.layoutMode).toBe('embedded');
  });
});

describe('history label punctuation follows the UI language (D-P18)', () => {
  const startLang = currentLanguage();
  afterEach(() => changeLanguage(startLang));

  it('uses half-width brackets and commas in English, full-width in Chinese', () => {
    useStore.getState().loadProject(createEmptyProject());

    changeLanguage('en');
    s().apply((d) => {
      addChildren(d, d.rootId, 3);
    });
    const enLabel = s().past[s().past.length - 1].label ?? '';
    expect(enLabel).toContain('Nodes (3 added)');
    expect(enLabel).not.toContain('（');
    expect(enLabel).not.toContain('，');

    useStore.getState().loadProject(createEmptyProject());
    changeLanguage('zh');
    s().apply((d) => {
      addChildren(d, d.rootId, 2);
    });
    // The Chinese branch is unchanged: 「（…，）」.
    expect(s().past[s().past.length - 1].label ?? '').toContain('节点（新增 2）');
  });

  it('separates several changed fields with ", " in English', () => {
    changeLanguage('en');
    useStore.getState().loadProject(createEmptyProject());
    s().apply((d) => {
      d.name = 'Renamed';
      addChildren(d, d.rootId, 1);
    });
    expect(s().past[s().past.length - 1].label ?? '').toContain('Project name, Nodes (1 added)');
  });
});

describe('fit channel carries its scale cap (D-P9/G-P7)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(createEmptyProject());
  });

  it('stores maxScale and bumps fitRequests in the same update', () => {
    const before = s().fitRequests;
    s().requestFit(1);
    expect(s().fitMaxScale).toBe(1);
    expect(s().fitRequests).toBe(before + 1);
  });

  it('defaults the cap to 8 when no argument is given', () => {
    s().requestFit(2);
    s().requestFit();
    expect(s().fitMaxScale).toBe(8);
  });
});

describe('runAsr preconditions and result notice (G-P10)', () => {
  const startLang = currentLanguage();
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useStore.getState().loadProject(createEmptyProject());
    changeLanguage('en');
  });
  afterEach(() => changeLanguage(startLang));

  it('explains a missing active character instead of returning silently', () => {
    s().runAsr();
    expect(s().asr).toBeNull();
    expect(s().asrRunning).toBe(false);
    expect(
      useToasts.getState().toasts.some((t) => t.message.includes('Select an assigned discrete character')),
    ).toBe(true);
  });

  it('distinguishes an active continuous character from no character at all', () => {
    const id = 'cont';
    s().apply((d) => {
      d.characters.push({ id, name: 'size', type: 'continuous', states: [] });
    });
    s().setActiveCharacter(id);
    s().runAsr();
    expect(s().asr).toBeNull();
    expect(useToasts.getState().toasts.some((t) => t.message.includes('is not discrete'))).toBe(true);
  });

  it('announces a completed reconstruction with its posterior node count', async () => {
    const p = createEmptyProject();
    const ids = addChildren(p, p.rootId, 2);
    for (const id of ids) {
      p.nodes[id].branchLength = 1;
      p.nodes[id].charStates = { c1: 'A' };
    }
    p.characters.push({
      id: 'c1',
      name: 'habitat',
      type: 'discrete',
      states: [
        { id: 'A', label: 'A', color: '#123456' },
        { id: 'B', label: 'B', color: '#654321' },
      ],
    });
    useStore.getState().loadProject(p);
    s().setActiveCharacter('c1');
    s().runAsr();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(s().asr).not.toBeNull();
    expect(
      useToasts
        .getState()
        .toasts.some((t) => t.kind === 'success' && t.message.includes('reconstruction complete')),
    ).toBe(true);
  });
});
