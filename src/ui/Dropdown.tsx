// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Lightweight click-to-open dropdown used by the menu bar.
//
// The panel is rendered through a portal into document.body with fixed
// positioning: the toolbar has `overflow-x: auto` (one-row scrolling on narrow
// windows, P3), which would otherwise clip an absolutely-positioned child
// menu — the 阶梯化 / 定根 submenus appeared cut off. A portal escapes that
// clipping entirely while keeping the z-index above the chrome.
//
// M10 (UI_UX_REVIEW 2026-11-15): the file/recent menus had NO keyboard
// contract — Escape did not close, arrows did nothing, and Tab jumped from the
// trigger straight to the next menubar button. This component now implements
// the APG menu pattern: Escape close + focus return, ↑/↓/Home/End navigation,
// typeahead, Enter/Space activation, Tab dismiss, and roving focus that skips
// disabled items. The help and preferences menus keep their own (existing)
// window-level Escape handling — M10's scope is the two Dropdown-based menus.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { isImeComposing } from './imeGuard';
import { usePresence } from './motion';

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

export function Dropdown({
  label,
  items,
  variant = 'boxed',
}: {
  label: string;
  items: DropdownItem[];
  /** Text variant is for the menu bar: no box, just the word and a caret. */
  variant?: 'boxed' | 'text';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  // Keep the panel mounted for one short exit transition (fade + 4 px lift +
  // blur). Reopening during that window cancels it and turns the motion around.
  const presence = usePresence(open);
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
    // focus follows the items; their own scroll must not dismiss the panel.
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

  // M10: the menu contract. `open` triggers the portal; after it mounts, focus
  // the first enabled item; the document keydown handles Escape / arrows /
  // typeahead / activation while the menu is open.
  const typeaheadRef = useRef({ seq: '', at: 0 });

  useEffect(() => {
    if (!open) return;
    // Focus the first enabled item once the portal content is in the DOM.
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLButtonElement>('.menu-item:not([aria-disabled="true"])');
      first?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        // APG menus consume Tab; focus returns to the trigger.
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not([aria-disabled="true"])') ?? [],
      );
      const current = document.activeElement as HTMLButtonElement | null;
      const idx = current ? items.indexOf(current) : -1;
      const move = (delta: number) => {
        e.preventDefault();
        const next = items[(idx + delta + items.length) % items.length] ?? items[0];
        next?.focus();
        next?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'ArrowDown') return move(1);
      if (e.key === 'ArrowUp') return move(-1);
      if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (current && items.includes(current)) {
          e.preventDefault();
          current.click();
        }
        return;
      }
      // Typeahead: printable characters cycle through labels starting with
      // the accumulated sequence (reset after 700ms of inactivity).
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        if (now - typeaheadRef.current.at > 700) typeaheadRef.current.seq = '';
        typeaheadRef.current.seq += e.key.toLowerCase();
        typeaheadRef.current.at = now;
        const seq = typeaheadRef.current.seq;
        const start = idx + 1;
        const ordered = [...items.slice(start), ...items.slice(0, start)];
        const hit = ordered.find((b) => (b.textContent ?? '').trim().toLowerCase().startsWith(seq));
        if (hit) {
          e.preventDefault();
          hit.focus();
          hit.scrollIntoView({ block: 'nearest' });
        } else {
          // A label can hold the sequence's TAIL only (e.g. "树" then "木");
          // retry with just the last character before giving up.
          typeaheadRef.current.seq = e.key.toLowerCase();
          const retry = ordered.find((b) => (b.textContent ?? '').trim().toLowerCase().startsWith(typeaheadRef.current.seq));
          if (retry) {
            e.preventDefault();
            retry.focus();
            retry.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        ref={btnRef}
        className={`btn${variant === 'text' ? ' text' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <ChevronDownIcon style={{ marginLeft: 2, opacity: 0.6 }} />
      </button>
      {presence.mounted &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="dropdown-panel"
            data-state={presence.state}
            role="menu"
            aria-label={label}
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
