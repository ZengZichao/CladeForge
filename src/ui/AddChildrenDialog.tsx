// Modal for adding an arbitrary number of child branches to the selected node.
// Includes a polytomy type selector (hard vs. soft polytomy) stored in node meta.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { addChildrenSpaced } from '../model/treeOps';
import { useDialogFocus } from './useDialogFocus';
import { isImeComposing } from './imeGuard';
import { S } from './strings';

interface AddChildrenDialogProps {
  open: boolean;
  targetId: string | null;
  onCancel: () => void;
}

export function AddChildrenDialog({ open, targetId, onCancel }: AddChildrenDialogProps) {
  const apply = useStore((s) => s.apply);
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

  const confirm = () => {
    const n = Math.max(1, Math.min(50, Math.round(count) || 1));
    if (targetId) {
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
    }
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
            if (e.key === 'Enter') confirm();
            else if (e.key === 'Escape') onCancel();
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
          <button className="btn primary" onClick={confirm}>
            {S.addDialog.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
