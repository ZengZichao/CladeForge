// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Preferences PAGE: language, theme, UI scale and the undo-history limit.
// 用户反馈: the CVD mode, diagnostics copy and restore-confirmation-prompts
// entries were removed together with their functionality; the undo-limit
// consumption note is gone too.
//
// 2026-11 design review: the compact segmented-button dialog became a full-page
// settings surface — one row per setting, name and explanation on the left,
// a single small control on the right, group headings, and the destructive
// action alone at the bottom. The page replaces the workspace in place (no
// outer card) and keeps the modal contract: focus trap, Escape, focus return.
//
// BUG-10 caps the header at ten clickable targets. The two segmented controls
// that used to live in the header cost five of them (中, EN, light, dark,
// system) while being low-frequency chrome; they now live in one entry that
// keeps the same behaviour — same i18n swap, same persisted theme choice (see
// ui/theme.ts and ui/i18n.ts), same live "system" tracking while the OS
// preference changes.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  Cross2Icon,
  GearIcon,
  MinusIcon,
  PlusIcon,
} from '@radix-ui/react-icons';
import { changeLanguage, useLanguagePref } from './i18n';
import { setTheme, storedTheme, type Theme } from './theme';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';
import { usePresence } from './motion';

const UI_SCALE_KEY = 'cladeforge:uiScale';
// Small, precise range: 85 %–160 % in 5 % steps (the stepper's domain).
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.05;

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
  // The layout viewport does NOT shrink with `zoom`, so media queries cannot
  // see that the effective width has dropped (at 130% a 1440 px window lays
  // out as ~1108 px of content space). Tell the shell to re-evaluate.
  window.dispatchEvent(new CustomEvent('cladeforge:ui-scale-change', { detail: scale }));
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
  // Stepper clicks can arrive faster than React commits; read the committed
  // value from a ref so two quick presses advance two steps, not one.
  const scaleRef = useRef(uiScale);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (onOpenChange) onOpenChange(value);
    else setInternalOpen(value);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  // M2: the dialog contract — focus trap + Escape + focus return. A full-page
  // surface needs no trigger positioning math, which also retires the old S02
  // zoom-space conversion.
  const dialogRef = useDialogFocus(open, () => setOpen(false));
  const btnRef = useRef<HTMLButtonElement>(null);
  // The settings page leaves with a short fade/scale/blur instead of vanishing
  // between frames; reopening mid-exit reverses it in place.
  const presence = usePresence(open);

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
    scaleRef.current = value;
    setUiScaleState(value);
    applyUiScale(value);
    try {
      localStorage.setItem(UI_SCALE_KEY, String(value));
    } catch {
      /* storage unavailable — session-only */
    }
  };

  /** Nudge the scale by one step, clamped to the supported range. */
  const stepUiScale = (dir: 1 | -1) => {
    const next = Math.round((scaleRef.current + dir * SCALE_STEP) * 100) / 100;
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next));
    if (clamped !== scaleRef.current) chooseUiScale(clamped);
  };

  const clearLocalData = () => {
    // GUI-B BUG-04: this used to close Preferences FIRST and then open the
    // confirm, so cancelling dropped the user back on the canvas with all the
    // other settings unreachable. Keep Preferences open: the confirm carries
    // its own higher backdrop layer (.confirm-backdrop) so it still stacks
    // above this portalled dialog, and useDialogFocus arbitrates Escape/focus
    // through the dialog stack. Close Preferences only on the confirming path.
    requestConfirm({
      key: 'clear-local-data',
      title: S.review.clearLocalData,
      message: S.review.clearLocalDataConfirm,
      confirmLabel: S.review.clearLocalData,
      danger: true,
      onConfirm: () => {
        setOpen(false);
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
      {/* Full-page settings surface. It still owns the modal contract (focus
          trap, Escape, focus return) but paints as a page, not a card: no
          border, radius or shadow of its own. */}
      {presence.mounted &&
        createPortal(
          <div
            className="dialog-backdrop prefs-backdrop"
            data-state={presence.state}
            onMouseDown={() => setOpen(false)}
          >
            <div
              ref={dialogRef}
              className="dialog prefs-dialog"
              data-state={presence.state}
              role="dialog"
              aria-modal="true"
              aria-label={tr('偏好设置', 'Preferences')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="prefs-page-header">
                <div className="prefs-page-header-inner">
                  <h2>{tr('偏好设置', 'Preferences')}</h2>
                  <button
                    className="btn icon ghost prefs-close"
                    aria-label={S.shortcuts.close}
                    title={S.shortcuts.close}
                    onClick={() => setOpen(false)}
                  >
                    <Cross2Icon />
                  </button>
                </div>
              </header>

              <div className="prefs-page-body">
                <div className="prefs-page-inner">
                  {/* --- Language ------------------------------------------- */}
                  <section className="prefs-group" aria-labelledby="prefs-group-language">
                    <h3 id="prefs-group-language" className="prefs-group-title">
                      {S.lang.label}
                    </h3>
                    <div className="prefs-row">
                      <div className="prefs-row-label">
                        <span className="prefs-label">{tr('界面语言', 'Interface language')}</span>
                        <span className="prefs-desc">
                          {tr('切换后界面立即更新，打开中的文档保持不动。', 'The interface updates immediately; open documents are untouched.')}
                        </span>
                      </div>
                      <div className="prefs-row-control">
                        {/* Three options, one choice: a menu is the smallest control
                            that shows the current value without a row of tabs. */}
                        <select
                          className="prefs-select"
                          data-autofocus
                          aria-label={tr('界面语言', 'Interface language')}
                          value={langPref}
                          onChange={(e) =>
                            chooseLanguage(e.target.value as 'zh' | 'en' | 'system')
                          }
                        >
                          <option value="zh">中文</option>
                          <option value="en">English</option>
                          <option value="system">{S.lang.system}</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* --- Appearance ----------------------------------------- */}
                  <section className="prefs-group" aria-labelledby="prefs-group-appearance">
                    <h3 id="prefs-group-appearance" className="prefs-group-title">
                      {tr('外观', 'Appearance')}
                    </h3>
                    <div className="prefs-row">
                      <div className="prefs-row-label">
                        <span className="prefs-label">{S.theme.label}</span>
                        <span className="prefs-desc">
                          {tr('跟随系统会随操作系统的明暗设置切换。', 'Follow system tracks the operating system light or dark setting.')}
                        </span>
                      </div>
                      <div className="prefs-row-control">
                        <select
                          className="prefs-select"
                          aria-label={S.theme.label}
                          value={pref}
                          onChange={(e) => chooseTheme(e.target.value as Theme)}
                        >
                          <option value="light">{S.theme.light}</option>
                          <option value="dark">{S.theme.dark}</option>
                          <option value="system">{S.theme.system}</option>
                        </select>
                      </div>
                    </div>
                    <div className="prefs-row">
                      <div className="prefs-row-label">
                        <span className="prefs-label">{S.review.preferencesUiScale}</span>
                        <span className="prefs-desc">
                          {tr('同时放大文字、控件与点击区域。', 'Scales text, controls and hit targets together.')}
                        </span>
                      </div>
                      <div className="prefs-row-control">
                        {/* A bounded numeric setting: a stepper is more precise
                            than a slider and needs no popup to read the value. */}
                        <div
                          className="prefs-stepper"
                          role="group"
                          aria-label={S.review.preferencesUiScale}
                        >
                          <button
                            type="button"
                            className="prefs-step-btn"
                            aria-label={tr('减小界面缩放', 'Decrease interface scale')}
                            disabled={uiScale <= SCALE_MIN + 1e-6}
                            onClick={() => stepUiScale(-1)}
                          >
                            <MinusIcon />
                          </button>
                          <span className="prefs-step-value" aria-live="polite">
                            {Math.round(uiScale * 100)}%
                          </span>
                          <button
                            type="button"
                            className="prefs-step-btn"
                            aria-label={tr('增大界面缩放', 'Increase interface scale')}
                            disabled={uiScale >= SCALE_MAX - 1e-6}
                            onClick={() => stepUiScale(1)}
                          >
                            <PlusIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* --- Editing -------------------------------------------- */}
                  <section className="prefs-group" aria-labelledby="prefs-group-editing">
                    <h3 id="prefs-group-editing" className="prefs-group-title">
                      {tr('编辑', 'Editing')}
                    </h3>
                    <div className="prefs-row">
                      <div className="prefs-row-label">
                        <span className="prefs-label">{tr('撤销步数上限', 'Undo history limit')}</span>
                        <span className="prefs-desc">
                          {tr('更大的上限占用更多内存，适合超长编辑。', 'A larger limit uses more memory; useful for very long sessions.')}
                        </span>
                      </div>
                      <div className="prefs-row-control">
                        <select
                          className="prefs-select"
                          aria-label={tr('撤销步数上限', 'Undo history limit')}
                          value={String(historyLimit)}
                          onChange={(e) =>
                            useStore.getState().setHistoryLimit(Number(e.target.value))
                          }
                        >
                          {[100, 300, 1000].map((v) => (
                            <option key={v} value={v}>
                              {v === 100 ? tr('100 步', '100 steps') : tr(`${v} 步`, `${v} steps`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* --- Data (destructive, away from everyday settings) ----- */}
                  <section className="prefs-group prefs-group-danger" aria-labelledby="prefs-group-data">
                    <h3 id="prefs-group-data" className="prefs-group-title">
                      {tr('数据', 'Data')}
                    </h3>
                    <div className="prefs-row">
                      <div className="prefs-row-label">
                        <span className="prefs-label">{S.review.clearLocalData}</span>
                        <span className="prefs-desc">
                          {tr('清除本地恢复区与偏好设置；磁盘上的项目文件不受影响。', 'Clears the local recovery area and preferences; project files on disk are untouched.')}
                        </span>
                      </div>
                      <div className="prefs-row-control">
                        <button className="btn prefs-reset-btn" onClick={clearLocalData}>
                          {S.review.clearLocalData}
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
