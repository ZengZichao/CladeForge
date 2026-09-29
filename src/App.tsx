// Application shell: assembles the menu bar, toolbar, canvas and inspector,
// and owns transient UI state (add-children dialog, context menu) plus global
// keyboard shortcuts.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Cross1Icon, PlusIcon, PinLeftIcon, PinRightIcon } from '@radix-ui/react-icons';
import { useStore, isReconActive } from './model/store';
import { addChildrenSpaced } from './model/treeOps';
import type { Project } from './model/types';
import { requestConfirm } from './ui/confirmDialog';
import { shouldReselectOnRightClick } from './ui/selectionGuard';
import * as file from './io/fileActions';
import { registerMultiTreeHandler } from './io/fileActions';
import { getAppInfo } from './io/native';
import { readAutoSave, readWorkspace, writeWorkspace } from './io/projectIO';
import { getLastAutosave, subscribeAutosave, type AutosaveState } from './io/autosave';
import { isImeComposing } from './ui/imeGuard';
import { MenuBar } from './ui/MenuBar';
import { Toolbar } from './ui/Toolbar';
import { LayoutPanel } from './ui/LayoutPanel';
import { LayerPanel } from './ui/LayerPanel';
import { CharacterPanel } from './ui/CharacterPanel';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { TimePanel } from './ui/TimePanel';
import { ReconPanel } from './ui/ReconPanel';
import { CharacterMatrixDialog } from './ui/CharacterMatrixDialog';
import { AnalysisDialog } from './ui/AnalysisDialog';
import { NexusExportDialog } from './ui/NexusExportDialog';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { CanvasControls } from './ui/CanvasControls';
import { ReconciliationView } from './canvas/ReconciliationView';
import { hitTargetFor } from './canvas/hitTarget';
import { MIN_SCALE as MIN_VIEW_SCALE } from './canvas/coords';
import { TreeCanvas } from './canvas/TreeCanvas';
import { AddChildrenDialog } from './ui/AddChildrenDialog';
import { CommandPalette } from './ui/CommandPalette';
import { ContextMenu, type ContextTarget } from './ui/ContextMenu';
import { Toaster } from './ui/Toaster';
import { BusyOverlay } from './ui/BusyOverlay';
import { ConfirmDialog } from './ui/confirmDialog';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { FirstRunTour } from './ui/FirstRunTour';
import { ImportTreesDialog } from './ui/ImportTreesDialog';
import { notify } from './ui/toast';
import { S, skippedTabs } from './ui/strings';
import { NavigationRail, type NavModule } from './ui/NavigationRail';
import { useLanguage, onLanguageChange, currentLanguage } from './ui/i18n';
import { tr } from './ui/strings';
import { buildConsensusTree } from './model/consensus';
import { AboutDialog } from './ui/AboutDialog';

// Locale switch side effect OUTSIDE the React tree: sample documents that the
// user has not touched are rebuilt from the catalogue in the new language, so
// sample names / characters / events follow the UI language instead of staying
// frozen in the language that was active when the card was clicked. Registered
// at module scope so the App remount on locale change cannot double-register.
let lastSeenLanguage = currentLanguage();
onLanguageChange(() => {
  if (currentLanguage() === lastSeenLanguage) return;
  lastSeenLanguage = currentLanguage();
  useStore.getState().relocalizeSamples();
});

// --- side-panel resizing -----------------------------------------------------
const LS_LEFT_WIDTH = 'cladeforge:leftWidth';
const LS_RIGHT_WIDTH = 'cladeforge:rightWidth';
// Default panel widths are kept narrow so a small laptop keeps canvas space; the
// splitters let the user widen either panel up to MAX_PANEL_WIDTH.
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 620;
const NARROW_THRESHOLD = 1024;
const LS_NAV_MODULE = 'cladeforge:navModule';

/**
 * Clamp a side-panel width. The ceiling is also bounded by the WINDOW: two panels
 * at the fixed 620 px maximum would consume all 1280 px of the default window and
 * leave the canvas no room at all. A third of the viewport each keeps
 * both panels usable while leaving the tree visible.
 */
function clampPanel(w: number): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const cap = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.floor(vw / 3)));
  return Math.max(MIN_PANEL_WIDTH, Math.min(cap, w));
}

