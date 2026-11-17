// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// GUI-report regressions for the find & replace preview (H-D1 / H-D7):
//   * H-D1: a COMPLETE node name searched with an empty "Replace with" must
//     still appear in the preview, flagged as skipped — it used to vanish and
//     read as "No matches" while a substring of the same name matched.
//   * H-D7: a node-backed preview row is a real button that focuses + selects
//     the node on the canvas.

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FindReplaceDialog } from './FindReplaceDialog';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { changeLanguage } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  changeLanguage('en');
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

function seed(): { rootId: string; childId: string } {
  useStore.getState().loadProject(createEmptyProject('FindReplace'));
  let rootId = '';
  let childId = '';
  act(() => {
    useStore.getState().apply((d) => {
      rootId = d.rootId;
      d.nodes[d.rootId].label = 'Taxon_A';
      childId = addChildren(d, d.rootId, 1)[0];
      d.nodes[childId].label = 'Taxon_B';
    });
  });
  return { rootId, childId };
}

/** The two search boxes are the only text inputs in the dialog's top grid. */
function setText(index: number, value: string): void {
  const input = document.querySelectorAll<HTMLInputElement>('.find-replace-grid input')[index];
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function applyButton(): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('.find-replace-dialog button')].find(
    (b) => b.textContent === 'Replace all',
  )!;
}

function rowButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.find-replace-locate')];
}

describe('FindReplaceDialog preview', () => {
  it('shows a complete-name hit as blocked instead of "No matches" (H-D1)', () => {
    seed();
    mount(createElement(FindReplaceDialog, { open: true, onClose: () => {} }));
    setText(0, 'Taxon_A');
    setText(1, '');
    const text = host!.textContent ?? '';
    expect(text).not.toContain('No matches');
    expect(text).toContain('empty name');
    // Nothing is applicable, so the commit button must stay disabled.
    expect(applyButton().disabled).toBe(true);
    expect(rowButtons()).toHaveLength(1);
  });

  it('counts only applicable replacements and enables Replace all for a substring (H-D1)', () => {
    seed();
    mount(createElement(FindReplaceDialog, { open: true, onClose: () => {} }));
    setText(0, 'Taxon');
    setText(1, '');
    expect(host!.textContent).toContain('2 replacements will be made');
    expect(applyButton().disabled).toBe(false);
  });

  it('clicking a node-backed row focuses and selects that node (H-D7)', () => {
    const { rootId } = seed();
    mount(createElement(FindReplaceDialog, { open: true, onClose: () => {} }));
    setText(0, 'Taxon');
    setText(1, '');
    const row = rowButtons().find((b) => b.textContent?.includes('Taxon_A'));
    expect(row).toBeDefined();
    act(() => row!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useStore.getState().focusTarget?.id).toBe(rootId);
    expect(useStore.getState().selection).toEqual([rootId]);
  });
});
