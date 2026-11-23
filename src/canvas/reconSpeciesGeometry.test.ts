// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TreeCanvas } from './TreeCanvas';
import { computeEmbeddedSpeciesLayout } from '../layout/embeddedRecon';
import { createReconciliationSample } from '../model/sampleTree';
import { useStore } from '../model/store';
import { PropertiesPanel } from '../ui/PropertiesPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node as never));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  act(() => useStore.getState().setReconMode(false));
});

function enterSpeciesEditor(): void {
  const project = createReconciliationSample();
  act(() => {
    useStore.getState().loadProject(project);
    useStore.getState().setReconMode(true);
    useStore.getState().setReconEditTarget('species');
  });
}

describe('species editor and nested preview share geometry', () => {
  it('uses the same node coordinates in the species editor and the nested layout', () => {
    enterSpeciesEditor();
    const el = mount(createElement(TreeCanvas));
    const project = useStore.getState().project;
    const expected = computeEmbeddedSpeciesLayout(project);

    for (const id of expected.visible) {
      const label = project.nodes[id].label;
      const group = [...el.querySelectorAll('g.node-group')].find((candidate) =>
        candidate.getAttribute('aria-label')?.startsWith(label),
      );
      expect(group, label).toBeTruthy();
      const [x, y] = (group!.getAttribute('transform') ?? '')
        .match(/translate\(([-\d.]+) ([-\d.]+)\)/)!
        .slice(1)
        .map(Number);
      const point = expected.positions.get(id)!;
      expect(x, label).toBeCloseTo(point.x, 6);
      expect(y, label).toBeCloseTo(point.y, 6);
    }
  });

  it('switches both surfaces to measured lengths when a branch length is edited', () => {
    enterSpeciesEditor();
    const project = useStore.getState().project;
    const node = Object.values(project.nodes).find((candidate) => candidate.label === 'N1')!;
    act(() => useStore.getState().select(node.id));
    const el = mount(createElement(PropertiesPanel));
    const firstSection = el.querySelector('button.section-toggle');
    if (firstSection?.getAttribute('aria-expanded') === 'false') {
      act(() => (firstSection as HTMLButtonElement).click());
    }
    const input = [...el.querySelectorAll('input[type="number"]')].find(
      (candidate) => ['枝长', 'Branch length'].includes(candidate.getAttribute('aria-label') ?? ''),
    ) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, '50');
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
    act(() => input.dispatchEvent(new Event('focusout', { bubbles: true })));

    const edited = useStore.getState().project;
    expect(edited.nodes[node.id].branchLength).toBe(50);
    expect(edited.layout.type).toBe('rectangular-phylogram');
    expect(computeEmbeddedSpeciesLayout(edited).positions.get(node.id)!.x).toBe(400);
  });
});
