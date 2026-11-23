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
import { usePresence } from './motion';
import { notify } from './toast';

interface AddChildrenDialogProps {
  open: boolean;
  targetId: string | null;
  /** 用户反馈 (2026-11-23): when set, the children are added to THIS gene
   *  tree's document (coordination-canvas editing) instead of the species
   *  project. */
  geneTreeId?: string | null;
  onCancel: () => void;
}

export function AddChildrenDialog({ open, targetId, geneTreeId, onCancel }: AddChildrenDialogProps) {
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

  const presence = usePresence(open);

  if (!presence.mounted) return null;

  // The document the children land in: the species project, or the targeted
  // gene tree's standalone document.
  const geneEntry = geneTreeId ? project.geneTrees?.find((g) => g.id === geneTreeId) : undefined;
  const doc = geneEntry?.doc ?? project;
  const targetNode = targetId ? doc.nodes[targetId] : undefined;
  const rootNode = doc.nodes[doc.rootId];
  // The toolbar button falls back to the ROOT when nothing is selected; say so
  // instead of pretending the user aimed at the root. A context-menu target is
  // explicit even when the selection is empty, so only the root + empty
  // selection combination is the fallback case.
  const rootFallback = targetId === doc.rootId && selection.length === 0;
  const unnamed = tr('未命名节点', 'Unnamed node');
  const targetLabel = targetNode ? targetNode.label || unnamed : '';

  const confirm = () => {
    // Re-validate the target at submit time: the node could have been deleted
    // (or the project replaced) between opening the dialog and pressing Add.
    const live = useStore.getState().project;
    const liveDoc = geneTreeId
      ? live.geneTrees?.find((g) => g.id === geneTreeId)?.doc
      : live;
    if (!targetId || !liveDoc?.nodes[targetId]) {
      notify.error(S.addDialog.targetMissing);
      onCancel();
      return;
    }
    // P-04: an explicit 0 used to be silently turned into 1 ("typed 0, got a
    // new child"). Zero children is a NO-OP with a clear message, never a
    // hidden default; the Add button is disabled for the same condition.
    if (!Number.isFinite(count) || count < 1) {
      notify.info(
        tr('子节点数量至少为 1：未添加任何节点。', 'Number of children must be at least 1: nothing was added.'),
      );
      return;
    }
    // GUI-A P2: over-max used to be CLAMPED to 50 while under-min was refused,
    // i.e. two different rules for the same declared range [1, 50]. Both ends
    // are now refused: the button is disabled above and this path re-checks for
    // the Enter key. No silent coercion in either direction.
    if (count > 50) {
      notify.info(
        tr(
          `每节点子节点数最多为 50：未添加任何节点。`,
          `Number of children is capped at 50: nothing was added.`,
        ),
      );
      return;
    }
    const n = Math.round(count);
    apply((d) => {
      // 用户反馈 (2026-11-23): gene-tree target → edit the gene doc; otherwise
      // the species project as before.
      const target = geneTreeId
        ? d.geneTrees?.find((g) => g.id === geneTreeId)?.doc
        : d;
      if (!target) return;
      const ids = addChildrenSpaced(target, targetId, n);
      // Store polytomy type in each new child's meta for ≥3 children.
      if (n >= 3) {
        for (const id of ids) {
          const node = target.nodes[id];
          if (node) {
            node.meta = { ...node.meta, polytomyType };
          }
        }
      }
    });
    onCancel();
  };

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onCancel}>
      <div
        ref={ref}
        className="dialog" data-state={presence.state}
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
            <span style={{ color: 'var(--muted-foreground)' }}>
              {S.addDialog.rootFallback(rootNode?.label || unnamed)}
            </span>
          ) : (
            <>
              <span style={{ color: 'var(--muted-foreground)' }}>{S.addDialog.targetLabel}</span>
              <span
                className="dialog-target-chip"
                style={{
                  background: 'var(--surface-2, var(--bg))',
                  border: '0.5px solid var(--border)',
                  borderRadius: 0,
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
          {/* S09 (Sonus): the count input had no associated label — programmatic
              name via htmlFor/id. */}
          <label htmlFor="add-children-count">{S.addDialog.countLabel}</label>
        </div>
        <input
          ref={inputRef}
          id="add-children-count"
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
        {/* GUI-A P2: state the range violation INLINE, next to the field that
            carries it — the same visible reason NumberField gives for an
            out-of-range age. */}
        {(count < 1 || count > 50) && (
          <div className="field-error">
            {tr(
              `数量需在 1–50 之间（当前 ${count}）`,
              `Number of children must be between 1 and 50 (currently ${count})`,
            )}
          </div>
        )}
        {count >= 3 && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="add-children-polytomy-type">{S.addDialog.polytomyType}</label>
            <select
              id="add-children-polytomy-type"
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
          <button
            className="btn primary"
            onClick={confirm}
            disabled={!targetNode || !(count >= 1 && count <= 50)}
          >
            {S.addDialog.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
