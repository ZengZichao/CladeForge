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
}

interface PanelPos {
  top: number;
  left: number;
  minWidth: number;
}

export function Dropdown({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click, scroll (any scrollable ancestor) or resize —
  // otherwise a fixed-position panel drifts away from its trigger.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onDismiss = () => setOpen(false);
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
      setPos({ top: r.bottom + 4, left: r.left, minWidth: Math.max(r.width, 170) });
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
            className="dropdown-panel"
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((it, i) =>
              it.sep ? (
                <div key={`sep-${i}`} className="menu-sep" />
              ) : (
                <button
                  key={it.label}
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
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
