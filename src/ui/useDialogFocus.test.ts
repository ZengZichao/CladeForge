// @vitest-environment jsdom
// The dialog focus trap depends on `[open]` alone, never on `[open, onClose]`:
// every caller passes an inline arrow (`onClose={() => setMatrixOpen(false)}`),
// so a dependency on `onClose` would make a parent re-render — which is what
// committing one matrix cell causes — tear the trap down and re-arm it, and
// re-arming starts by focusing the FIRST focusable control, i.e. the caret is
// kicked out of the field the user is typing in. These tests re-render the host
// component with a fresh `onClose` identity and assert the caret does not move,
// while Esc still runs the NEWEST callback and the open / close transitions keep
// behaving.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { claimFocusInto, modalIsOpen, useDialogFocus } from './useDialogFocus';

// React 18 refuses `act()` unless the environment declares itself.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The dialog: three focusable controls, an unstable `onClose`, re-rendered at will. */
function Dialog(props: { open: boolean; onClose: () => void; note?: string }) {
  const ref = useDialogFocus(props.open, props.onClose);
  if (!props.open) return null;
  return createElement(
    'div',
    { className: 'dialog-backdrop' },
    createElement(
      'div',
      { ref, role: 'dialog', 'aria-modal': true, tabIndex: -1 },
      createElement('button', { id: 'b1' }, 'first'),
      createElement('input', { id: 'f1' }),
      createElement('button', { id: 'b2' }, 'last'),
      props.note ? createElement('span', { id: 'note' }, props.note) : null,
    ),
  );
}

/** The App-shaped shell: a trigger outside the dialog + the dialog itself. */
function shell(props: { open: boolean; onClose: () => void; note?: string }): ReactNode {
  return createElement(
    'div',
    null,
    createElement('button', { id: 'outside' }, 'outside'),
    createElement(Dialog, props),
  );
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(initial: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(initial));
}

function rerender(next: ReactNode): void {
  act(() => root!.render(next));
}

function cleanup(): void {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

function press(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('useDialogFocus — focus is claimed once per opening', () => {
  afterEach(cleanup);

  it('moves focus into the dialog when it opens', () => {
    mount(shell({ open: false, onClose: () => {} }));
    act(() => byId('outside').focus());
    expect(document.activeElement).toBe(byId('outside'));
    rerender(shell({ open: true, onClose: () => {} }));
    expect(document.activeElement).toBe(byId('b1'));
  });

  it('a parent re-render with a new onClose does NOT move the caret', () => {
    // Realistic sequence: the matrix dialog is opened from a trigger button, so
    // the trap captured that trigger as "where focus came from".
    mount(shell({ open: false, onClose: () => {} }));
    act(() => byId('outside').focus());
    rerender(shell({ open: true, onClose: () => undefined }));
    // The user reaches the text field and starts typing a matrix value.
    act(() => byId('f1').focus());
    expect(document.activeElement).toBe(byId('f1'));

    // Each committed keystroke re-renders the parent: a NEW inline `onClose`
    // identity and new children. With `[open, onClose]` as the dependency list
    // the trap tore down (handing focus back to the trigger) and re-armed
    // (focusing `b1`) on every one of those renders — the caret was yanked out
    // of the field while the user was still editing.
    rerender(shell({ open: true, onClose: () => undefined, note: 'cell written' }));
    expect(document.activeElement).toBe(byId('f1'));
    expect(document.activeElement).not.toBe(byId('outside'));
    expect(document.activeElement).not.toBe(byId('b1'));
    rerender(shell({ open: true, onClose: () => undefined, note: 'another cell' }));
    expect(document.activeElement).toBe(byId('f1'));
  });

  it('Escape runs the NEWEST onClose even though the trap armed only once', () => {
    const first = { called: 0 };
    const second = { called: 0 };
    mount(
      shell({
        open: true,
        onClose: () => {
          first.called += 1;
        },
      }),
    );
    rerender(
      shell({
        open: true,
        onClose: () => {
          second.called += 1;
        },
        note: 're-rendered',
      }),
    );
    press('Escape');
    expect(second.called).toBe(1);
    expect(first.called).toBe(0);
  });

  it('still traps Tab at the last control and restores focus on close', () => {
    mount(shell({ open: false, onClose: () => {} }));
    act(() => byId('outside').focus());
    rerender(shell({ open: true, onClose: () => {} }));
    expect(document.activeElement).toBe(byId('b1'));
    act(() => byId('b2').focus());
    press('Tab');
    expect(document.activeElement).toBe(byId('b1'));
    // Closing hands focus back to the trigger that opened it.
    rerender(shell({ open: false, onClose: () => {} }));
    expect(document.activeElement).toBe(byId('outside'));
  });

  it('claimFocusInto leaves focus alone when it is already inside the dialog', () => {
    const el = document.createElement('div');
    el.innerHTML = '<button id="inner1"></button><input id="inner2"><button id="inner3"></button>';
    document.body.appendChild(el);
    const inner2 = el.querySelector('#inner2') as HTMLElement;
    inner2.focus();
    expect(claimFocusInto(el, document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(inner2);
    // Focus outside the dialog is pulled to its first control.
    inner2.blur();
    expect(claimFocusInto(el, document.body)).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('#inner1'));
    el.remove();
  });
});

describe('modalIsOpen — which layers own the keyboard', () => {
  function modal(attrs: Record<string, string>): HTMLElement {
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }
  const mounted: HTMLElement[] = [];
  afterEach(() => {
    while (mounted.length) mounted.pop()!.remove();
  });

  it('is false with no modal on screen', () => {
    expect(modalIsOpen()).toBe(false);
  });

  it('recognises role="dialog" with aria-modal', () => {
    mounted.push(modal({ role: 'dialog', 'aria-modal': 'true' }));
    expect(modalIsOpen()).toBe(true);
  });

  it('recognises role="alertdialog" too — that is what confirmDialog renders', () => {
    // The canvas short-circuit keyed on `role="dialog"` only, so while a
    // deletion confirmation was on screen Delete / arrows / Escape still reached
    // the tree behind it.
    mounted.push(modal({ role: 'alertdialog', 'aria-modal': 'true' }));
    expect(modalIsOpen()).toBe(true);
  });

  it('ignores a dialog that does not declare itself modal', () => {
    mounted.push(modal({ role: 'dialog' }));
    expect(modalIsOpen()).toBe(false);
  });
});

describe('Escape inside a dialog does not reach the canvas', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it('closes the dialog and stops the event before any window listener sees it', () => {
    // TreeCanvas and App listen on `window`; the dialog listens on `document` in
    // the CAPTURE phase, so `stopPropagation()` there is what keeps Escape from
    // also clearing the canvas selection.
    let windowSawEscape = 0;
    const witness = (e: KeyboardEvent) => {
      if (e.key === 'Escape') windowSawEscape += 1;
    };
    window.addEventListener('keydown', witness);

    let closed = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(shell({ open: true, onClose: () => (closed += 1) })));

    const inside = byId('f1');
    act(() => {
      inside.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    window.removeEventListener('keydown', witness);
    expect(closed).toBe(1);
    expect(windowSawEscape).toBe(0);
  });
});
