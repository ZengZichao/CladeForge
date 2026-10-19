// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Preferences dropdown: language (中 / EN) and theme (Light / Dark / System)
// consolidated into ONE header target.
//
// BUG-10 caps the header at ten clickable targets. The two segmented controls
// that used to live here cost five of them (中, EN, light, dark, system) while
// being low-frequency chrome; they move into one menu that keeps the exact same
// behaviour — same i18n swap, same persisted theme choice (see ui/theme.ts and
// ui/i18n.ts), same live "system" tracking while the OS preference changes.
//
// The panel is portalled to <body> with fixed positioning and right-aligned to
// the trigger: this menu opens from the right edge of the toolbar, where the
// left-aligned flyout used by the file menu would run off the viewport.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  GearIcon,
  LaptopIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { changeLanguage, useLanguage } from './i18n';
import { setTheme, storedTheme, type Theme } from './theme';
import { S, tr } from './strings';

/** Panel width, also used to keep the right-aligned flyout inside the viewport. */
const PANEL_WIDTH = 208;

interface ThemeOption {
  value: Theme;
  icon: ReactNode;
  label: string;
}

export function PreferencesMenu() {
  const lang = useLanguage();
  const [pref, setPref] = useState<Theme>(storedTheme);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Track OS changes so the "system" row's active state stays honest even
  // without reopening the menu (same rule as the old ThemeToggle).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPref(storedTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Close on outside click, any scrollable ancestor scrolling, resize or Escape
  // — the same dismissal contract the file/recent dropdowns implement.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onDismiss = () => setOpen(false);
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
      setPos({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
      });
    }
    setOpen((o) => !o);
  };

  const chooseTheme = (value: Theme) => {
    setTheme(value);
    setPref(value);
    setOpen(false);
  };

  const chooseLanguage = (value: 'zh' | 'en') => {
    setOpen(false);
    changeLanguage(value);
  };

  const themeOptions: ThemeOption[] = [
    { value: 'light', icon: <SunIcon />, label: S.theme.light },
    { value: 'dark', icon: <MoonIcon />, label: S.theme.dark },
    { value: 'system', icon: <LaptopIcon />, label: S.theme.system },
  ];

  return (
    <div className="dropdown prefs-menu" ref={boxRef}>
      <button
        ref={btnRef}
        className="btn prefs-trigger"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tr('偏好设置：语言与主题', 'Preferences: language and theme')}
        title={tr('偏好设置：语言与主题', 'Preferences: language and theme')}
      >
        <GearIcon />
        <span className="prefs-trigger-label">{tr('偏好', 'Preferences')}</span>
        <ChevronDownIcon className="prefs-caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="dropdown-panel prefs-panel"
            role="menu"
            aria-label={tr('偏好设置', 'Preferences')}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="menu-section-label">{S.lang.label}</div>
            <button
              className="menu-item prefs-item"
              role="menuitemradio"
              aria-checked={lang === 'zh'}
              onClick={() => chooseLanguage('zh')}
            >
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true">{lang === 'zh' ? '✓' : ''}</span>
                <span>中文</span>
              </span>
            </button>
            <button
              className="menu-item prefs-item"
              role="menuitemradio"
              aria-checked={lang === 'en'}
              onClick={() => chooseLanguage('en')}
            >
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true">{lang === 'en' ? '✓' : ''}</span>
                <span>English</span>
              </span>
            </button>
            <div className="menu-sep" />
            <div className="menu-section-label">{S.theme.label}</div>
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                className="menu-item prefs-item"
                role="menuitemradio"
                aria-checked={pref === opt.value}
                onClick={() => chooseTheme(opt.value)}
              >
                <span className="prefs-item-label">
                  <span className="prefs-check" aria-hidden="true">{pref === opt.value ? '✓' : ''}</span>
                  <span className="prefs-item-icon">{opt.icon}</span>
                  <span>{opt.label}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
