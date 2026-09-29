// Central application store (Zustand + Immer), organised as two slices:
//
//   * DocumentSlice — the Project document, reference-based undo/redo history,
//     the begin/live/commit interaction transaction and `draggingId` (used by
//     the canvas to skip full layout recomputes while a node is being dragged).
//   * UISlice — selection, canvas view transform and viewport measurement.
//
// The slice split keeps domain concerns (traits / events / hypotheses) on
// obvious seams instead of inflating a single monolithic state.
// Discrete edits go through `apply`; drag-style interactions use
// begin/live/commit so they collapse into a single undo step.

import { create, type StateCreator } from 'zustand';
import { produce, freeze, setAutoFreeze } from 'immer';
import type { EdgeId, NodeId, Project, ViewTransform } from './types';
import { IDENTITY_VIEW } from './types';
import { pushSnapshot, type HistoryEntry } from './history';
import { createEmptyProject, createSampleProject, SAMPLE_PROJECTS } from './sampleTree';
import { reconstructMk, type AsrResult, type AsrOptions, DEFAULT_ASR_OPTIONS } from './asr';
import { tr } from '../ui/strings';
// Side-effectful import ON PURPOSE: i18n.ts resolves the stored / OS locale at
// module load and swaps the string catalogue via setLanguage(). ESM evaluates
// imports before this module body, so the initial document seeded below —
// `createSampleProject()` bakes its labels through `tr()` — is built in the
// user's language instead of the `zh` fallback. Without it, an English-locale
// first run would open a Chinese-labelled sample.
import '../ui/i18n';
import type { EraLevel } from '../layout/timescale';
import { notify } from '../ui/toast';

// History keeps immutable Project snapshots by reference (no per-edit clone),
// which is only safe if every retained state is frozen. Immer freezes the
// states it produces; freeze(...) at the document boundaries below covers the
// initial / loaded / new projects. Pinning autofreeze on makes the invariant
// explicit so a future setAutoFreeze(false) can't silently corrupt undo.
setAutoFreeze(true);

export type Recipe = (draft: Project) => void;

function pruneSelection(project: Project, selection: NodeId[]): NodeId[] {
  return selection.filter((id) => project.nodes[id]);
}

/**
 * Prune to ids that still exist, but keep the SAME array reference when nothing
 * dropped — so the per-frame `live()` path does not hand every subscriber a new
 * array and force a re-render for no reason.
 */
function keptSelection(project: Project, selection: NodeId[]): NodeId[] {
  const kept = pruneSelection(project, selection);
  return kept.length === selection.length ? selection : kept;
}

/**
 * Capture the slices that undo/redo restore together: the document plus the
 * view of it the user was looking at — restoring only the document would
 * teleport the canvas and switch the coloured character back on every step.
 */
function entryOf(s: {
  project: Project;
  selection: NodeId[];
  selectedEdgeId: EdgeId | null;
  view: ViewTransform;
  activeCharacterId: string | null;
}): HistoryEntry {
  return {
    project: s.project,
    // Copied AND frozen: `history.ts` reasons that storing these fields by
    // reference is safe because everything is frozen, but the selection array
    // handed to it is the live one.
    selection: freeze(s.selection.slice()),
    selectedEdgeId: s.selectedEdgeId,
    view: s.view,
    activeCharacterId: s.activeCharacterId,
  };
}

// --- tabs (multi-document) ---------------------------------------------------
// Each open document is a tab. The ACTIVE tab's state lives in the top-level
// document/UI fields; inactive tabs are parked as snapshots in `tabStore` and
// swapped in on switch (the same capture/restore pattern as hypothesis layers).

let TAB_SEQ = 1;
const INITIAL_TAB_ID = 'tab_1';
function newTabId(): string {
  TAB_SEQ += 1;
  return `tab_${TAB_SEQ}`;
}

interface TabSnapshot {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selection: NodeId[];
  selectedEdgeId: EdgeId | null;
  view: ViewTransform;
  activeCharacterId: string | null;
  showTransitions: boolean;
  showEvents: boolean;
  showEras: boolean;
  eraLevel: EraLevel;
  reconMode: boolean;
  activeGeneTreeId: string | null;
  geneSelection: NodeId[];
}

