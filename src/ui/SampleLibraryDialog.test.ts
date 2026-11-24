// @vitest-environment jsdom
// CF-B-003 / B-X01: the library's explicit new-tab action must preserve the
// current document, and replacement confirmation must show the platform's key.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { ConfirmDialog } from './confirmDialog';
import { SampleLibraryDialog } from './SampleLibraryDialog';
import { changeLanguage } from './i18n';
import { S } from './strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeAll(() => changeLanguage('en'));

function mountLibrary(onClose = vi.fn()): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        'div',
        null,
        createElement(SampleLibraryDialog, { open: true, onClose }),
        createElement(ConfirmDialog),
      ),
    );
  });
}

function firstRowButton(label: string): HTMLButtonElement {
  const row = host.querySelector('.sample-library-row');
  const button = [...row!.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`Missing sample action: ${label}`);
  return button;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  useStore.getState().loadWorkspace([createEmptyProject('Untitled')], 0);
});

describe('SampleLibraryDialog explicit sample actions', () => {
  it('Open in a new tab preserves Untitled and opens Time-tree example in a second tab', () => {
    useStore.getState().loadWorkspace([createEmptyProject('Untitled')], 0);
    const untitledTabId = useStore.getState().activeTabId;
    const onClose = vi.fn();
    mountLibrary(onClose);

    act(() => firstRowButton(S.review.sampleOpenNew).click());

    const st = useStore.getState();
    expect(st.tabs).toHaveLength(2);
    expect(st.activeTabId).not.toBe(untitledTabId);
    expect(st.project.name).toBe('Time-tree example');
    expect(st.tabStore[untitledTabId].project.name).toBe('Untitled');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['Win32', 'Linux x86_64'])('shows the Ctrl save shortcut in replacement confirmation on %s', (platform) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    useStore.getState().loadWorkspace([createEmptyProject('Untitled')], 0);
    mountLibrary();

    act(() => firstRowButton(S.review.sampleReplaceCurrent).click());

    const message = host.querySelector('.confirm-message')?.textContent ?? '';
    expect(message).toContain('CtrlS');
    expect(message).not.toContain('⌘S');
  });
});
