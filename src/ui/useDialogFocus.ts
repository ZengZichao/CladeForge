// Accessibility helper for modal dialogs: focus trap + Esc-to-close +
// initial focus on the first focusable control. Applies the standard dialog
// contract to every modal so keyboard users never get stranded outside the
// dialog, and the Escape key always dismisses it.
//
// Usage: pass `open` and `onClose`; call the returned `ref` on the dialog
// container element.
//
// The effect depends on `[open]` alone, never on `[open, onClose]`: callers pass
// inline arrow functions (App.tsx: `<CharacterMatrixDialog onClose={() =>
// setMatrixOpen(false)} />`), so a dependency on `onClose` would tear the trap
// down and re-arm it on every parent re-render — which scoring one matrix cell
// triggers — and re-arming begins by focusing the FIRST focusable control. The
// caret would then jump out of the field a user is typing in, mid-edit, on each
// keystroke that commits. `onClose` is read through a ref instead, so the latest
// callback still runs without re-arming the trap.

import { useEffect, useRef, type RefObject } from 'react';
import { isImeComposing } from './imeGuard';

export const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Focusable descendants of `el`, in DOM order. */
export function focusablesOf(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Move focus INTO the dialog, but only when focus is not already inside it.
 * Returning false lets a caller know the caret was left where the user put it —
 * which is the point: a dialog that re-claims focus while a matrix cell is being
 * edited is unusable by keyboard.
 */
export function claimFocusInto(el: HTMLElement, active: Element | null = document.activeElement): boolean {
  if (active && active !== document.body && el.contains(active)) return false;
  const focusables = focusablesOf(el);
  (focusables[0] ?? el).focus();
  return true;
}

export function useDialogFocus(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  // Latest `onClose`, without being an effect dependency (see header).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    // Capture the previously focused element BEFORE focusing the dialog
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const el = ref.current;
    if (el) claimFocusInto(el);

    const onKeyDown = (e: KeyboardEvent) => {
      // Inside a dialog the user is routinely composing Pinyin in a text
      // field. Escape (cancel the candidate list) and Tab (page through
      // candidates on some engines) must not close the dialog or move focus out
      // of the field mid-composition.
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // Escape inside a modal belongs to the modal. Otherwise the event
        // bubbles to the canvas handler, which clears the selection the user
        // has just made.
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const focusables = focusablesOf(el);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}

/**
 * True while a modal dialog is on screen.
 *
 * Canvas-level keyboard handlers must stand down when one is open. A dialog that
 * does not hold focus — the onboarding tour, for instance — otherwise lets
 * Delete / Backspace / arrows / Escape reach the tree behind it, so a first-time
 * user pressing a key while reading the card could delete nodes with no
 * confirmation.
 *
 * Both ARIA modal roles count: `confirmDialog` renders `role="alertdialog"`, so
 * matching only `role="dialog"` would leave every confirmation box out and the
 * canvas would keep acting on Delete / Escape behind a deletion prompt.
 */
export function modalIsOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
    ) !== null
  );
}
