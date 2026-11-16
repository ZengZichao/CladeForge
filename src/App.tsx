// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Application shell: assembles the tab bar, menu bar + toolbar and the ACTIVE
// WORKSPACE, and owns global transient UI (dialogs, command palette, tour,
// toasts) plus global keyboard shortcuts.
//
// One mode, one workspace (2026-10-31 reconciliation review §5.1/§6.2): the
// standard workspace and the reconciliation workspace are separate component
// trees. The switch reads ONLY `reconMode`; an active gene tree decides what
// the reconciliation workspace shows (content vs empty state), never whether
// the workspace exists — so "no gene tree" can no longer produce the old
// half-standard, half-reconciled chimera.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, persistedProject } from './model/store';
import type { Project } from './model/types';
import { confirmCloseTab } from './ui/tabs';
import * as file from './io/fileActions';
import { registerMultiTreeHandler, registerExportSettingsHandler, registerCompareHandler, registerAppDialogHandler } from './io/fileActions';
import { getAppInfo, isTauri } from './io/native';
import { initDesktopShell, requestWindowClose } from './io/desktopShell';
import { readAutoSave, readWorkspace, writeWorkspace } from './io/projectIO';
import { isImeComposing } from './ui/imeGuard';
import { modalIsOpen } from './ui/useDialogFocus';
import { MenuBar } from './ui/MenuBar';
import { Toolbar, HeaderActions } from './ui/Toolbar';
import { GeneTreeBuilderDialog } from './ui/GeneTreeBuilderDialog';
import { CharacterMatrixDialog } from './ui/CharacterMatrixDialog';
import { AnalysisDialog } from './ui/AnalysisDialog';
import { NexusExportDialog } from './ui/NexusExportDialog';
import { CommandPalette } from './ui/CommandPalette';
import { Toaster } from './ui/Toaster';
import { BusyOverlay } from './ui/BusyOverlay';
import { ConfirmDialog } from './ui/confirmDialog';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { FirstRunTour, type TourMode } from './ui/FirstRunTour';
import { NarrowScreenHint } from './ui/NarrowScreenHint';
import { ImportTreesDialog } from './ui/ImportTreesDialog';
import { ImportReportDialog } from './ui/ImportReportDialog';
import { notify } from './ui/toast';
import { S, skippedTabs } from './ui/strings';
import { useLanguage, onLanguageChange, currentLanguage } from './ui/i18n';
import { tr } from './ui/strings';
import { buildConsensusTree } from './model/consensus';
import { addBuiltGeneTree, createGeneDocFromSpecies } from './model/geneTreeBuild';
import { AboutDialog } from './ui/AboutDialog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ExportSettingsDialog } from './ui/ExportSettingsDialog';
import { ProjectInfoDialog } from './ui/ProjectInfoDialog';
import { HistoryPanel } from './ui/HistoryPanel';
import { FindReplaceDialog } from './ui/FindReplaceDialog';
import { TreeDistanceDialog } from './ui/TreeDistanceDialog';
import { SampleLibraryDialog } from './ui/SampleLibraryDialog';
import { ManualDialog } from './ui/ManualDialog';
import { OperationLogDialog } from './ui/OperationLogDialog';
import { StandardWorkspace } from './ui/StandardWorkspace';
import { ReconWorkspace } from './canvas/ReconWorkspace';
import { AddChildrenDialog } from './ui/AddChildrenDialog';
import { LayerCompareDialog } from './ui/LayerPanel';
import type { NavModule } from './ui/FirstRunTour';

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

