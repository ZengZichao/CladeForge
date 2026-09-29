// @vitest-environment jsdom
/**
 * The app PROPOSES the geological time chart; it never imposes it.
 *
 * Switching the layout from an effect would, in one move, rewrite the user's
 * explicit choice without asking and depend on the very field it wrote — so
 * undoing the switch would re-fire the effect and re-apply the change, making the
 * layout unrecoverable by design.
 *
 * These tests mount the real canvas and assert (a) a time-ready project never
 * moves the layout on its own, (b) the offer arrives as an informative toast with
 * a one-click switch, (c) accepting it costs exactly ONE undo step, and (d) undoing
 * that step leaves it undone — across a re-render and a flushed effect pass.
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

/** A dated tree whose layout is the plain cladogram — the state machine's trigger. */
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

describe('the time-chart layout is proposed, never imposed', () => {
  // Each case loads a project with its own id: the proposal guard is keyed on the
  // document, so a fresh id is what makes the cases independent.
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(cleanup);

  it('a time-ready project does NOT rewrite the user’s layout', () => {
    useStore.getState().loadProject(datedCladogram('c2-impose'));
    mountCanvas();
    // Mounting only PROPOSES: the layout stays exactly as the document set it…
    expect(useStore.getState().project.layout.type).toBe('rectangular-cladogram');
    // …and no edit reaches the undo stack on its own.
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('the offer is an informative message with a one-click switch', () => {
    useStore.getState().loadProject(datedCladogram('c2-toast'));
    mountCanvas();
    const toast = proposalToast();
    expect(toast, 'a proposal toast with a switch action').toBeDefined();
    expect(toast!.message).toBe(S.layoutPanel.timeDataButWrongLayout(S.layoutType.cladogram));
    // The message names the layout the user chose, i.e. it informs rather than acts.
    expect(toast!.message).toContain(S.layoutType.cladogram);
  });

  it('accepting the proposal is ONE undoable step', () => {
    useStore.getState().loadProject(datedCladogram('c2-accept'));
    mountCanvas();
    const before = useStore.getState().past.length;
    act(() => proposalToast()!.action!.run());
    expect(useStore.getState().project.layout.type).toBe('time-calibrated');
    expect(useStore.getState().past).toHaveLength(before + 1);
  });

  it('undoing the layout change LEAVES it undone (the effect cannot re-apply it)', () => {
    useStore.getState().loadProject(datedCladogram('c2-undo'));
    mountCanvas();
    const chosen = useStore.getState().project.layout.type;
    act(() => proposalToast()!.action!.run());
    expect(useStore.getState().project.layout.type).toBe('time-calibrated');

    act(() => useStore.getState().undo());
    expect(useStore.getState().project.layout.type).toBe(chosen);

    // Re-rendering with the undone layout must leave it alone: an effect that
    // wrote 'time-calibrated' back would also push another history entry.
    for (let pass = 0; pass < 3; pass += 1) {
      act(() => root!.render(createElement(TreeCanvas)));
    }
    expect(useStore.getState().project.layout.type).toBe(chosen);
    expect(useStore.getState().past).toHaveLength(0);
    expect(useStore.getState().future).toHaveLength(1);

    // …and undoing again after redo still lands back on the user's choice.
    act(() => useStore.getState().redo());
    expect(useStore.getState().project.layout.type).toBe('time-calibrated');
    act(() => useStore.getState().undo());
    expect(useStore.getState().project.layout.type).toBe(chosen);
  });

  it('the proposal is offered once per document, so Undo cannot re-trigger it', () => {
    useStore.getState().loadProject(datedCladogram('c2-once'));
    mountCanvas();
    expect(proposalToast()).toBeDefined();
    act(() => proposalToast()!.action!.run());
    act(() => useStore.getState().undo());
    useToasts.setState({ toasts: [] });
    // Same document, layout back to the non-time one: no second proposal.
    act(() => root!.render(createElement(TreeCanvas)));
    expect(proposalToast()).toBeUndefined();
  });

  it('a different document gets its own proposal', () => {
    useStore.getState().loadProject(datedCladogram('c2-doc-a'));
    mountCanvas();
    act(() => useStore.getState().loadProject(datedCladogram('c2-doc-b')));
    act(() => root!.render(createElement(TreeCanvas)));
    expect(proposalToast()).toBeDefined();
    expect(useStore.getState().project.layout.type).toBe('rectangular-cladogram');
  });
});
