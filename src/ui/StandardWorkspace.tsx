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
} from 'react';
import { Cross1Icon, ChevronLeftIcon, ChevronRightIcon, HamburgerMenuIcon, ViewVerticalIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import * as file from '../io/fileActions';
import { getLastAutosave, subscribeAutosave, type AutosaveState } from '../io/autosave';
import { shouldReselectOnRightClick } from './selectionGuard';
import { MAX_COLLISION_PLAN_NODES } from '../canvas/eventBadgeLayout';
import { MAX_DOCUMENT_NODES, MAX_PARSED_NODES } from '../io/limits';
import { mrcaOf } from '../model/treeOps';
import { switchLayer } from '../model/layers';
import { computeLayout } from '../layout/autoLayout';
import { LayoutPanel } from './LayoutPanel';
import { TimePanel } from './TimePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { CanvasControls } from './CanvasControls';
import { hitTargetFor } from '../canvas/hitTarget';
import { MIN_SCALE as MIN_VIEW_SCALE } from '../canvas/coords';
import { TreeCanvas } from '../canvas/TreeCanvas';
import { ContextMenu, type ContextTarget } from './ContextMenu';
import { WINDOW_BREAKPOINTS } from '../canvas/ReconWorkspace';
import { S, tr } from './strings';
// OP-17: one shared splitter implementation for BOTH workspaces (see the
// component's own header for the performance contract).
import { ResizeHandle } from './ResizeHandle';
import { documentHasTree } from './documentContent';

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

// Narrow-screen bottom tab bar: the navigation modules stay
// reachable as a persistent bar instead of being dropped or hidden behind
// overlays. Tapping a module opens the left panel overlay on that module.
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
  // GUI-C OBS-1: "Nodes" counts EVERY node (tips + internal), which readers
  // routinely misinterpret as the tip count. State both.
  const tipCount = useStore(
    (s) => Object.values(s.project.nodes).filter((n) => n.childrenIds.length === 0).length,
  );
  const edgeCount = useStore((s) => s.project.customEdges.length);
  const scale = useStore((s) => s.view.scale);
  // A#10: a blank welcome document has no tree to zoom — the stale transform
  // (e.g. an earlier sample's 800%) read as a meaningless "Zoom 800%".
  const hasTree = useStore((s) => documentHasTree(s.project));
  const selection = useStore((s) => s.selection);
  const selectionCount = useStore((s) => s.selection.length);
  // M20: the active hypothesis layer is invisible outside the 假说 module —
  // undo after silently switching layers there gave no cue. One authoritative
  // chip lives here.
  const activeLayerName = useStore(
    (s) => s.project.layers.find((l) => l.id === s.project.activeLayerId)?.name ?? null,
  );
  // BUG-16: the active-layer chip was inert even though nothing else in the UI
  // could switch layers (LayerPanel is no longer mounted). Make it the switch:
  // click cycles to the next hypothesis layer, one undoable edit.
  const layers = useStore((s) => s.project.layers);
  const activeLayerId = useStore((s) => s.project.activeLayerId);
  const apply = useStore((s) => s.apply);
  // M22: an edge selection clears the node selection and was otherwise
  // invisible in the status bar.
  const selectedEdge = useStore((s) => s.selectedEdgeId);
  // ID-03: the MRCA / degradation notices used to be static text. The MRCA chip
  // now LOCATES its clade (the reason it exists), and the degradation chips open
  // the in-app manual where the behaviour is explained.
  const focusNode = useStore((s) => s.focusNode);
  const { status: saveStatus, detail: saveDetail } = useAutoSaveStatus();
  const minScaleReached = useStore((s) => s.view.scale <= MIN_VIEW_SCALE + 1e-9);

  // Dirty flag + capacity/LOD disclosures: the status bar is where a user looks
  // to answer "is my work saved?" and "why does this big tree look different".
  const collisionDegraded = nodeCount > MAX_COLLISION_PLAN_NODES;
  const capacityWarned = nodeCount > 5000;
  // OP-11: "已自动保存" on its own read as "saved to my project file". The
  // indicator now names the LOCAL RECOVERY AREA explicitly, and a second chip
  // states the DISK state — the two are different stores and must not be
  // conflated by one ambiguous word.
  const activeDirty = useStore((s) => s.revision !== s.lastSavedRevision);
  const diskSavedAt = useStore((s) => s.project.savedAt);
  const hasDiskPath = useStore((s) => Boolean(s.project.sourcePath));
  // BUG-09: "On-disk version" is only honest when the app can re-read that
  // path. A browser download has no sourcePath — it gets its own chip instead
  // of a claim that contradicts 「回退到磁盘版本」's refusal.
  const diskText = activeDirty
    ? S.review.diskUnsaved
    : diskSavedAt && hasDiskPath
      ? // m12 (UI_UX_REVIEW): the UI locale — not a hardcoded zh-CN — formats the
        // disk timestamp (English users read "11/15/2026, 14:03").
        S.review.diskSavedAt(new Date(diskSavedAt).toLocaleString(undefined, { hour12: false }))
      : diskSavedAt
        ? S.review.diskDownloaded
        : S.review.diskUnsaved;
  const diskTooltip = activeDirty
    ? tr('当前文档有尚未写入项目文件的更改', 'This document has changes not yet written to its project file')
    : diskSavedAt && hasDiskPath
      ? S.status.savedTitle
      : diskSavedAt
        ? S.review.diskDownloadedTitle
        : tr(
            '尚未写入过项目文件：当前内容只在本地恢复区（自动保存），重启后仍可恢复；执行「保存项目」写入磁盘。',
            'No project file yet: the content lives in the local recovery area (autosave) and survives a restart; “Save project” writes it to disk.',
          );
  return (
    // The selection count is announced to assistive tech (the canvas tree has
    // no aria-live region of its own).
    <div className="status" aria-live="polite">
      {/* G-P12: a blank document still owns the invisible root node, so the
          count read "Nodes 1" over an empty canvas. With no tree there is
          nothing to count — show 0 rather than the internal placeholder. */}
      <span>
        {S.status.nodes} {hasTree ? nodeCount : 0}
        {hasTree && ` (${S.status.tips} ${tipCount})`}
      </span>
      {/* 发现9: on narrow windows the status bar already carries 8 entries and
          wraps; the edge count (usually `nodes − 1`) is the most redundant one
          and hides below the narrow breakpoint via CSS (.status-edges). The
          title keeps its meaning one hover away on wide screens. */}
      <span className="status-edges" title={tr('自定义连线数', 'Custom link count')}>
        {S.status.edges} {edgeCount}
      </span>
      {/* "Fit" clamps at MIN_SCALE, so a very tall tree can stay partly
          off-screen; the zoom readout says explicitly when that limit is hit. */}
      <span title={minScaleReached && hasTree ? S.canvasControls.fitClampedTitle : undefined}>
        {S.status.zoom} {hasTree ? `${Math.round(scale * 100)}%` : '—'}
        {hasTree && minScaleReached
          ? tr(`（${S.canvasControls.fitClamped}）`, ` (${S.canvasControls.fitClamped})`)
          : ''}
      </span>
      {selectionCount > 0 && (
        <span>
          {S.status.selected} {selectionCount}
        </span>
      )}
      {/* M22: an edge selection clears the node selection — without this chip
          the status bar looked like "nothing selected" while an edge was. */}
      {selectedEdge && (
        <span title={tr('选中的自定义连线', 'Selected custom link')}>
          {tr('连线已选', 'Edge selected')}
        </span>
      )}
      {/* M20: the active hypothesis layer is one authoritative chip — outside
          the 假说 module nothing else showed which layer undo would edit. */}
      {activeLayerName && (
        <button
          className="status-layer"
          onClick={() => {
            if (layers.length < 2) return;
            const idx = layers.findIndex((l) => l.id === activeLayerId);
            const next = layers[(idx + 1 + layers.length) % layers.length];
            if (next) apply((d) => void switchLayer(d, next.id));
          }}
          title={tr(
            '当前假说层：点击切换到下一层',
            'Active hypothesis layer: click to switch to the next layer',
          )}
        >
          {/* A#10: the other status chips use a half-width colon; this one was
              the odd full-width 「：」out. */}
          {tr('层', 'Layer')}: {activeLayerName}
        </button>
      )}
      {/* MRCA is highlighted whenever exactly two nodes are selected — surface
          this otherwise invisible capability explicitly, and make the hint do
          something: click to centre that ancestor (ID-03). */}
      {selectionCount === 2 && (
        <button
          className="status-mrca"
          onClick={() => {
            const [a, b] = selection;
            if (!a || !b) return;
            const m = mrcaOf(useStore.getState().project, a, b);
            if (m) focusNode(m);
          }}
          title={tr('点击定位最近共同祖先', 'Click to centre the most recent common ancestor')}
        >
          {S.status.mrcaHint}
        </button>
      )}
      {collisionDegraded && (
        <button
          className="status-failed"
          title={S.review.collisionDegradedNotice(MAX_COLLISION_PLAN_NODES)}
          onClick={() => file.openAppDialog('manual')}
        >
          {S.review.collisionDegradedNotice(MAX_COLLISION_PLAN_NODES)}
        </button>
      )}
      {capacityWarned && !collisionDegraded && (
        <button
          className="status-capacity"
          title={tr(
            `当前文档 ${nodeCount} 个节点。解析层上限：单树 ${MAX_PARSED_NODES.toLocaleString()} 节点、单文档合计 ${MAX_DOCUMENT_NODES.toLocaleString()} 节点；超过上限的文件会在打开时被拒绝并说明原因。点击查看手册。`,
            `This document has ${nodeCount} nodes. Parse-layer limits: ${MAX_PARSED_NODES.toLocaleString()} per tree and ${MAX_DOCUMENT_NODES.toLocaleString()} per document; larger files are refused at open with the reason stated. Open the manual.`,
          )}
          onClick={() => file.openAppDialog('manual')}
        >
          {S.review.capacityNotice(nodeCount)}
        </button>
      )}
      {/* Auto-save status: 'saved' only ever follows a write that returned ok,
          and it names the local recovery area rather than implying the project
          FILE is written. */}
      {saveStatus === 'saving' && (
        <span className="status-saving" title={S.status.savingTitle}>
          {S.review.autoSaveState(S.status.saving)}
        </span>
      )}
      {saveStatus === 'saved' && (
        <span className="status-saved" title={S.status.savedTitle}>
          {S.review.autoSaveState(S.status.saved)}
        </span>
      )}
      {saveStatus === 'failed' && (
        <span className="status-failed" role="alert" title={saveDetail ?? S.status.saveFailedTitle}>
          {S.status.saveFailed}
        </span>
      )}
      <span
        className={`status-disk${activeDirty ? ' status-disk-dirty' : ''}`}
        title={diskTooltip}
      >
        {diskText}
       </span>
      <span className="spacer" />
      {/* Gesture hints live in the ⌘? shortcuts dialog; the status bar stays
          data-only (counts / zoom / autosave). */}
    </div>
  );
}

