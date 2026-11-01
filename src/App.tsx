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

import { useCallback, useEffect, useState } from 'react';
import { useStore } from './model/store';
import type { Project } from './model/types';
import { requestConfirm } from './ui/confirmDialog';
import * as file from './io/fileActions';
import { registerMultiTreeHandler, registerExportSettingsHandler } from './io/fileActions';
import { getAppInfo } from './io/native';
import { readAutoSave, readWorkspace, writeWorkspace } from './io/projectIO';
import { isImeComposing } from './ui/imeGuard';
import { MenuBar } from './ui/MenuBar';
import { Toolbar } from './ui/Toolbar';
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
import { notify } from './ui/toast';
import { S, skippedTabs } from './ui/strings';
import { useLanguage, onLanguageChange, currentLanguage } from './ui/i18n';
import { tr } from './ui/strings';
import { buildConsensusTree } from './model/consensus';
import { addBuiltGeneTree, createGeneDocFromSpecies } from './model/geneTreeBuild';
import { AboutDialog } from './ui/AboutDialog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ExportSettingsDialog } from './ui/ExportSettingsDialog';
import { StandardWorkspace } from './ui/StandardWorkspace';
import { ReconWorkspace } from './canvas/ReconWorkspace';
import { AddChildrenDialog } from './ui/AddChildrenDialog';
import { addChildrenSpaced } from './model/treeOps';
import type { NavModule } from './ui/NavigationRail';

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
function TabBar() {  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeName = useStore((s) => s.project.name);
  const tabStore = useStore((s) => s.tabStore);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const newTab = useStore((s) => s.newTab);
  // Real dirty flag: revision vs last-saved revision. The undo-stack DEPTH was
  // the old test, which lied in both directions — an undo back to a clean
  // document still counted as "unsaved", and a history-limit truncation made a
  // dirty document look clean.
  const revision = useStore((s) => s.revision);
  const lastSavedRevision = useStore((s) => s.lastSavedRevision);
  const titleOf = (id: string) =>
    (id === activeTabId ? activeName : tabStore[id]?.project.name) || S.tabs.untitled;
  const dirtyOf = (id: string): boolean => {
    if (id === activeTabId) {
      return revision !== lastSavedRevision;
    }
    const snap = tabStore[id];
    return snap ? snap.revision !== snap.lastSavedRevision : false;
  };

  const handleClose = (id: string) => {
    if (dirtyOf(id)) {
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
          {dirtyOf(id) && (
            <span
              aria-label={S.review.unsavedDot}
              title={S.review.unsavedDot}
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: 'var(--accent, #2563eb)',
                flex: 'none',
              }}
            />
          )}
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
        tr(`${d.name} · 基因树`, `${d.name} · gene tree`),
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
        `Gene tree created from the species tree: ${mapped}/${total} tip(s) auto-mapped`,
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

  const confirmAdd = useCallback(
    (count: number) => {
      if (addTarget) useStore.getState().apply((d) => addChildrenSpaced(d, addTarget, count));
      setAddOpen(false);
    },
    [addTarget],
  );

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
        // ⌘S saves IN PLACE when the document has a remembered path;
        // ⌘⇧S is always "ask where".
        if (e.shiftKey) void file.actionSaveProjectAs();
        else void file.actionSaveProject();
      } else if (k === 'w') {
        // ⌘W closes the ACTIVE TAB (with the dirty confirm), not the window:
        // the system window-close used to bypass the unsaved-changes guard.
        e.preventDefault();
        if (s.tabs.length > 1) s.closeTab(s.activeTabId);
      } else if (k === '0') {
        e.preventDefault();
        s.requestFit();
      } else if (k === 'a' && !e.shiftKey && !e.altKey) {
        // ⌘A selects ALL tips (the palette's 选中全部末端, on the natural key):
        // the review's keyboard-main-path item, one chord.
        e.preventDefault();
        const tips = Object.values(s.project.nodes)
          .filter((n) => n.childrenIds.length === 0)
          .map((n) => n.id);
        s.selectMany(tips);
      } else if (k >= '1' && k <= '7' && !e.altKey && !e.shiftKey) {
        // ⌘1–7 jump the left rail to the corresponding module — the rail is
        // fully keyboard-reachable through these, which the reference table
        // used to promise for nothing.
        e.preventDefault();
        const modules = ['traits', 'layers', 'recon', 'time', 'style', 'analysis', 'export'];
        const target = modules[Number(k) - 1];
        if (target) {
          window.dispatchEvent(new CustomEvent('cladeforge:tour-navigate', { detail: target }));
        }
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
          // `requestFit`, the reconciliation canvas for its own event.
          if (s.reconMode) {
            window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'));
          } else {
            s.requestFit();
          }
        } else {
          // Read the LIVE store, not a render-scope value: this handler is
          // registered once with `[]` deps, so a closed-over boolean would be
          // frozen at its initial value and the branch could never be taken.
          if (s.reconMode) {
            // The reconciliation canvas has no node-search field; the left
            // panel's assumption list is the locator here. Say so instead of
            // silently swallowing the chord.
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

  // F2 renames the selected node: the canvas owns the rename editor, so the
  // chord is relayed. Without it, renaming was double-click only — undiscoverable
  // for every keyboard user.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' && e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (isImeComposing(e)) return;
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

  // Multi-tree import chooser: fileActions delegates here.
  useEffect(() => {
    registerMultiTreeHandler((projects) => {
      setMultiTreeProjects(projects);
    });
    registerExportSettingsHandler(() => setExportSettingsOpen(true));
    return () => {
      registerMultiTreeHandler(null);
      registerExportSettingsHandler(null);
    };
  }, []);

  return (
    <div className="app" key={lang}>
      <TabBar />
      <div className="header-bar" data-tauri-drag-region>
        <MenuBar
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenTour={() => setTourMode('basics')}
          onOpenWorkflowTour={() => setTourMode('workflow')}
          onOpenAbout={() => setAboutOpen(true)}
        />
        <Toolbar onAddChildrenDialog={openAddForSelection} />
      </div>

      {reconMode ? (
        <ErrorBoundary scope={tr('协同重建工作区', 'Reconciliation workspace')}>
          <ReconWorkspace
            panelsHidden={panelsHidden}
            onBuildGeneTree={() => openGeneBuilder(null)}
            onCopySpeciesTree={copySpeciesTreeToGene}
            onEditGeneTree={(id) => openGeneBuilder(id)}
          />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary scope={tr('标准工作区', 'Standard workspace')}>
          <StandardWorkspace
            panelsHidden={panelsHidden}
            onOpenMatrix={() => setMatrixOpen(true)}
            onOpenAnalysis={() => setAnalysisOpen(true)}
            onNexusExport={() => setNexusExportOpen(true)}
            onBuildGeneTree={() => openGeneBuilder(null)}
            onCopySpeciesTree={copySpeciesTreeToGene}
            onEditGeneTree={(id) => openGeneBuilder(id)}
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
          // Preset mode engages so the export follows the panel, not the view.
          useStore.getState().setExportSettings({ followView: false });
          void file.actionExportWithSettings(format);
        }}
      />
      <BusyOverlay />
      <Toaster />
      <ConfirmDialog />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onOpenTour={() => {
          setShortcutsOpen(false);
          setTourMode('basics');
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
