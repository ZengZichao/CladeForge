// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Top menu bar: document lifecycle (File / Recent) on the left and ONE Help
// menu on the right.
//
// BUG-10 capped the header at ten clickable targets, so Keyboard Shortcuts,
// the Beginner Tour, the new Workflow Tour and About are consolidated behind a
// single "?" dropdown instead of three labelled buttons. Every item still opens
// exactly the dialog it used to open.
//
// The Help trigger keeps its word label (帮助 / Help) above 1440px and collapses
// to the bare "?" icon below that width — the same responsive rule the three
// separate help buttons followed, now costing one header target instead of three.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, QuestionMarkIcon } from '@radix-ui/react-icons';
import * as file from '../io/fileActions';
import { RECENTS_CHANGED_EVENT, readRecents, clearRecents, type RecentEntry } from '../io/recent';
import { Dropdown, type DropdownItem } from './Dropdown';
import { buildFileMenuItems, buildRecentItems } from './fileMenu';
import { S, tr } from './strings';
import { notify } from './toast';

interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * The single help dropdown. Mirrors `Dropdown`'s dismissal/portal behaviour
 * (the toolbar/drag-region ancestors clip absolutely positioned children) but
 * adds the icon trigger and the wide-screen label that the old icon buttons had.
 */
function HelpMenu({ items }: { items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click, any scrollable ancestor scrolling, resize or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // The help panel scrolls internally when the list is taller than the
    // viewport cap; that scroll belongs to the panel, not to the page.
    const onDismiss = (e: Event) => {
      const target = e.target;
      if (panelRef.current && target instanceof Node && panelRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const edge = 8;
      // Clamp to the viewport: below 640px the menubar itself is narrow and the
      // panel must not push the document wider than the screen. The height cap
      // keeps a tall help menu inside the window instead of running off-screen.
      const width = Math.min(280, window.innerWidth - edge * 2);
      const top = Math.max(edge, r.bottom + 4);
      setPos({
        top,
        left: Math.max(edge, Math.min(r.left, window.innerWidth - width - edge)),
        width,
        maxHeight: Math.max(80, window.innerHeight - top - edge),
      });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="dropdown menubar-help" ref={boxRef}>
      <button
        ref={btnRef}
        className="btn icon ghost menubar-help-btn"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={S.menu.helpGroup}
        title={S.menu.helpGroup}
      >
        <QuestionMarkIcon />
        <span className="menubar-help-label">{S.menu.helpGroup}</span>
        <ChevronDownIcon className="menubar-help-caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="dropdown-panel help-panel"
            role="menu"
            aria-label={S.menu.helpGroup}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
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

export function MenuBar({
  onOpenShortcuts,
  onOpenTour,
  onOpenWorkflowTour,
  onOpenAbout,
}: {
  onOpenShortcuts: () => void;
  onOpenTour: () => void;
  onOpenWorkflowTour: () => void;
  onOpenAbout: () => void;
}) {
  // Live recents: re-read on the change event (fired by pushRecent / clearRecents),
  // so importing via the canvas dropzone also refreshes the list immediately.
  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents());
  useEffect(() => {
    const refresh = () => setRecents(readRecents());
    window.addEventListener(RECENTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RECENTS_CHANGED_EVENT, refresh);
  }, []);
  const openRecent = (entry: RecentEntry) => void file.actionOpenRecent(entry);
  // Both lists are built by `fileMenu.ts`: every export action
  // is wrapped there, so no handler can receive the click event as an argument.
  const recentItems = buildRecentItems(recents, openRecent, () => clearRecents());
  const fileItems = buildFileMenuItems(recents[0], openRecent);

  const helpItems: DropdownItem[] = [
    { label: S.menu.shortcuts, onClick: onOpenShortcuts, kbd: '⌘?' },
    { label: S.menu.guide, onClick: onOpenTour },
    {
      label: tr(
        '工作流引导：性状 → 假说 → 分析 → 导出',
        'Workflow tour: Characters → Hypotheses → Analysis → Export',
      ),
      onClick: onOpenWorkflowTour,
    },
    { sep: true },
    // In-app feedback channel: the manual said "file an issue" without a URL,
    // so a stuck user had no path back to the author. The URL is copied to the
    // clipboard (the webview cannot open a browser without an extra plugin).
    {
      label: S.review.reportIssue,
      onClick: () => {
        const url = 'https://github.com/zengzichao/CladeForge/issues/new?template=bug_report.md';
        void import('../io/clipboardIO').then(({ writeClipboardText }) =>
          writeClipboardText(url),
        );
        notify.info(
          tr(
            `问题反馈地址已复制：${url}`,
            `Issue-report URL copied: ${url}`,
          ),
        );
      },
    },
    { sep: true },
    { label: S.menu.about, onClick: onOpenAbout },
  ];

  return (
    // data-tauri-drag-region: Tauri only starts a window drag when the mousedown
    // TARGET itself carries the attribute, so the menubar's own blank stretches
    // (brand row, gaps between groups) drag the window while the Dropdown /
    // HelpMenu buttons — children without the attribute — keep opening menus.
    <div className="menubar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="dot" />
        <span className="brand-name">{S.app.name}</span>
      </div>

      <div className="group">
        <Dropdown label={S.menu.fileGroup} items={fileItems} />
        <Dropdown label={S.menu.recent} items={recentItems} />
      </div>

      <div className="group">
        <HelpMenu items={helpItems} />
      </div>
    </div>
  );
}
