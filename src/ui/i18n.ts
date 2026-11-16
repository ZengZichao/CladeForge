// UI language (中文 / English / 跟随系统) management.
//
// The stored preference may be 'zh', 'en' or 'system'; 'system' resolves
// against the OS / browser locale at read time and whenever the preference is
// picked. The ACTIVE locale lives in this module (mirrored into the strings
// catalogue via setLanguage()). React components subscribe with useLanguage();
// App remounts its subtree when the resolved locale changes so every string —
// including those inside memoised components — re-renders from the swapped
// catalogue.

import { useSyncExternalStore } from 'react';
import { setLanguage, type Language } from './strings';

const LS_KEY = 'cladeforge:lang';

/** The persisted choice — 'system' follows the OS/browser locale. */
export type LanguagePref = 'zh' | 'en' | 'system';

function systemLanguage(): Language {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('zh')) return 'zh';
  }
  return 'en';
}

function resolvePref(pref: LanguagePref): Language {
  return pref === 'system' ? systemLanguage() : pref;
}

function readStoredPref(): LanguagePref {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'en' || v === 'zh' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  // No stored preference: follow the OS / browser locale.
  return 'system';
}

let pref: LanguagePref = readStoredPref();
let lang: Language = resolvePref(pref);
setLanguage(lang);
// Node-env tests import this module transitively (store → i18n) without a DOM.
function syncDocumentLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}
syncDocumentLang();

const listeners = new Set<() => void>();

export function currentLanguage(): Language {
  return lang;
}

/** The stored preference ('system' included) — what the settings UI shows. */
export function currentLanguagePref(): LanguagePref {
  return pref;
}

export function changeLanguage(next: LanguagePref): void {
  if (next === pref) return;
  pref = next;
  const resolved = resolvePref(next);
  try {
    localStorage.setItem(LS_KEY, next);
  } catch {
    /* ignore */
  }
  if (resolved === lang) {
    // Preference changed (e.g. zh → system resolving to zh): the UI still
    // needs to re-render its selection state, but the catalogue stays put.
    for (const fn of listeners) fn();
    return;
  }
  lang = resolved;
  setLanguage(lang);
  syncDocumentLang();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive locale for components; re-renders on changeLanguage(). */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
}

/** Reactive preference (including 'system') for settings UIs. */
export function useLanguagePref(): LanguagePref {
  return useSyncExternalStore(subscribe, currentLanguagePref, currentLanguagePref);
}

/**
 * Subscribe to locale changes OUTSIDE React (module scope), for side effects
 * that must run exactly once per switch — e.g. the store rebuilding pristine
 * sample documents in the new language. Returns an unsubscribe function.
 */
export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
