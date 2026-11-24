// @vitest-environment jsdom
// GUI-B BUG-04: Preferences › Reset local data opened its confirm AFTER closing
// the preferences dialog, so pressing Cancel dropped the user back on the
// canvas instead of returning to the settings they were editing. These tests
// pin the stacked contract: the confirm closes only on the confirming path.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../model/store';
import { PreferencesMenu } from './PreferencesMenu';
import { ConfirmDialog } from './confirmDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; PreferencesMenu subscribes to the dark-mode query.
if (!window.matchMedia) {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(
        'div',
        null,
        createElement(PreferencesMenu),
        createElement(ConfirmDialog),
      ),
    );
  });
}

function click(el: Element | null): void {
  if (!el) throw new Error('element not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

describe('Preferences › Reset local data (BUG-04)', () => {
  it('keeps Preferences open while the confirm is up and restores it on Cancel', () => {
    mount();
    click(document.querySelector('.prefs-trigger'));
    const prefs = document.querySelector('.prefs-dialog');
    expect(prefs).not.toBeNull();

    click(document.querySelector('.prefs-reset-btn'));
    // Both dialogs are on screen: the confirm stacks above the preferences.
    expect(document.querySelector('.prefs-dialog')).not.toBeNull();
    const confirm = document.querySelector('[role="alertdialog"]');
    expect(confirm).not.toBeNull();

    // Cancel is the first action in the confirm dialog.
    const cancel = confirm!.querySelector('.actions button');
    click(cancel);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('.prefs-dialog')).not.toBeNull();
  });

  it('closes Preferences only when the reset is confirmed', () => {
    mount();
    click(document.querySelector('.prefs-trigger'));
    click(document.querySelector('.prefs-reset-btn'));
    const confirm = document.querySelector('[role="alertdialog"]');
    const buttons = Array.from(confirm!.querySelectorAll('.actions button'));
    const confirmBtn = buttons[buttons.length - 1];
    click(confirmBtn);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('.prefs-dialog')).toBeNull();
  });

  it('CF-B-002: the undo-limit control persists 1000 and reset restores 100', () => {
    useStore.getState().setHistoryLimit(100);
    mount();
    click(document.querySelector('.prefs-trigger'));
    const limit = Array.from(document.querySelectorAll<HTMLSelectElement>('.prefs-select'))
      .find((select) => Array.from(select.options).some((option) => option.value === '1000'))!;
    expect(limit).toBeDefined();
    act(() => {
      limit.value = '1000';
      limit.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useStore.getState().historyLimit).toBe(1000);
    expect(localStorage.getItem('cladeforge:historyLimit')).toBe('1000');

    click(document.querySelector('.prefs-reset-btn'));
    const confirm = document.querySelector('[role="alertdialog"]')!;
    click(confirm.querySelector('.actions button:last-child'));
    expect(localStorage.getItem('cladeforge:historyLimit')).toBeNull();
    expect(useStore.getState().historyLimit).toBe(100);
  });
});
