// Rename one node straight from the coordination canvas (用户反馈 2026-11-23):
// the mapping editor edits BOTH trees, so the target is either a species node
// (the project document) or a gene node (the active gene tree's document).
// Same interaction contract as the standard editor's inline rename — no
// window.prompt — with the empty-name refusal both surfaces share.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { renameNode } from '../model/treeOps';
import type { NodeId, Project } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { isImeComposing } from './imeGuard';
import { tr } from './strings';
import { usePresence } from './motion';
import { notify } from './toast';

export interface RenamePaneTarget {
  side: 'species' | 'gene';
  /** Set exactly when side === 'gene'. */
  geneTreeId: string | null;
  nodeId: NodeId;
}

function targetDoc(project: Project, target: RenamePaneTarget): Project | undefined {
  return target.side === 'gene'
    ? project.geneTrees?.find((g) => g.id === target.geneTreeId)?.doc
    : project;
}

export function RenameNodeDialog({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: RenamePaneTarget | null;
  onClose: () => void;
}) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useDialogFocus(open, onClose);

  useEffect(() => {
    if (open && target) {
      setDraft(targetDoc(project, target)?.nodes[target.nodeId]?.label ?? '');
      requestAnimationFrame(() => inputRef.current?.select());
    }
    // The dialog is keyed off `open` + the target identity; the project read
    // only seeds the initial draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const presence = usePresence(open);
  if (!presence.mounted || !target) return null;
  if (!targetDoc(project, target)?.nodes[target.nodeId]) return null; // stale target

  const commit = () => {
    if (!target) return;
    const name = draft.trim();
    // A#7 / BUG-14: refuse an empty name — a node without any on-canvas handle
    // is worse than a refused rename.
    if (!name) {
      notify.info(
        tr(
          '名称不能为空：已保留原名称，避免画布上的节点标签消失。',
          'The name cannot be empty: the original name was kept so the canvas label does not disappear.',
        ),
      );
      onClose();
      return;
    }
    const t = target;
    apply((d) => {
      const doc = targetDoc(d, t);
      if (doc?.nodes[t.nodeId]) renameNode(doc, t.nodeId, name);
    });
    onClose();
  };

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog"
        data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={tr('重命名节点', 'Rename node')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{tr('重命名节点', 'Rename node')}</h2>
        <div className="field">
          <label htmlFor="recon-rename-input">
            {target.side === 'gene' ? tr('基因节点名称', 'Gene node name') : tr('物种节点名称', 'Species node name')}
          </label>
        </div>
        <input
          ref={inputRef}
          id="recon-rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {tr('取消', 'Cancel')}
          </button>
          <button className="btn primary" onClick={commit}>
            {tr('确定', 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
