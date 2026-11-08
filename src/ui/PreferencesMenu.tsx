// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Preferences dropdown: language, theme, UI scale, colour-vision-friendly
// badges, diagnostics and local-data controls, consolidated into ONE target.
//
// A "preferences" entry that only switched appearance was an appearance
// switcher; the settings that actually shape a session live here now:
//   * UI scale (interface chrome zoom — the 11px baseline is small on 4K);
//   * CVD-friendly badges (force shape+code emphasis on event markers);
//   * copy diagnostics (version / platform / doc stats for bug reports);
//   * clear local data (autosave / recents / prefs), with confirmation.
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
import { APP_VERSION } from '../model/types';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';
import { writeClipboardText } from '../io/clipboardIO';

const UI_SCALE_KEY = 'cladeforge:uiScale';
const CVD_MODE_KEY = 'cladeforge:cvdMode';

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

function storedCvdMode(): boolean {
  try {
    return localStorage.getItem(CVD_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

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
  const [uiScale, setUiScaleState] = useState<number>(storedUiScale);
  const [cvd, setCvd] = useState<boolean>(storedCvdMode);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Track OS changes so the "system" row's active state stays honest even
  // without reopening the menu (same rule as the old ThemeToggle).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPref(storedTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Restore the stored UI scale + CVD flag on mount.
  useEffect(() => {
    applyUiScale(storedUiScale());
    if (storedCvdMode()) {
      (window as unknown as Record<string, unknown>).__cladeforgeCvd = true;
      document.documentElement.dataset.cvdMode = '1';
    }
  }, []);

  // Close on outside click, any scrollable ancestor scrolling, resize or Escape
  // — the same dismissal contract the file/recent dropdowns implement.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // The panel scrolls internally (max-height in app.css). Its own scroll must
    // not dismiss it — only a scroll elsewhere would drift the fixed panel away
    // from its trigger.
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

  const chooseUiScale = (value: number) => {
    setUiScaleState(value);
    applyUiScale(value);
    try {
      localStorage.setItem(UI_SCALE_KEY, String(value));
    } catch {
      /* storage unavailable — session-only */
    }
  };

  const chooseCvd = (value: boolean) => {
    setCvd(value);
    try {
      localStorage.setItem(CVD_MODE_KEY, value ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    // The flag is read by the event layers / exporter through the store-agnostic
    // global so badge rendering can respond without threading a prop everywhere.
    (window as unknown as Record<string, unknown>).__cladeforgeCvd = value;
    document.documentElement.dataset.cvdMode = value ? '1' : '';
    setOpen(false);
  };

  const copyDiagnostics = () => {
    const st = (window as unknown as { __cladeforge?: { useStore: { getState: () => { project: { nodes: Record<string, unknown>; characters: unknown[]; events: unknown[]; geneTrees?: unknown[] } } } } }).__cladeforge?.useStore.getState();
    const docStats = st
      ? `nodes=${Object.keys(st.project.nodes).length}, characters=${st.project.characters.length}, events=${st.project.events.length}, geneTrees=${st.project.geneTrees?.length ?? 0}`
      : 'store unavailable';
    const text = [
      `CladeForge ${APP_VERSION}`,
      `ua: ${navigator.userAgent}`,
      `lang: ${lang}`,
      `doc: ${docStats}`,
      `time: ${new Date().toISOString()}`,
    ].join('\n');
    void writeClipboardText(text).then((ok) =>
      notify.success(ok ? S.review.diagnosticsCopied : text),
    );
    setOpen(false);
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

  // P0-15 / U-41: “Don't ask again” is stored permanently, so Preferences must
  // offer a way back. Clearing the skip keys re-enables every confirmation.
  const restoreConfirmPrompts = () => {
    setOpen(false);
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('cladeforge:confirm:skip:')) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* storage already broken */
    }
    notify.success(S.review.restoredConfirmPrompts);
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
        aria-label={tr('偏好设置', 'Preferences')}
        title={tr('偏好设置', 'Preferences')}
      >
        <GearIcon />
        <span className="prefs-trigger-label">{tr('偏好', 'Preferences')}</span>
        <ChevronDownIcon className="prefs-caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="dropdown-panel prefs-panel"
            role="menu"
            aria-label={tr('偏好设置', 'Preferences')}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: PANEL_WIDTH,
              // max-content keeps long English labels (the 54-char workflow-tour
              // entry) on one line instead of wrapping mid-phrase.
              width: 'max-content',
              maxWidth: Math.min(360, window.innerWidth - pos.left - 8),
            }}
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
            <div className="menu-sep" />
            <div className="menu-section-label">{S.review.preferencesUiScale}</div>
            {[1, 1.15, 1.3].map((v) => (
              <button
                key={v}
                className="menu-item prefs-item"
                role="menuitemradio"
                aria-checked={Math.abs(uiScale - v) < 0.01}
                onClick={() => chooseUiScale(v)}
              >
                <span className="prefs-item-label">
                  <span className="prefs-check" aria-hidden="true">
                    {Math.abs(uiScale - v) < 0.01 ? '✓' : ''}
                  </span>
                  <span>
                    {v === 1 ? tr('标准 100%', 'Standard 100%') : `${Math.round(v * 100)}%`}
                  </span>
                </span>
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item prefs-item"
              role="menuitemcheckbox"
              aria-checked={cvd}
              onClick={() => chooseCvd(!cvd)}
            >
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true">{cvd ? '✓' : ''}</span>
                <span>{S.review.cvdMode}</span>
              </span>
            </button>
            <div className="menu-sep" />
            <button className="menu-item prefs-item" onClick={copyDiagnostics}>
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true" />
                <span>{S.review.diagnosticsCopy}</span>
              </span>
            </button>
            <button className="menu-item prefs-item" onClick={restoreConfirmPrompts}>
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true" />
                <span>{S.review.restoreConfirmPrompts}</span>
              </span>
            </button>
            <button className="menu-item prefs-item" onClick={clearLocalData} style={{ color: 'var(--danger)' }}>
              <span className="prefs-item-label">
                <span className="prefs-check" aria-hidden="true" />
                <span>{S.review.clearLocalData}</span>
              </span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
