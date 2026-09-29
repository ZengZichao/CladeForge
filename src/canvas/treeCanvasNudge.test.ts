// @vitest-environment jsdom
/**
 * One held arrow key is ONE undo step.
 *
 * Calling `apply()` on every keydown would let a held key — which repeats at the
 * OS rate, 30–60 events per second of pressing — push dozens of the 100 history
 * slots for a single visual adjustment, after which the user cannot step back
 * past it. So the nudge runs through the store's begin / live / commit
 * transaction, the same one the mouse drag uses: the first keydown opens it, the
 * repeats only update live, and the gesture records one step. The terminators
 * matter as much as the keyup: a keyup never arrives when the window loses focus
 * mid-hold, when the tab is hidden, or when a pointer gesture takes over, and an
 * interaction left open would pin the canvas's drag-cached baseline. `useDrag`
 * interrupts itself on exactly those events; so must the keyboard.
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers `src/` files
 * ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TreeCanvas } from './TreeCanvas';
import { useStore } from '../model/store';
import { moveNode } from '../model/treeOps';
import { useToasts } from '../ui/toast';
import { parseNewick } from '../io/newick';
import type { NodeId, Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has never implemented the ResizeObserver the canvas measures itself with;
// the viewport stays 0×0, which the component already handles.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let host: HTMLElement | null = null;
let root: Root | null = null;

/** Unmounts the mounted canvas — a second live canvas would install a second
 *  window keydown listener and the counts below would describe two gestures. */
function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

/** A purely topological tree (no ages), so no layout proposal is in the way. */
function plainTree(id: string): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  p.layout.type = 'rectangular-cladogram';
  p.layout.orientation = 'LR'; // depth axis = x, so arrows only move x
  return p;
}

/** Mount the canvas and select a tip; returns its id. */
function mountWith(p: Project): NodeId {
  cleanup();
  useStore.getState().loadProject(p);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TreeCanvas)));
  const tip = Object.values(useStore.getState().project.nodes).find(
    (n) => n.childrenIds.length === 0,
  );
  if (!tip) throw new Error('no tip to nudge');
  act(() => useStore.getState().select(tip.id));
  return tip.id;
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, init));
  });
}

/** `count` OS repeats of one arrow key, as a single held-key gesture. */
function holdArrow(count: number, keyName = 'ArrowRight', shift = false): void {
  for (let i = 0; i < count; i += 1) {
    key('keydown', { key: keyName, shiftKey: shift, repeat: i > 0 });
  }
}

const s = () => useStore.getState();
const posOf = (id: NodeId) => useStore.getState().project.nodes[id].position;
const xOf = (id: NodeId) => posOf(id)?.x ?? 0;
const past = () => useStore.getState().past.length;
const interactionOpen = () => useStore.getState().interactionBase !== null;

/**
 * The x a later gesture starts from.
 *
 * A node carries no `position` until it is moved, and the layout's own coordinate is
 * not on the node — so one committed 1px nudge establishes the anchor, and every
 * expectation below is measured from the position it leaves the node at.
 */
function anchor(id: NodeId): number {
  holdArrow(1);
  key('keyup', { key: 'ArrowRight' });
  return xOf(id);
}

