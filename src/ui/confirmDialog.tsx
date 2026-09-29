// Lightweight confirm-dialog infrastructure.
//
// Rather than threading callback props through every delete / reroot entry
// point, a tiny module-level registry lets any code (toolbar, context menu,
// keyboard handler, inspector) request a confirmation; App mounts a single
// ConfirmDialog that resolves the pending request. The dialog supports a
// "don't ask again for this key" opt-out persisted to localStorage.

import { useCallback, useEffect, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { S } from './strings';

export interface ConfirmRequest {
  /** Stable key used for the "don't ask again" opt-out (e.g. 'delete-large'). */
  key: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

type Handler = (req: ConfirmRequest) => void;
let handler: Handler | null = null;

/**
 * Register the dialog consumer (called from App's effect) and hand back a
 * teardown. Without one, `handler` keeps pointing at the LAST mounted instance,
 * so a remount — a locale switch does one — could strand it on an unmounted
 * component and swallow the next confirmation.
 */
export function registerConfirmHandler(fn: Handler): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Ask for confirmation before a destructive / high-impact operation.
 * When the user has opted out ("don't ask again" for this key), the callback
 * runs immediately without a dialog.
 */
export function requestConfirm(req: ConfirmRequest): void {
  try {
    if (localStorage.getItem('cladeforge:confirm:skip:' + req.key) === 'true') {
      req.onConfirm();
      return;
    }
  } catch {
    /* ignore */
  }
  handler?.(req);
}

export function ConfirmDialog() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [skip, setSkip] = useState(false);
  const ref = useDialogFocus(Boolean(req), () => setReq(null));

  const open = useCallback((r: ConfirmRequest) => {
    setSkip(false);
    setReq(r);
  }, []);

  // Register from an effect, never during render: a render-time registration runs
  // on every render, never unregisters, and makes rendering a side effect.
  useEffect(() => registerConfirmHandler(open), [open]);

  if (!req) return null;

  const confirm = () => {
    if (skip) {
      try {
        localStorage.setItem('cladeforge:confirm:skip:' + req.key, 'true');
      } catch {
        /* ignore */
      }
    }
    const fn = req.onConfirm;
    setReq(null);
    fn();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => setReq(null)}>
      <div
        ref={ref}
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={req.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{req.title}</h2>
        <p className="confirm-message">{req.message}</p>
        <label className="confirm-skip">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          {S.confirm.dontAskAgain}
        </label>
        <div className="actions">
          <button className="btn" onClick={() => setReq(null)}>
            {S.confirm.cancel}
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={confirm}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
