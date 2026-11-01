// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The STANDARD workspace: navigation rail + left module panel + tree canvas +
// inspector, extracted verbatim from the old App shell so the standard view's
// DOM structure and behaviour stay byte-for-byte the same while the
// reconciliation view gets its own workspace (§5.1: one mode, one workspace).
// Owns the standard context menu + add-children dialog: neither may leak into
// the reconciliation canvas (review R-04).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Cross1Icon, PlusIcon, PinLeftIcon, PinRightIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import * as file from '../io/fileActions';
import { getLastAutosave, subscribeAutosave, type AutosaveState } from '../io/autosave';
import { shouldReselectOnRightClick } from './selectionGuard';
import { MAX_COLLISION_PLAN_NODES } from '../canvas/eventBadgeLayout';
import { LayoutPanel } from './LayoutPanel';
import { LayerPanel } from './LayerPanel';
import { CharacterPanel } from './CharacterPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { TimePanel } from './TimePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { CanvasControls } from './CanvasControls';
import { hitTargetFor } from '../canvas/hitTarget';
import { MIN_SCALE as MIN_VIEW_SCALE } from '../canvas/coords';
import { TreeCanvas } from '../canvas/TreeCanvas';
import { ContextMenu, type ContextTarget } from './ContextMenu';
import { WINDOW_BREAKPOINTS } from '../canvas/ReconWorkspace';
import { S, tr } from './strings';
import { NavigationRail, type NavModule } from './NavigationRail';

// --- side-panel resizing -----------------------------------------------------
const LS_LEFT_WIDTH = 'cladeforge:leftWidth';
const LS_RIGHT_WIDTH = 'cladeforge:rightWidth';
// Default panel widths are kept narrow so a small laptop keeps canvas space; the
// splitters let the user widen either panel up to MAX_PANEL_WIDTH.
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 620;
// Aligned with the window minWidth (900 in tauri.conf.json) via the SHARED
// breakpoint constants: the threshold used to sit ABOVE the minimum, so
// dragging the window to its allowed smallest size ALWAYS flipped the layout
// into the narrow form (review PM-14). The recon workspace reads the same
// ladder, so the two modes can no longer disagree at any window width.
const NARROW_THRESHOLD = WINDOW_BREAKPOINTS.narrow;
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
          data-nav={it.id}
        >
          {it.label}
        </button>
      ))}
    </nav>
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

  // Any document / tab change means a write is due (the debounced effect in
  // App performs it ~800 ms later).
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

  // Dirty flag + capacity/LOD disclosures: the status bar is where a user looks
  // to answer "is my work saved?" and "why does this big tree look different".
  const dirty = useStore((s) => s.revision !== s.lastSavedRevision);
  const collisionDegraded = nodeCount > MAX_COLLISION_PLAN_NODES;
  const capacityWarned = nodeCount > 5000;
  return (
    // The selection count is announced to assistive tech (the canvas tree has
    // no aria-live region of its own).
    <div className="status" aria-live="polite">
      {dirty && (
        <span
          className="status-dirty"
          role="status"
          title={S.review.unsavedDot}
          style={{ color: 'var(--accent, #2563eb)' }}
        >
          ● {S.review.unsavedDot}
        </span>
      )}
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
      {collisionDegraded && (
        <span className="status-failed" title={S.review.collisionDegradedNotice(MAX_COLLISION_PLAN_NODES)}>
          {S.review.collisionDegradedNotice(MAX_COLLISION_PLAN_NODES)}
        </span>
      )}
      {capacityWarned && !collisionDegraded && (
        <span title={S.review.capacityNotice(nodeCount)}>
          {S.review.capacityNotice(nodeCount)}
        </span>
      )}
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
  onBuildGeneTree,
  onCopySpeciesTree,
  onEditGeneTree,
}: {
  module: NavModule;
  onOpenMatrix: () => void;
  onOpenAnalysis: () => void;
  onNexusExport: () => void;
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
  onEditGeneTree: (id: string) => void;
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
      // PM-13: the standard rail's 协同重建 entry now ENTERS the reconciliation
      // workspace — one mode, one layout. The legacy stacked ReconPanel was a
      // second, diverging face of the same feature and is retired from this
      // surface (the workspace's own rail renders the four-section panel).
      if (!reconEnterRequested.current) {
        reconEnterRequested.current = true;
        useStore.getState().enterReconWorkspace();
      }
      return null;
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
      return <AnalysisPanel onOpenAnalysis={onOpenAnalysis} />;
    case 'export':
      return <ExportPanel onNexusExport={onNexusExport} />;
  }
}

