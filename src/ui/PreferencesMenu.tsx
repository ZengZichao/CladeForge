// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Preferences dialog: language, theme, UI scale and the undo-history limit.
// 用户反馈: the CVD mode, diagnostics copy and restore-confirmation-prompts
// entries were removed together with their functionality; the undo-limit
// consumption note is gone too.
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
import { useStore } from '../model/store';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  GearIcon,
  LaptopIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { changeLanguage, useLanguagePref } from './i18n';
import { setTheme, storedTheme, type Theme } from './theme';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';

const UI_SCALE_KEY = 'cladeforge:uiScale';

function storedUiScale(): number {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    return Number.isFinite(v) && v >= 0.85 && v <= 1.6 ? v : 1;
  } catch {
    return 1;
  }
}

function applyUiScale(scale: number): void {
  // `zoom` scales the chrome including hit targets; tree typography is
  // unaffected (the canvas computes its own sizes).
  document.documentElement.style.setProperty('zoom', String(scale));
}

interface ThemeOption {
  value: Theme;
  icon: ReactNode;
  label: string;
}

export function PreferencesMenu({
  open: openProp,
  onOpenChange,
}: {
  /** Controlled open state. App supplies it so the dialog survives the locale
   *  switch (the app subtree remounts on `key={lang}`); standalone mounts fall
   *  back to internal state. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
} = {}) {
  const langPref = useLanguagePref();
  const historyLimit = useStore((s) => s.historyLimit);
  const [pref, setPref] = useState<Theme>(storedTheme);
  const [uiScale, setUiScaleState] = useState<number>(storedUiScale);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (onOpenChange) onOpenChange(value);
    else setInternalOpen(value);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  // M2: the dialog contract — focus trap + Escape + focus return (replaces the
  // flyout's hand-rolled dismissal listeners; a centered dialog needs no
  // positioning math, which also retires the S02 zoom-space conversion).
  const dialogRef = useDialogFocus(open, () => setOpen(false));
  const btnRef = useRef<HTMLButtonElement>(null);

  // Track OS changes so the "system" row's active state stays honest even
  // without reopening the menu (same rule as the former toggle components).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPref(storedTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Restore the stored UI scale on mount.
  useEffect(() => {
    applyUiScale(storedUiScale());
  }, []);

  const toggle = () => setOpen((o) => !o);

  const chooseTheme = (value: Theme) => {
    setTheme(value);
    setPref(value);
    // M2: inside a dialog, a theme switch keeps the dialog open so the user
    // sees the effect and can undo a wrong pick in place.
    setOpen(true);
  };

  const chooseLanguage = (value: 'zh' | 'en' | 'system') => {
    // P-03: switching language relabels the dialog in place; it must NOT close
    // (theme / UI scale / undo limit all stay open, and users often change
    // several preferences in one visit). The open state lives in App, so the
    // `key={lang}` remount of the workspace subtree cannot lose it either.
    changeLanguage(value);
  };

  const chooseUiScale = (value: number) => {
    setUiScaleState(value);
    applyUiScale(value);
    try {
      localStorage.setItem(UI_SCALE_KEY, String(value));
    } catch {
      /* storage unavailable — session-only */
    }
  };

  const clearLocalData = () => {
    setOpen(false);
    requestConfirm({
      key: 'clear-local-data',
      title: S.review.clearLocalData,
      message: S.review.clearLocalDataConfirm,
      confirmLabel: S.review.clearLocalData,
      danger: true,
      onConfirm: () => {
        try {
          const keepTheme = localStorage.getItem('cladeforge:theme');
          localStorage.clear();
          if (keepTheme) localStorage.setItem('cladeforge:theme', keepTheme);
        } catch {
          /* storage already broken */
        }
        notify.success(S.review.clearedLocalData);
      },
    });
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
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tr('偏好设置', 'Preferences')}
        title={tr('偏好设置', 'Preferences')}
      >
        <GearIcon />
        <span className="prefs-trigger-label">{tr('偏好', 'Preferences')}</span>
        <ChevronDownIcon className="prefs-caret" />
      </button>
      {/* M2 (UI_UX_REVIEW): a 12-radio + destructive-action settings page is a
          DIALOG, not a dropdown — the flyout scrolled 896px of content in a
          420px window and anchored off-screen at 130% zoom. The centered dialog
          gives the real modal contract (focus trap, Escape, backdrop dismiss)
          and the widest layout the content needs. */}
      {open &&
        createPortal(
          <div className="dialog-backdrop" onMouseDown={() => setOpen(false)}>
            <div
              ref={dialogRef}
              className="dialog prefs-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={tr('偏好设置', 'Preferences')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2>{tr('偏好设置', 'Preferences')}</h2>
              {/* 用户反馈：each group is a rounded segmented BUTTON ROW — equal
                  size, equal weight, comparable label lengths — instead of one
                  full-width row per option with a check glyph. */}
              <div className="menu-section-label">{S.lang.label}</div>
              {/* 用户反馈: 跟随系统 joins 中文 / English — the stored preference
                  may be 'system', resolved against the OS locale. */}
              <div className="prefs-seg-group" role="radiogroup" aria-label={S.lang.label}>
                <button
                  className={`prefs-seg${langPref === 'zh' ? ' active' : ''}`}
                  role="radio"
                  aria-checked={langPref === 'zh'}
                  onClick={() => chooseLanguage('zh')}
                >
                  中文
                </button>
                <button
                  className={`prefs-seg${langPref === 'en' ? ' active' : ''}`}
                  role="radio"
                  aria-checked={langPref === 'en'}
                  onClick={() => chooseLanguage('en')}
                >
                  English
                </button>
                <button
                  className={`prefs-seg${langPref === 'system' ? ' active' : ''}`}
                  role="radio"
                  aria-checked={langPref === 'system'}
                  onClick={() => chooseLanguage('system')}
                >
                  {S.lang.system}
                </button>
              </div>
              <div className="menu-section-label">{S.theme.label}</div>
              <div className="prefs-seg-group" role="radiogroup" aria-label={S.theme.label}>
                {themeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={`prefs-seg${pref === opt.value ? ' active' : ''}`}
                    role="radio"
                    aria-checked={pref === opt.value}
                    onClick={() => chooseTheme(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="menu-section-label">{S.review.preferencesUiScale}</div>
              <div className="prefs-seg-group" role="radiogroup" aria-label={S.review.preferencesUiScale}>
                {[1, 1.15, 1.3].map((v) => (
                  <button
                    key={v}
                    className={`prefs-seg${Math.abs(uiScale - v) < 0.01 ? ' active' : ''}`}
                    role="radio"
                    aria-checked={Math.abs(uiScale - v) < 0.01}
                    onClick={() => chooseUiScale(v)}
                  >
                    {v === 1 ? tr('100%', '100%') : `${Math.round(v * 100)}%`}
                  </button>
                ))}
              </div>
            <div className="menu-section-label">{tr('撤销步数上限', 'Undo history limit')}</div>
            <div className="prefs-seg-group" role="radiogroup" aria-label={tr('撤销步数上限', 'Undo history limit')}>
              {[100, 300, 1000].map((v) => (
                <button
                  key={v}
                  className={`prefs-seg${historyLimit === v ? ' active' : ''}`}
                  role="radio"
                  aria-checked={historyLimit === v}
                  title={
                    v === 100
                      ? tr('默认', 'Default')
                      : tr('更大内存占用，适合超长编辑', 'More memory, for very long sessions')
                  }
                  onClick={() => useStore.getState().setHistoryLimit(v)}
                >
                  {v === 100 ? tr('100 步', '100 steps') : tr(`${v} 步`, `${v} steps`)}
                </button>
              ))}
            </div>
            <div className="menu-sep" />
            {/* 用户反馈: a long rounded rectangle wrapping the destructive row. */}
            <button className="menu-item prefs-item prefs-reset-btn" onClick={clearLocalData} style={{ color: 'var(--danger)' }}>
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true" />
                <span>{S.review.clearLocalData}</span>
              </span>
            </button>
              <div className="actions">
                <button className="btn primary" onClick={() => setOpen(false)}>
                  {S.shortcuts.close}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
