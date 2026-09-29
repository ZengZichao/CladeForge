// @vitest-environment jsdom
// `initTheme()` is called at module scope in main.tsx, before the first render,
// so every localStorage access in the theme module is wrapped: in a browser that
// blocks or has filled localStorage (private mode, "block all cookies", quota
// reached) an exception there escapes the entry point and the whole window stays
// white. These tests drive a throwing storage stub, so a regression shows up as a
// red test rather than a blank screen.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { currentTheme, initTheme, setTheme, storedTheme, toggleTheme } from './theme';

type Stub = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  calls: { get: number; set: number };
  raw: Map<string, string>;
};

function installStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): Stub {
  const raw = new Map<string, string>();
  const calls = { get: 0, set: 0 };
  const stub: Stub = {
    calls,
    raw,
    getItem: (k: string) => {
      calls.get += 1;
      if (opts.throwOnGet) throw new DOMException('storage is disabled', 'SecurityError');
      return raw.has(k) ? (raw.get(k) as string) : null;
    },
    setItem: (k: string, v: string) => {
      calls.set += 1;
      if (opts.throwOnSet) throw new DOMException('QuotaExceeded', 'QuotaExceededError');
      raw.set(k, String(v));
    },
    removeItem: (k: string) => void raw.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: stub,
  });
  return stub;
}

const LS_KEY = 'cladeforge:theme';

describe('theme — storage failures must never break boot', () => {
  let previousStorage: unknown;

  beforeEach(() => {
    previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: previousStorage,
    });
    document.documentElement.removeAttribute('data-theme');
  });

  it('initTheme() survives a localStorage that throws on read', () => {
    installStorage({ throwOnGet: true });
    expect(() => initTheme()).not.toThrow();
    // No stored choice means no attribute: the CSS media query drives the palette.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(storedTheme()).toBe('system');
    expect(['light', 'dark']).toContain(currentTheme());
  });

  it('setTheme() survives a localStorage that throws on write (quota)', () => {
    const stub = installStorage({ throwOnSet: true });
    expect(() => setTheme('dark')).not.toThrow();
    // The session still gets the chosen palette; only persistence is lost.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(stub.raw.has(LS_KEY)).toBe(false);
  });

  it('toggleTheme() survives a storage that throws in both directions', () => {
    installStorage({ throwOnGet: true, throwOnSet: true });
    expect(() => toggleTheme()).not.toThrow();
    expect(() => initTheme()).not.toThrow();
    expect(() => storedTheme()).not.toThrow();
  });

  it('a healthy storage still round-trips the choice', () => {
    const stub = installStorage();
    setTheme('dark');
    expect(stub.raw.get(LS_KEY)).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storedTheme()).toBe('dark');
    setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('a garbage stored value is ignored instead of being written into the DOM', () => {
    const stub = installStorage();
    stub.raw.set(LS_KEY, '><script>x</script>');
    initTheme();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(storedTheme()).toBe('system');
  });
});
