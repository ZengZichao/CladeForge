// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Full-screen advisory for phone-width windows (BUG-9).
//
// CladeForge is a desktop-first tree editor: below 1024px the app already
// switches to its narrow mode (panels become overlays, a bottom tab bar replaces
// the rail), but a 375px viewport still cannot show the canvas plus both panels
// comfortably. Rather than pretend otherwise, the first visit at ≤640px says so
// once; "Continue anyway" persists the acknowledgement so the hint never nags
// again. The app stays fully usable after (and behind) it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { tr } from './strings';

/** localStorage key remembering that the user chose to continue on a phone. */
export const LS_NARROW_HINT = 'cladeforge:narrowHintDismissed';
/** Viewports at or below this width get the advisory. */
export const NARROW_HINT_MAX_WIDTH = 640;

function acknowledged(): boolean {
  try {
    return localStorage.getItem(LS_NARROW_HINT) === 'true';
  } catch {
    // Blocked storage degrades to "not acknowledged": the hint may reappear,
    // which is better than suppressing it forever without consent.
    return false;
  }
}

function shouldShow(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.innerWidth <= NARROW_HINT_MAX_WIDTH &&
    !acknowledged()
  );
}

export function NarrowScreenHint() {
  const [open, setOpen] = useState(shouldShow);
  const okRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(LS_NARROW_HINT, 'true');
    } catch {
      /* The hint still closes for this session; only persistence is lost. */
    }
    setOpen(false);
  }, []);

  // Re-evaluate when the window is resized across the threshold. Once
  // acknowledged, `acknowledged()` keeps it closed for good.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > NARROW_HINT_MAX_WIDTH) setOpen(false);
      else if (!acknowledged()) setOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The advisory claims aria-modal, so it must honour the dialog contract:
  // focus its only action and let Escape dismiss it.
  useEffect(() => {
    if (!open) return undefined;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="narrow-hint"
      role="dialog"
      aria-modal="true"
      aria-label={tr('窄屏提示', 'Narrow screen notice')}
    >
      <div className="narrow-hint-card">
        <div className="narrow-hint-title">
          {tr('CladeForge 是桌面端编辑器', 'CladeForge is a desktop editor')}
        </div>
        <div className="narrow-hint-desc">
          {tr(
            '建议在 ≥1280px 宽的窗口中使用。窄屏下画布会自动让出空间，左右面板改以覆盖层打开，操作空间仍然有限。',
            'A window at least 1280px wide is recommended. On narrow screens the canvas gives up space and the side panels open as overlays, so room is still limited.',
          )}
        </div>
        <div className="narrow-hint-actions">
          <button ref={okRef} className="btn primary" onClick={dismiss}>
            {tr('仍要继续', 'Continue anyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
