// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Field } from './fields';
import { SliderNumberField } from './SliderNumberField';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import type { Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function field(label: string, control: ReactNode): ReactNode {
  return createElement(Field, { label, children: control });
}

/** A realistic host: the value comes from the store, as every panel does. */
function Harness() {
  const width = useStore((s) => s.project.defaults.branch.width);
  return field(
    '分支粗细',
    createElement(SliderNumberField, {
      value: width,
      min: 0.5,
      max: 40,
      step: 0.5,
      unit: 'px',
      recipe: (v: number) => (d: Project) => {
        d.defaults.branch.width = v;
      },
    }),
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.getState().loadProject(createEmptyProject('slider'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function numberInput(): HTMLInputElement {
  return host.querySelector('input[type="number"]') as HTMLInputElement;
}

function sliderInput(): HTMLInputElement {
  return host.querySelector('input[type="range"]') as HTMLInputElement;
}

function width(): number {
  return useStore.getState().project.defaults.branch.width;
}

describe('SliderNumberField', () => {
  it('renders BOTH a number input and a slider, each with an accessible name', () => {
    expect(numberInput()).not.toBeNull();
    expect(sliderInput()).not.toBeNull();
    expect(numberInput().getAttribute('aria-label')).toBe('分支粗细');
    expect(sliderInput().getAttribute('aria-label')).toMatch(/分支粗细.*(滑块|slider)/);
    expect(sliderInput().min).toBe('0.5');
    expect(sliderInput().max).toBe('40');
    expect(sliderInput().step).toBe('0.5');
  });

  it('previews live while dragging and records exactly ONE undo step', () => {
    const initial = width();
    const slider = sliderInput();
    act(() => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(useStore.getState().interactionBase).not.toBeNull();

    nativeValueSetter.call(slider, '12');
    act(() => {
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(width()).toBe(12);
    // Live previews must not flood the undo budget.
    expect(useStore.getState().past).toHaveLength(0);

    act(() => {
      slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    expect(useStore.getState().past).toHaveLength(1);

    act(() => useStore.getState().undo());
    expect(width()).toBe(initial);
  });

  it('still commits through the number input, as one undo step', () => {
    const input = numberInput();
    nativeValueSetter.call(input, '16');
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(width()).toBe(16);
    expect(useStore.getState().past).toHaveLength(1);
  });
});