function readPanelWidth(key: string, fallback: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? clampPanel(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readNavModule(): NavModule {
  try {
    const v = localStorage.getItem(LS_NAV_MODULE);
    if (
      v === 'traits' || v === 'layers' || v === 'recon' || v === 'time' ||
      v === 'style' || v === 'analysis' || v === 'export'
    ) return v;
    // `hypothesis` is an accepted alias for the layers module, so a stored key
    // carrying it opens layers rather than falling back to the default.
    if (v === 'hypothesis') return 'layers';
  } catch { /* ignore */ }
  return 'traits';
}

/**
 * Vertical splitter that resizes an adjacent side panel by dragging.
 *
 * Performance strategy:
 * 1. During the drag, panel width is mutated DIRECTLY on the DOM node so no
 *    React re-render fires per frame.
 * 2. CSS transitions on the panel are temporarily disabled (a `dragging` class
 *    is toggled on <body>) so the browser doesn't animate every width change.
 * 3. pointermove is throttled to one update per animation frame via
 *    requestAnimationFrame — pointermove can fire faster than the display
 *    refresh, so coalescing avoids redundant layout work.
 * 4. React state is only updated once, on pointerup, to persist the final width.
 */
function ResizeHandle({
  side,
  width,
  panelRef,
  onCommit,
}: {
  side: 'left' | 'right';
  width: number;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onCommit: (w: number) => void;
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = panelRef.current;
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    let raf = 0;
    let pending = false;

    // Disable transitions globally during drag so width changes are instant.
    document.body.classList.add('panel-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const applyWidth = () => {
      raf = 0;
      pending = false;
      if (panel) panel.style.width = `${last}px`;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      last = clampPanel(side === 'left' ? startW + dx : startW - dx);
      // Coalesce multiple pointermove events into one rAF callback.
      if (!pending) {
        pending = true;
        raf = requestAnimationFrame(applyWidth);
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      // Final write in case the last rAF hasn't fired yet.
      if (panel) panel.style.width = `${last}px`;
      document.body.classList.remove('panel-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      title={S.panel.resizeTitle}
      onPointerDown={onPointerDown}
    />
  );
}

// Narrow-screen bottom tab bar: the navigation modules stay
// reachable as a persistent bar instead of being dropped or hidden behind
// overlays. Tapping a module opens the left panel overlay on that module.
function BottomTabBar({ active, onSelect }: { active: NavModule; onSelect: (m: NavModule) => void }) {
  const items: { id: NavModule; label: string }[] = [
    { id: 'style', label: S.nav.style },
    { id: 'traits', label: S.nav.traits },
    { id: 'layers', label: S.nav.layers },
    { id: 'recon', label: S.nav.recon },
    { id: 'time', label: S.nav.time },
    { id: 'analysis', label: S.nav.analysis },
    { id: 'export', label: S.nav.export },
  ];
  return (
    <nav className="bottom-tab-bar" aria-label={tr("模块导航","Module navigation")}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`bottom-tab${active === it.id ? ' active' : ''}`}
          onClick={() => onSelect(it.id)}
          aria-current={active === it.id ? 'page' : undefined}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}

// --- tab bar -----------------------------------------------------------------
function TabBar() {  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeName = useStore((s) => s.project.name);
  const tabStore = useStore((s) => s.tabStore);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const newTab = useStore((s) => s.newTab);
  const pastLength = useStore((s) => s.past.length);
  const titleOf = (id: string) =>
    (id === activeTabId ? activeName : tabStore[id]?.project.name) || S.tabs.untitled;

  const handleClose = (id: string) => {
    // Determine if this tab has unsaved work: the active tab's undo history
    // tells us whether the user made edits after loading/creating.
    const isActive = id === activeTabId;
    const hasHistory = isActive ? pastLength > 0 : (tabStore[id]?.past.length ?? 0) > 0;
    if (hasHistory) {
      requestConfirm({
        key: 'close-tab',
        title: S.tabs.closeConfirmTitle,
        message: S.tabs.closeConfirmMessage(titleOf(id)),
        confirmLabel: S.tabs.close,
        danger: true,
        onConfirm: () => closeTab(id),
      });
    } else {
      closeTab(id);
    }
  };

  return (
    <div className="tabbar" data-tauri-drag-region>
      {tabs.map((id) => (
        <div
          key={id}
          className={`tab${id === activeTabId ? ' active' : ''}`}
          title={titleOf(id)}
          onMouseDown={() => switchTab(id)}
        >
          {/* The title attribute also sits on the inner span: the tab bar is
              a window drag region in Tauri and some builds suppress the
              container tooltip, so a per-span title guarantees the full file
              name is shown on hover (truncated tab labels stay readable). */}
          <span className="tab-title" title={titleOf(id)}>
            {titleOf(id)}
          </span>
          {tabs.length > 1 && (
            <button
              className="tab-close"
              title={S.tabs.close}
              aria-label={S.tabs.close}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleClose(id);
              }}
            >
              <Cross1Icon />
            </button>
          )}
        </div>
      ))}
      <button className="tab-new" title={S.tabs.newTab} aria-label={S.tabs.newTab} onClick={() => newTab()}>
        <PlusIcon />
      </button>
    </div>
  );
}

// Auto-save status tracker.
//
// A "已保存" driven off the debounce timer alone would lie whenever localStorage
// is blocked or quota-full and the write throws — the one failure mode that costs
// a user their work. So the status follows the real write outcome published on
// the autosave channel: 'saved' appears only for a write that returned ok, and a
// failure appears as 'failed' with the cause in its tooltip (the channel also
// raises the warning toast itself).
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

function useAutoSaveStatus(): { status: SaveStatus; detail: string | null } {
  const project = useStore((s) => s.project);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  const [outcome, setOutcome] = useState<AutosaveState | null>(() => getLastAutosave());
  const [pendingSince, setPendingSince] = useState<number | null>(null);

  // Subscribe once: every workspace write publishes its result here.
  useEffect(() => subscribeAutosave(setOutcome), []);

  // Any document / tab change means a write is due (the debounced effect below
  // performs it ~800 ms later).
  useEffect(() => {
    setPendingSince(Date.now());
  }, [project, tabs, activeTabId, tabStore]);

  // An outcome at or after the last change answers that change.
  useEffect(() => {
    if (outcome && pendingSince !== null && outcome.at >= pendingSince) setPendingSince(null);
  }, [outcome, pendingSince]);

  const status: SaveStatus =
    pendingSince !== null ? 'saving' : outcome ? (outcome.ok ? 'saved' : 'failed') : 'idle';
  return { status, detail: outcome && !outcome.ok ? outcome.message ?? null : null };
}

function StatusBar() {
  const nodeCount = useStore((s) => Object.keys(s.project.nodes).length);
  const edgeCount = useStore((s) => s.project.customEdges.length);
  const scale = useStore((s) => s.view.scale);
  const selectionCount = useStore((s) => s.selection.length);
  const { status: saveStatus, detail: saveDetail } = useAutoSaveStatus();
  const minScaleReached = useStore((s) => s.view.scale <= MIN_VIEW_SCALE + 1e-9);

  return (
    <div className="status">
      <span>
        {S.status.nodes} {nodeCount}
      </span>
      <span>
        {S.status.edges} {edgeCount}
      </span>
      {/* "Fit" clamps at MIN_SCALE, so a very tall tree can stay partly
          off-screen; the zoom readout says explicitly when that limit is hit. */}
      <span title={minScaleReached ? S.canvasControls.fitClampedTitle : undefined}>
        {S.status.zoom} {Math.round(scale * 100)}%
        {minScaleReached ? ` · ${S.canvasControls.fitClamped}` : ''}
      </span>
      {selectionCount > 0 && (
        <span>
          {S.status.selected} {selectionCount}
        </span>
      )}
      {/* MRCA is highlighted whenever exactly two nodes are selected — surface
          this otherwise invisible capability explicitly. */}
      {selectionCount === 2 && <span className="status-mrca">{S.status.mrcaHint}</span>}
      {/* Auto-save status: 'saved' only ever follows a write that returned ok. */}
      {saveStatus === 'saving' && (
        <span className="status-saving" title={S.status.savingTitle}>{S.status.saving}</span>
      )}
      {saveStatus === 'saved' && (
        <span className="status-saved" title={S.status.savedTitle}>{S.status.saved}</span>
      )}
      {saveStatus === 'failed' && (
        <span className="status-failed" role="alert" title={saveDetail ?? S.status.saveFailedTitle}>
          {S.status.saveFailed}
        </span>
      )}
      <span className="spacer" />
      {/* Gesture hints live in the ⌘? shortcuts dialog; the status bar stays
          data-only (counts / zoom / autosave). */}
    </div>
  );
}

/** Left panel content for a given navigation module (single-responsibility
 *  modules — see NavigationRail for the grouping rationale). */
function LeftPanelContent({
  module,
  onOpenMatrix,
  onOpenAnalysis,
  onNexusExport,
}: {
  module: NavModule;
  onOpenMatrix: () => void;
  onOpenAnalysis: () => void;
  onNexusExport: () => void;
}) {
  switch (module) {
    case 'traits':
      return (
        <>
          <div className="panel-header">
            <span className="panel-header-title">{S.nav.traits}</span>
            <span className="panel-header-subtitle">{S.character.section}</span>
          </div>
          <CharacterPanel onOpenMatrix={onOpenMatrix} />
        </>
      );
    case 'layers':
      return (
        <>
          <div className="panel-header">
            <span className="panel-header-title">{S.nav.layers}</span>
            <span className="panel-header-subtitle">{S.layer.section}</span>
          </div>
          <LayerPanel />
        </>
      );
    case 'recon':
      // ReconPanel renders its own header.
      return <ReconPanel />;
    case 'time':
      // TimePanel renders its own header.
      return <TimePanel />;
    case 'style':
      return (
        <>
          <div className="panel-header">
            <span className="panel-header-title">{S.nav.style}</span>
          </div>
          <LayoutPanel />
        </>
      );
    case 'analysis':
      return (
        <AnalysisPanel
          onOpenMatrix={onOpenMatrix}
          onOpenAnalysis={onOpenAnalysis}
        />
      );
    case 'export':
      return <ExportPanel onNexusExport={onNexusExport} />;
  }
}

/** Export module panel for the navigation rail, grouped by format family. */
function ExportPanel({ onNexusExport }: { onNexusExport: () => void }) {
  const row = (label: string, fn: () => void) => (
    <div className="field row-actions" key={label}>
      <button className="btn" onClick={fn}>
        {label}
      </button>
    </div>
  );
  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.export}</span>
      </div>
      <div className="panel-section">
        <h3>{S.exportGroup.vector}</h3>
        {row(S.exportItems.svg, () => void file.actionExportSVG())}
        {row(S.exportItems.pdf, () => void file.actionExportPDF())}
        <h3>{S.exportGroup.raster}</h3>
        {row(S.exportItems.png, () => void file.actionExportPNG())}
        <h3>{S.exportGroup.data}</h3>
        {row(S.exportItems.newick, () => void file.actionExportNewick())}
        {row(S.exportItems.nexus, onNexusExport)}
        {row(S.exportItems.hypothesisJSON, () => void file.actionExportHypothesisJSON())}
        {row(S.exportItems.rScript, () => void file.actionExportRScript())}
        {row(S.exportItems.reconReport, () => void file.actionExportReconciliationReport())}
        <h3>{S.exportGroup.report}</h3>
        {row(S.exportItems.narrative, () => void file.actionExportNarrative())}
      </div>
    </>
  );
}

export function App() {
  // Locale switch remounts the whole tree (key) so every string — including
  // those inside memoised subtrees — re-renders from the swapped catalogue.
  const lang = useLanguage();
  // One subscription, one rule (`isReconActive`): the keyboard handler below
  // applies the same predicate to live store state, so the rendered view and the
  // shortcut handling cannot disagree about whether reconciliation is active.
  const reconActive = useStore(isReconActive);
  const [addOpen, setAddOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [nexusExportOpen, setNexusExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // The command palette memoises its ~35-command list on these callbacks. Passed
  // as inline arrows they would get a fresh identity on every App render — and
  // App re-renders on every pointer-move during a drag — so the whole list, JSX
  // icons included, would be rebuilt each frame. These setters are all stable,
  // so an empty dep list is correct here.
  const openMatrixFromPalette = useCallback(() => { setPaletteOpen(false); setMatrixOpen(true); }, []);
  const openAnalysisFromPalette = useCallback(() => { setPaletteOpen(false); setAnalysisOpen(true); }, []);
  const openTourFromPalette = useCallback(() => { setPaletteOpen(false); setTourOpen(true); }, []);
  const openShortcutsFromPalette = useCallback(() => { setPaletteOpen(false); setShortcutsOpen(true); }, []);
  const openAboutFromPalette = useCallback(() => { setPaletteOpen(false); setAboutOpen(true); }, []);
  const [multiTreeProjects, setMultiTreeProjects] = useState<Project[] | null>(null);
  const [leftWidth, setLeftWidth] = useState(() => readPanelWidth(LS_LEFT_WIDTH, 240));
  const [rightWidth, setRightWidth] = useState(() => readPanelWidth(LS_RIGHT_WIDTH, 272));
  // Clamp on EVERY render, not only when the handle is released: `clampPanel`
  // bounds the ceiling by the current window width, so a width committed while
  // the window was wide would otherwise stay oversized after a shrink and keep
  // squeezing the canvas out.
  const panelLeft = clampPanel(leftWidth);
  const panelRight = clampPanel(rightWidth);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const [navModule, setNavModule] = useState<NavModule>(() => readNavModule());

  // ⌘. toggles both side panels — a quick collapse on small windows.
  const [panelsHidden, setPanelsHidden] = useState(false);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false);
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const isNarrow = windowWidth < NARROW_THRESHOLD;

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Multi-tree import chooser: fileActions delegates here.
  useEffect(() => {
    registerMultiTreeHandler((projects) => {
      setMultiTreeProjects(projects);
    });
    return () => registerMultiTreeHandler(null);
  }, []);

  const openAddForSelection = useCallback(() => {
    const s = useStore.getState();
    setAddTarget(s.selection[0] ?? s.project.rootId);
    setAddOpen(true);
  }, []);

  const openAddForNode = useCallback((parentId: string) => {
    setAddTarget(parentId);
    setAddOpen(true);
  }, []);

  const confirmAdd = useCallback(
    (count: number) => {
      if (addTarget) useStore.getState().apply((d) => addChildrenSpaced(d, addTarget, count));
      setAddOpen(false);
    },
    [addTarget],
  );

  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    // Same closest()-based resolution as the canvas gestures: right-clicking a
    // custom edge hits its child hit-path, whose own attributes are empty.
    const hit = hitTargetFor(e.target);
    const nodeId = hit.nodeId;
    const edgeId = hit.edgeId;
    const st = useStore.getState();
    // A right-click inside an existing selection keeps that selection; only a
    // click on a node outside it re-selects. Collapsing every multi-selection on
    // right-click would make `selection.length > 1` in the context menu never
    // true, leaving the "set as outgroup & reroot" item — a fully implemented
    // feature — unreachable.
    if (nodeId) {
      if (shouldReselectOnRightClick(st.selection, nodeId)) st.select(nodeId);
    } else if (edgeId) {
      st.selectEdge(edgeId);
    }
    setMenu({ x: e.clientX, y: e.clientY, nodeId, edgeId });
  }, []);

  // Global (modifier) shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // A composition session can be open over a non-input element too (an
      // SVG child, a contenteditable region, a focus kept on the canvas), and
      // ⌘-key chords are delivered to the page while the candidate list is up.
      // Nothing here may fire mid-composition.
      if (isImeComposing(e)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (k === 's') {
        e.preventDefault();
        void file.actionSaveProject();
      } else if (k === 'o') {
        e.preventDefault();
        void file.actionOpenProject();
      } else if (k === 't' || k === 'n') {
        e.preventDefault();
        s.newTab();
      } else if (k === 'f') {
        e.preventDefault();
        if (e.shiftKey) s.requestFit();
        else {
          // CanvasControls owns the only listener for this event, and it is
          // unmounted in reconciliation view — so the key would be swallowed with
          // no feedback at all. Say so instead.
          //
          // Read the LIVE store, not the render-scope `reconActive`: this handler
          // is registered once with `[]` deps, so a closed-over render value is
          // frozen at its initial `false` and the branch could never be taken.
          if (isReconActive(useStore.getState())) {
            notify.info(
              tr(
                '搜索仅适用于标准树视图；请退出协同视图后再使用 ⌘F。',
                'Search applies to the standard tree view only — leave the reconciliation view before using ⌘F.',
              ),
            );
          } else {
            // Dispatch a custom event so CanvasControls opens the search input
            // (if closed) and focuses it, instead of silently failing when the
            // input hasn't been rendered yet.
            window.dispatchEvent(new CustomEvent('cladeforge:focus-search'));
          }
        }
      } else if (k === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (k === '?') {
        // ⌘? opens the shortcut reference.
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (k === '.') {
        // ⌘. toggles the side panels.
        e.preventDefault();
        setPanelsHidden((h) => !h);
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        s.zoomBy(1.2);
      } else if (k === '-' || k === '_') {
        e.preventDefault();
        s.zoomBy(1 / 1.2);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reflect native app + version into the window title.
  useEffect(() => {
    void getAppInfo().then((info) => {
      if (info) document.title = `${info.name} ${info.version}`;
    });
  }, []);

  // Restore the saved workspace on first mount. The onboarding tour is opt-in
  // and is not opened here — see the comment inside the effect.
  useEffect(() => {
    const ws = readWorkspace();
    if (ws) {
      useStore.getState().loadWorkspace(ws.projects, ws.activeIndex);
      if (ws.skipped > 0) notify.info(skippedTabs(ws.skipped));
    } else {
      const saved = readAutoSave();
      if (saved) useStore.getState().loadProject(saved);
    }
    // The tour is OPT-IN and nothing here opens it: users reach it from
    // 帮助 → 新手指南, from the command palette (⌘K) or from the shortcut
    // reference dialog. `FirstRunTour` is a modal with its own focus trap
    // (`useDialogFocus`), so when it is shown is a product decision, not a
    // safety one.
  }, []);

  // Debounced autosave of the whole workspace.
  const project = useStore((s) => s.project);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useStore.getState();
      const projects = s.tabs
        .map((id) => (id === s.activeTabId ? s.project : s.tabStore[id]?.project))
        .filter((p): p is Project => Boolean(p));
      writeWorkspace(projects, Math.max(0, s.tabs.indexOf(s.activeTabId)));
    }, 800);
    return () => clearTimeout(t);
  }, [project, tabs, activeTabId, tabStore]);

  // Persist panel widths.
  useEffect(() => {
    try { localStorage.setItem(LS_LEFT_WIDTH, String(leftWidth)); } catch { /* ignore */ }
  }, [leftWidth]);
  useEffect(() => {
    try { localStorage.setItem(LS_RIGHT_WIDTH, String(rightWidth)); } catch { /* ignore */ }
  }, [rightWidth]);

  // Persist nav module selection.
  useEffect(() => {
    try { localStorage.setItem(LS_NAV_MODULE, navModule); } catch { /* ignore */ }
  }, [navModule]);

  return (
    <div className="app" key={lang}>
      <TabBar />
      <div className="header-bar" data-tauri-drag-region>
        <MenuBar
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenTour={() => setTourOpen(true)}
          onOpenAbout={() => setAboutOpen(true)}
        />
          <Toolbar onAddChildrenDialog={openAddForSelection} />
        </div>
      <div className="body">
        {/* NavigationRail: icon + label module switcher (hidden when panels
            are collapsed via ⌘. or on narrow screens — a bottom tab bar takes
            over there). */}
        {!isNarrow && !panelsHidden && <NavigationRail active={navModule} onSelect={setNavModule} />}

        {/* Overlay buttons for narrow screens */}
        {isNarrow && (
          <button
            className="panel-toggle-btn left"
            onClick={() => {
              setLeftOverlayOpen(true);
              setRightOverlayOpen(false);
            }}
            title={tr("打开左侧面板","Open left panel")}
          >
            <PinLeftIcon />
          </button>
        )}
        <div
          ref={leftPanelRef}
          className={`panel panel-left${isNarrow ? ' overlay' : ''}`}
          style={{
            width: isNarrow ? 280 : panelLeft,
            ...(isNarrow && !leftOverlayOpen && { display: 'none' }),
            ...(!isNarrow && panelsHidden && { display: 'none' }),
          }}
        >
          {isNarrow && (
            <button
              className="overlay-close"
              onClick={() => setLeftOverlayOpen(false)}
              title={S.panel.closeOverlay}
              aria-label={S.panel.closeOverlay}
            >
              <Cross1Icon />
            </button>
          )}
<LeftPanelContent
module={navModule}
onOpenMatrix={() => setMatrixOpen(true)}
onOpenAnalysis={() => setAnalysisOpen(true)}
onNexusExport={() => setNexusExportOpen(true)}
/>
        </div>
        {!isNarrow && !panelsHidden && (
          <ResizeHandle side="left" width={panelLeft} panelRef={leftPanelRef} onCommit={setLeftWidth} />
        )}
        <div className="canvas-host" onContextMenu={handleContextMenu}>
          {reconActive ? (
            <ReconciliationView />
          ) : (
            <>
              <TreeCanvas />
              <CanvasControls />
            </>
          )}
        </div>
        {isNarrow && (
          <button
            className="panel-toggle-btn right"
            onClick={() => {
              setRightOverlayOpen(true);
              setLeftOverlayOpen(false);
            }}
            title={tr("打开右侧面板","Open right panel")}
          >
            <PinRightIcon />
          </button>
        )}
        {!isNarrow && !panelsHidden && (
          <ResizeHandle side="right" width={panelRight} panelRef={rightPanelRef} onCommit={setRightWidth} />
        )}
        <div
          ref={rightPanelRef}
          className={`panel panel-right${isNarrow ? ' overlay' : ''}`}
          style={{
            width: isNarrow ? 300 : panelRight,
            ...(isNarrow && !rightOverlayOpen && { display: 'none' }),
            ...(!isNarrow && panelsHidden && { display: 'none' }),
          }}
        >
          {isNarrow && (
            <button
              className="overlay-close"
              onClick={() => setRightOverlayOpen(false)}
              title={S.panel.closeOverlay}
              aria-label={S.panel.closeOverlay}
            >
              <Cross1Icon />
            </button>
          )}
          {/* Mount the inspector only while it can actually be seen: `display:
              none` still renders its subtree on every store change, so with the
              panels hidden the user would pay full price for an invisible panel.
              Trade-off, deliberately accepted: unmounting resets the panel's
              local UI state (which sections are expanded, the search text), so
              re-opening with ⌘. starts from the defaults. */}
          {!panelsHidden && !(isNarrow && !rightOverlayOpen) && <PropertiesPanel />}
        </div>
      </div>
      {/* Narrow screens: a persistent bottom tab bar replaces the hidden rail,
          so the navigation modules stay reachable without overlays. */}
      {isNarrow && (
        <BottomTabBar
          active={navModule}
          onSelect={(m) => {
            setNavModule(m);
            setLeftOverlayOpen(true);
          }}
        />
      )}
      <StatusBar />
      {menu && (
        <ContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onAddChildrenDialog={(id) => {
            setMenu(null);
            openAddForNode(id);
          }}
        />
      )}
      <AddChildrenDialog open={addOpen} targetId={addTarget} onCancel={() => setAddOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenMatrix={openMatrixFromPalette}
        onOpenAnalysis={openAnalysisFromPalette}
        onOpenTour={openTourFromPalette}
        onOpenShortcuts={openShortcutsFromPalette}
        onOpenAbout={openAboutFromPalette}
      />
<CharacterMatrixDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} />
<AnalysisDialog open={analysisOpen} onClose={() => setAnalysisOpen(false)} />
<NexusExportDialog
  open={nexusExportOpen}
  onClose={() => setNexusExportOpen(false)}
  onExport={(opts) => void file.actionExportNexus(opts)}
/>
      <BusyOverlay />
      <Toaster />
      <ConfirmDialog />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onOpenTour={() => {
          setShortcutsOpen(false);
          setTourOpen(true);
        }}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
{multiTreeProjects && (
  <ImportTreesDialog
    projects={multiTreeProjects}
    onClose={() => setMultiTreeProjects(null)}
    onImport={(indices) => {
      for (const i of indices) {
        useStore.getState().openInNewTab(multiTreeProjects[i]);
      }
      notify.success(S.notify.treeImported);
    }}
    onConsensus={(method, indices) => {
      const selectedProjects = indices.map((i) => multiTreeProjects[i]);
      // `buildConsensusTree` refuses inconsistent tip sets and reports the
      // incompatible clades it skips. Both go to the user: one generic
      // "无法构建共识树" would leave a failed consensus (or a silently star-shaped
      // result) completely unexplained.
      const issues: string[] = [];
      const consensus = buildConsensusTree(
        selectedProjects,
        method,
        tr('共识树', 'Consensus tree'),
        (collected) => issues.push(...collected),
      );
      if (consensus) {
        useStore.getState().openInNewTab(consensus);
        if (issues.length > 0) notify.info(S.notify.consensusPartial(issues.join('；')));
        else notify.success(S.notify.consensusBuilt);
      } else {
        notify.error(
          issues.length > 0
            ? S.notify.consensusIssues(issues.join('；'))
            : S.notify.consensusFail,
        );
      }
    }}
  />
)}
      <FirstRunTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
