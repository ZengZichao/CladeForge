// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// BUG-7 first-entry behaviour for the geological time chart's era overlay.
//
// The rule has two halves that must not drift apart: a PURE decision
// (`planTimeChartEntry`) and the store/notify bridge called by the three
// explicit layout-switch entry points (`enterTimeChartLayout`). These tests
// pin both, including the two things the fix must never do: record an undo
// step, or re-enable the bands after the user explicitly unchecked them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import type { Project } from '../model/types';
import { useToasts } from './toast';
import {
  DEFAULT_TIME_CHART_ERAS_MEMORY,
  LS_KEY,
  enterTimeChartLayout,
  markTimeChartErasHintShown,
  planTimeChartEntry,
  readTimeChartErasMemory,
  rememberErasToggle,
  timeChartErasHintActionLabel,
  timeChartErasHintText,
  writeTimeChartErasMemory,
} from './timeChartEras';

const store = () => useStore.getState();
const toasts = () => useToasts.getState().toasts;
const hintToast = () => toasts().find((t) => t.action?.label === timeChartErasHintActionLabel());

/** A dated tree where node ages exist, so `isTimeCalibrated` is true. */
function datedProject(id: string, layout: Project['layout']['type'] = 'time-calibrated'): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  for (const node of Object.values(p.nodes)) node.age = 10;
  const root = p.nodes[p.rootId];
  root.age = 100;
  for (const child of root.childrenIds) p.nodes[child].age = 60;
  p.layout.type = layout;
  return p;
}

/** Same topology, no ages: the time chart cannot draw an axis for it. */
function topologicalProject(id: string): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  p.layout.type = 'time-calibrated';
  return p;
}

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
  store().setShowEras(false);
});

afterEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
});

describe('planTimeChartEntry — the decision table', () => {
  it('a first entry with the bands off enables them and owes the hint', () => {
    expect(planTimeChartEntry(false, DEFAULT_TIME_CHART_ERAS_MEMORY)).toEqual({
      enableEras: true,
      showHint: true,
    });
  });

  it('bands already on: nothing to enable, nothing to explain', () => {
    expect(planTimeChartEntry(true, DEFAULT_TIME_CHART_ERAS_MEMORY)).toEqual({
      enableEras: false,
      showHint: false,
    });
  });

  it('a remembered opt-out wins over every convenience default', () => {
    expect(planTimeChartEntry(false, { erasOff: true, hintShown: false })).toEqual({
      enableEras: false,
      showHint: false,
    });
    // …and stays silent even after the hint has been shown before.
    expect(planTimeChartEntry(false, { erasOff: true, hintShown: true })).toEqual({
      enableEras: false,
      showHint: false,
    });
  });

  it('the hint is spent once, but the convenience default still applies', () => {
    expect(planTimeChartEntry(false, { erasOff: false, hintShown: true })).toEqual({
      enableEras: true,
      showHint: false,
    });
  });
});

describe('durable memory — bad storage degrades, never throws', () => {
  let previousStorage: unknown;

  beforeEach(() => {
    previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: previousStorage,
    });
  });

  function installStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
    const raw = new Map<string, string>();
    const stub = {
      raw,
      getItem: (k: string) => {
        if (opts.throwOnGet) throw new DOMException('blocked', 'SecurityError');
        return raw.has(k) ? (raw.get(k) as string) : null;
      },
      setItem: (k: string, v: string) => {
        if (opts.throwOnSet) throw new DOMException('full', 'QuotaExceededError');
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

  it('a throwing storage reads as "nothing remembered"', () => {
    installStorage({ throwOnGet: true });
    expect(readTimeChartErasMemory()).toEqual(DEFAULT_TIME_CHART_ERAS_MEMORY);
  });

  it('a throwing storage on write does not break the switch', () => {
    installStorage({ throwOnSet: true });
    expect(() => rememberErasToggle(false)).not.toThrow();
    expect(() => markTimeChartErasHintShown()).not.toThrow();
    expect(() => writeTimeChartErasMemory(DEFAULT_TIME_CHART_ERAS_MEMORY)).not.toThrow();
  });

  it('a healthy storage round-trips, and malformed JSON is ignored', () => {
    const stub = installStorage();
    rememberErasToggle(false);
    expect(stub.raw.has(LS_KEY)).toBe(true);
    expect(readTimeChartErasMemory()).toEqual({ erasOff: true, hintShown: false });

    markTimeChartErasHintShown();
    expect(readTimeChartErasMemory()).toEqual({ erasOff: true, hintShown: true });

    stub.raw.set(LS_KEY, 'not json at all');
    expect(readTimeChartErasMemory()).toEqual(DEFAULT_TIME_CHART_ERAS_MEMORY);
    stub.raw.set(LS_KEY, 'null');
    expect(readTimeChartErasMemory()).toEqual(DEFAULT_TIME_CHART_ERAS_MEMORY);
  });
});

