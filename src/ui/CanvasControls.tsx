// Floating on-canvas control cluster.
//
// Offers the common view actions — zoom in / out, jump back to 100%, fit the
// whole tree — plus the node SEARCH field (it belongs to the canvas view, which
// keeps the left column purely content-modules). The input keeps
// id="node-search-input" because the global ⌘F shortcut focuses it by id.

import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, MinusIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { isImeComposing } from './imeGuard';
import { S } from './strings';

function NodeSearch() {
  const nodes = useStore((s) => s.project.nodes);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);
  const [q, setQ] = useState('');
  const [next, setNext] = useState(0);

  // Supports `type:leaf` / `type:internal` filters alongside label matching.
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [] as string[];
    let typeFilter: 'leaf' | 'internal' | null = null;
    let labelText = t;
    const typeMatch = /^type:(leaf|internal)\s*(.*)$/.exec(t);
    if (typeMatch) {
      typeFilter = typeMatch[1] as 'leaf' | 'internal';
      labelText = typeMatch[2].trim();
    }
    return Object.values(nodes)
      .filter((n) => {
        if (typeFilter === 'leaf' && n.childrenIds.length > 0) return false;
        if (typeFilter === 'internal' && n.childrenIds.length === 0) return false;
        if (!labelText) return true;
        return (n.label || '').toLowerCase().includes(labelText);
      })
      .map((n) => n.id);
  }, [q, nodes]);

  const focusAt = (i: number) => {
    if (!matches.length) return;
    const k = ((i % matches.length) + matches.length) % matches.length;
    select(matches[k]);
    focusNode(matches[k]);
    setNext(k + 1);
  };
  return (
    <>
      <input
        id="node-search-input"
        className="cc-search-input"
        value={q}
        placeholder={S.toolbar.searchPlaceholder}
        onChange={(e) => {
          setQ(e.target.value);
          setNext(0);
        }}
        onKeyDown={(e) => {
          // While a Pinyin candidate list is open, Enter / Escape belong to the
          // IME: without the guard the search jumps to a node or closes the box
          // mid-composition.
          if (isImeComposing(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            focusAt(next);
          } else if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
      />
      {matches.length > 0 && <span className="search-count">{matches.length}</span>}
    </>
  );
}

export function CanvasControls() {
  const zoomBy = useStore((s) => s.zoomBy);
  const requestFit = useStore((s) => s.requestFit);
  const scale = useStore((s) => s.view.scale);
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘F dispatches a custom event so we open the search input (if closed)
  // and focus it — focusing it directly would silently miss an input that
  // is not rendered yet.
  useEffect(() => {
    const onFocusSearch = () => {
      setSearchOpen(true);
      // Defer focus to the next frame so the input has time to mount.
      requestAnimationFrame(() => {
        document.getElementById('node-search-input')?.focus();
      });
    };
    window.addEventListener('cladeforge:focus-search', onFocusSearch);
    return () => window.removeEventListener('cladeforge:focus-search', onFocusSearch);
  }, []);

  return (
    <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cc-row">
        {searchOpen && <NodeSearch />}
        <button
          className="cc-btn"
          title={S.toolbar.searchPlaceholder}
          aria-label={S.toolbar.searchPlaceholder}
          onClick={() => setSearchOpen((o) => !o)}
        >
          <MagnifyingGlassIcon />
        </button>
      </div>
      <div className="cc-row">
        <button
          className="cc-btn"
          title={S.canvasControls.zoomInTitle}
          aria-label={S.canvasControls.zoomInTitle}
          onClick={() => zoomBy(1.2)}
        >
          <PlusIcon />
        </button>
        <button
          className="cc-btn"
          title={S.canvasControls.zoomOutTitle}
          aria-label={S.canvasControls.zoomOutTitle}
          onClick={() => zoomBy(1 / 1.2)}
        >
          <MinusIcon />
        </button>
        <button
          className="cc-btn cc-zoom"
          title={S.canvasControls.actualSizeTitle}
          aria-label={S.canvasControls.actualSizeTitle}
          onClick={() => zoomBy(1 / scale)}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          className="cc-btn cc-wide"
          title={S.canvasControls.fitTitle}
          aria-label={S.canvasControls.fitTitle}
          onClick={requestFit}
        >
          {S.canvasControls.fit}
        </button>
      </div>
    </div>
  );
}
