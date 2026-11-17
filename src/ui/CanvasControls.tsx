// Floating on-canvas control cluster.
//
// Offers the common view actions — zoom in / out, jump back to 100%, fit the
// whole tree — plus the node SEARCH field (it belongs to the canvas view, which
// keeps the left column purely content-modules). The input keeps
// id="node-search-input" because the global ⌘F shortcut focuses it by id.

import { useEffect, useMemo, useState } from 'react';
import { FrameIcon, MagnifyingGlassIcon, PlusIcon, MinusIcon, Crosshair2Icon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { isImeComposing } from './imeGuard';
import { S, tr } from './strings';

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
        aria-label={S.canvasControls.searchAria}
        value={q}
        placeholder={S.toolbar.searchPlaceholder}
        // BUG-03 (canvas half): the box filters live and shows a match count,
        // but nothing said that Enter is what JUMPS to the hit — a user typed a
        // name, saw a count, and had no cue that the selection would follow.
        title={tr(
          '输入即实时筛选；按 Enter 定位匹配节点（type:leaf 只搜末端）',
          'Filters live as you type; press Enter to jump to a match (type:leaf searches tips only)',
        )}
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
  // S24: the zoom-to-selection entry only appears with something selected.
  const selectionCount = useStore((s) => s.selection.length);
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
        className="cc-btn"
        title={S.canvasControls.zoomInTitle}
        aria-label={S.canvasControls.zoomInTitle}
        onClick={() => zoomBy(1.2)}
      >
        <PlusIcon />
      </button>
      {/* Icon-only "fit" (mature canvas-tool convention); the word stays in the
          tooltip and the accessible name, the glyph stays consistent with the
          neighbouring +/-/search icons. */}
      <button
        className="cc-btn"
        title={S.canvasControls.fitTitle}
        aria-label={S.canvasControls.fitTitle}
        onClick={() => requestFit()}
      >
        <FrameIcon />
      </button>
      {/* S24 (Sonus): the overview→detail path must be discoverable ON the
          canvas, not only in the palette. With a selection (a found node, a
          picked clade) this zooms into it; dense trees navigate local↔global
          through search → this button → ⌘0 back to the overview. */}
      {selectionCount > 0 && (
        <button
          className="cc-btn"
          title={tr('缩放到选区（在密集树中定位局部）', 'Zoom to selection (locate a region in a dense tree)')}
          aria-label={S.cmd.zoomSelection}
          onClick={() => window.dispatchEvent(new CustomEvent('cladeforge:fit-selection'))}
        >
          <Crosshair2Icon />
        </button>
      )}
      <span className="cc-sep" />
      {searchOpen && <NodeSearch />}
      <button
        className="cc-btn"
        title={S.toolbar.searchPlaceholder}
        aria-label={S.canvasControls.searchAria}
        onClick={() => setSearchOpen((o) => !o)}
      >
        <MagnifyingGlassIcon />
      </button>
    </div>
  );
}
