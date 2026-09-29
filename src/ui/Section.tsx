// Collapsible panel section with localStorage persistence, visual
// open/closed state differentiation, search filtering, favorites and a
// "pin open" toggle.
//
// A collapsible stand-in for the plain `.panel-section` + `<h3>` pattern, so
// side-panel groups can be folded away — keeping core controls visible and
// tucking secondary ones out of sight (minimalist progressive disclosure).
//
// Inspector enhancements:
//   - `searchQuery`: when non-empty, a section is auto-expanded and visible
//     only if its title OR its field-level keywords match the query — a query
//     like "颜色" names a field, not a section title, so the title alone is not
//     enough to find it.
//   - `keywords`: extra terms that should match the search (field labels,
//     synonyms). Supplied by the owning panel for each section.
//   - `count`: when given, a small "N 项" badge shows next to the title so
// collapsed sections still hint at their contents.
//   - `favoritable`: when true, a star (★) button appears next to the title.
//     Favorited sections persist to localStorage and can be shown first.
//   - `pinable`: when true, a pushpin button appears next to the title.
//     Pinned sections stay expanded — clicking the header does not collapse
//     them (「固定展开 / 取消固定折叠」).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  StarIcon,
  StarFilledIcon,
  PinLeftIcon,
} from '@radix-ui/react-icons';
import { S, titleKey } from './strings';

const LS_PREFIX = 'cladeforge:section:';
const LS_FAV_PREFIX = 'cladeforge:fav:';
const LS_PIN_PREFIX = 'cladeforge:pin:';

function readStored(key: string, fallback: boolean, legacyKey?: string): boolean {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // Read-side fallback: the same state under the title-hash key.
    if (legacyKey) {
      const legacy = localStorage.getItem(LS_PREFIX + legacyKey);
      if (legacy === 'true') return true;
      if (legacy === 'false') return false;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeStored(key: string, value: boolean) {
  try {
    localStorage.setItem(LS_PREFIX + key, String(value));
  } catch {
    /* ignore */
  }
}

function readFav(key: string): boolean {
  try {
    return localStorage.getItem(LS_FAV_PREFIX + key) === 'true';
  } catch {
    return false;
  }
}

function writeFav(key: string, value: boolean) {
  try {
    localStorage.setItem(LS_FAV_PREFIX + key, String(value));
  } catch {
    /* ignore */
  }
}

function readPin(key: string): boolean {
  try {
    return localStorage.getItem(LS_PIN_PREFIX + key) === 'true';
  } catch {
    return false;
  }
}

function writePin(key: string, value: boolean) {
  try {
    localStorage.setItem(LS_PIN_PREFIX + key, String(value));
  } catch {
    /* ignore */
  }
}

/** Generate a stable ID from a string (the fallback when `id` is not provided). */
function stableId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return 'section:' + Math.abs(h).toString(36);
}

export function Section({
  id: sectionId,
  title,
  children,
  defaultOpen = true,
  searchQuery = '',
  favoritable = false,
  pinable = false,
  keywords,
  count,
}: {
  /** Stable identifier for persistence (language-independent). Falls back to the
   *  catalogue path of `title`, so the state survives a 中/EN switch. Pass an
   *  explicit id whenever two sections share a title. */
  id?: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** When non-empty, section is only shown if title (or keywords) matches and is forced open. */
  searchQuery?: string;
  /** When true, a star toggle is rendered for favoriting. */
  favoritable?: boolean;
  /** When true, a pushpin toggle is rendered; pinned sections stay expanded. */
  pinable?: boolean;
  /** Extra search terms (field labels / synonyms) for the inspector search. */
  keywords?: string[];
  /** When given, shows a "N 项" badge next to the title (incl. when collapsed). */
  count?: number;
}) {
  // Keys are derived from the catalogue PATH of the title, not from the
  // translated text, so switching 中文/English does not silently reset every
  // collapsed / pinned / favourited section. `stableId(title)` is the title-hash
  // fallback read when no path-based key has been written.
  const persistId = sectionId ?? titleKey(title);
  const legacyId = sectionId ? undefined : stableId(title);
  const [open, setOpen] = useState(() => readStored(persistId, defaultOpen, legacyId));
  const [fav, setFav] = useState(() => (favoritable ? readFav(persistId) : false));
  const [pin, setPin] = useState(() => (pinable ? readPin(persistId) : false));
  // Scroll the section into view when a search hit lands on a closed section.
  const ref = useRef<HTMLDivElement | null>(null);

  // Search filtering: match the title AND any field-level keywords.
  const q = searchQuery.trim().toLowerCase();
  const haystack = [title, ...(keywords ?? [])].join(' ').toLowerCase();
  const matchesSearch = !q || haystack.includes(q);
  // A filtered-out section must still run every Hook below before returning:
  // bailing out earlier changes the Hook count between renders, and React throws
  // "Rendered fewer hooks than expected", blanking the whole window.
  const hidden = !!q && !matchesSearch;

  // When searching OR pinned, force the section open.
  const effectiveOpen = q || pin ? true : open;

  // Reveal the section body when the query matches but the section was closed.
  useEffect(() => {
    if (!hidden && q && !open && !pin) {
      const id = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }));
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [q, open, pin, hidden]);

  if (hidden) return null;

  const toggle = () => {
    // Pinned sections ignore collapse clicks — they are fixed expanded.
    if (pin) return;
    const next = !open;
    setOpen(next);
    writeStored(persistId, next);
  };

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    writeFav(persistId, next);
  };

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pin;
    setPin(next);
    writePin(persistId, next);
    // Pinning forces the section open; unpinning keeps the current state.
    if (next) {
      setOpen(true);
      writeStored(persistId, true);
    }
  };

  return (
    <div
      ref={ref}
      className={`panel-section${effectiveOpen ? '' : ' collapsed'}${fav ? ' favorited' : ''}${pin ? ' pinned' : ''}`}
    >
      <div className="section-header-row">
        <button
          type="button"
          className={`section-toggle${effectiveOpen ? ' open' : ''}`}
          aria-expanded={effectiveOpen}
          onClick={toggle}
        >
          {title}
          {count !== undefined && !effectiveOpen && (
            <span className="section-count">{count} {S.section.items}</span>
          )}
        </button>
        {pinable && (
          <button
            type="button"
            className={`section-pin${pin ? ' active' : ''}`}
            onClick={togglePin}
            title={pin ? S.section.unpin : S.section.pin}
            aria-pressed={pin}
            aria-label={pin ? S.section.unpin : S.section.pin}
          >
            <PinLeftIcon style={pin ? { transform: 'rotate(45deg)' } : undefined} />
          </button>
        )}
        {favoritable && (
          <button
            type="button"
            className={`section-fav${fav ? ' active' : ''}`}
            onClick={toggleFav}
            title={fav ? S.section.unfavorite : S.section.favorite}
            aria-pressed={fav}
          >
            {fav ? <StarFilledIcon /> : <StarIcon />}
          </button>
        )}
      </div>
      {effectiveOpen && <div className="section-body">{children}</div>}
    </div>
  );
}