/** Freeze the per-tab state of the currently active document. */
function captureTab(s: AppState): TabSnapshot {
  return {
    project: s.project,
    past: s.past,
    future: s.future,
    selection: s.selection,
    selectedEdgeId: s.selectedEdgeId,
    view: s.view,
    activeCharacterId: s.activeCharacterId,
    showTransitions: s.showTransitions,
    showEvents: s.showEvents,
    showEras: s.showEras,
    eraLevel: s.eraLevel,
    reconMode: s.reconMode,
    activeGeneTreeId: s.activeGeneTreeId,
    geneSelection: s.geneSelection,
  };
}

/** A fresh snapshot for a project parked as an inactive tab. */
function snapshotFor(project: Project): TabSnapshot {
  return {
    project: freeze(project, true),
    past: [],
    future: [],
    selection: [],
    selectedEdgeId: null,
    view: { ...IDENTITY_VIEW },
    activeCharacterId: project.characters[0]?.id ?? null,
    showTransitions: true,
    showEvents: true,
    showEras: false,
    eraLevel: 'both',
    reconMode: false,
    activeGeneTreeId: project.geneTrees?.[0]?.id ?? null,
    geneSelection: [],
  };
}

/** Top-level fields written when a project becomes the active tab (fresh doc). */
function docStateFor(project: Project): Partial<AppState> {
  return {
    project: freeze(project, true),
    past: [] as HistoryEntry[],
    future: [] as HistoryEntry[],
    interactionBase: null as HistoryEntry | null,
    draggingId: null as NodeId | null,
    selection: [] as NodeId[],
    selectedEdgeId: null as EdgeId | null,
    view: { ...IDENTITY_VIEW },
    activeCharacterId: project.characters[0]?.id ?? null,
    showTransitions: true,
    showEvents: true,
    showEras: false,
    eraLevel: 'both',
    focusTarget: null,
    asr: null,
  asrOptions: DEFAULT_ASR_OPTIONS,
    reconMode: false,
    activeGeneTreeId: project.geneTrees?.[0]?.id ?? null,
    geneSelection: [] as NodeId[],
  };
}

/** Top-level fields written when an inactive-tab snapshot is swapped in. */
function restoreState(snap: TabSnapshot): Partial<AppState> {
  return {
    project: snap.project,
    past: snap.past,
    future: snap.future,
    interactionBase: null as HistoryEntry | null,
    draggingId: null as NodeId | null,
    selection: pruneSelection(snap.project, snap.selection),
    selectedEdgeId: snap.selectedEdgeId,
    view: snap.view,
    activeCharacterId: snap.activeCharacterId,
    showTransitions: snap.showTransitions,
    showEvents: snap.showEvents,
    showEras: snap.showEras,
    eraLevel: snap.eraLevel,
    focusTarget: null,
    asr: null,
  asrOptions: DEFAULT_ASR_OPTIONS,
    reconMode: snap.reconMode,
    // Drop a stale gene-tree pointer (e.g. removed while tab was parked).
    activeGeneTreeId:
      snap.activeGeneTreeId && snap.project.geneTrees?.some((g) => g.id === snap.activeGeneTreeId)
        ? snap.activeGeneTreeId
        : snap.project.geneTrees?.[0]?.id ?? null,
    geneSelection: snap.geneSelection.filter(
      (id) =>
        Boolean(snap.project.geneTrees?.find((g) => g.id === snap.activeGeneTreeId)?.doc.nodes[id]),
    ),
  };
}

// --- document slice ----------------------------------------------------------

export interface DocumentSlice {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  interactionBase: HistoryEntry | null;
  /** Id of the node being dragged, or null outside a drag interaction. */
  draggingId: NodeId | null;

  apply: (recipe: Recipe) => void;
  beginInteraction: (dragId?: NodeId) => void;
  live: (recipe: Recipe) => void;
  /**
   * Finish a begin/live interaction, recording ONE undo step.
   * An optional final recipe is applied atomically before committing
   * (e.g. reparent + unpin on drop).
   */
  commitInteraction: (finalRecipe?: Recipe) => void;
  /** Abort an interaction, reverting to the pre-interaction snapshot. */
  cancelInteraction: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  loadProject: (project: Project) => void;
  newProject: () => void;
}

// --- UI slice ------------------------------------------------------------------

