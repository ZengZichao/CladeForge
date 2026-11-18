// Renders the active toast stack in a corner overlay. Mounted once in App.
//
// M40 (UI_UX_REVIEW): a 500px error toast used to offer only "click the whole
// strip to dismiss" — no visible control, and a pointer-down on the message
// itself could be a failed copy attempt. Every toast now carries an explicit
// close button (Cross2Icon, named). Toasts auto-dismiss on a bounded clock
// (5 s; errors 6 s) and the stack is capped at three, so a later result can
// never sit behind a pile of earlier ones (GUI-C DEF-5).

import { useToasts } from './toast';
import { Cross2Icon } from '@radix-ui/react-icons';
import { tr } from './strings';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}${t.action ? ' toast-with-action' : ''}`}
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
