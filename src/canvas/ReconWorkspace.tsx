// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation WORKSPACE.
//
// 用户反馈 (2026-11-16): the toolbar is a FULL-WIDTH row at the top of the
// workspace — the gene picker and the 物种树编辑 / 基因树编辑 / 协调树编辑
// switch keep the exact same left edge in every mode, and the side panels
// start BELOW it. Below the toolbar:
//   协调树编辑: ONE plain left panel (视图 + 节点映射), the coordination
//     canvas in the middle, the inspector on the right.
//   物种树编辑 / 基因树编辑: the STANDARD workspace (same panels and mouse
//     gestures as 标准视图) under the same toolbar. The gene tree reaches it
//     through a document swap (store.enterGeneDocEdit); the species tree is
//     already the project document.
//
// Panel widths / visibility use their OWN localStorage keys (§5.7), never the
// standard workspace's, and the responsive tiers follow §5.7:
//   ≥1440  left 260 + right 300 inline
//   ≥1200  left inline, right = drawer (overlay)
//   ≥1024  both drawers
//    <1024 both drawers (full overlay)

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cross1Icon, HamburgerMenuIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { S, tr } from '../ui/strings';
import { ReconPanel } from '../ui/ReconPanel';
import { ReconInspector } from '../ui/ReconInspector';
import { ReconToolbar } from '../ui/ReconToolbar';
import { ReconStatusBar } from '../ui/ReconStatusBar';
import { ReconciliationView } from './ReconciliationView';
import { StandardWorkspace } from '../ui/StandardWorkspace';
// OP-17: the drag interaction now lives in ONE place, shared with the standard
// workspace; only the remembered width bounds differ between the two.
import { ResizeHandle } from '../ui/ResizeHandle';

const LS_RECON_LEFT_WIDTH = 'cladeforge:reconLeftWidth';
const LS_RECON_RIGHT_WIDTH = 'cladeforge:reconRightWidth';

const RECON_MIN_PANEL = 200;
const RECON_MAX_PANEL = 620;
/** Shared breakpoints — the ONE place the window-width ladder is defined, so
 *  the two workspaces cannot drift apart again (review PM-14). The floor
 *  matches the window minWidth (900): no reachable window size is mis-binned.
 */
export const WINDOW_BREAKPOINTS = { narrow: 900, medium: 1200, wide: 1440 } as const;
/** ≥1440: both panels inline. 1200–1439: right panel is a (closed) drawer.
 *  1024–1199: both panels are drawers. <1024: drawers + collapsed rail. */
const WIDE = WINDOW_BREAKPOINTS.wide;
const MID = WINDOW_BREAKPOINTS.medium;
const FULL_NARROW = WINDOW_BREAKPOINTS.narrow;

function clampReconPanel(w: number): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const cap = Math.max(RECON_MIN_PANEL, Math.min(RECON_MAX_PANEL, Math.floor(vw / 3)));
  return Math.max(RECON_MIN_PANEL, Math.min(cap, w));
}

