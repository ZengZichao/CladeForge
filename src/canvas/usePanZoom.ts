// Small hooks/helpers for canvas navigation.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { isImeComposing } from '../ui/imeGuard';
import type { Point } from '../model/types';

/** Screen-space point (relative to the SVG top-left) for a pointer/wheel event. */
export function eventScreenPoint(
  svg: SVGSVGElement,
  e: { clientX: number; clientY: number },
): Point {
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** Tracks whether the space bar is currently held (temporary pan modifier). */
export function useSpaceHeld(): MutableRefObject<boolean> {
  const held = useRef(false);
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      // Space accepts the highlighted IME candidate. While a composition is
      // open the keystroke belongs to the input method, so panning must not
      // claim it (and must not preventDefault it away from the composition).
      if (isImeComposing(e)) return;
      if (e.code === 'Space' && !isEditable(e.target)) {
        held.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') held.current = false;
    };
    // If focus leaves the window while Space is down (e.g. Alt-Tab), the keyup
    // never arrives here and the flag would stay stuck true. Reset defensively.
    const reset = () => {
      held.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);
  return held;
}

/**
 * Attaches a non-passive wheel listener so we can call preventDefault (React's
 * onWheel is passive in some browsers). `handler` receives the native event.
 */
export function useWheel(
  ref: MutableRefObject<SVGSVGElement | null>,
  handler: (e: WheelEvent) => void,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => handler(e);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, [ref, handler]);
}
