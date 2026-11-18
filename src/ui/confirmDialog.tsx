// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Lightweight confirm-dialog infrastructure.
//
// Rather than threading callback props through every delete / reroot entry
// point, a tiny module-level registry lets any code (toolbar, context menu,
// keyboard handler, inspector) request a confirmation; App mounts a single
// ConfirmDialog that resolves the pending request. The dialog supports a
// "don't ask again for this key" opt-out persisted to localStorage.

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * B4 (UI_UX_REVIEW): an optional third choice rendered between Cancel and
   * Confirm as the solid-primary button — the close-tab dialog offers
   * 保存并关闭 (safe, primary) beside 不保存 (destructive, danger). It runs
   * INSTEAD of onConfirm/onCancel; the dialog closes either way.
   */
  alternate?: { label: string; onAction: () => void };
  /**
   * Runs when the dialog is dismissed WITHOUT confirming (cancel button,
   * backdrop, Escape). Lets a caller that must branch on the answer (the M12
   * overwrite question resolves a promise) tidy up instead of hanging.
   */
  onCancel?: () => void;
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
  // m20: the currently pending request, mirrored in a ref so `open()` can
  // cancel the previous one even under React StrictMode (state updaters run
  // twice there — a side effect inside the updater would cancel twice).
  const reqRef = useRef<ConfirmRequest | null>(null);
  const ref = useDialogFocus(Boolean(req), () => {
    const cancel = req?.onCancel;
    setReq(null);
    reqRef.current = null;
    cancel?.();
  });

  const open = useCallback((r: ConfirmRequest) => {
    setSkip(false);
    // m20 (UI_UX_REVIEW): a singleton replacing a pending request used to drop
    // the old one silently — its awaiting promise (e.g. the save-then-replace
    // flow in fileActions) then never resolved. Cancel it explicitly.
    reqRef.current?.onCancel?.();
    reqRef.current = r;
    setReq(r);
  }, []);

  // Register from an effect, never during render: a render-time registration runs
  // on every render, never unregisters, and makes rendering a side effect.
  useEffect(() => registerConfirmHandler(open), [open]);

  if (!req) return null;

  const dismiss = () => {
    const cancel = req.onCancel;
    setReq(null);
    reqRef.current = null;
    cancel?.();
  };

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
    reqRef.current = null;
    fn();
  };

  return (
    <div className="dialog-backdrop confirm-backdrop" onMouseDown={dismiss}>
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
        {!req.danger && (
          <label className="confirm-skip">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            {S.confirm.dontAskAgain}
          </label>
        )}
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              const cancel = req.onCancel;
              setReq(null);
              reqRef.current = null;
              cancel?.();
            }}
          >
            {S.confirm.cancel}
          </button>
          {req.alternate && (
            <button
              className="btn primary"
              onClick={() => {
                const act = req.alternate!.onAction;
                setReq(null);
                reqRef.current = null;
                act();
              }}
            >
              {req.alternate.label}
            </button>
          )}
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={confirm}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