describe('enterTimeChartLayout — the three entry points share one bridge', () => {
  it('the first explicit entry auto-enables the bands and shows ONE hint', () => {
    store().loadProject(datedProject('eras-first'));
    expect(store().showEras).toBe(false);

    enterTimeChartLayout();

    expect(store().showEras).toBe(true);
    const toast = hintToast();
    expect(toast, 'one actionable hint').toBeDefined();
    expect(toast!.message).toBe(timeChartErasHintText());
    expect(readTimeChartErasMemory().hintShown).toBe(true);
    // UI state only: no document edit, no undo entry.
    expect(store().past).toHaveLength(0);
  });

  it('a later entry re-applies the default but never repeats the hint', () => {
    store().loadProject(datedProject('eras-later'));
    enterTimeChartLayout();
    // A new document / tab resets the session-only showEras flag.
    store().setShowEras(false);
    useToasts.setState({ toasts: [] });

    enterTimeChartLayout();
    expect(store().showEras).toBe(true);
    expect(hintToast()).toBeUndefined();
  });

  it('a remembered manual opt-out is never overridden', () => {
    store().loadProject(datedProject('eras-optout'));
    enterTimeChartLayout(); // first entry: on + hint
    // The user unchecks the box themselves (this is exactly what the
    // CheckboxField's onChange does before calling setShowEras).
    rememberErasToggle(false);
    store().setShowEras(false);
    useToasts.setState({ toasts: [] });

    enterTimeChartLayout();
    expect(store().showEras).toBe(false);
    expect(hintToast()).toBeUndefined();

    // Switching away and back several times changes nothing.
    store().setShowEras(false);
    enterTimeChartLayout();
    enterTimeChartLayout();
    expect(store().showEras).toBe(false);
    expect(hintToast()).toBeUndefined();
  });

  it('re-checking the box opts back into the convenience default', () => {
    store().loadProject(datedProject('eras-optin'));
    enterTimeChartLayout();
    rememberErasToggle(false); // opt out…
    rememberErasToggle(true); // …then opt back in
    store().setShowEras(false);
    useToasts.setState({ toasts: [] });

    enterTimeChartLayout();
    expect(store().showEras).toBe(true);
    // The hint was already spent on the first entry.
    expect(hintToast()).toBeUndefined();
  });

  it('the hint action hides the bands and remembers the opt-out', () => {
    store().loadProject(datedProject('eras-action'));
    enterTimeChartLayout();
    const toast = hintToast();
    expect(toast).toBeDefined();

    toast!.action!.run();
    expect(store().showEras).toBe(false);
    expect(readTimeChartErasMemory().erasOff).toBe(true);

    // Now the memory alone keeps it off on the next switch.
    useToasts.setState({ toasts: [] });
    enterTimeChartLayout();
    expect(store().showEras).toBe(false);
    expect(hintToast()).toBeUndefined();
  });

  it('a purely topological tree is left alone (its checkbox is disabled)', () => {
    store().loadProject(topologicalProject('eras-topo'));
    enterTimeChartLayout();
    expect(store().showEras).toBe(false);
    expect(hintToast()).toBeUndefined();
    expect(readTimeChartErasMemory().hintShown).toBe(false);
  });

  it('a non-time layout is left alone', () => {
    store().loadProject(datedProject('eras-clado', 'rectangular-cladogram'));
    enterTimeChartLayout();
    expect(store().showEras).toBe(false);
    expect(hintToast()).toBeUndefined();
  });

  it('entering records no undo step and does not touch the document', () => {
    store().loadProject(datedProject('eras-nodoc'));
    const projectBefore = store().project;
    const pastBefore = store().past.length;
    enterTimeChartLayout();
    expect(store().project).toBe(projectBefore);
    expect(store().past).toHaveLength(pastBefore);
    // Undo still does exactly what it did before (nothing to undo here).
    store().undo();
    expect(store().project).toBe(projectBefore);
  });
});