/** Left panel content for the single merged 时间+样式 module (用户反馈:
 *  性状 / 假说 removed, 时间 and 样式 merged into one big panel, and 导出
 *  moved to the top menu bar). */
function LeftPanelContent() {
  return (
    <>
      <TimePanel />
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.style}</span>
      </div>
      <LayoutPanel />
    </>
  );
}

export function StandardWorkspace({
  panelsHidden,
  onShowPanels,
  onAddChildrenDialog,
}: {
  panelsHidden: boolean;
  /** A#2: restores BOTH panels from the double-hidden state reached via the
   *  header button / ⌘.; without this the edge toggle had no way to bring the
   *  left panel back (the per-panel hide buttons only cover their own side). */
  onShowPanels: () => void;
  /** Opens the shared add-children dialog (owned by App, toolbar shares it). */
  onAddChildrenDialog: (parentId: string) => void;
}) {
  const [menu, setMenu] = useState<ContextTarget | null>(null);

  // Slightly wider defaults + the denser section rhythm (app.css) fit the
  // common controls without wrapping or a scroll trip; both remain resizable.
  const [leftWidth, setLeftWidth] = useState(() => readPanelWidth(LS_LEFT_WIDTH, 280));
  const [rightWidth, setRightWidth] = useState(() => readPanelWidth(LS_RIGHT_WIDTH, 292));
  // Clamp on EVERY render, not only when the handle is released: `clampPanel`
  // bounds the ceiling by the current window width, so a width committed while
  // the window was wide would otherwise stay oversized after a shrink and keep
  // squeezing the canvas out.
  const panelLeft = clampPanel(leftWidth);
  const panelRight = clampPanel(rightWidth);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const project = useStore((s) => s.project);
  const canvasIsEmpty = !documentHasTree(project);
  // A blank document (a fresh tab before any sample / file / added node) owns
  // the whole canvas: both side panels are hidden until the document actually
  // has a tree. The empty state is then the front page, not a card squeezed
  // between two panels full of controls for a tree that does not exist.
  const showPanels = !canvasIsEmpty;

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false);
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  // 用户反馈: each side panel has its OWN show/hide control (independent of
  // the ⌘. global toggle).
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const isNarrow = windowWidth < NARROW_THRESHOLD;
  // V16/M43 (UI_UX_REVIEW): 1024 px is the common laptop-window width, and the
  // fixed rails + two panels used to leave the canvas ~350px with every label
  // clipped. Between the narrow overlay mode and a roomy desktop, the RIGHT
  // panel folds automatically (its toggle button appears in its place); the
  // user can re-open it, and a resize back restores it.
  const [midFold, setMidFold] = useState(false);
  const [userReopenedRight, setUserReopenedRight] = useState(false);
  useEffect(() => {
    const fold = windowWidth >= NARROW_THRESHOLD && windowWidth < 1200;
    setMidFold(fold);
    if (!fold) setUserReopenedRight(false);
  }, [windowWidth]);

  /**
   * 用户反馈: the left rail is gone — there is ONE plain left panel. The
   * tour-navigate event now only makes sure the left panel is actually visible
   * when a tour step spotlights it (on narrow screens it is an overlay that
   * starts closed, so the step would spotlight nothing at all).
   */
  const navigateForTour = useCallback((_module: 'edit') => {
    if (window.innerWidth < NARROW_THRESHOLD) {
      setLeftOverlayOpen(true);
      setRightOverlayOpen(false);
    }
  }, []);

  const canvasHostRef = useRef<HTMLDivElement>(null);
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
      // Shift+F10, or the dedicated ContextMenu key, opens the node menu.
      const isContextMenuKey = e.key === 'ContextMenu';
      if (!isContextMenuKey && (e.key !== 'F10' || !e.shiftKey)) return;
      const st = useStore.getState();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const id = st.selection[0] ?? null;
      if (!id || !st.project.nodes[id]) return;
      e.preventDefault();
      // M14 (UI_UX_REVIEW): the comment promised the node's on-screen position
      // but the code always took the canvas centre. Compute the node's screen
      // position from the live view transform so keyboard users keep the
      // spatial node↔menu association; fall back to centre only when the node
      // is culled off-screen.
      const host = canvasHostRef.current;
      const cx = host ? host.clientWidth / 2 : 200;
      const cy = host ? host.clientHeight / 2 : 200;
      const layout = computeLayout(useStore.getState().project, {
        showEras: useStore.getState().showEras,
        eraLevel: useStore.getState().eraLevel,
      });
      const pos = layout.positions.get(id);
      const view = useStore.getState().view;
      let x = cx;
      let y = cy;
      if (pos && host) {
        const sx = pos.x * view.scale + view.tx;
        const sy = pos.y * view.scale + view.ty;
        if (sx >= 0 && sx <= host.clientWidth && sy >= 0 && sy <= host.clientHeight) {
          x = sx;
          y = sy;
        }
      }
      setMenu({ x, y, nodeId: id, edgeId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The tour (opened from App) navigates modules through a custom event so the
  // spotlight follows without App owning any module state — there is only the
  // one merged panel, so the event just ensures it is visible.
  useEffect(() => {
    const onTourNav = (e: Event) => {
      const m = (e as CustomEvent<'edit'>).detail;
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

  return (
    <>
      <div className="body">
        {/* 用户反馈: no module rail — the left panel is ONE plain panel (时间 +
            样式 merged), always visible while a document has a tree. */}

        {/* Left-panel toggle: on narrow screens it opens the overlay; on desktop
            it re-shows the panel after its own hide button collapsed it. */}
        {/* A#2: `panelsHidden` (the header button / ⌘.) hides BOTH panels, so
            this edge entry must exist in that state too — otherwise the left
            panel has no on-screen way back at all. */}
        {(isNarrow || leftHidden || panelsHidden) && showPanels && (
          <button
            className="panel-toggle-btn left"
            onClick={() => {
              if (isNarrow) {
                setLeftOverlayOpen(true);
                setRightOverlayOpen(false);
              } else if (panelsHidden) {
                onShowPanels();
              } else {
                setLeftHidden(false);
              }
            }}
            title={tr("打开左侧面板","Open left panel")}
          >
            <HamburgerMenuIcon />
          </button>
        )}
        <div
          ref={leftPanelRef}
          className={`panel panel-left${isNarrow ? ' overlay' : ''}`}
          style={{
            width: isNarrow ? 280 : panelLeft,
            ...(isNarrow && !leftOverlayOpen && { display: 'none' }),
            ...(!isNarrow && panelsHidden && { display: 'none' }),
            ...(!isNarrow && leftHidden && { display: 'none' }),
            ...(!showPanels && { display: 'none' }),
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
          {/* 用户反馈: the panel carries its own hide button (desktop). */}
          {!isNarrow && showPanels && (
            <button
              className="overlay-close"
              onClick={() => setLeftHidden(true)}
              title={tr('隐藏左侧面板', 'Hide left panel')}
              aria-label={tr('隐藏左侧面板', 'Hide left panel')}
            >
              <ChevronLeftIcon />
            </button>
          )}
          {showPanels && <LeftPanelContent />}
        </div>
        {!isNarrow && showPanels && !panelsHidden && !leftHidden && (
          <ResizeHandle side="left" width={panelLeft} panelRef={leftPanelRef} onCommit={setLeftWidth} />
        )}
        <div className="canvas-host" ref={canvasHostRef} onContextMenu={handleContextMenu}>
          <TreeCanvas />
          {/* Zoom/search aids do nothing on a blank document; the empty state
              owns the whole surface until the first tree exists. */}
          {!canvasIsEmpty && <CanvasControls />}
        </div>
        {/* V16: between the narrow overlay mode and a roomy desktop the right
            panel folds; its toggle re-opens it (inline, user decides). The same
            button re-shows the panel after its own hide button collapsed it. */}
        {(isNarrow || rightHidden || (midFold && !userReopenedRight) || panelsHidden) && showPanels && (
          <button
            className="panel-toggle-btn right"
            onClick={() => {
              if (isNarrow) {
                setRightOverlayOpen(true);
                setLeftOverlayOpen(false);
              } else if (panelsHidden) {
                onShowPanels();
              } else if (rightHidden) {
                setRightHidden(false);
              } else {
                setUserReopenedRight(true);
              }
            }}
            title={tr("打开右侧面板","Open right panel")}
          >
            <ViewVerticalIcon />
          </button>
        )}
        {!isNarrow && showPanels && !panelsHidden && !rightHidden && !(midFold && !userReopenedRight) && (
          <ResizeHandle side="right" width={panelRight} panelRef={rightPanelRef} onCommit={setRightWidth} />
        )}
        <div
          ref={rightPanelRef}
          className={`panel panel-right${isNarrow ? ' overlay' : ''}`}
          style={{
            width: isNarrow ? 300 : panelRight,
            ...(isNarrow && !rightOverlayOpen && { display: 'none' }),
            ...(!isNarrow && panelsHidden && { display: 'none' }),
            ...(!isNarrow && rightHidden && { display: 'none' }),
            ...(!isNarrow && midFold && !userReopenedRight && { display: 'none' }),
            ...(!showPanels && { display: 'none' }),
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
          {/* 用户反馈: the panel carries its own hide button (desktop). */}
          {!isNarrow && showPanels && (
            <button
              className="overlay-close"
              onClick={() => setRightHidden(true)}
              title={tr('隐藏右侧面板', 'Hide right panel')}
              aria-label={tr('隐藏右侧面板', 'Hide right panel')}
            >
              <ChevronRightIcon />
            </button>
          )}
          {/* Mount the inspector only while it can actually be seen: `display:
              none` still renders its subtree on every store change, so with the
              panels hidden the user would pay full price for an invisible panel.
              Trade-off, deliberately accepted: unmounting resets the panel's
              local UI state (which sections are expanded, the search text), so
              re-opening with ⌘. starts from the defaults. */}
          {showPanels &&
            !panelsHidden &&
            !(isNarrow && !rightOverlayOpen) &&
            !(!isNarrow && rightHidden) &&
            !(midFold && !userReopenedRight) && <PropertiesPanel />}
        </div>
      </div>
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
