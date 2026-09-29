import { describe, it, expect, beforeEach } from 'vitest';
import { readRecents, pushRecent, clearRecents } from './recent';

// Minimal localStorage shim for the node test environment.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('recent files', () => {
  beforeEach(() => clearRecents());

  it('pushes newest to the front and de-duplicates by name + path', () => {
    pushRecent({ name: 'a.json', path: '/x/a.json', kind: 'project' });
    pushRecent({ name: 'b.nwk', path: '/x/b.nwk', kind: 'tree' });
    pushRecent({ name: 'a.json', path: '/x/a.json', kind: 'project' }); // duplicate

    const list = readRecents();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('a.json'); // moved to front
    expect(list[1].name).toBe('b.nwk');
  });

  it('caps the list at 8 entries, keeping the most recent', () => {
    for (let i = 0; i < 12; i += 1) pushRecent({ name: `f${i}.json`, kind: 'project' });
    const list = readRecents();
    expect(list).toHaveLength(8);
    expect(list[0].name).toBe('f11.json');
  });
});
