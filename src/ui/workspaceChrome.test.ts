// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore, workspaceHasPanels } from '../model/store';
import { ReconWorkspace } from '../canvas/ReconWorkspace';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { HeaderActions } from './Toolbar';
import { changeLanguage } from './i18n';

vi.mock('../io/fileActions', () => ({
  actionSaveProject: vi.fn(),
  openAppDialog: vi.fn(),
}));
vi.mock('./StandardWorkspace', () => ({ StandardWorkspace: () => null }));
vi.mock('../ui/ReconToolbar', () => ({ ReconToolbar: () => null }));
vi.mock('../ui/ReconPanel', () => ({ ReconPanel: () => null }));
vi.mock('../ui/ReconInspector', () => ({ ReconInspector: () => null }));
vi.mock('../ui/ReconStatusBar', () => ({ ReconStatusBar: () => null }));
vi.mock('../canvas/ReconciliationView', () => ({ ReconciliationView: () => null }));

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

beforeEach(() => {
  changeLanguage('en');
  localStorage.clear();
  useStore.getState().loadWorkspace([createEmptyProject()], 0);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(HeaderActions)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function panelToggle(): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label')?.includes('Show / hide') &&
      button.getAttribute('aria-label')?.includes('side panels'),
  )!;
}

describe('header side-panel availability (IMP-001)', () => {
  it('disables the toggle and explains that a blank workspace has no panels', () => {
    const button = panelToggle();
    expect(button).toBeDefined();
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('no tree content');
    expect(button.getAttribute('aria-label')).toContain('no tree content');
  });

  it('keeps the toggle active for a standard workspace with a tree', () => {
    const project = createEmptyProject('tree');
    addChildren(project, project.rootId, 2);
    act(() => useStore.getState().loadWorkspace([project], 0));
    const button = panelToggle();
    expect(button.disabled).toBe(false);
    expect(button.title).toContain('Show / hide both side panels');

    const toggled = vi.fn();
    window.addEventListener('cladeforge:toggle-panels', toggled);
    act(() => button.click());
    window.removeEventListener('cladeforge:toggle-panels', toggled);
    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it('uses the effective gene-tree content for reconciliation and its empty/import-empty state', () => {
    const project = createEmptyProject('species');
    const doc = createEmptyProject('gene');
    project.geneTrees = [{ id: 'gene-1', name: 'Gene 1', doc, assumptions: {} }];
    act(() => useStore.setState({ project, reconMode: true, activeGeneTreeId: 'gene-1' }));
    expect(workspaceHasPanels(useStore.getState())).toBe(true);
    expect(panelToggle().disabled).toBe(false);

    act(() => useStore.getState().apply((draft) => { draft.geneTrees = []; }));
    expect(workspaceHasPanels(useStore.getState())).toBe(false);
    expect(panelToggle().disabled).toBe(true);
    expect(panelToggle().title).toContain('no tree content');
  });

  it('requires editable tree content as well as an active gene tree in tree-edit surfaces', () => {
    const project = createEmptyProject('species');
    const gene = createEmptyProject('gene');
    project.geneTrees = [{ id: 'gene-1', name: 'Gene 1', doc: gene, assumptions: {} }];
    act(() => useStore.setState({
      project,
      reconMode: true,
      reconEditTarget: 'species',
      activeGeneTreeId: 'gene-1',
    }));
    expect(workspaceHasPanels(useStore.getState())).toBe(false);

    act(() => useStore.getState().setReconEditTarget('gene'));
    expect(useStore.getState().project).toBe(gene);
    expect(workspaceHasPanels(useStore.getState())).toBe(false);
  });

  it('hides reconciliation panels when no active gene tree matches the workspace', () => {
    const project = createEmptyProject('species');
    project.geneTrees = [{ id: 'gene-1', name: 'Gene 1', doc: createEmptyProject('gene'), assumptions: {} }];
    act(() => useStore.setState({
      project,
      reconMode: true,
      reconEditTarget: 'recon',
      activeGeneTreeId: 'missing-gene',
    }));

    expect(workspaceHasPanels(useStore.getState())).toBe(false);
    expect(panelToggle().disabled).toBe(true);

    act(() => root.render(createElement(ReconWorkspace, {
      panelsHidden: false,
      onShowPanels: () => undefined,
      onCopySpeciesTree: () => undefined,
      onAddChildrenDialog: () => undefined,
      onAddChildrenDialogGene: () => undefined,
    })));
    expect(host.querySelector('.recon-left')).toBeNull();
    expect(host.querySelector('.recon-right')).toBeNull();
  });

  it('disables panels for species editing when the reconciliation has no gene trees', () => {
    const project = createEmptyProject('species');
    addChildren(project, project.rootId, 2);
    act(() => useStore.setState({
      project,
      reconMode: true,
      reconEditTarget: 'species',
      activeGeneTreeId: null,
    }));

    expect(workspaceHasPanels(useStore.getState())).toBe(false);
    expect(panelToggle().disabled).toBe(true);
    expect(panelToggle().title).toContain('no tree content');

    act(() => root.render(createElement(ReconWorkspace, {
      panelsHidden: false,
      onShowPanels: () => undefined,
      onCopySpeciesTree: () => undefined,
      onAddChildrenDialog: () => undefined,
      onAddChildrenDialogGene: () => undefined,
    })));
    expect(host.querySelector('.recon-editing')).toBeNull();
    expect(host.querySelector('.recon-left')).toBeNull();
  });

  it('does not expose a panel opener or hidden panel in a narrow empty reconciliation workspace', () => {
    vi.stubGlobal('innerWidth', 800);
    act(() => useStore.setState({ reconMode: true, reconEditTarget: 'recon' }));
    act(() => root.render(createElement(ReconWorkspace, {
      panelsHidden: false,
      onShowPanels: () => undefined,
      onCopySpeciesTree: () => undefined,
      onAddChildrenDialog: () => undefined,
      onAddChildrenDialogGene: () => undefined,
    })));
    expect(host.querySelector('.panel-toggle-btn.left')).toBeNull();
    expect(host.querySelector('.recon-left')).toBeNull();
  });
});
