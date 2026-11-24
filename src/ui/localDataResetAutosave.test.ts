// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { readWorkspace } from '../io/projectIO';
import { changeLanguage } from './i18n';
import { initTheme } from './theme';
import { resetAutosaveState } from '../io/autosave';

vi.mock('../io/desktopShell', () => ({
  initDesktopShell: () => () => undefined,
  requestWindowClose: vi.fn(),
}));
vi.mock('./MenuBar', () => ({ MenuBar: () => null }));
vi.mock('./StandardWorkspace', () => ({ StandardWorkspace: () => null }));
vi.mock('../canvas/ReconWorkspace', () => ({ ReconWorkspace: () => null }));
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
let root: Root | null;

function mountApp(): void {
  act(() => root!.render(createElement(App)));
}

function click(selector: string): void {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  act(() => (element as HTMLElement).click());
}

function confirmReset(): void {
  click('.prefs-trigger');
  click('.prefs-reset-btn');
  click('[role="alertdialog"] .actions button:last-child');
}

beforeEach(() => {
  vi.useFakeTimers();
  changeLanguage('en');
  localStorage.clear();
  localStorage.setItem('cladeforge:theme', 'dark');
  initTheme();
  resetAutosaveState();
  const project = createEmptyProject('old edited document');
  addChildren(project, project.rootId, 2);
  useStore.getState().loadWorkspace([project], 0);
  const other = createEmptyProject('other open document');
  addChildren(other, other.rootId, 1);
  useStore.getState().openInNewTab(other);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mountApp();
  act(() => vi.advanceTimersByTime(800));
  act(() => useStore.getState().apply((draft) => { draft.name = 'QA_Reset'; }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  resetAutosaveState();
});

describe('Reset local data invalidates workspace autosave (IMP-003)', () => {
  it('does not write the old document after reset and reloads a clean blank workspace', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    confirmReset();

    const state = useStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabStore).toEqual({});
    expect(state.project.name).not.toBe('QA_Reset');
    expect(state.project.nodes[state.project.rootId].childrenIds).toEqual([]);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(localStorage.getItem('cladeforge:theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => vi.advanceTimersByTime(5000));
    expect(writes.mock.calls.filter(([key]) => key === 'cladeforge:workspace')).toEqual([]);
    expect(readWorkspace()).toBeNull();

    // Simulate a fresh process: discard in-memory state, then boot App again.
    act(() => root!.unmount());
    root = null;
    useStore.setState(useStore.getInitialState(), true);
    root = createRoot(host);
    mountApp();
    expect(useStore.getState().project.name).not.toBe('QA_Reset');
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().project.nodes[useStore.getState().project.rootId].childrenIds).toEqual([]);
  });

  it('cancelling keeps Preferences open and leaves the pending edited-document write intact', () => {
    click('.prefs-trigger');
    click('.prefs-reset-btn');
    expect(document.querySelector('.prefs-dialog')).not.toBeNull();
    click('[role="alertdialog"] .actions button:first-child');
    expect(document.querySelector('.prefs-dialog')).not.toBeNull();
    expect(useStore.getState().project.name).toBe('QA_Reset');

    act(() => vi.advanceTimersByTime(800));
    expect(readWorkspace()?.projects.find((project) => project.name === 'QA_Reset')).toBeDefined();
    expect(localStorage.getItem('cladeforge:theme')).toBe('dark');
  });

  it('resumes normal autosave when the user edits the new blank workspace', () => {
    confirmReset();
    act(() => useStore.getState().apply((draft) => { draft.name = 'new work after reset'; }));
    act(() => vi.advanceTimersByTime(800));
    expect(readWorkspace()?.projects).toHaveLength(1);
    expect(readWorkspace()?.projects[0]?.name).toBe('new work after reset');
  });
});