// Higher-level collapsible group: wraps multiple Sections under a bold
// group header with a separator, so a long list of look-alike sections does not
// become one undifferentiated column.
export function GroupSection({
  title,
  children,
  defaultOpen = true,
  pinable = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** When true, a pushpin toggle is rendered; pinned groups stay expanded. */
  pinable?: boolean;
}) {
  // Same locale-independent keying as Section.
  const groupId = `group:${titleKey(title)}`;
  const legacyGroupId = `group:${stableId(title)}`;
  const [open, setOpen] = useState(() => readStored(groupId, defaultOpen, legacyGroupId));
  const [pin, setPin] = useState(() => (pinable ? readPin(groupId) : false));
  const toggle = () => {
    if (pin) return;
    const next = !open;
    setOpen(next);
    writeStored(groupId, next);
  };
  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pin;
    setPin(next);
    writePin(groupId, next);
    if (next) {
      setOpen(true);
      writeStored(groupId, true);
    }
  };
  const effectiveOpen = pin || open;
  return (
    <div className="group-section">
      <div className="group-toggle-row">
        <button
          type="button"
          className={`group-toggle${effectiveOpen ? ' open' : ''}`}
          aria-expanded={effectiveOpen}
          onClick={toggle}
        >
          {title}
        </button>
        {pinable && (
          <button
            type="button"
            className={`group-pin${pin ? ' active' : ''}`}
            onClick={togglePin}
            title={pin ? S.section.unpin : S.section.pin}
            aria-pressed={pin}
            aria-label={pin ? S.section.unpin : S.section.pin}
          >
            <PinLeftIcon style={pin ? { transform: 'rotate(45deg)' } : undefined} />
          </button>
        )}
      </div>
      {effectiveOpen && <div className="group-body">{children}</div>}
    </div>
  );
}