function readReconWidth(key: string, fallback: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? clampReconPanel(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Vertical splitter, shared implementation with the standard workspace. */
export function ReconWorkspace({
  panelsHidden,
  onCopySpeciesTree,
  onAddChildrenDialog,
}: {
  panelsHidden: boolean;
  /** Empty state: 新建协调视图 — seeds the reconciliation from the species tree. */
  onCopySpeciesTree: () => void;
  /** Opens the shared add-children dialog (owned by App) — the tree-edit
      surfaces reuse it exactly like the standard workspace does. */
  onAddChildrenDialog: (parentId: string) => void;
}) {
  const [leftWidth, setLeftWidth] = useState(() => readReconWidth(LS_RECON_LEFT_WIDTH, 260));
  const [rightWidth, setRightWidth] = useState(() => readReconWidth(LS_RECON_RIGHT_WIDTH, 300));
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const geneSelection = useStore((s) => s.geneSelection);
  const speciesSelection = useStore((s) => s.selection);
  const geneTreeCount = useStore((s) => s.project.geneTrees?.length ?? 0);
  // While 「基因树编辑」 is swapped, `project` IS the gene doc — the count that
  // matters for workspace chrome comes from the backed-up species project.
  const geneEditBackup = useStore((s) => s.geneEditBackup);
  const effectiveGeneTreeCount = geneEditBackup
    ? (geneEditBackup.project.geneTrees?.length ?? 0)
    : geneTreeCount;
  // 用户反馈: 物种树编辑 / 基因树编辑 render the STANDARD workspace — same
  // side panels, same mouse gestures as 标准视图. 协调树编辑 is the mapping
  // canvas below.
  const reconEditTarget = useStore((s) => s.reconEditTarget);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);

  // First selection in drawer mode opens the inspector drawer automatically
  // (§5.7) — the four-state inspector is the feedback for a node click, so a
  // closed drawer would make clicks feel dead on mid-size windows.
  useEffect(() => {
    if (windowWidth < WIDE && (geneSelection.length > 0 || speciesSelection.length > 0)) {
      setRightDrawerOpen(true);
    }
  }, [geneSelection.length, speciesSelection.length, windowWidth]);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_RECON_LEFT_WIDTH, String(leftWidth)); } catch { /* ignore */ }
  }, [leftWidth]);
  useEffect(() => {
    try { localStorage.setItem(LS_RECON_RIGHT_WIDTH, String(rightWidth)); } catch { /* ignore */ }
  }, [rightWidth]);

  const mid = windowWidth < MID;
  const wide = windowWidth >= WIDE;
  const fullNarrow = windowWidth < FULL_NARROW;
  // 用户反馈：with NO gene tree there is nothing for the left panel to list or
  // edit — the empty stage carries the creation entries itself, so the sidebar
  // stays out of the way until a gene tree exists. While 「基因树编辑」 is
  // swapped, the gene trees live on the backup, not on `project`.
  const reconEmpty = effectiveGeneTreeCount === 0;

  const openGenePanel = useCallback(() => {
    setLeftDrawerOpen(true);
    setRightDrawerOpen(false);
  }, []);

  // --- tree-edit surfaces (物种树编辑 / 基因树编辑) -----------------------------
  // The full standard workspace under the SAME full-width toolbar, so the
  // switch row keeps one fixed position across all three modes. Species needs
  // no swap (the project IS the species tree); the gene tree was swapped into
  // `project` by setReconEditTarget before this branch rendered.
  if (reconEditTarget !== 'recon' && !reconEmpty) {
    return (
      <div className="body recon-workspace recon-editing">
        <ReconToolbar />
        <div className="recon-edit-column">
          <StandardWorkspace
            panelsHidden={panelsHidden}
            onAddChildrenDialog={onAddChildrenDialog}
          />
        </div>
      </div>
    );
  }

  // Right panel: inline on wide screens, overlay drawer below.
  // §5.7 tiers — drawers start CLOSED: at 1280 the two panes need the room far
  // more than a permanently mounted inspector does.
  const rightInline = wide && !panelsHidden && !reconEmpty;
  const leftInline = !fullNarrow && !panelsHidden && !reconEmpty;

  return (
    <div className="body recon-workspace">
      {/* 用户反馈: the toolbar spans the FULL window width — the gene picker
          and the edit-target switch stay left-aligned exactly as in the
          tree-edit modes, and both side panels start below this row. */}
      <ReconToolbar onToggleRightPanel={mid && !reconEmpty ? () => { setRightDrawerOpen((o) => !o); setLeftDrawerOpen(false); } : undefined} />

      <div className="recon-workspace-row">
        {/* 用户反馈: ONE plain left panel stacks the two surviving sections
            (视图 / 节点映射). On the narrowest tier a toggle button opens the
            panel as a full overlay. */}
        {fullNarrow && (
          <button
            className="panel-toggle-btn left"
            onClick={openGenePanel}
            title={tr('打开协调面板', 'Open reconciliation panel')}
            aria-label={S.recon.railLabel}
          >
            <HamburgerMenuIcon />
          </button>
        )}

        <div
          ref={leftPanelRef}
          className={`panel panel-left recon-left${!leftInline ? ' overlay' : ''}`}
          style={{
            width: leftInline ? leftWidth : 280,
            ...(!leftInline && !leftDrawerOpen && { display: 'none' }),
          }}
        >
          {!leftInline && (
            <button
              className="overlay-close"
              onClick={() => setLeftDrawerOpen(false)}
              title={S.panel.closeOverlay}
              aria-label={S.panel.closeOverlay}
            >
              <Cross1Icon />
            </button>
          )}
          <ReconPanel />
        </div>
        {!fullNarrow && !panelsHidden && !reconEmpty && (
          <ResizeHandle side="left" width={leftWidth} panelRef={leftPanelRef} onCommit={setLeftWidth} minWidth={RECON_MIN_PANEL} maxWidth={RECON_MAX_PANEL} />
        )}

        <div className="recon-main">
          {/* M9 (review finding 8): the empty canvas carries the creation
              actions itself — it is the primary surface for a first-time user,
              and in narrow mode it is the only reachable one. */}
          <ReconWorkspacePanel
            onCopySpeciesTree={onCopySpeciesTree}
          />
        </div>

        {rightInline && (
          <ResizeHandle side="right" width={rightWidth} panelRef={rightPanelRef} onCommit={setRightWidth} minWidth={RECON_MIN_PANEL} maxWidth={RECON_MAX_PANEL} />
        )}
        {/* 用户反馈：no 场景概览 side panel on the EMPTY reconciliation front
            page — the stage itself carries every entry. */}
        {!reconEmpty && (
          <div
            ref={rightPanelRef}
            className={`panel panel-right recon-right${!rightInline ? ' overlay' : ''}`}
            style={{
              width: rightInline ? rightWidth : 300,
              ...(!rightInline && !rightDrawerOpen && { display: 'none' }),
            }}
          >
            {mid && (
              <button
                className="overlay-close"
                onClick={() => setRightDrawerOpen(false)}
                title={S.panel.closeOverlay}
                aria-label={S.panel.closeOverlay}
              >
                <Cross1Icon />
              </button>
            )}
            <ReconInspector />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The canvas + status bar, wired to the zoom readouts the status bar shows.
 * The transform state stays inside `ReconciliationView`; the panes' scales are
 * reported up through one callback (fired only when a scale actually changes),
 * so the workspace never re-renders during a pan.
 */
function ReconWorkspacePanel({
  onCopySpeciesTree,
}: {
  onCopySpeciesTree?: () => void;
}) {
  const [zoom, setZoom] = useState({ species: 1, gene: 1 });
  const [embeddedZoom, setEmbeddedZoom] = useState(1);
  const layoutMode = useStore((s) => s.reconViewOptions.layoutMode);
  const onZoomChange = useCallback((species: number, gene: number) => {
    setZoom((z) => (z.species === species && z.gene === gene ? z : { species, gene }));
  }, []);
  const onEmbeddedZoomChange = useCallback((zoomValue: number) => {
    setEmbeddedZoom((z) => (z === zoomValue ? z : zoomValue));
  }, []);

  return (
    <div className="recon-canvas-frame">
      <ReconciliationView
        onZoomChange={onZoomChange}
        onEmbeddedZoomChange={onEmbeddedZoomChange}
        onCopySpeciesTree={onCopySpeciesTree}
      />
      <ReconStatusBar
        speciesZoom={zoom.species}
        geneZoom={zoom.gene}
        mode={layoutMode}
        embeddedZoom={embeddedZoom}
      />
    </div>
  );
}
