// UI language (中文 / English) management.
//
// The active locale lives in this module (persisted to localStorage), mirrored
// into the strings catalogue via setLanguage(). React components subscribe
// with useLanguage(); App remounts its subtree when the locale changes so
// every string — including those inside memoised components — re-renders.

import { useSyncExternalStore } from 'react';
import { setLanguage, type Language } from './strings';

const LS_KEY = 'cladeforge:lang';

function readStored(): Language {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* ignore */
  }
  // No stored preference: follow the OS / browser locale.
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('zh')) return 'zh';
    return 'en';
  }
  return 'en';
}

let lang: Language = readStored();
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

export function changeLanguage(next: Language): void {
  if (next === lang) return;
  lang = next;
  setLanguage(next);
  syncDocumentLang();
  try {
    localStorage.setItem(LS_KEY, next);
  } catch {
    /* ignore */
  }
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
