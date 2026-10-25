// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Secondary toolbar. Left segment = primary editing actions (add children,
// undo / redo — moved here from the dissolved tool shelf); right segment =
// global chrome (project name, save, preferences). The header stays
// window-draggable between the segments.
//
// The old language (中/EN) and theme (light/dark/system) segmented controls are
// now one Preferences dropdown (see PreferencesMenu.tsx): BUG-10 caps the header
// at ten clickable targets and those five segments were low-frequency chrome.

import { PlusIcon, ResetIcon, ReloadIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { PreferencesMenu } from './PreferencesMenu';
import * as file from '../io/fileActions';
import { S, tr } from './strings';
import { notify } from './toast';

/** View-mode segment: 标准 standard canvas ↔ 协同 side-by-side reconciliation. */
function ViewModeSegment() {
  const reconMode = useStore((s) => s.reconMode);
  const setReconMode = useStore((s) => s.setReconMode);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const firstGeneId = useStore((s) => s.project.geneTrees?.[0]?.id ?? null);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);

  const enterRecon = () => {
    if (activeGeneTreeId) {
      setReconMode(true);
      return;
    }
    if (firstGeneId) {
      setActiveGeneTree(firstGeneId);
      setReconMode(true);
      return;
    }
    notify.info(tr('请先在「协同」模块导入一个基因树', 'Import a gene tree in the Reconcile module first'));
  };

  return (
    <div className="seg" role="tablist" aria-label={S.recon.section}>
      <button
        className={`seg-btn${!reconMode ? ' active' : ''}`}
        onClick={() => setReconMode(false)}
        aria-selected={!reconMode}
        title={S.recon.viewStandard}
      >
        {S.recon.viewStandard}
      </button>
      <button
        className={`seg-btn${reconMode ? ' active' : ''}`}
        onClick={() => !reconMode && enterRecon()}
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
  const projectName = useStore((s) => s.project.name);

  // Tauri's drag region fires only when the mousedown TARGET itself carries
  // `data-tauri-drag-region` — an attribute on the parent `.header-bar` does
  // nothing once a child (`.toolbar`, the flex spacer, the project name) is the
  // actual hit element. Every non-interactive blank stretch of the bar therefore
  // needs the attribute on its own element; buttons stay children without it and
  // keep working. (The `-webkit-app-region` rules in app.css are Electron-only
  // and are ignored by the Tauri webview.)
  return (
    <div className="toolbar" data-tauri-drag-region>
      <button className="btn primary" onClick={onAddChildrenDialog} title={S.toolbar.addMultiTitle}>
        <PlusIcon /> {S.toolbar.addChildren}
      </button>
      <UndoRedo />
      <ViewModeSegment />
      <div className="spacer" data-tauri-drag-region />
      <div className="hint project-name" data-tauri-drag-region>{projectName}</div>
      <button
        className="btn primary header-save"
        onClick={() => void file.actionSaveProject()}
        title={`${S.menu.save} (⌘S)`}
      >
        {S.menu.save}
      </button>
      <PreferencesMenu />
    </div>
  );
}
