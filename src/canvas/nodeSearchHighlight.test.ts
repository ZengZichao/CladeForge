// @vitest-environment jsdom
// GUI-B OBS-03: the node-search box showed a match count while the canvas gave
// no visible cue. These tests pin both halves: the shared matcher and the
// highlight ring drawn on matching nodes.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TreeCanvas } from './TreeCanvas';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import { nodeMatchesSearch, parseNodeSearch } from '../ui/nodeSearch';
import type { Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
      (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  }
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function gestureTree(): Project {
  const p = parseNewick('((A,B),(C,D));', 'search');
  p.layout.type = 'rectangular-cladogram';
  p.layout.orientation = 'LR';
  return p;
}

function mount(p: Project): HTMLElement {
  useStore.getState().loadProject(p);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TreeCanvas)));
  return host;
}

afterEach(() => {
  act(() => useStore.getState().setSearchQuery(''));
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('node-search matcher (OBS-03)', () => {
  it('matches labels case-insensitively and supports the type: filter', () => {
    const p = gestureTree();
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    const internal = Object.values(p.nodes).find(
      (n) => n.childrenIds.length > 0 && n.parentId !== null,
    )!;
    expect(nodeMatchesSearch(a, 'a')).toBe(true);
    expect(nodeMatchesSearch(internal, 'type:internal')).toBe(true);
    expect(nodeMatchesSearch(a, 'type:internal')).toBe(false);
    expect(nodeMatchesSearch(a, 'type:leaf')).toBe(true);
    expect(nodeMatchesSearch(a, '')).toBe(false);
    expect(parseNodeSearch('type:leaf taxon').labelText).toBe('taxon');
  });
});

describe('node-search canvas highlight (OBS-03)', () => {
  it('draws a highlight ring on every matching node and clears it', () => {
    mount(gestureTree());
    act(() => useStore.getState().setSearchQuery('a'));
    const hits = Array.from(host!.querySelectorAll('.node-search-hit'));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.closest('g.node-group')).not.toBeNull();
    }

    act(() => useStore.getState().setSearchQuery(''));
    expect(host!.querySelectorAll('.node-search-hit')).toHaveLength(0);
  });

  it('does not highlight when only the type filter is given but nothing matches', () => {
    mount(gestureTree());
    act(() => useStore.getState().setSearchQuery('type:leaf zzz-no-such-tip'));
    expect(host!.querySelectorAll('.node-search-hit')).toHaveLength(0);
  });
});
