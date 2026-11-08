// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Lightweight click-to-open dropdown used by the menu bar.
//
// The panel is rendered through a portal into document.body with fixed
// positioning: the toolbar has `overflow-x: auto` (one-row scrolling on narrow
// windows, P3), which would otherwise clip an absolutely-positioned child
// menu — the 阶梯化 / 定根 submenus appeared cut off. A portal escapes that
// clipping entirely while keeping the z-index above the chrome.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '@radix-ui/react-icons';

export interface DropdownItem {
  label?: string;
  onClick?: () => void;
  kbd?: string;
  sep?: boolean;
  /** Non-interactive group heading rendered above the following items. */
  heading?: string;
  /** Disabled entries render inert (no handler, aria-disabled) — a placeholder
   *  that LOOKS clickable but does nothing reads as breakage. */
  disabled?: boolean;
}

interface PanelPos {
  top: number;
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
}

export function Dropdown({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click, scroll (any scrollable ancestor) or resize —
  // otherwise a fixed-position panel drifts away from its trigger.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Long menus scroll internally (inline maxHeight/overflowY below); their own
    // scroll must not dismiss the panel. Only a scroll elsewhere moves the
    // trigger relative to the fixed panel.
    const onDismiss = (e: Event) => {
      const target = e.target;
      if (panelRef.current && target instanceof Node && panelRef.current.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const edge = 8;
      const minWidth = Math.min(Math.max(r.width, 170), window.innerWidth - edge * 2);
      const maxWidth = window.innerWidth - edge * 2;
      // Keep the menu inside the viewport and let it scroll internally: the
      // long File menu used to run past the bottom edge of the window.
      const left = Math.max(edge, Math.min(r.left, window.innerWidth - minWidth - edge));
      const top = Math.max(edge, Math.min(r.bottom + 4, window.innerHeight - edge));
      setPos({
        top,
        left,
        minWidth,
        maxWidth,
        maxHeight: Math.max(80, window.innerHeight - top - edge),
      });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="dropdown" ref={ref}>
      <button ref={btnRef} className="btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <ChevronDownIcon style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="dropdown-panel"
            role="menu"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: pos.minWidth,
              maxWidth: pos.maxWidth,
              maxHeight: pos.maxHeight,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((it, i) =>
              it.heading ? (
                <div key={`heading-${i}`} className="menu-section-label">
                  {it.heading}
                </div>
              ) : it.sep ? (
                <div key={`sep-${i}`} className="menu-sep" />
              ) : (
                <button
                  key={it.label}
                  className="menu-item"
                  role="menuitem"
                  aria-disabled={it.disabled || undefined}
                  style={it.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
                  onClick={() => {
                    if (it.disabled) return;
                    setOpen(false);
                    it.onClick?.();
                  }}
                >
                  <span>{it.label}</span>
                  {it.kbd && <span className="kbd">{it.kbd}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
