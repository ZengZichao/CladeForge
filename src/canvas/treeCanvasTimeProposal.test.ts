// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * The canvas never pushes the geological time chart at the user.
 *
 * Mounting a time-ready project with a non-time layout must not rewrite that
 * layout, and it must not raise a global toast: a toast outlives the document
 * that produced it and would follow the user into another tab, where its action
 * could edit the wrong project. The 时间 panel owns the inline note and the
 * switch action, next to the data the decision depends on.
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers `src/` files
 * ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TreeCanvas } from './TreeCanvas';
import { useStore } from '../model/store';
import { useToasts } from '../ui/toast';
import { S } from '../ui/strings';
import { parseNewick } from '../io/newick';
import type { Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The canvas measures its own box through a ResizeObserver, which jsdom has never
// implemented; the viewport stays 0×0, which the component already handles.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let host: HTMLElement | null = null;
let root: Root | null = null;

function mountCanvas(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TreeCanvas)));
}

function cleanup(): void {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

/** A dated tree whose layout is the plain cladogram. */
function datedCladogram(id: string): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  for (const node of Object.values(p.nodes)) node.age = 10;
  const base = p.nodes[p.rootId];
  base.age = 100;
  for (const child of base.childrenIds) p.nodes[child].age = 60;
  p.layout.type = 'rectangular-cladogram';
  return p;
}

const proposalToast = () =>
  useToasts
    .getState()
    .toasts.find((t) => t.action?.label === S.layoutPanel.switchToTimeChart);

describe('the canvas never proposes a time-chart switch', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(cleanup);

  it('a time-ready project keeps the layout the document set', () => {
    useStore.getState().loadProject(datedCladogram('c2-no-impose'));
    mountCanvas();
    expect(useStore.getState().project.layout.type).toBe('rectangular-cladogram');
    // Only the import step loadProject retains (PM-23); mounting adds nothing.
    expect(useStore.getState().past).toHaveLength(1);
  });

  it('mounting raises no global layout-proposal toast', () => {
    useStore.getState().loadProject(datedCladogram('c2-no-toast'));
    mountCanvas();
    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(proposalToast()).toBeUndefined();
  });
});
