// Renders the active toast stack in a corner overlay. Mounted once in App.

import { useToasts } from './toast';
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
          onClick={() => dismiss(t.id)}
          title={tr("点击关闭","Click to dismiss")}
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
            type="button"
            className="toast-close"
            aria-label={tr('关闭', 'Dismiss')}
            title={tr('关闭', 'Dismiss')}
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            style={{
              marginLeft: 8,
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
