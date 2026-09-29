// @vitest-environment jsdom
// The inspector's colour field buffers rather than committing on every
// `onChange`. A native `<input type="color">` fires `input` for EVERY pixel of
// the drag, and each commit goes through `ns({ fill })` → `apply()` → one undo
// step, so one drag of one swatch would burn dozens of the 100 history slots and
// leave the user unable to step back past it.
//
// `NumberField` next to it already has the right shape (buffer, commit once).
// `ColorField` keeps its `onChange` name and is buffered to one commit per
// interaction. These tests drive a realistic drag and count the commits — the
// number of `onChange` calls IS the number of history entries.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ColorField } from './fields';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(node: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function rerender(node: ReactNode): void {
  act(() => root!.render(node));
}

function cleanup(): void {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

function colorInput(): HTMLInputElement {
  const el = document.querySelector('input[type="color"]');
  if (!el) throw new Error('no colour input rendered');
  return el as HTMLInputElement;
}

/**
 * One pixel of a native colour drag: set the value, then let React see it.
 *
 * The value has to be written through the prototype's own setter. React installs
 * a `_valueTracker` property override on the input, so a plain `el.value = v`
 * updates the tracker too and React then treats the following `input` event as
 * "no change" and never reaches `onChange`.
 */
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)!.set!;

function dragTo(el: HTMLInputElement, value: string): void {
  nativeValueSetter.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fire(el: HTMLInputElement, type: string): void {
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

/** The 32-frame sweep of a real picker drag. */
const DRAG = Array.from({ length: 32 }, (_, i) => `#${i.toString(16).padStart(2, '0')}${'80'}${'ff'}`);

describe('ColorField — one drag, one commit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('coalesces a 32-frame drag into a single onChange, with the final colour', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    for (const v of DRAG) dragTo(el, v);

    // Still mid-drag: nothing has been committed yet.
    expect(onChange).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DRAG[DRAG.length - 1]);
  });

  it('releasing the pointer commits immediately, once', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#00ff00');
    dragTo(el, '#00ff80');
    fire(el, 'pointerup');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#00ff80');
    // The pending debounce must not fire a second, identical step.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('blur commits the pending value so nothing is lost', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#123456');
    // React surfaces `onBlur` from the bubbling `focusout` event.
    fire(el, 'focusout');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('a no-op pick (the same colour) records no step at all', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#000000');
    fire(el, 'pointerup');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('two drags, well apart, are two commits — coalescing is not suppression', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#aaaaaa');
    fire(el, 'pointerup');
    dragTo(el, '#bbbbbb');
    fire(el, 'pointerup');
    expect(onChange.mock.calls).toEqual([['#aaaaaa'], ['#bbbbbb']]);
  });

  it('the committed value is fed back so the next drag starts from it', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#ff0000');
    fire(el, 'pointerup');
    expect(onChange).toHaveBeenCalledWith('#ff0000');
    // The parent re-renders with the new value; a drag back to it is a real edit.
    rerender(createElement(ColorField, { value: '#ff0000', onChange }));
    dragTo(el, '#0000ff');
    fire(el, 'pointerup');
    expect(onChange.mock.calls).toEqual([['#ff0000'], ['#0000ff']]);
  });

  it('a drag still pending when the field unmounts flushes once, not zero times', () => {
    // The panels unmount their colour rows on a click that ends the edit (or on a
    // type flip, which swaps the whole row set). A debounce that died with the field
    // silently discarded the colour the user had just picked.
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    const el = colorInput();
    dragTo(el, '#123abc');
    dragTo(el, '#654321');
    expect(onChange).toHaveBeenCalledTimes(0); // mid-drag, nothing committed yet
    cleanup();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#654321');
    // The timer is gone with the field, so there is no second commit after unmount.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a field that unmounted untouched commits nothing', () => {
    const onChange = vi.fn();
    mount(createElement(ColorField, { value: '#000000', onChange }));
    cleanup();
    expect(onChange).not.toHaveBeenCalled();
  });
});
