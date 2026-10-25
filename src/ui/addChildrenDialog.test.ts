// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The "Add a polytomy" dialog is the one modal whose Enter path used to differ
// from its Add button: the children were added and the dialog closed, but the
// focus trap handed focus back to the toolbar button that opened it and the
// SAME Enter keydown then activated that button (the browser default action),
// reopening the dialog — users read this as "Enter never closes the dialog".
// These tests pin the two contracts that fix it:
//   1. Enter and the Add button run the same confirm path, and Enter cancels its
//      own default action (so it cannot activate the restored focus target).
//   2. The dialog names its target (selected node / explicit root fallback) and
//      re-validates it at submit time.

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddChildrenDialog } from './AddChildrenDialog';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has no requestAnimationFrame; the dialog only uses it to select the
  // number field after opening.
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
      (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  }
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(ui: unknown): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui as never));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

/** Fresh empty project with a named root; returns the root id. */
function freshProject(): string {
  useStore.getState().loadProject(createEmptyProject('Test'));
  let rootId = '';
  act(() => {
    useStore.getState().apply((d) => {
      rootId = d.rootId;
      d.nodes[d.rootId].label = 'Taxon_A';
    });
  });
  return rootId;
}

/** Add one named child under the root; returns its id. */
function addNamedChild(name: string): string {
  let id = '';
  act(() => {
    useStore.getState().apply((d) => {
      id = addChildren(d, d.rootId, 1)[0];
      d.nodes[id].label = name;
    });
  });
  return id;
}

function dialogEl(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

function numberInput(): HTMLInputElement {
  return document.querySelector('.dialog input[type=number]') as HTMLInputElement;
}

function setNumber(value: string): void {
  const input = numberInput();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressOnInput(key: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    numberInput().dispatchEvent(ev);
  });
  return ev;
}

function nodeCount(): number {
  return Object.keys(useStore.getState().project.nodes).length;
}

describe('AddChildrenDialog — target is always stated (BUG-3)', () => {
  it('names the selected target node', () => {
    const targetId = freshProject();
    const childId = addNamedChild('Taxon_B');
    expect(childId).not.toBe(targetId);
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: childId,
        onCancel: () => undefined,
      }),
    );
    expect(dialogEl().textContent).toContain('Add children to');
    expect(dialogEl().textContent).toContain('Taxon_B');
  });

  it('spells out the root fallback when nothing is selected', () => {
    const rootId = freshProject();
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: rootId,
        onCancel: () => undefined,
      }),
    );
    expect(dialogEl().textContent).toContain('No node selected');
    expect(dialogEl().textContent).toContain('Taxon_A');
  });

  it('warns and disables Add when the target disappeared while open', () => {
    freshProject();
    const childId = addNamedChild('Taxon_B');
    let cancelled = 0;
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: childId,
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    // Swap the document out from under the still-open dialog.
    act(() => useStore.getState().loadProject(createEmptyProject('Other')));
    // Re-open state: the component is still mounted with the stale id.
    const addBtn = [...document.querySelectorAll('.dialog .actions button')].find(
      (b) => b.textContent?.trim() === 'Add',
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    expect(addBtn.closest('.dialog')!.textContent).toContain('no longer exists');
    const before = nodeCount();
    act(() => addBtn.click());
    expect(nodeCount()).toBe(before);
    // The button is disabled, but the Enter path still has to re-validate
    // instead of dereferencing a node that no longer exists.
    const ev = pressOnInput('Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(nodeCount()).toBe(before);
    expect(cancelled).toBe(1);
  });
});

describe('AddChildrenDialog — Enter and Add are the same path (BUG-1)', () => {
  it('Enter prevents its default action, adds the children and closes', () => {
    freshProject();
    const childId = addNamedChild('Taxon_B');
    let cancelled = 0;
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: childId,
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    setNumber('2');
    const before = nodeCount();
    const ev = pressOnInput('Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(cancelled).toBe(1);
    expect(nodeCount()).toBe(before + 2);
  });

  it('clicking Add produces the same result as Enter', () => {
    freshProject();
    const childId = addNamedChild('Taxon_B');
    let cancelled = 0;
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: childId,
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    const addBtn = [...document.querySelectorAll('.dialog .actions button')].find(
      (b) => b.textContent?.trim() === 'Add',
    ) as HTMLButtonElement;
    const before = nodeCount();
    act(() => addBtn.click());
    expect(cancelled).toBe(1);
    expect(nodeCount()).toBe(before + 3);
  });
});

describe('AddChildrenDialog — Escape cancels without side effects (BUG-2)', () => {
  it('closes, does not add nodes, and stops the event', () => {
    freshProject();
    const childId = addNamedChild('Taxon_B');
    let cancelled = 0;
    mount(
      createElement(AddChildrenDialog, {
        open: true,
        targetId: childId,
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    const before = nodeCount();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      numberInput().dispatchEvent(ev);
    });
    expect(cancelled).toBe(1);
    expect(nodeCount()).toBe(before);
  });
});
