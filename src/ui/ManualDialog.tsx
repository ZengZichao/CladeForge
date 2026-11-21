// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// In-app user manual reader (S18, UI_UX_REVIEW 2026-11-15 / Sonus S18).
//
// The manual used to render as RAW TEXT in a <pre> — readers saw HTML comments,
// `#` marks and table pipes. It now renders through the safe Markdown renderer
// (`markdown.tsx`: React elements only, no dangerouslySetInnerHTML) with a
// clickable table of contents, so "how do I set a time calibration" lands on
// the right section without scrolling the whole document.

import { useMemo, useRef, useState } from 'react';
import manualZh from '../../docs/MANUAL_ZH.md?raw';
import manualEn from '../../docs/MANUAL_EN.md?raw';
import { useLanguage } from './i18n';
import { useDialogFocus } from './useDialogFocus';
import { parseMarkdown, renderBlocks, tocOf } from './markdown';
import { S, tr } from './strings';
import { usePresence } from './motion';

export function ManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useLanguage();
  const ref = useDialogFocus(open, onClose);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tocOpen, setTocOpen] = useState(true);
  // The manual document is static per language — parse once per language.
  const { blocks, toc } = useMemo(() => {
    const text = lang === 'en' ? manualEn : manualZh;
    const blocks = parseMarkdown(text);
    return { blocks, toc: tocOf(blocks) };
  }, [lang]);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  const jumpTo = (id: string) => {
    const el = bodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog manual-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.menu.manual}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.menu.manual}</h2>
        <div className="manual-toolbar">
          <button className="btn tiny" aria-expanded={tocOpen} onClick={() => setTocOpen((o) => !o)}>
            {tr('目录', 'Contents')}
          </button>
        </div>
        {tocOpen && toc.length > 0 && (
          <nav className="manual-toc" aria-label={tr('手册目录', 'Manual contents')}>
            {toc.map((t) => (
              <button key={t.id} className="manual-toc-item" onClick={() => jumpTo(t.id)}>
                {t.text}
              </button>
            ))}
        </nav>
        )}
        {/* S18: rendered markdown — real headings, lists, tables, links. */}
        <div className="manual-body" ref={bodyRef}>
          {renderBlocks(blocks)}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}

export function manualLabel(): string {
  return tr('用户手册', 'User manual');
}