// --- tab bar -----------------------------------------------------------------
function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeProject = useStore((s) => s.project);
  const tabStore = useStore((s) => s.tabStore);
  const switchTab = useStore((s) => s.switchTab);
  const newTab = useStore((s) => s.newTab);
  // Real dirty flag: revision vs last-saved revision. The undo-stack DEPTH was
  // the old test, which lied in both directions — an undo back to a clean
  // document still counted as "unsaved", and a history-limit truncation made a
  // dirty document look clean.
  const revision = useStore((s) => s.revision);
  const lastSavedRevision = useStore((s) => s.lastSavedRevision);
  const titleOf = (id: string) =>
    (id === activeTabId ? activeProject.name : tabStore[id]?.project.name) || S.tabs.untitled;
  const dirtyOf = (id: string): boolean => {
    if (id === activeTabId) {
      return revision !== lastSavedRevision;
    }
    const snap = tabStore[id];
    return snap ? snap.revision !== snap.lastSavedRevision : false;
  };
  // ID-02: a tab showed only its name, so with several documents open there was
  // no way to tell which tab mapped to which file on disk. The hover tooltip
  // now carries the path, the disk state and the on-disk timestamp.
  const tooltipOf = (id: string): string => {
    const p = id === activeTabId ? activeProject : tabStore[id]?.project;
    if (!p) return titleOf(id);
    const lines = [titleOf(id), p.sourcePath ?? tr('尚未保存到磁盘', 'Not saved to disk yet')];
    if (dirtyOf(id)) lines.push(S.review.unsavedDot);
    else if (p.savedAt) {
      const d = new Date(p.savedAt);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        // m12: hardcoded zh label → tr(); the date format is locale-stable ISO.
        lines.push(
          tr(
            `磁盘版本 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
            `On disk: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
          ),
        );
      }
    }
    return lines.join('\n');
  };

  // The × button and the ⌘W chord MUST share one close path — the guard lives
  // in ui/tabs.ts so both ask before dropping a dirty tab.
  const handleClose = (id: string) => {
    confirmCloseTab(id);
  };

  return (
    <div className="tabbar" data-tauri-drag-region role="tablist" aria-label={S.tabs.listLabel}>
      {tabs.map((id) => (
        <div
          key={id}
          role="tab"
          className={`tab${id === activeTabId ? ' active' : ''}`}
          title={tooltipOf(id)}
          aria-selected={id === activeTabId}
          /* S08 (Sonus): the tab strip had no keyboard contract — tabs were
             plain divs and close worked only on mousedown. Roving tabindex +
             Left/Right selection closes that gap. */
          tabIndex={id === activeTabId ? 0 : -1}
          onClick={() => switchTab(id)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            const i = tabs.indexOf(id);
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const dir = e.key === 'ArrowLeft' ? -1 : 1;
              const next = tabs[(i + dir + tabs.length) % tabs.length];
              if (next && next !== id) switchTab(next);
              // Move DOM focus to the newly active tab (roving tabindex).
              requestAnimationFrame(() => {
                const el = document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${next}"]`);
                el?.focus();
              });
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              const next = e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
              if (next && next !== id) switchTab(next);
              requestAnimationFrame(() => {
                const el = document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${next}"]`);
                el?.focus();
              });
            }
          }}
          data-tab-id={id}
        >
          {/* The title attribute also sits on the inner span: the tab bar is
              a window drag region in Tauri and some builds suppress the
              container tooltip, so a per-span title guarantees the full file
              name is shown on hover (truncated tab labels stay readable). */}
          <span className="tab-title" title={tooltipOf(id)}>
            {titleOf(id)}
          </span>
          {dirtyOf(id) && (
            <span
              aria-label={S.review.unsavedDot}
              title={S.review.unsavedDot}
              style={{
                width: 6,
                height: 6,
                borderRadius: 0,
                // S01 (Sonus): surface tokens are not ink — the unsaved dot
                // used to resolve to a near-white surface color and vanish.
                // Amber is the dirty-state ink, readable on both themes.
                background: 'var(--amber-9)',
                flex: 'none',
              }}
            />
          )}
          {tabs.length > 1 && (
            <button
              className="tab-close"
              title={S.tabs.close}
              aria-label={`${S.tabs.close} ${titleOf(id)}`}
              /* m10: activate on click like every other button in the app —
                 mousedown-only closed the tab even when the press was part of
                 a drag on the tab bar and ignored keyboard-generated clicks. */
              onClick={(e) => {
                e.stopPropagation();
                handleClose(id);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
            >
              <CrossClose />
            </button>
          )}
        </div>
      ))}
      <button className="tab-new" title={S.tabs.newTab} aria-label={S.tabs.newTab} onClick={() => newTab()}>
        <CrossPlus />
      </button>
    </div>
  );
}

