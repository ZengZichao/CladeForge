// Secondary toolbar. Left segment = primary editing actions (add children,
// undo / redo — moved here from the dissolved tool shelf); right segment =
// global chrome (project name, save, language, theme). The header stays
// window-draggable between the segments.

import { PlusIcon, ResetIcon, ReloadIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
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

  return (
    <div className="toolbar">
      <button className="btn primary" onClick={onAddChildrenDialog} title={S.toolbar.addMultiTitle}>
        <PlusIcon /> {S.toolbar.addChildren}
      </button>
      <UndoRedo />
      <ViewModeSegment />
      <div className="spacer" />
      <div className="hint project-name">{projectName}</div>
      <button
        className="btn primary header-save"
        onClick={() => void file.actionSaveProject()}
        title={`${S.menu.save} (⌘S)`}
      >
        {S.menu.save}
      </button>
      <LanguageToggle />
      <ThemeToggle />
    </div>
  );
}