export interface UISlice {
  selection: NodeId[];
  selectedEdgeId: EdgeId | null;
  view: ViewTransform;
  /** Bumped whenever a fresh document is loaded, so the canvas can re-fit. */
  loadCounter: number;
  /** Bumped to request the canvas to fit the tree into the viewport. */
  fitRequests: number;
  viewport: { w: number; h: number };
  /** Character whose states currently colour the tree (null = style colours). */
  activeCharacterId: string | null;
  /** Whether state-change markers are drawn on branches for the active character. */
  showTransitions: boolean;
  /** Whether evolutionary-event badges and causal-chain arrows are drawn. */
  showEvents: boolean;
  /** Whether geological-era bands are drawn behind the time-calibrated layout. */
  showEras: boolean;
  /** Which rank of the geological time scale to draw: eons, periods or both. */
  eraLevel: EraLevel;
  /** A node the canvas should pan to (bumped `seq` re-triggers the same id). */
  focusTarget: { id: NodeId; seq: number } | null;
  /** Probabilistic ancestral-state reconstruction for the active character (transient). */
  asr: AsrResult | null;
  /** ASR model and display threshold options. */
  asrOptions: AsrOptions;
  // --- gene-tree / species-tree reconciliation -------------------------------
  /** Whether the canvas shows the side-by-side reconciliation view. */
  reconMode: boolean;
  /** Gene tree currently being reconciled (id into project.geneTrees). */
  activeGeneTreeId: string | null;
  /** Selection within the active gene tree's canvas pane. */
  geneSelection: NodeId[];

  select: (id: NodeId | null, additive?: boolean) => void;
  selectMany: (ids: NodeId[]) => void;
  selectEdge: (id: EdgeId | null) => void;
  clearSelection: () => void;
  isSelected: (id: NodeId) => boolean;

  setView: (view: ViewTransform) => void;
  requestFit: () => void;
  setViewport: (w: number, h: number) => void;
  zoomBy: (factor: number) => void;
  setActiveCharacter: (id: string | null) => void;
  setShowTransitions: (v: boolean) => void;
  setShowEvents: (v: boolean) => void;
  setShowEras: (v: boolean) => void;
  setEraLevel: (v: EraLevel) => void;
  focusNode: (id: NodeId) => void;
  runAsr: () => void;
  clearAsr: () => void;
  setAsrOptions: (opts: Partial<AsrOptions>) => void;

  setReconMode: (v: boolean) => void;
  setActiveGeneTree: (id: string | null) => void;
  selectGeneNode: (id: NodeId | null, additive?: boolean) => void;
  clearGeneSelection: () => void;
}

// --- tabs slice ----------------------------------------------------------------

export interface TabsSlice {
  /** Ordered tab ids. */
  tabs: string[];
  /** The active tab whose document is in the top-level fields. */
  activeTabId: string;
  /** Parked snapshots for the INACTIVE tabs. */
  tabStore: Record<string, TabSnapshot>;

  /** Open a fresh empty document in a new tab and activate it. */
  newTab: () => void;
  /** Open the given project in a new tab and activate it. */
  openInNewTab: (project: Project) => void;
  /** Switch to an existing tab, preserving its saved view. */
  switchTab: (id: string) => void;
  /** Close a tab; the last remaining tab cannot be closed. */
  closeTab: (id: string) => void;
  /** Replace all tabs with the given projects (used to restore a workspace). */
  loadWorkspace: (projects: Project[], activeIndex: number) => void;
  /**
   * Rebuild every UNTOUCHED sample document in the current UI language.
   *
   * A sample document bakes its labels (project name, characters, states,
   * layers, events, calibrations) in the language that was active when the
   * sample card was clicked, because they are document DATA. Documents that
   * came from a sample card and have no undo / redo history are pure sample
   * content, so on a locale switch they are rebuilt from the catalogue and
   * follow the new language; anything the user has edited is left alone.
   */
  relocalizeSamples: () => void;
}

export type AppState = DocumentSlice & UISlice & TabsSlice;

/**
 * Is the reconciliation view what the user is looking at right now?
 *
 * Exported as a plain function of state, not as a hook, because two different
 * callers need the same rule: the React render (which subscribes through
 * `useStore`) and the global keyboard handler (which must call it against
 * `useStore.getState()`). The handler is installed once with `[]` deps, so a
 * value closed over from the first render never updates — which is why the
 * handler reads this live rather than capturing a stale boolean (otherwise a
 * branch such as "tell the user ⌘F is unavailable here" would never fire).
 */
export function isReconActive(state: Pick<AppState, 'reconMode' | 'activeGeneTreeId' | 'project'>): boolean {
  return (
    state.reconMode &&
    Boolean(state.activeGeneTreeId) &&
    state.project.geneTrees?.some((g) => g.id === state.activeGeneTreeId) === true
  );
}

