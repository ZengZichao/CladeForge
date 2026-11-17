// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Secondary toolbar. The toolbar carries ONLY editing actions (undo/redo,
// add children); document-level chrome (view mode, save, preferences) lives in
// HeaderActions at the right edge. The document name lives in the tab, not
// here. The header stays window-draggable between the segments.
//
// The old language (中/EN) and theme (light/dark/system) segmented controls are
// now one Preferences dropdown (see PreferencesMenu.tsx): BUG-10 caps the header
// at ten clickable targets and those five segments were low-frequency chrome.
//
// The view-mode switch (标准 ↔ 协调) moved into HeaderActions (2026-11-15):
// it switches the whole workspace, not an editing tool, so it belongs with the
// other document-level actions (save, preferences) instead of sitting between
// undo/redo and add-children in the editing row.
//
// Mode-aware (§5.5): the reconciliation workspace hides "add children" — the
// gene tree is read-only and species-tree topology edits belong to the standard
// workspace — while undo/redo/save/preferences stay (their tooltips explain
// what a reconciliation-mode undo can cover).

import { PlusIcon, ResetIcon, ReloadIcon, ViewVerticalIcon, MagnifyingGlassIcon, ClockIcon } from '@radix-ui/react-icons';
import { documentHasTree } from './documentContent';
import { useStore } from '../model/store';
import { PreferencesMenu } from './PreferencesMenu';
import * as file from '../io/fileActions';
import { S, modKey, tr } from './strings';

/** View-mode segment: 标准 standard canvas ↔ 协调 side-by-side reconciliation.
 *
 * The active state and the workspace switch BOTH read `reconMode`, so the
 * toolbar can never claim reconciliation while the app renders the standard
 * workspace. Entering with no gene tree opens the reconciliation EMPTY state —
 * there is no toast-and-nothing path any more (review R-16). */
function ViewModeSegment() {
  const reconMode = useStore((s) => s.reconMode);
  const enterReconWorkspace = useStore((s) => s.enterReconWorkspace);
  const exitReconWorkspace = useStore((s) => s.exitReconWorkspace);

  return (
    <div className="seg" role="tablist" aria-label={S.recon.section}>
      <button
        className={`seg-btn${!reconMode ? ' active' : ''}`}
        onClick={() => exitReconWorkspace()}
        aria-selected={!reconMode}
        title={S.recon.viewStandard}
      >
        {S.recon.viewStandard}
      </button>
      <button
        className={`seg-btn${reconMode ? ' active' : ''}`}
        onClick={() => !reconMode && enterReconWorkspace()}
        aria-selected={reconMode}
        title={S.recon.viewRecon}
      >
        {S.recon.viewRecon}
      </button>
    </div>
  );
}

function UndoRedo() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  return (
    <div className="actions-group">
      <button
        className="btn icon ghost"
        disabled={past === 0}
        onClick={undo}
        title={S.status.undoTitle(past)}
        aria-label={S.menu.undo}
      >
        <ResetIcon />
      </button>
      <button
        className="btn icon ghost"
        disabled={future === 0}
        onClick={redo}
        title={S.status.redoTitle(future)}
        aria-label={S.menu.redo}
      >
        <ReloadIcon />
      </button>
    </div>
  );
}

export function Toolbar({ onAddChildrenDialog }: { onAddChildrenDialog: () => void }) {
  const reconMode = useStore((s) => s.reconMode);
  // 用户反馈：a blank document has no node to add children TO — the button
  // belongs to the editing surface, which starts at the first tree.
  const hasTree = useStore((s) => documentHasTree(s.project));

  // Tauri's drag region fires only when the mousedown TARGET itself carries
  // `data-tauri-drag-region` — an attribute on the parent `.header-bar` does
  // nothing once a child (`.toolbar`, the flex spacer, the project name) is the
  // actual hit element. Every non-interactive blank stretch of the bar therefore
  // needs the attribute on its own element; buttons stay children without it and
  // keep working. (The `-webkit-app-region` rules in app.css are Electron-only
  // and are ignored by the Tauri webview.)
  return (
    <div className="toolbar" data-tauri-drag-region>
      <UndoRedo />
      {/* No "add children" in the reconciliation workspace: adding nodes to the
          species tree here would invalidate existing mappings silently, and the
          action reads as if it could edit the read-only gene tree. Also hidden
          on a blank document (nothing to add to — the empty state's 新建树文件
          is the way to start). */}
      {!reconMode && hasTree && (
        <button className="btn" onClick={onAddChildrenDialog} title={S.toolbar.addMultiTitle}>
          <PlusIcon /> <span className="toolbar-btn-label">{S.toolbar.addChildren}</span>
        </button>
      )}
      {/* 用户反馈: 查找与替换 / 历史记录 are first-class toolbar buttons (they
          used to hide inside the 文件 menu). They operate on the active document
          and stay reachable in both workspaces. */}
      {hasTree && (
        <>
          <button
            className="btn"
            onClick={() => file.openAppDialog('findReplace')}
            title={tr(`查找与替换（${modKey()}K 亦可搜索命令）`, 'Find & replace')}
          >
            <MagnifyingGlassIcon /> <span className="toolbar-btn-label">{tr('查找', 'Find')}</span>
          </button>
          <button
            className="btn"
            onClick={() => file.openAppDialog('history')}
            title={tr('历史记录', 'History')}
          >
            <ClockIcon /> <span className="toolbar-btn-label">{tr('历史', 'History')}</span>
          </button>
        </>
      )}
      <div className="spacer" data-tauri-drag-region />
    </div>
  );
}

/**
 * Save + Preferences. They live OUTSIDE `.toolbar` because the toolbar scrolls
 * horizontally when its row does not fit: the one solid action and the single
 * settings entry must never scroll out of reach (at 1024px the preferences
 * trigger used to sit 20px past the window edge, at 768px only half of Save
 * project was still on screen).
 */
export function HeaderActions({
  prefsOpen,
  onPrefsOpenChange,
}: {
  /** P-03: owned by App so the dialog stays open across the locale remount.
   *  Optional so isolated component tests can mount the header bare. */
  prefsOpen?: boolean;
  onPrefsOpenChange?: (v: boolean) => void;
}) {
  return (
    <div className="header-actions">
      {/* The workspace switch is a document-level mode change, not an editing
          tool: it sits at the right edge with save + preferences so the
          editing row (undo/redo, add children) stays purely about the canvas. */}
      <ViewModeSegment />
      {/* S19 (Sonus): panel visibility must be discoverable — ⌘. existed but
          nothing visible offered it. A header button toggles both panels. */}
      <button
        className="btn icon"
        title={tr(`显示 / 隐藏两侧面板（${modKey()}.）`, `Show / hide both side panels (${modKey()}.)`)}
        aria-label={tr('显示 / 隐藏两侧面板', 'Show / hide side panels')}
        onClick={() => window.dispatchEvent(new CustomEvent('cladeforge:toggle-panels'))}
      >
        <ViewVerticalIcon />
      </button>
      <button
        className="btn primary header-save"
        onClick={() => void file.actionSaveProject()}
        title={tr(`保存项目文件（${modKey()}S）`, `Save project file (${modKey()}S)`)}
        aria-label={S.menu.save}
      >
        {/* Below 640px the full label no longer fits next to the menubar; the
            short form keeps the action readable instead of truncating it. */}
        <span className="header-save-full">{S.menu.save}</span>
        <span className="header-save-short">{S.menu.saveShort}</span>
      </button>
      <PreferencesMenu open={prefsOpen} onOpenChange={onPrefsOpenChange} />
    </div>
  );
}
