// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation WORKSPACE: the recon rail + recon panel on the left, the
// recon inspector on the right, and the canvas column (toolbar / panes /
// status bar) between them. It replaces the standard shell entirely while
// `reconMode` is on — one mode, one workspace (§5.1) — so no standard module
// rail, no PropertiesPanel and no standard context menu can appear here.
//
// Panel widths / visibility use their OWN localStorage keys (§5.7), never the
// standard workspace's, and the responsive tiers follow §5.7:
//   ≥1440  left 260 + right 300 inline
//   ≥1200  left inline, right = drawer (overlay)
//   ≥1024  both drawers
//    <1024 both drawers (full overlay)

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cross1Icon, PinLeftIcon, PinRightIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { S, tr } from '../ui/strings';
import { ReconRail } from '../ui/ReconRail';
import { ReconPanel } from '../ui/ReconPanel';
import { ReconInspector } from '../ui/ReconInspector';
import { ReconToolbar } from '../ui/ReconToolbar';
import { ReconStatusBar } from '../ui/ReconStatusBar';
import { ReconciliationView } from './ReconciliationView';

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
function ReconResizeHandle({
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
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = panelRef.current;
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    let raf = 0;
    let pending = false;
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
      last = clampReconPanel(side === 'left' ? startW + dx : startW - dx);
      if (!pending) {
        pending = true;
        raf = requestAnimationFrame(applyWidth);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
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

export function ReconWorkspace({
  panelsHidden,
  onBuildGeneTree,
  onCopySpeciesTree,
  onEditGeneTree,
}: {
  panelsHidden: boolean;
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
  onEditGeneTree: (id: string) => void;
}) {
  const [leftWidth, setLeftWidth] = useState(() => readReconWidth(LS_RECON_LEFT_WIDTH, 260));
  const [rightWidth, setRightWidth] = useState(() => readReconWidth(LS_RECON_RIGHT_WIDTH, 300));
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const reconSection = useStore((s) => s.reconSection);
  const geneSelection = useStore((s) => s.geneSelection);
  const speciesSelection = useStore((s) => s.selection);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geneSelection.length, speciesSelection.length]);

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
  // Right panel: inline on wide screens, overlay drawer below.
  // §5.7 tiers — drawers start CLOSED: at 1280 the two panes need the room far
  // more than a permanently mounted inspector does.
  const rightInline = wide && !panelsHidden;
  const leftInline = !fullNarrow && !panelsHidden;

  const openGenePanel = useCallback(() => {
    setLeftDrawerOpen(true);
    setRightDrawerOpen(false);
  }, []);

  return (
    <div className="body recon-workspace">
      {/* Rail: always visible inline; on the narrowest tier it collapses and a
          toggle button opens the panel as a full overlay (§5.7). */}
      {!fullNarrow && !panelsHidden && <ReconRail />}
      {fullNarrow && (
        <button
          className="panel-toggle-btn left"
          onClick={openGenePanel}
          title={tr('打开协同面板', 'Open reconciliation panel')}
        >
          <PinLeftIcon />
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
        <ReconPanel
          section={reconSection}
          onBuildGeneTree={onBuildGeneTree}
          onCopySpeciesTree={onCopySpeciesTree}
          onEditGeneTree={onEditGeneTree}
        />
      </div>
      {!fullNarrow && !panelsHidden && (
        <ReconResizeHandle side="left" width={leftWidth} panelRef={leftPanelRef} onCommit={setLeftWidth} />
      )}

      <div className="recon-main">
        <ReconToolbar onToggleRightPanel={mid ? () => { setRightDrawerOpen((o) => !o); setLeftDrawerOpen(false); } : undefined} />
        <ReconWorkspacePanel
          onBuildGeneTree={onBuildGeneTree}
          onCopySpeciesTree={onCopySpeciesTree}
        />
      </div>

      {rightInline && (
        <ReconResizeHandle side="right" width={rightWidth} panelRef={rightPanelRef} onCommit={setRightWidth} />
      )}
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
        <ReconInspector onBuildGeneTree={onBuildGeneTree} />
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
  onBuildGeneTree,
  onCopySpeciesTree,
}: {
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
}) {
  const [zoom, setZoom] = useState({ species: 1, gene: 1 });
  const onZoomChange = useCallback((species: number, gene: number) => {
    setZoom((z) => (z.species === species && z.gene === gene ? z : { species, gene }));
  }, []);

  return (
    <div className="recon-canvas-frame">
      <ReconciliationView
        onBuildGeneTree={onBuildGeneTree}
        onCopySpeciesTree={onCopySpeciesTree}
        onZoomChange={onZoomChange}
      />
      <ReconStatusBar speciesZoom={zoom.species} geneZoom={zoom.gene} />
    </div>
  );
}