describe('arrow-key nudging commits one step per gesture', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(cleanup);

  it('60 repeats of a held arrow key record exactly one undo step', () => {
    const id = mountWith(plainTree('c5-repeat'));
    const start = anchor(id);
    const before = past();

    holdArrow(60);
    // Live frames must not touch the history stack — that is what `live()` is for.
    expect(past()).toBe(before);
    expect(xOf(id)).toBe(start + 60);
    expect(interactionOpen()).toBe(true);

    key('keyup', { key: 'ArrowRight' });
    expect(past()).toBe(before + 1);
    expect(interactionOpen()).toBe(false);
    // The node is where all 60 frames put it, and one ⌘Z is enough to undo it.
    expect(xOf(id)).toBe(start + 60);
    act(() => useStore.getState().undo());
    expect(xOf(id), 'one step rewound the whole hold').toBe(start);
    act(() => useStore.getState().undo());
    expect(posOf(id), '…and the anchor gesture had its own step').toBeUndefined();
  });

  it('a keyup-less termination (window blur) still commits exactly once', () => {
    const id = mountWith(plainTree('c5-blur'));
    const start = anchor(id);
    const before = past();

    holdArrow(7);
    expect(interactionOpen()).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(interactionOpen()).toBe(false);
    expect(past()).toBe(before + 1);
    expect(xOf(id)).toBe(start + 7);

    // …and the next gesture is its own step, not a continuation of the closed one.
    holdArrow(3);
    expect(past()).toBe(before + 1);
    key('keyup', { key: 'ArrowRight' });
    expect(past()).toBe(before + 2);
    expect(xOf(id)).toBe(start + 10);
  });

  it('every other termination closes the transaction, committing once', () => {
    const terminators: Array<[string, () => void]> = [
      [
        'pointerdown',
        () => act(() => window.dispatchEvent(new Event('pointerdown'))),
      ],
      [
        'pointercancel',
        () => act(() => window.dispatchEvent(new Event('pointercancel'))),
      ],
      [
        'visibilitychange',
        () => {
          Object.defineProperty(document, 'hidden', { value: true, configurable: true });
          act(() => document.dispatchEvent(new Event('visibilitychange')));
          Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        },
      ],
      ['escape', () => key('keydown', { key: 'Escape' })],
      ['unmount', () => act(() => root?.unmount())],
    ];
    for (const [name, terminate] of terminators) {
      const id = mountWith(plainTree(`c5-term-${name}`));
      holdArrow(4);
      const before = past();
      expect(interactionOpen(), `${name}: a gesture was open`).toBe(true);
      terminate();
      expect(past(), `${name}: exactly one step`).toBe(before + 1);
      expect(interactionOpen(), `${name}: nothing left open`).toBe(false);
      expect(xOf(id), `${name}: the nudges survived`).toBeGreaterThanOrEqual(4);
    }
  });

  it('a different direction or step size is a different gesture', () => {
    const id = mountWith(plainTree('c5-switch'));
    const start = anchor(id);
    const before = past();

    holdArrow(5, 'ArrowRight');
    // Switching direction mid-hold commits the +5 and opens the new gesture.
    holdArrow(3, 'ArrowLeft');
    expect(past()).toBe(before + 1);
    // A Shift repeat is a different edit size, so it is a different gesture too.
    holdArrow(2, 'ArrowRight', true);
    expect(past()).toBe(before + 2);
    key('keyup', { key: 'ArrowRight', shiftKey: true });
    expect(past()).toBe(before + 3);
    expect(xOf(id)).toBe(start + 5 - 3 + 20);
  });

  it('a cross-axis hold on a rectangular layout records nothing at all', () => {
    const id = mountWith(plainTree('c5-cross'));
    const start = anchor(id);
    const before = past();
    // LR puts the depth axis on x: ArrowUp/Down are constrained to a zero move and
    // must not spend a slot on a pin rewrite that changes nothing.
    holdArrow(12, 'ArrowDown');
    key('keyup', { key: 'ArrowDown' });
    holdArrow(12, 'ArrowUp');
    key('keyup', { key: 'ArrowUp' });
    expect(past()).toBe(before);
    expect(interactionOpen()).toBe(false);
    expect(xOf(id)).toBe(start);
  });

  it('a keydown that lands during a node drag starts no second transaction', () => {
    const id = mountWith(plainTree('c5-dragging'));
    const before = past();
    const pristine = s().project;
    // Exactly what `useDrag` does when a press turns into a drag.
    act(() => useStore.getState().beginInteraction(id));
    expect(s().draggingId).toBe(id);
    holdArrow(6);
    key('keyup', { key: 'ArrowRight' });
    // The arrow keys are inert until the drag's own transaction closes.
    expect(past()).toBe(before);
    expect(posOf(id)).toBeUndefined();
    // …and the drag keeps the baseline it captured, so its own commit is one step
    // back to the pre-drag document rather than to a mid-drag frame.
    act(() => s().live((d) => moveNode(d, id, { x: 10, y: 10 })));
    act(() => s().commitInteraction());
    expect(past()).toBe(before + 1);
    expect(s().past[past() - 1].project).toBe(pristine);
    expect(s().draggingId).toBeNull();
  });

  it('a 100-repeat hold stays inside the undo budget instead of evicting it', () => {
    mountWith(plainTree('c5-budget'));
    // Seed the stack so eviction is observable.
    act(() => {
      for (let i = 0; i < 95; i += 1) {
        useStore.getState().apply((d) => {
          d.name = `revision ${i}`;
        });
      }
    });
    const before = past();
    expect(before).toBeLessThanOrEqual(100);
    holdArrow(100);
    key('keyup', { key: 'ArrowRight' });
    // One step for the whole hold — and the 95 edits before it are still reachable.
    expect(past()).toBe(before + 1);
    expect(useStore.getState().past[past() - 1].project.name).not.toBe('revision 0');
  });
});
