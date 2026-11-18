// @vitest-environment jsdom
// GUI-B BUG-07: the "save current settings as a preset" button was gated on
// state that only updated on blur/Enter, so a single paste (or a password
// manager's one-shot fill) left the button disabled. The field now mirrors its
// draft live.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExportSettingsDialog } from './ExportSettingsDialog';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(): void {
  useStore.getState().loadProject(createEmptyProject('Preset'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(ExportSettingsDialog, {
        open: true,
        onClose: () => undefined,
        onExport: () => undefined,
      }),
    );
  });
}

function nameInput(): HTMLInputElement {
  return document.querySelector('.export-preset-save input') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return document.querySelector('.export-preset-save button') as HTMLButtonElement;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('Export options — named presets (BUG-07)', () => {
  it('enables Save from a single paste-style input event', () => {
    mount();
    expect(saveButton().disabled).toBe(true);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput(), 'journal-600dpi');
      nameInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
    // No blur, no Enter — exactly what a password manager / paste produces.
    expect(nameInput().value).toBe('journal-600dpi');
    expect(saveButton().disabled).toBe(false);
  });

  it('disables Save again when the draft is cleared', () => {
    mount();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput(), 'x');
      nameInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saveButton().disabled).toBe(false);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput(), '   ');
      nameInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saveButton().disabled).toBe(true);
  });
});
