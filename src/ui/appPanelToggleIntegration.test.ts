// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { addBuiltGeneTree, createGeneDocFromSpecies } from '../model/geneTreeBuild';
import { resetAutosaveState } from '../io/autosave';
import { changeLanguage } from './i18n';

// Keep App, HeaderActions and StandardWorkspace real. Only their expensive or
// unrelated child surfaces are replaced; panel state and event wiring stay live.
vi.mock('../canvas/TreeCanvas', () => ({ TreeCanvas: () => null }));
vi.mock('./TimePanel', () => ({ TimePanel: () => null }));
vi.mock('./LayoutPanel', () => ({ LayoutPanel: () => null }));
vi.mock('./PropertiesPanel', () => ({ PropertiesPanel: () => null }));
vi.mock('./CanvasControls', () => ({ CanvasControls: () => null }));
vi.mock('../canvas/ReconciliationView', () => ({ ReconciliationView: () => null }));
vi.mock('./ReconPanel', () => ({ ReconPanel: () => null }));
vi.mock('./ReconInspector', () => ({ ReconInspector: () => null }));
vi.mock('./MenuBar', () => ({ MenuBar: () => null }));
vi.mock('./FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('./NarrowScreenHint', () => ({ NarrowScreenHint: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

let host: HTMLDivElement;
let root: Root;

function panel(side: 'left' | 'right'): HTMLElement {
  const element = host.querySelector<HTMLElement>(`.panel-${side}`);
  expect(element).not.toBeNull();
  return element!;
}

function expectPanelVisibility(left: boolean, right: boolean): void {
  expect(panel('left').style.display === 'none').toBe(!left);
  expect(panel('right').style.display === 'none').toBe(!right);
}

function closePanel(side: 'left' | 'right'): void {
  const button = host.querySelector<HTMLButtonElement>(`.panel-${side} .overlay-close`);
  expect(button).not.toBeNull();
  expect(button!.getAttribute('aria-label')).toBe(`Hide ${side} panel`);
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

function hidePanelsIndependently(): void {
  expectPanelVisibility(true, true);
  closePanel('left');
  expectPanelVisibility(false, true);
  closePanel('right');
  expectPanelVisibility(false, false);
}

function clickMasterPanelButton(): void {
  const button = host.querySelector<HTMLButtonElement>(
    '.header-actions button[aria-label^="Show / hide both side panels"]',
  );
  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(false);
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

function pressModifierPeriod(metaKey: boolean): void {
  const event = new KeyboardEvent('keydown', {
    key: '.',
    metaKey,
    ctrlKey: !metaKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

function clickTab(label: string): void {
  const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(tab, `tab ${label}`).toBeDefined();
  act(() => tab!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

function enterReconTarget(target: 'species' | 'gene' | 'recon' | 'embedded'): void {
  clickTab('Reconciliation view');
  clickTab({
    species: 'Edit species tree',
    gene: 'Edit gene tree',
    recon: 'Reconciliation mapping',
    embedded: 'Nested reconciliation preview',
  }[target]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerWidth', 1600);
  changeLanguage('en');
  localStorage.clear();
  resetAutosaveState();
  useStore.setState(useStore.getInitialState(), true);
  const project = createEmptyProject('Panel integration tree');
  addChildren(project, project.rootId, 2);
  addBuiltGeneTree(project, createGeneDocFromSpecies(project, 'Panel integration gene'));
  useStore.getState().loadWorkspace([project], 0);

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(App)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute('data-header-compact');
  localStorage.clear();
  resetAutosaveState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App master side-panel recovery (CF-B-001)', () => {
  it('restores both independently hidden panels after one click on the real header button', () => {
    hidePanelsIndependently();

    clickMasterPanelButton();

    expectPanelVisibility(true, true);
  });

  it.each([
    ['⌘', true],
    ['Ctrl', false],
  ] as const)('restores both panels through the real %s+. shortcut after independently hiding them again', (_label, metaKey) => {
    hidePanelsIndependently();
    clickMasterPanelButton();
    expectPanelVisibility(true, true);

    hidePanelsIndependently();
    pressModifierPeriod(metaKey);

    expectPanelVisibility(true, true);
  });

  it.each(['species', 'gene'] as const)(
    'restores independently hidden panels in the nested %s editor with one header click or shortcut',
    (target) => {
      enterReconTarget(target);
      expectPanelVisibility(true, true);
      hidePanelsIndependently();

      clickMasterPanelButton();
      expectPanelVisibility(true, true);

      hidePanelsIndependently();
      pressModifierPeriod(true);
      expectPanelVisibility(true, true);
    },
  );

  it.each(['recon', 'embedded'] as const)(
    'forgets independent standard-panel hiding when switching to the %s surface',
    (target) => {
      hidePanelsIndependently();
      enterReconTarget(target);
      expectPanelVisibility(true, true);

      clickMasterPanelButton();
      expectPanelVisibility(false, false);

      pressModifierPeriod(true);
      expectPanelVisibility(true, true);
    },
  );

  it('forgets nested independent hiding across embedded and gene-target switches', () => {
    enterReconTarget('species');
    hidePanelsIndependently();

    clickTab('Nested reconciliation preview');
    expectPanelVisibility(true, true);
    clickTab('Edit gene tree');
    expectPanelVisibility(true, true);

    clickMasterPanelButton();
    expectPanelVisibility(false, false);

    pressModifierPeriod(false);
    expectPanelVisibility(true, true);
  });

  it('forgets independent hiding while the reconciliation surface is empty', () => {
    enterReconTarget('species');
    hidePanelsIndependently();
    clickTab('Reconciliation mapping');
    const geneId = useStore.getState().activeGeneTreeId;
    expect(geneId).not.toBeNull();

    act(() => useStore.getState().setActiveGeneTree(null));
    expect(host.querySelector('.recon-left')).toBeNull();
    act(() => useStore.getState().setActiveGeneTree(geneId));
    expectPanelVisibility(true, true);

    clickMasterPanelButton();
    expectPanelVisibility(false, false);
  });
});
