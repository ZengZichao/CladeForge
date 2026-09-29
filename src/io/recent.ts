// Recent files: a small MRU list persisted in localStorage. In the desktop
// shell each entry keeps the absolute path so it can be re-opened directly; in
// a plain browser there is no path, so a click falls back to the open dialog.

export interface RecentEntry {
  /** File name with extension (display + parser hint). */
  name: string;
  /** Absolute path, when known (desktop only). */
  path?: string;
  kind: 'project' | 'tree';
}

const KEY = 'cladeforge:recent';
const MAX = 8;

/** Dispatched whenever the recent list changes, so live UI (e.g. the menu bar
 * recents dropdown) can re-read it without polling or re-render hacks. */
export const RECENTS_CHANGED_EVENT = 'cladeforge:recents-changed';

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(RECENTS_CHANGED_EVENT));
  } catch {
    /* non-DOM environment (SSR/tests) */
  }
}

export function readRecents(): RecentEntry[] {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return [];
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e): e is RecentEntry => !!e && typeof (e as RecentEntry).name === 'string')
      .map((e) => ({ ...e, kind: e.kind === 'tree' ? 'tree' : 'project' }) as RecentEntry)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Add (or move to front) a recent entry, de-duplicated by name + path. */
export function pushRecent(entry: RecentEntry): void {
  try {
    const list = readRecents().filter((e) => !(e.name === entry.name && e.path === entry.path));
    list.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    notifyChanged();
  } catch {
    /* best-effort */
  }
}

export function clearRecents(): void {
  try {
    localStorage.removeItem(KEY);
    notifyChanged();
  } catch {
    /* ignore */
  }
}
