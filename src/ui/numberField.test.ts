// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// `NumberField` used to accept a `unit` that was rendered only as the input's
// placeholder — i.e. it vanished exactly when a value was present, which is
// when the user is reading the number. BUG-8/T19 requires a visible unit
// decoration; these tests pin the new contract down:
//   - the decoration is optional (every caller that passes nothing, which is
//     most of the app, must render exactly as before),
//   - it stays visible for a filled field and can sit on either side,
//   - the input stays a normal editable number input and still commits,
//   - a pasted "35 Ma" / "0.5 %" is reduced to its numeric part instead of
//     being rejected by the number input (the unit lives in the decoration).

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NumberField } from './fields';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mount(node: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

beforeEach(() => mount(createElement('div', null)));
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function renderField(props: Parameters<typeof NumberField>[0]): void {
  act(() =>
    root.render(
      createElement(NumberField, props),
    ),
  );
}

function numberInput(): HTMLInputElement {
  const el = host.querySelector('input[type="number"]');
  if (!el) throw new Error('no number input rendered');
  return el as HTMLInputElement;
}

function unitSpan(): HTMLElement | null {
  return host.querySelector('.number-unit');
}

/** Same native-setter trick as fields.test.ts: React tracks the last value it saw. */
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)!.set!;

function type(el: HTMLInputElement, value: string): void {
  nativeValueSetter.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(el: HTMLInputElement): void {
  act(() => {
    el.dispatchEvent(new Event('focusout', { bubbles: true }));
  });
}

describe('NumberField — visible unit decoration', () => {
  it('renders the unit as a visible suffix while a value is present', () => {
    renderField({ value: 35, unit: 'Ma', unitTitle: 'million years ago', onCommit: () => undefined });
    expect(numberInput().value).toBe('35');
    expect(unitSpan()?.textContent).toBe('Ma');
    expect(unitSpan()?.getAttribute('title')).toBe('million years ago');
    // The decoration is described-by the input, not dropped for screen readers.
    expect(numberInput().getAttribute('aria-describedby')).toBe(unitSpan()?.id);
    expect(numberInput().getAttribute('title')).toBe('million years ago');
  });

  it('renders nothing extra when the unit prop is omitted (back-compat)', () => {
    renderField({ value: 3, onCommit: () => undefined });
    expect(unitSpan()).toBeNull();
    expect(numberInput().getAttribute('aria-describedby')).toBeNull();
    expect(host.querySelector('.number-input-row')).not.toBeNull();
  });

  it('supports a prefix placement', () => {
    renderField({ value: 2, unit: '$', unitSide: 'prefix', onCommit: () => undefined });
    const row = host.querySelector('.number-input-row')!;
    expect(row.firstElementChild).toBe(unitSpan());
    expect(row.classList.contains('unit-prefix')).toBe(true);
  });

  it('keeps the unit visible after the value is edited and commits a number', () => {
    const onCommit = vi.fn();
    renderField({ value: 1, unit: 'px', onCommit });
    const input = numberInput();
    type(input, '12');
    expect(unitSpan()?.textContent).toBe('px');
    blur(input);
    expect(onCommit).toHaveBeenCalledWith(12);
    expect(unitSpan()?.textContent).toBe('px');
  });

  it('separates the empty-field placeholder hint from the unit decoration', () => {
    renderField({
      value: undefined,
      allowEmpty: true,
      unit: '%',
      hint: '0–1 or 0–100',
      onCommit: () => undefined,
    });
    expect(numberInput().getAttribute('placeholder')).toBe('0–1 or 0–100');
    // The unit does not depend on the placeholder being visible.
    expect(unitSpan()?.textContent).toBe('%');
  });

  it('accepts a pasted "35 Ma" by keeping only the numeric part', () => {
    const onCommit = vi.fn();
    renderField({ value: undefined, allowEmpty: true, unit: 'Ma', onCommit });
    const input = numberInput();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '35 Ma' },
    });
    act(() => {
      input.dispatchEvent(paste);
    });
    expect(input.value).toBe('35');
    blur(input);
    expect(onCommit).toHaveBeenCalledWith(35);
  });

  it('accepts a pasted "0.5 %" the same way', () => {
    const onCommit = vi.fn();
    renderField({ value: undefined, allowEmpty: true, onCommit });
    const input = numberInput();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '0.5 %' },
    });
    act(() => {
      input.dispatchEvent(paste);
    });
    expect(input.value).toBe('0.5');
    blur(input);
    expect(onCommit).toHaveBeenCalledWith(0.5);
  });

  it('leaves a non-numeric paste to the browser', () => {
    renderField({ value: 7, onCommit: () => undefined });
    const input = numberInput();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'not a number' },
    });
    act(() => {
      input.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
    expect(input.value).toBe('7');
  });
});