export function App() {
  // Locale switch remounts the whole tree (key) so every string — including
  // those inside memoised subtrees — re-renders from the swapped catalogue.
  const lang = useLanguage();
  // The workspace switch reads `reconMode` (and nothing else): the toolbar's
  // active segment and the rendered workspace can never disagree.
  const reconMode = useStore((s) => s.reconMode);
  // Only macOS Tauri overlays the traffic lights on the webview; every other
  // platform must not reserve the 80 px title-bar gutter.
  const macosTitlebar = isTauri() && /Mac/i.test(navigator.userAgent);
  const [addOpen, setAddOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [nexusExportOpen, setNexusExportOpen] = useState(false);
  const [geneBuilderOpen, setGeneBuilderOpen] = useState(false);
  const [geneBuilderEditId, setGeneBuilderEditId] = useState<string | null>(null);

  const openGeneBuilder = (editId: string | null = null) => {
    setGeneBuilderEditId(editId);
    setGeneBuilderOpen(true);
  };

  /**
   * One-click "copy the species topology as a gene tree". This is the direct
   * construction path for users who do not have a gene tree file at hand; the
   * tip labels are identical, so every tip maps and the view opens populated.
   */
  const copySpeciesTreeToGene = () => {
    const st = useStore.getState();
    const tips = Object.values(st.project.nodes).filter((n) => n.childrenIds.length === 0).length;
    if (tips < 2) {
      notify.info(S.recon.needSpeciesTips);
      return;
    }
    let id: string | null = null;
    let mapped = 0;
    let total = 0;
    st.apply((d) => {
      const doc = createGeneDocFromSpecies(
        d,
        tr(`${d.name}：基因树`, `${d.name}: gene tree`),
      );
      const built = addBuiltGeneTree(d, doc);
      id = built.id;
      mapped = built.scenario.mappedTips;
      total = built.scenario.totalTips;
    });
    if (!id) return;
    st.setActiveGeneTree(id);
    st.enterReconWorkspace();
    notify.success(
      tr(
        `已从物种树创建基因树：${mapped}/${total} 个末端已自动映射`,
        `Gene tree created from the species tree: ${mapped}/${total} tips auto-mapped`,
      ),
    );
  };

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Which onboarding tour is open (null = none): 'basics' is the original
  // canvas/inspector walk-through, 'workflow' the Traits → … → Export script.
  const [tourMode, setTourMode] = useState<TourMode | null>(null);

  // The command palette memoises its ~35-command list on these callbacks. Passed
  // as inline arrows they would get a fresh identity on every App render — and
  // App re-renders on every pointer-move during a drag — so the whole list, JSX
  // icons included, would be rebuilt each frame. These setters are all stable,
  // so an empty dep list is correct here.
  const openMatrixFromPalette = useCallback(() => { setPaletteOpen(false); setMatrixOpen(true); }, []);
  const openAnalysisFromPalette = useCallback(() => { setPaletteOpen(false); setAnalysisOpen(true); }, []);
  const openTourFromPalette = useCallback(() => { setPaletteOpen(false); setTourMode('basics'); }, []);
  const openShortcutsFromPalette = useCallback(() => { setPaletteOpen(false); setShortcutsOpen(true); }, []);
  const openAboutFromPalette = useCallback(() => { setPaletteOpen(false); setAboutOpen(true); }, []);
  const [multiTreeProjects, setMultiTreeProjects] = useState<Project[] | null>(null);
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  // App-level dialogs opened from the FILE menu / command palette (2026-11-15).
  const [projectInfoOpen, setProjectInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [treeDistanceOpen, setTreeDistanceOpen] = useState(false);
  const [sampleLibraryOpen, setSampleLibraryOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  // S14/m14: the palette's layer-compare command opens the SAME dialog as the
  // hypothesis panel — one command, one definition.
  const [layerCompareOpen, setLayerCompareOpen] = useState(false);

  // ⌘. toggles both side panels in the active workspace — a quick collapse on
  // small windows. Shared state: whichever workspace is live reads it.
  const [panelsHidden, setPanelsHidden] = useState(false);

  const openAddForSelection = useCallback(() => {
    const s = useStore.getState();
    setAddTarget(s.selection[0] ?? s.project.rootId);
    setAddOpen(true);
  }, []);

  const openAddForNode = useCallback((parentId: string) => {
    setAddTarget(parentId);
    setAddOpen(true);
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
      // M11 (UI_UX_REVIEW) / S03 (Sonus): while ANY modal is open the shell
      // chords stand down — ⌘N/⌘W/⌘Z used to act on the hidden document behind
      // the export dialog, and ⌘K stacked a palette on top of a modal.
      if (modalIsOpen()) return;
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
        // ⌘S saves IN PLACE when the document has a remembered path;
        // ⌘⇧S is always "ask where".
        if (e.shiftKey) void file.actionSaveProjectAs();
        else void file.actionSaveProject();
      } else if (k === 'w') {
        // ⌘W closes the ACTIVE TAB (with the dirty confirm), not the window;
        // the system window-close used to bypass the unsaved-changes guard.
        // With a single tab the chord MEANS "close the window": desktop routes
        // through the same dirty-check guard. R9/M7: a BROWSER keeps ⌘W for
        // itself (it closes the browser tab, and preventDefault cannot stop
        // that), so the desktop-only window close is not even attempted on the
        // web — the multi-tab close still went through, matching what the chord
        // can actually do in each host.
        if (s.tabs.length > 1) {
          e.preventDefault();
          confirmCloseTab(s.activeTabId);
        } else if (isTauri()) {
          e.preventDefault();
          requestWindowClose();
        }
      } else if (k === '0') {
        e.preventDefault();
        // S11: route by ACTIVE workspace — recon mode must not zoom the
        // hidden standard canvas. The tree-edit surfaces (物种树编辑 /
        // 基因树编辑) render the standard canvas, so only the coordination
        // canvas answers the recon events.
        if (s.reconMode && s.reconEditTarget === 'recon') {
          window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'));
        } else {
          s.requestFit();
        }
      } else if (k === 'a' && !e.shiftKey && !e.altKey) {
        // ⌘A selects ALL tips (the palette's 选中全部末端, on the natural key):
        // the review's keyboard-main-path item, one chord.
        e.preventDefault();
        const tips = Object.values(s.project.nodes)
          .filter((n) => n.childrenIds.length === 0)
          .map((n) => n.id);
        s.selectMany(tips);
      } else if (k === '1' && !e.altKey && !e.shiftKey) {
        // ⌘1 focuses the single left module (时间 + 样式 merged panel) — the
        // rail is fully keyboard-reachable through this one chord.
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('cladeforge:tour-navigate', { detail: 'edit' }));
      } else if (k === 'o') {
        e.preventDefault();
        void file.actionOpenProject();
      } else if (k === 't' || k === 'n') {
        e.preventDefault();
        s.newTab();
      } else if (k === 'f') {
        e.preventDefault();
        if (e.shiftKey) {
          // ⌘⇧F fits the ACTIVE workspace: the standard canvas listens for
          // `requestFit`, the reconciliation canvas for its own event. The
          // tree-edit surfaces render the standard canvas.
          if (s.reconMode && s.reconEditTarget === 'recon') {
            window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'));
          } else {
            s.requestFit();
          }
        } else {
          // Read the LIVE store, not a render-scope value: this handler is
          // registered once with `[]` deps, so a closed-over boolean would be
          // frozen at its initial value and the branch could never be taken.
          if (s.reconMode && s.reconEditTarget === 'recon') {
            // The reconciliation canvas has no node-search field; the left
            // panel's assumption list is the locator here. Say so instead of
            // silently swallowing the chord. (Tree-edit surfaces render the
            // standard canvas, which opens its own search field below.)
            notify.info(S.recon.searchUnavailable);
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
      } else if (k === '?' || (k === '/' && (e.metaKey || e.ctrlKey))) {
        // ⌘? (and the more common ⌘/) opens the shortcut reference.
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (k === '.') {
        // ⌘. toggles the side panels (same path as the header button, S19).
        e.preventDefault();
        setPanelsHidden((h) => !h);
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        // S11: zoom keys route to the active workspace.
        if (s.reconMode && s.reconEditTarget === 'recon') {
          window.dispatchEvent(new CustomEvent('cladeforge:recon-zoom-in'));
        } else {
          s.zoomBy(1.2);
        }
      } else if (k === '-' || k === '_') {
        e.preventDefault();
        if (s.reconMode && s.reconEditTarget === 'recon') {
          window.dispatchEvent(new CustomEvent('cladeforge:recon-zoom-out'));
        } else {
          s.zoomBy(1 / 1.2);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // F2 renames the selected node: the canvas owns the rename editor, so the
  // chord is relayed. Without it, renaming was double-click only — undiscoverable
  // for every keyboard user.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' && e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (modalIsOpen()) return;
      const st = useStore.getState();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return; // let ⌘Enter pass
      if (st.selection.length !== 1) return;
      if (e.key === 'F2' || (e.key === 'Enter' && e.altKey)) {
        e.preventDefault();
        st.requestRename(st.selection[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A-10: the title used to be stamped once at startup, so every window in the
  // task switcher read "CladeForge 0.2.0" with no document name and no dirty
  // marker. Follow the ACTIVE tab like any desktop editor does.
  const appNameRef = useRef('CladeForge');
  useEffect(() => {
    void getAppInfo().then((info) => {
      if (info) appNameRef.current = info.name;
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
  // The title tracks the active document and the dirty marker (A-10).
  const activeTabDirty = useStore((s) => s.revision !== s.lastSavedRevision);
  useEffect(() => {
    document.title = `${activeTabDirty ? '● ' : ''}${project.name || S.tabs.untitled} — ${appNameRef.current}`;
  }, [project.name, activeTabDirty]);
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useStore.getState();
      const projects = s.tabs
        .map((id) =>
          id === s.activeTabId
            ? // While 「基因树编辑」 is swapped, persist the species project
              // with the edited gene doc merged back — never the bare gene doc.
              persistedProject(s)
            : s.tabStore[id]?.project,
        )
        .filter((p): p is Project => Boolean(p));
      writeWorkspace(projects, Math.max(0, s.tabs.indexOf(s.activeTabId)));
    }, 800);
    return () => clearTimeout(t);
  }, [project, tabs, activeTabId, tabStore]);

  // Multi-tree import chooser: fileActions delegates here.
  useEffect(() => {
    registerMultiTreeHandler((projects) => {
      setMultiTreeProjects(projects);
    });
    registerExportSettingsHandler(() => setExportSettingsOpen(true));
    registerCompareHandler(() => setTreeDistanceOpen(true));
    registerAppDialogHandler((id) => {
      if (id === 'projectInfo') setProjectInfoOpen(true);
      else if (id === 'findReplace') setFindReplaceOpen(true);
      else if (id === 'history') setHistoryOpen(true);
      else if (id === 'sampleLibrary') setSampleLibraryOpen(true);
      else if (id === 'manual') setManualOpen(true);
      else if (id === 'operationLog') setOperationLogOpen(true);
      // S14/m14: the command palette's layer-compare entry now opens the SAME
      // A/B dialog the hypothesis panel opens — no toast-only variant.
      else if (id === 'layerCompare') setLayerCompareOpen(true);
      else if (id === 'nexusExport') setNexusExportOpen(true);
    });
    return () => {
      registerMultiTreeHandler(null);
      registerExportSettingsHandler(null);
      registerCompareHandler(null);
      registerAppDialogHandler(null);
    };
  }, []);

  // Desktop shell (Tauri only, no-op in a browser): the unsaved-changes close
  // guard and the OS file association. Returns its unlisten cleanup.
  useEffect(() => initDesktopShell(), []);

  // S19: the header's panel-visibility button drives the same state as ⌘.
  // (The Toolbar is rendered outside the handler's closure scope, so the
  // button talks through a window event rather than a prop drilling chain.)
  useEffect(() => {
    const onToggle = () => setPanelsHidden((h) => !h);
    window.addEventListener('cladeforge:toggle-panels', onToggle);
    return () => window.removeEventListener('cladeforge:toggle-panels', onToggle);
  }, []);

  return (
    <div className={`app${macosTitlebar ? ' macos-titlebar' : ''}`} key={lang}>
      <TabBar />
      <div className="header-bar" data-tauri-drag-region>
        <MenuBar
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenTour={() => setTourMode('basics')}
          onOpenWorkflowTour={() => setTourMode('workflow')}
          onOpenAbout={() => setAboutOpen(true)}
        />
        <Toolbar onAddChildrenDialog={openAddForSelection} />
        <HeaderActions />
      </div>

      {reconMode ? (
        <ErrorBoundary scope={tr('协调工作区', 'Reconciliation workspace')}>
          <ReconWorkspace
            panelsHidden={panelsHidden}
            onBuildGeneTree={() => openGeneBuilder(null)}
            onCopySpeciesTree={copySpeciesTreeToGene}
            onEditGeneTree={(id) => openGeneBuilder(id)}
            onAddChildrenDialog={openAddForNode}
          />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary scope={tr('标准工作区', 'Standard workspace')}>
          <StandardWorkspace
            panelsHidden={panelsHidden}
            onAddChildrenDialog={openAddForNode}
          />
        </ErrorBoundary>
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
      <GeneTreeBuilderDialog
        open={geneBuilderOpen}
        editId={geneBuilderEditId}
        onClose={() => setGeneBuilderOpen(false)}
      />
      <AnalysisDialog open={analysisOpen} onClose={() => setAnalysisOpen(false)} />
      <NexusExportDialog
        open={nexusExportOpen}
        onClose={() => setNexusExportOpen(false)}
        onExport={(opts) => void file.actionExportNexus(opts)}
      />
      <ExportSettingsDialog
        open={exportSettingsOpen}
        onClose={() => setExportSettingsOpen(false)}
        onExport={(format) => {
          setExportSettingsOpen(false);
          // S04/m15 (Sonus+UI_UX_REVIEW): the user's follow-view choice IS the
          // export contract. Forcing followView:false here silently overrode
          // the checked "按当前屏幕导出" box and switched the left panel's mode
          // chip to "导出预设" — execute the chosen mode instead.
          void file.actionExportWithSettings(format);
        }}
      />
      <BusyOverlay />
      <Toaster />
      <ConfirmDialog />
      <ImportReportDialog />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onOpenTour={() => {
          setShortcutsOpen(false);
          setTourMode('basics');
        }}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ProjectInfoDialog open={projectInfoOpen} onClose={() => setProjectInfoOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <FindReplaceDialog open={findReplaceOpen} onClose={() => setFindReplaceOpen(false)} />
      <TreeDistanceDialog open={treeDistanceOpen} onClose={() => setTreeDistanceOpen(false)} />
      <SampleLibraryDialog open={sampleLibraryOpen} onClose={() => setSampleLibraryOpen(false)} />
      {/* S14: the command palette's layer-compare entry lands here, on the SAME
          A/B dialog the hypothesis panel uses. Initial picks follow the store's
          active layer vs the first other layer, resolved lazily at open time. */}
      {layerCompareOpen && (
        <LayerCompareDialog
          initialA={useStore.getState().project.activeLayerId}
          initialB={
            useStore.getState().project.layers.find((l) => l.id !== useStore.getState().project.activeLayerId)?.id ??
            useStore.getState().project.activeLayerId
          }
          onClose={() => setLayerCompareOpen(false)}
        />
      )}
      <ManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />
      <OperationLogDialog open={operationLogOpen} onClose={() => setOperationLogOpen(false)} />
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
              if (issues.length > 0) notify.info(S.notify.consensusPartial(issues.join(tr('；', '; '))));
              else notify.success(S.notify.consensusBuilt);
            } else {
              notify.error(
                issues.length > 0
                  ? S.notify.consensusIssues(issues.join(tr('；', '; ')))
                  : S.notify.consensusFail,
              );
            }
          }}
        />
      )}
      {/* Phone-width advisory (BUG-9): says once that this is a desktop editor
          and remembers "continue anyway" in localStorage. */}
      <NarrowScreenHint />
      <FirstRunTour
        open={tourMode !== null}
        mode={tourMode ?? 'basics'}
        onNavigate={(m: NavModule) => {
          // The module state lives in the standard workspace now; relay the
          // tour's jump so the spotlight follows the module switch.
          window.dispatchEvent(new CustomEvent('cladeforge:tour-navigate', { detail: m }));
        }}
        onOpenShortcuts={() => {
          setTourMode(null);
          setShortcutsOpen(true);
        }}
        onClose={() => setTourMode(null)}
      />
    </div>
  );
}

// Small local icon shims keep the icon imports in one place.
import { Cross1Icon, PlusIcon } from '@radix-ui/react-icons';
function CrossClose() {
  return <Cross1Icon />;
}
function CrossPlus() {
  return <PlusIcon />;
}