/** Export module panel for the navigation rail, grouped by format family. */
function ExportPanel({ onNexusExport }: { onNexusExport: () => void }) {
  // One equal-width column: format labels differ wildly in length, and a row of
  // ragged buttons read as an accident rather than a menu.
  const row = (label: string, fn: () => void) => (
    <button className="btn export-btn" onClick={fn} key={label}>
      {label}
    </button>
  );
  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.export}</span>
      </div>
      <div className="panel-section export-panel-section">
        <h3>{S.exportGroup.vector}</h3>
        <div className="export-actions">
          {row(S.exportItems.svg, () => void file.actionExportSVG())}
          {row(S.exportItems.pdf, () => void file.actionExportPDF())}
        </div>
        <h3>{S.exportGroup.raster}</h3>
        <div className="export-actions">
          {row(S.exportItems.png, () => void file.actionExportPNG())}
        </div>
        <h3>{S.exportGroup.data}</h3>
        <div className="export-actions">
          {row(S.exportItems.newick, () => void file.actionExportNewick())}
          {row(S.exportItems.nexus, onNexusExport)}
          {row(S.exportItems.hypothesisJSON, () => void file.actionExportHypothesisJSON())}
          {row(S.exportItems.rScript, () => void file.actionExportRScript())}
          {row(S.exportItems.reconReport, () => void file.actionExportReconciliationReport())}
        </div>
        <h3>{S.exportGroup.report}</h3>
        <div className="export-actions">
          {row(S.exportItems.narrative, () => void file.actionExportNarrative())}
        </div>
      </div>
    </>
  );
}

export function StandardWorkspace({
  panelsHidden,
  onOpenMatrix,
  onOpenAnalysis,
  onNexusExport,
  onBuildGeneTree,
  onCopySpeciesTree,
  onEditGeneTree,
  onAddChildrenDialog,
}: {
  panelsHidden: boolean;
  onOpenMatrix: () => void;
  onOpenAnalysis: () => void;
  onNexusExport: () => void;
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
  onEditGeneTree: (id: string) => void;
  /** Opens the shared add-children dialog (owned by App, toolbar shares it). */
  onAddChildrenDialog: (parentId: string) => void;
}) {
  const [menu, setMenu] = useState<ContextTarget | null>(null);

  // Slightly wider defaults + the denser section rhythm (app.css) fit the
  // common controls without wrapping or a scroll trip; both remain resizable.
  const [leftWidth, setLeftWidth] = useState(() => readPanelWidth(LS_LEFT_WIDTH, 260));
  const [rightWidth, setRightWidth] = useState(() => readPanelWidth(LS_RIGHT_WIDTH, 292));
  // Clamp on EVERY render, not only when the handle is released: `clampPanel`
  // bounds the ceiling by the current window width, so a width committed while
  // the window was wide would otherwise stay oversized after a shrink and keep
  // squeezing the canvas out.
  const panelLeft = clampPanel(leftWidth);
  const panelRight = clampPanel(rightWidth);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const [navModule, setNavModule] = useState<NavModule>(() => readNavModule());

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false);
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const isNarrow = windowWidth < NARROW_THRESHOLD;

  /**
   * Workflow tour navigation: each step presents one left-panel module, so the
   * spotlight has to follow the module switch. On narrow screens the left panel
   * is an overlay (display:none until opened), so the tour opens it too —
   * otherwise the step would spotlight nothing at all.
   */
  const navigateForTour = useCallback((module: NavModule) => {
    setNavModule(module);
    if (window.innerWidth < NARROW_THRESHOLD) {
      setLeftOverlayOpen(true);
      setRightOverlayOpen(false);
    }
  }, []);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  // One-shot guard for the PM-13 recon handoff: entering the workspace swaps
  // the whole tree, so the flag resets with this component.
  const reconEnterRequested = useRef(false);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Keyboard-open the context menu (Shift+F10 / the ContextMenu key): the menu
  // carries the ONLY entry points for insert-parent / reroot / ladderize, so
  // without this the keyboard user was excluded from core editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F10' || !e.shiftKey) return;
      if (e.key === 'F10' && !(e.shiftKey || e.key === 'ContextMenu')) return;
      const st = useStore.getState();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const id = st.selection[0] ?? null;
      if (!id || !st.project.nodes[id]) return;
      e.preventDefault();
      // Anchor at the node's on-screen position when available, else centre.
      const host = canvasHostRef.current;
      const cx = host ? host.clientWidth / 2 : 200;
      const cy = host ? host.clientHeight / 2 : 200;
      setMenu({ x: cx, y: cy, nodeId: id, edgeId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The tour (opened from App) navigates modules through a custom event so the
  // spotlight follows without App owning the module state.
  useEffect(() => {
    const onTourNav = (e: Event) => {
      const m = (e as CustomEvent<NavModule>).detail;
      if (m) navigateForTour(m);
    };
    window.addEventListener('cladeforge:tour-navigate', onTourNav);
    return () => window.removeEventListener('cladeforge:tour-navigate', onTourNav);
  }, [navigateForTour]);

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
    <>
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
            onOpenMatrix={onOpenMatrix}
            onOpenAnalysis={onOpenAnalysis}
            onNexusExport={onNexusExport}
            onBuildGeneTree={onBuildGeneTree}
            onCopySpeciesTree={onCopySpeciesTree}
            onEditGeneTree={onEditGeneTree}
          />
        </div>
        {!isNarrow && !panelsHidden && (
          <ResizeHandle side="left" width={panelLeft} panelRef={leftPanelRef} onCommit={setLeftWidth} />
        )}
        <div className="canvas-host" ref={canvasHostRef} onContextMenu={handleContextMenu}>
          <TreeCanvas />
          <CanvasControls />
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
            onAddChildrenDialog(id);
          }}
        />
      )}
    </>
  );
}
