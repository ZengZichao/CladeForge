// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Modal for adding an arbitrary number of child branches to the selected node.
// Includes a polytomy type selector (hard vs. soft polytomy) stored in node meta.
//
// Two interaction contracts are enforced here:
//
// 1. The dialog STATES ITS TARGET. It used to add the children to the current
//    selection (or silently to the root when nothing was selected) while showing
//    nothing about it, so the user had no way to know where the new "?" nodes
//    would land. The dialog now names the target node, and spells out the root
//    fallback when the trigger was the toolbar button with an empty selection.
//
// 2. Enter and the Add button are the SAME path. Enter used to add the children
//    and close the dialog, after which the focus trap handed focus back to the
//    toolbar button that opened it — and the browser's default action for that
//    same Enter keydown then clicked the freshly focused button, reopening the
//    dialog. It looked like "Enter submits but never closes". The keydown handler
//    now calls preventDefault() (and stops propagation to the canvas) before
//    running the shared confirm path.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { addChildrenSpaced } from '../model/treeOps';
import { useDialogFocus } from './useDialogFocus';
import { isImeComposing } from './imeGuard';
import { S, tr } from './strings';
import { notify } from './toast';

interface AddChildrenDialogProps {
  open: boolean;
  targetId: string | null;
  onCancel: () => void;
}

export function AddChildrenDialog({ open, targetId, onCancel }: AddChildrenDialogProps) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [count, setCount] = useState(3);
  const [polytomyType, setPolytomyType] = useState<'hard' | 'soft'>('hard');
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus trap + Esc close + initial focus.
  const ref = useDialogFocus(open, onCancel);

  useEffect(() => {
    if (open) {
      setCount(3);
      setPolytomyType('hard');
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open]);

  if (!open) return null;

  const targetNode = targetId ? project.nodes[targetId] : undefined;
  const rootNode = project.nodes[project.rootId];
  // The toolbar button falls back to the ROOT when nothing is selected; say so
  // instead of pretending the user aimed at the root. A context-menu target is
  // explicit even when the selection is empty, so only the root + empty
  // selection combination is the fallback case.
  const rootFallback = targetId === project.rootId && selection.length === 0;
  const unnamed = tr('未命名节点', 'Unnamed node');
  const targetLabel = targetNode ? targetNode.label || unnamed : '';

  const confirm = () => {
    // Re-validate the target at submit time: the node could have been deleted
    // (or the project replaced) between opening the dialog and pressing Add.
    if (!targetId || !useStore.getState().project.nodes[targetId]) {
      notify.error(S.addDialog.targetMissing);
      onCancel();
      return;
    }
    const n = Math.max(1, Math.min(50, Math.round(count) || 1));
    apply((d) => {
      const ids = addChildrenSpaced(d, targetId, n);
      // Store polytomy type in each new child's meta for ≥3 children.
      if (n >= 3) {
        for (const id of ids) {
          const node = d.nodes[id];
          if (node) {
            node.meta = { ...node.meta, polytomyType };
          }
        }
      }
    });
    onCancel();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.addDialog.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.addDialog.title}</h2>
        <div
          className="dialog-target"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            margin: '-4px 0 12px',
            fontSize: 'var(--text-sm, 13px)',
            lineHeight: 1.4,
          }}
        >
          {!targetNode ? (
            <span style={{ color: 'var(--danger)' }}>{S.addDialog.targetMissing}</span>
          ) : rootFallback ? (
            <span style={{ color: 'var(--muted)' }}>
              {S.addDialog.rootFallback(rootNode?.label || unnamed)}
            </span>
          ) : (
            <>
              <span style={{ color: 'var(--muted)' }}>{S.addDialog.targetLabel}</span>
              <span
                className="dialog-target-chip"
                style={{
                  background: 'var(--surface-2, var(--bg))',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '1px 10px',
                  fontWeight: 600,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {targetLabel}
              </span>
            </>
          )}
        </div>
        <div className="field">
          <label>{S.addDialog.countLabel}</label>
        </div>
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          onKeyDown={(e) => {
            // Enter accepts an IME candidate, it does not confirm the count.
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') {
              // Same path as clicking Add — and the default action must be
              // cancelled so the same keystroke cannot activate the toolbar
              // button that the focus trap returns focus to on close.
              e.preventDefault();
              e.stopPropagation();
              confirm();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        {count >= 3 && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>{S.addDialog.polytomyType}</label>
            <select
              value={polytomyType}
              onChange={(e) => setPolytomyType(e.target.value as 'hard' | 'soft')}
            >
              <option value="hard">{S.addDialog.hardPolytomy}</option>
              <option value="soft">{S.addDialog.softPolytomy}</option>
            </select>
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={onCancel}>
            {S.addDialog.cancel}
          </button>
          <button className="btn primary" onClick={confirm} disabled={!targetNode}>
            {S.addDialog.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
