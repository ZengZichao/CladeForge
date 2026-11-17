// @vitest-environment jsdom
// BUG-02 / P-09: the canvas legend chip looked dead in GUI testing. The main
// code path renders a local toggle that mounts the card on click; this pins it
// so a future regression cannot silently grey out the legend again.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CanvasLegend } from './CanvasLegend';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CanvasLegend)));
}

beforeEach(() => {
  act(() => useStore.getState().loadProject(createEmptyProject('legend')));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('CanvasLegend', () => {
  it('the chip opens the legend card and the card can be closed again', () => {
    mount();
    const toggle = document.querySelector('.legend-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(document.querySelector('.legend-card')).toBeNull();

    act(() => toggle.click());
    expect(document.querySelector('.legend-card')).not.toBeNull();

    act(() => (document.querySelector('.legend-close') as HTMLButtonElement).click());
    expect(document.querySelector('.legend-card')).toBeNull();
  });
});
