// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Shared vertical splitter for the two workspaces' side panels (2026-11-15
// OP-17).
//
// The standard and reconciliation workspaces each carried their own copy of
// this interaction, which is exactly the kind of duplication that drifts: a
// fix to one drag handler would never reach the other. One implementation now
// serves both, parameterised only by the panel-width bounds (the two
// workspaces deliberately remember different widths).

import type { PointerEvent as ReactPointerEvent } from 'react';
import { S, tr } from './strings';
import { isImeComposing } from './imeGuard';

/**
 * Clamp a side-panel width. The ceiling is also bounded by the WINDOW: two
 * panels at the fixed maximum would consume all of a 1280 px window and leave
 * the canvas no room at all. A third of the viewport each keeps both panels
 * usable while leaving the tree visible.
 */
export function clampPanelWidth(
  w: number,
  minWidth: number,
  maxWidth: number,
): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const cap = Math.max(minWidth, Math.min(maxWidth, Math.floor(vw / 3)));
  return Math.max(minWidth, Math.min(cap, w));
}

/**
 * Vertical splitter that resizes an adjacent side panel by dragging.
 *
 * Performance strategy:
 * 1. During the drag, panel width is mutated DIRECTLY on the DOM node so no
 *    React re-render fires per frame.
 * 2. CSS transitions on the panel are temporarily disabled (a `dragging` class
 *    is toggled on <body>) so the browser doesn't animate every width change.
 * 3. pointermove is throttled to one update per animation frame via
 *    requestAnimationFrame — pointermove can fire faster than the display
 *    refresh, so coalescing avoids redundant layout work.
 * 4. React state is only updated once, on pointerup, to persist the final width.
 */
export function ResizeHandle({
  side,
  width,
  panelRef,
  onCommit,
  minWidth = 180,
  maxWidth = 620,
}: {
  side: 'left' | 'right';
  width: number;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onCommit: (w: number) => void;
  minWidth?: number;
  maxWidth?: number;
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panel = panelRef.current;
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    let raf = 0;
    let pending = false;

    // Disable transitions globally during drag so width changes are instant.
    document.body.classList.add('panel-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const applyWidth = () => {
      raf = 0;
      pending = false;
      if (panel) panel.style.width = `${last}px`;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      last = clampPanelWidth(side === 'left' ? startW + dx : startW - dx, minWidth, maxWidth);
      // Coalesce multiple pointermove events into one rAF callback.
      if (!pending) {
        pending = true;
        raf = requestAnimationFrame(applyWidth);
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      // Final write in case the last rAF hasn't fired yet.
      if (panel) panel.style.width = `${last}px`;
      document.body.classList.remove('panel-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={S.panel.resizeTitle}
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      title={`${S.panel.resizeTitle} · ${tr('←/→ 调整，双击复位', '←/→ to resize, double-click resets')}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      /* m11 (UI_UX_REVIEW): the splitter had role=separator but no focus, no
         keyboard adjustment and no reset — a keyboard user could not resize
         panels at all. ←/→ (and ↑/↓'s horizontal cousins) move by 16px, and a
         double-click restores the default width. */
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dir = (e.key === 'ArrowLeft' ? -1 : 1) * (side === 'left' ? 1 : -1);
          onCommit(clampPanelWidth(width + dir * step, minWidth, maxWidth));
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          onCommit(e.key === 'Home' ? minWidth : maxWidth);
        }
      }}
      onDoubleClick={() => onCommit(clampPanelWidth(side === 'left' ? 280 : 292, minWidth, maxWidth))}
    />
  );
}
