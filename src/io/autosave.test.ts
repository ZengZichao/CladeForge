import { describe, it, expect, beforeEach } from 'vitest';
import { readWorkspace, writeWorkspace } from './projectIO';
import {
  classifyStorageError,
  getLastAutosave,
  resetAutosaveState,
  subscribeAutosave,
} from './autosave';
import { useToasts } from '../ui/toast';
import { createEmptyProject } from '../model/sampleTree';

// Controllable localStorage for the node test environment: a real quota error
// cannot be provoked in jsdom, so the shim can be told to throw one.
function installStorage() {
  const store = new Map<string, string>();
  let failure: { name: string; code?: number } | null = null;
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => {
      if (failure) throw failure;
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    failWith: (e: typeof failure) => {
      failure = e;
    },
    raw: store,
  };
  globalThis.localStorage = ls as unknown as Storage;
  return ls;
}

const QUOTA = { name: 'QuotaExceededError', code: 22 };

describe('workspace autosave status', () => {
  let storage: ReturnType<typeof installStorage>;

  beforeEach(() => {
    storage = installStorage();
    storage.failWith(null);
    resetAutosaveState();
    useToasts.setState({ toasts: [] });
  });

  it('reports a successful write and publishes it', () => {
    const seen: boolean[] = [];
    const off = subscribeAutosave((s) => seen.push(s.ok));
    const result = writeWorkspace([createEmptyProject('a')], 0);
    off();
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(getLastAutosave()?.ok).toBe(true);
    expect(seen).toEqual([true]);
    // A healthy autosave must not raise a warning.
    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(readWorkspace()?.projects).toHaveLength(1);
  });

  it('turns a quota failure into an explicit warning instead of "已保存"', () => {
    storage.failWith(QUOTA);
    const result = writeWorkspace([createEmptyProject('big')], 0);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('quota');
    expect(result.message ?? '').toMatch(/存储|storage/i);
    const errors = useToasts.getState().toasts.filter((t) => t.kind === 'error');
    expect(errors.length).toBe(1);
    expect(getLastAutosave()?.ok).toBe(false);
  });

  it('warns once per distinct failure, then again after recovery', () => {
    storage.failWith(QUOTA);
    writeWorkspace([createEmptyProject('a')], 0);
    writeWorkspace([createEmptyProject('a')], 0);
    writeWorkspace([createEmptyProject('a')], 0);
    expect(useToasts.getState().toasts).toHaveLength(1); // no toast stacking
    storage.failWith({ name: 'SecurityError' });
    const second = writeWorkspace([createEmptyProject('a')], 0);
    expect(second.failure).toBe('unavailable');
    expect(useToasts.getState().toasts).toHaveLength(2); // a new cause is a new warning
  });

  it('classifies the failure it was handed', () => {
    expect(classifyStorageError(QUOTA)).toBe('quota');
    expect(classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe('quota');
    expect(classifyStorageError({ name: 'SecurityError' })).toBe('unavailable');
    expect(classifyStorageError(new Error('disk full'))).toBe('write');
  });

  it('keeps a corrupt snapshot instead of dropping it silently', () => {
    storage.raw.set('cladeforge:workspace', '{"projects": [broken');
    const restored = readWorkspace();
    expect(restored).toBeNull();
    expect(useToasts.getState().toasts.some((t) => t.kind === 'error' && /corrupt|损坏/.test(t.message))).toBe(true);
    // The unreadable blob is still recoverable by hand.
    expect(storage.raw.get('cladeforge:workspace.corrupt')).toContain('broken');
  });

  it('skips an unreadable tab but restores the rest, and counts it', () => {
    const good = createEmptyProject('good');
    storage.raw.set(
      'cladeforge:workspace',
      JSON.stringify({
        app: 'CladeForge',
        kind: 'workspace',
        version: '0.1.0',
        activeIndex: 0,
        projects: [good, { ...good, id: 'x', nodes: null }],
      }),
    );
    const restored = readWorkspace();
    expect(restored?.projects.map((p) => p.name)).toEqual(['good']);
    expect(restored?.skipped).toBe(1);
  });
});
