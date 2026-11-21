// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Transition-based presence for overlays and collapsible content.
//
// The review asks for motion that can be interrupted: keyframe entrances restart
// from zero and snap, while a CSS transition can be reversed mid-flight when the
// pointer comes back. This hook keeps an element mounted while it transitions
// OUT (a short travel + fade + blur), then unmounts it, so closing a menu never
// "flies off" and reopening it immediately cancels the exit in place.
//
// `motionEnabled()` returns false in jsdom (no layout engine, so no
// `transitionend` ever fires and tests would hang on a half-closed overlay) and
// when the OS asks for reduced motion. Callers then unmount synchronously, which
// keeps the DOM contract the component tests assert on.

import { useEffect, useRef, useState } from 'react';

/** Kept in sync with the `--motion-exit` token in app.css. */
export const EXIT_MS = 240;

export function motionEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // jsdom has neither a compositor nor matchMedia in most test files.
  if (/jsdom/i.test(window.navigator.userAgent)) return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export interface Presence {
  /** Render the element while true (includes the exit transition window). */
  mounted: boolean;
  /** `data-state` value: transitions from open → closed animate the exit. */
  state: 'open' | 'closed';
}

/**
 * Keep an element mounted while it leaves.
 *
 * `active` is the logical open/visible flag. On false the element renders one
 * more time in the `closed` state, then unmounts after `exitMs`. Setting
 * `active` back to true during that window cancels the timer and transitions
 * back from wherever it was — the interruption the review asks for.
 */
export function usePresence(active: boolean, exitMs: number = EXIT_MS): Presence {
  const [mounted, setMounted] = useState(active);
  const [state, setState] = useState<Presence['state']>(active ? 'open' : 'closed');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (active) {
      clear();
      setMounted(true);
      if (!motionEnabled()) {
        setState('open');
        return;
      }
      // One frame with the closed style first, so the transition has a start
      // value even when the element was just inserted.
      const raf = window.requestAnimationFrame(() => setState('open'));
      return () => window.cancelAnimationFrame(raf);
    }

    setState('closed');
    if (!mounted) return;
    if (!motionEnabled()) {
      setMounted(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setMounted(false);
    }, exitMs);
    return clear;
  }, [active, mounted, exitMs]);

  return { mounted, state };
}