const createDocumentSlice: StateCreator<AppState, [], [], DocumentSlice> = (set, get) => ({
  project: freeze(createSampleProject(), true),
  past: [],
  future: [],
  interactionBase: null,
  draggingId: null,

  apply: (recipe) =>
    set((s) => {
      // Wrap so a treeOp's return value is ignored (Immer forbids returning
      // a value *and* mutating the draft).
      const next = produce(s.project, (d) => {
        recipe(d);
      });
      if (next === s.project) return {};
      // Undo / redo / cancel all prune the selection; `apply` does too, so an
      // edit that folds away the selected node cannot leave a dangling id that
      // makes the status bar keep reporting "1 selected" for a node that no
      // longer exists.
      // The past entry keeps the PRE-edit selection so undo restores it faithfully.
      return {
        project: next,
        selection: keptSelection(next, s.selection),
        past: pushSnapshot(s.past, entryOf(s)),
        future: [],
        asr: null,
      };
    }),

  beginInteraction: (dragId) =>
    set((s) => ({ interactionBase: entryOf(s), draggingId: dragId ?? null })),

  live: (recipe) =>
    set((s) => {
      const next = produce(s.project, (d) => {
        recipe(d);
      });
      return next === s.project ? {} : { project: next, selection: keptSelection(next, s.selection) };
    }),

  commitInteraction: (finalRecipe) =>
    set((s) => {
      const base = s.interactionBase;
      const current = finalRecipe
        ? produce(s.project, (d) => {
            finalRecipe(d);
          })
        : s.project;
      if (!base) {
        return current === s.project
          ? { draggingId: null }
          : { project: current, draggingId: null };
      }
      // Structural sharing means an unchanged interaction yields the very same
      // Project reference, so a cheap identity check is enough — no O(n) deep
      // comparison is needed to tell whether anything actually moved.
      const changed = current !== base.project;
      return {
        project: current,
        selection: keptSelection(current, s.selection),
        interactionBase: null,
        draggingId: null,
        asr: null,
        ...(changed ? { past: pushSnapshot(s.past, base), future: [] } : {}),
      };
    }),

  cancelInteraction: () =>
    set((s) =>
      s.interactionBase
        ? {
            project: s.interactionBase.project,
            selection: pruneSelection(s.interactionBase.project, s.interactionBase.selection),
            selectedEdgeId: s.interactionBase.selectedEdgeId,
            interactionBase: null,
            draggingId: null,
          }
        : { draggingId: null },
    ),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        project: previous.project,
        past: s.past.slice(0, -1),
        future: [entryOf(s), ...s.future],
        selection: pruneSelection(previous.project, previous.selection),
        selectedEdgeId: previous.selectedEdgeId,
        view: previous.view,
        activeCharacterId: previous.activeCharacterId,
        asr: null,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const nextEntry = s.future[0];
      return {
        project: nextEntry.project,
        past: pushSnapshot(s.past, entryOf(s)),
        future: s.future.slice(1),
        selection: pruneSelection(nextEntry.project, nextEntry.selection),
        selectedEdgeId: nextEntry.selectedEdgeId,
        view: nextEntry.view,
        activeCharacterId: nextEntry.activeCharacterId,
        asr: null,
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  loadProject: (project) =>
    set((s) => ({
      // Reuse the one canonical per-document reset (`docStateFor`) rather than a
      // second, shorter copy that omits reconMode / activeGeneTreeId /
      // geneSelection and the view — an incomplete reset could leave the
      // reconciliation state pointing at a gene tree of the previous document.
      ...docStateFor(project),
      loadCounter: s.loadCounter + 1,
      fitRequests: s.fitRequests + 1,
    })),

  newProject: () =>
    // Same single reset set as `loadProject` (`docStateFor`), so a new empty
    // document can never inherit the previous one's reconciliation view through a
    // shorter hand-written list. Every UI entry point goes through
    // `openInNewTab`, so this path is rarely hit — which is exactly why it shares
    // the canonical reset rather than relying on being unused.
    set((s) => ({
      ...docStateFor(freeze(createEmptyProject(), true)),
      loadCounter: s.loadCounter + 1,
      fitRequests: s.fitRequests + 1,
    })),
});

const createUISlice: StateCreator<AppState, [], [], UISlice> = (set, get) => ({
  selection: [],
  selectedEdgeId: null,
  view: { ...IDENTITY_VIEW },
  loadCounter: 0,
  fitRequests: 0,
  viewport: { w: 0, h: 0 },
  activeCharacterId: null,
  showTransitions: true,
  showEvents: true,
  showEras: false,
  eraLevel: 'both',
  focusTarget: null,
  asr: null,
  asrOptions: DEFAULT_ASR_OPTIONS,
  reconMode: false,
  activeGeneTreeId: null,
  geneSelection: [],

  select: (id, additive = false) =>
    set((s) => {
      if (id === null) return { selection: [], selectedEdgeId: null };
      if (!additive) return { selection: [id], selectedEdgeId: null };
      const has = s.selection.includes(id);
      return {
        selection: has ? s.selection.filter((x) => x !== id) : [...s.selection, id],
        selectedEdgeId: null,
      };
    }),

  selectMany: (ids) => set({ selection: ids, selectedEdgeId: null }),

  selectEdge: (id) => set({ selectedEdgeId: id, selection: [] }),

  clearSelection: () => set({ selection: [], selectedEdgeId: null }),

  isSelected: (id) => get().selection.includes(id),

  setView: (view) => set({ view }),

  requestFit: () => set((s) => ({ fitRequests: s.fitRequests + 1 })),

  setViewport: (w, h) => set({ viewport: { w, h } }),

  zoomBy: (factor) =>
    set((s) => {
      const { view, viewport } = s;
      const cx = (viewport.w || 800) / 2;
      const cy = (viewport.h || 600) / 2;
      const scale = Math.max(0.1, Math.min(8, view.scale * factor));
      const k = scale / view.scale;
      return { view: { scale, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k } };
    }),

  setActiveCharacter: (id) => set({ activeCharacterId: id, asr: null }),

  setShowTransitions: (v) => set({ showTransitions: v }),

  setShowEvents: (v) => set({ showEvents: v }),

  setShowEras: (v) => set({ showEras: v }),

  setEraLevel: (v) => set({ eraLevel: v }),

  focusNode: (id) =>
    set((s) => ({ focusTarget: { id, seq: (s.focusTarget?.seq ?? 0) + 1 } })),

  runAsr: () =>
    set((s) => {
      const c = s.project.characters.find((x) => x.id === s.activeCharacterId);
      if (!c || c.type !== 'discrete') return {};
      const result = reconstructMk(s.project, c, s.asrOptions);
      if (!result) {
        // A null result means "this Mk model is not implemented here", and
        // must never be left to read as "the data supports no reconstruction".
        notify.error(
          tr(
            `Mk 模型「${s.asrOptions.model}」尚未实现：本软件只做等速率（ER）重建，因此不显示结果`,
            `The Mk model "${s.asrOptions.model}" is not implemented: this software reconstructs only equal rates (ER), so no result is shown`,
          ),
        );
      }
      if (result?.warnings.length) {
        for (const w of result.warnings) {
          notify.info(w.message);
        }
      }
      return { asr: result };
    }),

  clearAsr: () => set({ asr: null }),

  setAsrOptions: (opts) =>
    set((s) => ({ asrOptions: { ...s.asrOptions, ...opts } })),

  setReconMode: (v) => set({ reconMode: v }),

  setActiveGeneTree: (id) => set({ activeGeneTreeId: id, geneSelection: [] }),

  selectGeneNode: (id, additive = false) =>
    set((s) => {
      if (id === null) return { geneSelection: [] };
      if (!additive) return { geneSelection: [id] };
      const has = s.geneSelection.includes(id);
      return {
        geneSelection: has ? s.geneSelection.filter((x) => x !== id) : [...s.geneSelection, id],
      };
    }),

  clearGeneSelection: () => set({ geneSelection: [] }),
});

const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set) => ({
  tabs: [INITIAL_TAB_ID],
  activeTabId: INITIAL_TAB_ID,
  tabStore: {},

  newTab: () =>
    set((s) => {
      const id = newTabId();
      return {
        tabStore: { ...s.tabStore, [s.activeTabId]: captureTab(s) },
        tabs: [...s.tabs, id],
        activeTabId: id,
        ...docStateFor(createEmptyProject()),
        loadCounter: s.loadCounter + 1,
        fitRequests: s.fitRequests + 1,
      };
    }),

  openInNewTab: (project) =>
    set((s) => {
      const id = newTabId();
      return {
        tabStore: { ...s.tabStore, [s.activeTabId]: captureTab(s) },
        tabs: [...s.tabs, id],
        activeTabId: id,
        ...docStateFor(project),
        loadCounter: s.loadCounter + 1,
        fitRequests: s.fitRequests + 1,
      };
    }),

  switchTab: (id) =>
    set((s) => {
      if (id === s.activeTabId) return {};
      const snap = s.tabStore[id];
      if (!snap) return {};
      const tabStore = { ...s.tabStore, [s.activeTabId]: captureTab(s) };
      delete tabStore[id];
      // Preserve the tab's saved view (no auto-fit); the layout recomputes from
      // the swapped-in project reference.
      return { tabStore, activeTabId: id, ...restoreState(snap), loadCounter: s.loadCounter + 1 };
    }),

  closeTab: (id) =>
    set((s) => {
      if (s.tabs.length <= 1) return {};
      const idx = s.tabs.indexOf(id);
      if (idx < 0) return {};
      const tabs = s.tabs.filter((t) => t !== id);
      if (id !== s.activeTabId) {
        const tabStore = { ...s.tabStore };
        delete tabStore[id];
        return { tabs, tabStore };
      }
      // Closing the active tab: activate a neighbour and discard this document.
      const neighbourId = tabs[Math.min(idx, tabs.length - 1)];
      const snap = s.tabStore[neighbourId];
      const tabStore = { ...s.tabStore };
      delete tabStore[neighbourId];
      return {
        tabs,
        tabStore,
        activeTabId: neighbourId,
        ...(snap ? restoreState(snap) : {}),
        loadCounter: s.loadCounter + 1,
      };
    }),

  loadWorkspace: (projects, activeIndex) =>
    set((s) => {
      if (!projects.length) return {};
      const clamped = Math.max(0, Math.min(projects.length - 1, activeIndex));
      const ids = projects.map(() => newTabId());
      const tabStore: Record<string, TabSnapshot> = {};
      projects.forEach((p, i) => {
        if (i !== clamped) tabStore[ids[i]] = snapshotFor(p);
      });
      return {
        tabs: ids,
        activeTabId: ids[clamped],
        tabStore,
        ...docStateFor(projects[clamped]),
        loadCounter: s.loadCounter + 1,
        fitRequests: s.fitRequests + 1,
      };
    }),

  relocalizeSamples: () =>
    set((s) => {
      const isPristine = (past: HistoryEntry[], future: HistoryEntry[]) =>
        past.length === 0 && future.length === 0;
      const rebuild = (project: Project, pristine: boolean): Project | null => {
        if (!project.sampleId || !pristine) return null;
        const entry = SAMPLE_PROJECTS.find((d) => d.id === project.sampleId);
        return entry ? entry.build() : null;
      };

      const activeFresh = rebuild(s.project, isPristine(s.past, s.future));
      let tabsTouched = false;
      const tabStore: Record<string, TabSnapshot> = {};
      for (const [id, snap] of Object.entries(s.tabStore)) {
        const fresh = rebuild(snap.project, isPristine(snap.past, snap.future));
        tabStore[id] = fresh
          ? {
              ...snap,
              project: freeze(fresh, true),
              activeCharacterId: fresh.characters[0]?.id ?? null,
              activeGeneTreeId: fresh.geneTrees?.[0]?.id ?? null,
              geneSelection: [],
            }
          : snap;
        if (fresh) tabsTouched = true;
      }
      if (!activeFresh && !tabsTouched) return {};

      // Keep the user's canvas view; only the document content swaps.
      return {
        tabStore,
        ...(activeFresh
          ? {
              project: freeze(activeFresh, true),
              past: [] as HistoryEntry[],
              future: [] as HistoryEntry[],
              selection: [] as NodeId[],
              selectedEdgeId: null as EdgeId | null,
              activeCharacterId: activeFresh.characters[0]?.id ?? null,
              activeGeneTreeId: activeFresh.geneTrees?.[0]?.id ?? null,
              geneSelection: [] as NodeId[],
            }
          : {}),
      };
    }),
});

export const useStore = create<AppState>()((set, get, api) => {
  const doc = createDocumentSlice(set, get, api);
  const ui = createUISlice(set, get, api);
  const tabs = createTabsSlice(set, get, api);
  return {
    ...doc,
    ...ui,
    ...tabs,
    // Colour by the first character of the initial document, if any.
    activeCharacterId: doc.project.characters[0]?.id ?? null,
  };
});
