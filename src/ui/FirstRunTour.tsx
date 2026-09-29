// Onboarding tour: a 4-step coachmark sequence that spotlights a
// region of the app (canvas, inspector, module rail, command palette) with a
// short explanation and a next/skip control.
//
// The tour is opt-in: it does not auto-show on first launch. It can be re-opened
// any time from 帮助 → 新手指南 (menu bar), from the command palette
// (⌘K → 新手指南) or from the shortcut reference dialog.
// Completion is persisted to localStorage so re-opening from Help
// always starts at step 1.

import { useCallback, useEffect, useState } from 'react';
import { S } from './strings';
import { useDialogFocus } from './useDialogFocus';

const LS_ONBOARDED = 'cladeforge:onboarded';

interface TourStep {
  /** CSS selector of the element to spotlight; null = centered card. */
  target: string | null;
  title: string;
  desc: string;
}

function getSteps(): TourStep[] {
  return [
    {
      target: '.canvas-host',
      title: S.tour.step1Title,
      desc: S.tour.step1Desc,
    },
    {
      target: '.panel-right',
      title: S.tour.step2Title,
      desc: S.tour.step2Desc,
    },
    {
      target: '.nav-rail, .panel-left',
      title: S.tour.step3Title,
      desc: S.tour.step3Desc,
    },
    {
      target: null,
      title: S.tour.step4Title,
      desc: S.tour.step4Desc,
    },
  ];
}

/** Mark the tour as completed (persisted). */
export function markOnboarded(): void {
  try {
    localStorage.setItem(LS_ONBOARDED, 'true');
  } catch {
    /* ignore */
  }
}

function targetRect(selector: string | null): DOMRect | null {
  if (!selector) return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Skip fully hidden targets (e.g. collapsed panels on narrow screens).
  if (r.width < 8 || r.height < 8) return null;
  return r;
}

export function FirstRunTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  // The tour declares role="dialog" aria-modal="true", so it must honour that
  // contract: claim focus, trap Tab and close on Escape. Previously it did none
  // of that, and keystrokes fell through to the canvas.
  const dialogRef = useDialogFocus(open, onClose);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Reset to the first step each time the tour is (re-)opened.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const steps = getSteps();
    const measure = () => setRect(targetRect(steps[step].target));
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [open, step]);

  const finish = useCallback(() => {
    markOnboarded();
    onClose();
  }, [onClose]);

  if (!open) return null;

  const steps = getSteps();
  const current = steps[step];
  const isLast = step === steps.length - 1;
  // Card is centered when no target exists, otherwise pinned below/above it.
  const cardStyle: React.CSSProperties = current.target
    ? rect
      ? rect.bottom + window.innerHeight * 0.12 > window.innerHeight - 120
        ? { left: Math.max(12, Math.min(rect.left, window.innerWidth - 360)), top: Math.max(12, rect.top - 150) }
        : { left: Math.max(12, Math.min(rect.left, window.innerWidth - 360)), top: rect.bottom + 12 }
      : { top: '45%', left: '50%', transform: 'translate(-50%, -50%)' }
    : { top: '45%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div ref={dialogRef} className="tour-backdrop" role="dialog" aria-modal="true" aria-label={S.tour.title}>
      <div className="tour-mask" />
      {rect && current.target && (
        <div
          className="tour-spotlight"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="tour-card" style={cardStyle}>
        <div className="tour-step">{step + 1} / {steps.length}</div>
        <div className="tour-title">{current.title}</div>
        <div className="tour-desc">{current.desc}</div>
        <div className="tour-actions">
          <button className="btn ghost" onClick={finish}>
            {S.tour.skip}
          </button>
          <button className="btn primary" onClick={() => (isLast ? finish() : setStep((s) => s + 1))}>
            {isLast ? S.tour.done : S.tour.next}
          </button>
        </div>
      </div>
    </div>
  );
}
