// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { addBlankLayer } from '../model/layers';
import { StandardWorkspace } from './StandardWorkspace';
import { setLanguage } from './strings';

vi.mock('../canvas/TreeCanvas', () => ({ TreeCanvas: () => null }));
vi.mock('./CanvasControls', () => ({ CanvasControls: () => null }));
vi.mock('./TimePanel', () => ({ TimePanel: () => null }));
vi.mock('./LayoutPanel', () => ({ LayoutPanel: () => null }));
vi.mock('./PropertiesPanel', () => ({ PropertiesPanel: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let toggleMaster: () => void;

function Harness({ resetVersion = 0 }: { resetVersion?: number }) {
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [bothPanelsHidden, setBothPanelsHidden] = useState(false);
  toggleMaster = () => {
    if (panelsHidden || bothPanelsHidden) {
      setPanelsHidden(false);
      window.dispatchEvent(new CustomEvent('cladeforge:show-panels'));
    } else {
      setPanelsHidden(true);
    }
  };
  return createElement(StandardWorkspace, {
    panelsHidden,
    autosaveResetVersion: resetVersion,
    onShowPanels: () => setPanelsHidden(false),
    onBothPanelsHiddenChange: setBothPanelsHidden,
    onAddChildrenDialog: () => undefined,
  });
}

function mount() {
  act(() => root.render(createElement(Harness)));
}

function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button!.click());
}

function display(side: 'left' | 'right'): string {
  return host.querySelector<HTMLElement>(`.panel-${side}`)!.style.display;
}

beforeEach(() => {
  setLanguage('en');
  vi.stubGlobal('innerWidth', 1400);
  const project = createEmptyProject('tree');
  addChildren(project, project.rootId, 2);
  useStore.getState().loadProject(project);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('status-bar hypothesis layer switch (UX-001)', () => {
  it('disables the sole layer with a current-state explanation instead of offering a no-op', () => {
    const button = host.querySelector<HTMLButtonElement>('.status-layer');
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(button!.title).toContain('Only one hypothesis layer');
    expect(button!.getAttribute('aria-label')).toContain('Only one hypothesis layer');
    const before = useStore.getState().project;
    act(() => button!.click());
    expect(useStore.getState().project).toBe(before);
  });

  it('keeps enabled cycling through multiple hypothesis layers', () => {
    let nextId = '';
    act(() => useStore.getState().apply((draft) => {
      nextId = addBlankLayer(draft, 'Alternative');
    }));
    const button = host.querySelector<HTMLButtonElement>('.status-layer')!;
    expect(button.disabled).toBe(false);
    expect(button.title).toContain('click to switch to the next layer');
    act(() => button.click());
    expect(useStore.getState().project.activeLayerId).toBe(nextId);
    expect(button.textContent).toContain('Alternative');
  });
});

describe('StandardWorkspace autosave status after local-data reset', () => {
  it('clears the stale Saving indicator when reset invalidates the pending write', () => {
    act(() => useStore.getState().apply((draft) => { draft.name = 'edited before reset'; }));
    expect(host.querySelector('.status-saving')).not.toBeNull();

    act(() => root.render(createElement(Harness, { resetVersion: 1 })));

    expect(host.querySelector('.status-saving')).toBeNull();
  });
});

describe('StandardWorkspace master panel toggle (CF-B-001)', () => {
  it('restores both panels after each side was hidden independently', () => {
    expect(display('left')).not.toBe('none');
    expect(display('right')).not.toBe('none');
    click('.panel-left .overlay-close');
    click('.panel-right .overlay-close');
    expect(display('left')).toBe('none');
    expect(display('right')).toBe('none');

    act(() => toggleMaster());
    expect(display('left')).not.toBe('none');
    expect(display('right')).not.toBe('none');
  });

  it('keeps ordinary master hide/show semantics when no side was collapsed', () => {
    act(() => toggleMaster());
    expect(display('left')).toBe('none');
    expect(display('right')).toBe('none');
    act(() => toggleMaster());
    expect(display('left')).not.toBe('none');
    expect(display('right')).not.toBe('none');
  });
});
