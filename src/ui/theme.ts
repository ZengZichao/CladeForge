// Light / dark / system theme management.
//
// The full palette lives in app.css as CSS custom properties; this module only
// decides which palette is active and persists the user's explicit choice.
//
//  - 'system' (default): leaves `data-theme` unset so the `prefers-color-scheme`
//    media query in app.css drives the palette live and keeps tracking OS
//    changes (initTheme also honours this before first paint).
//  - 'light' / 'dark': explicit user choice, persisted to localStorage and
//    re-applied every launch.

export type Theme = 'light' | 'dark' | 'system';

const LS_KEY = 'cladeforge:theme';

/**
 * Every storage access in this module is guarded.
 *
 * `initTheme()` runs at module scope BEFORE the first render (see main.tsx), and
 * an uncaught exception there aborts the whole script evaluation: a browser in
 * private mode, with cookies/storage blocked, or with a full quota would produce
 * a permanently white window. This matches how the other storage paths in the
 * repository behave (projectIO.ts). A missing theme preference is a cosmetic
 * loss, never a fatal one, so both directions degrade to "no persisted choice"
 * and the OS setting takes over.
 */
function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null; // blocked / unavailable / corrupt storage
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(LS_KEY, theme);
  } catch {
    /* The choice still applies for this session; only persistence is lost. */
  }
}

/** The document root, or null in a non-DOM context (SSR probe, node tests). */
function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function systemTheme(): Exclude<Theme, 'system'> {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  const el = root();
  if (!el) return;
  try {
    if (theme === 'system') {
      // Remove the attribute so the media query drives the palette.
      el.removeAttribute('data-theme');
    } else {
      el.dataset.theme = theme;
    }
  } catch {
    /* A hostile DOM cannot stop the app from booting. */
  }
}

/** A stored value is only honoured when it is one of the three known themes. */
function asTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

/**
 * Read the stored choice (if any) and apply it. When the user has never chosen
 * (or chose "system"), `data-theme` stays unset so the media query drives it.
 */
export function initTheme(): void {
  const stored = asTheme(readStoredTheme());
  if (stored) applyTheme(stored);
}

/** The currently active theme, resolved from the attribute or the OS setting. */
export function currentTheme(): Theme {
  const attr = root()?.dataset.theme as Theme | undefined;
  if (attr === 'light' || attr === 'dark') return attr;
  return systemTheme();
}

/** The user's stored preference ('system' when never chosen). */
export function storedTheme(): Theme {
  const stored = asTheme(readStoredTheme());
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Set an explicit theme ('system' clears the attribute), persisting the choice. */
export function setTheme(theme: Theme): void {
  writeStoredTheme(theme);
  applyTheme(theme);
}

/** Flip between light and dark (legacy shortcut, now goes through setTheme). */
export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}
