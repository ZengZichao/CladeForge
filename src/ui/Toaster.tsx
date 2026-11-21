// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Renders the active toast stack in a corner overlay. Mounted once in App.
//
// M40 (UI_UX_REVIEW): a 500px error toast used to offer only "click the whole
// strip to dismiss" — no visible control, and a pointer-down on the message
// itself could be a failed copy attempt. Every toast now carries an explicit
// close button (Cross2Icon, named). Toasts auto-dismiss on a bounded clock
// (5 s; errors 6 s) and the stack is capped at three, so a later result can
// never sit behind a pile of earlier ones (GUI-C DEF-5).
//
// 2026-11 review: a dismissed toast now LEAVES instead of blinking out — the
// row stays mounted for one short fade + downward drift + blur, then is
// removed. The exit is driven by a CSS transition, so a toast that reappears
// mid-exit reverses from its current position instead of restarting.

import { useEffect, useState } from 'react';
import { useToasts, type Toast } from './toast';
import { Cross2Icon } from '@radix-ui/react-icons';
import { tr } from './strings';
import { EXIT_MS, motionEnabled } from './motion';

interface ToastRow extends Toast {
  exiting: boolean;
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  // Mirror the store but keep removed rows one transition longer so the exit
  // is visible. `Map` preserves the newest-wins order the store maintains.
  const [rows, setRows] = useState<ToastRow[]>([]);

  useEffect(() => {
    setRows((prev) => {
      const live = new Map(toasts.map((t) => [t.id, t]));
      const next: ToastRow[] = [];
      for (const row of prev) {
        const t = live.get(row.id);
        if (t) {
          next.push({ ...row, ...t, exiting: false });
          live.delete(row.id);
        } else if (!row.exiting) {
          next.push({ ...row, exiting: true });
        } else {
          next.push(row);
        }
      }
      for (const t of live.values()) next.push({ ...t, exiting: false });
      return next;
    });
  }, [toasts]);

  useEffect(() => {
    if (!rows.some((r) => r.exiting)) return;
    if (!motionEnabled()) {
      setRows((cur) => cur.filter((r) => !r.exiting));
      return;
    }
    const timer = window.setTimeout(
      () => setRows((cur) => cur.filter((r) => !r.exiting)),
      EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [rows]);

  if (rows.length === 0) return null;
  return (
    <div className="toaster">
      {rows.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}${t.action ? ' toast-with-action' : ''}`}
          data-state={t.exiting ? 'closed' : 'open'}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            className="toast-close"
            aria-label={tr('关闭通知', 'Dismiss notification')}
            title={tr('关闭', 'Dismiss')}
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            <Cross2Icon />
          </button>
        </div>
      ))}
    </div>
  );
}
