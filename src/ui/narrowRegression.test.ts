// @vitest-environment jsdom
// CF-B-007 / B-X02: focused guards for the defects reproduced in the running app.
// jsdom cannot measure layout; the CSS contract is secondary evidence, while the
// acceptance measurements are taken in Chromium at 320/390px and 280/480px panels.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimePanel } from './TimePanel';
import { setLanguage, S } from './strings';
import { useStore } from '../model/store';
import { createSampleProject } from '../model/sampleTree';

const css = readFileSync('src/styles/app.css', 'utf8');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;

beforeEach(() => {
  localStorage.clear();
  setLanguage('zh');
  useStore.getState().loadProject(createSampleProject());
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(TimePanel)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  style.remove();
});

function openEnvironmentalEvents(): void {
  const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button.section-toggle')).find(
    (button) => button.textContent?.includes(S.layoutPanel.envSection),
  );
  expect(toggle).toBeDefined();
  act(() => toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('CF-B-007 narrow header containment', () => {
  it('lets the menu and document actions wrap inside a 320px viewport', () => {
    // Chromium measured .menubar right=335 and .header-actions right=350 at a
    // 320px viewport. Both rows must be allowed to wrap rather than widen body.
    const narrow = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(
      /\.header-bar > \.menubar \{[^}]*flex-wrap:\s*wrap;/s,
    );
    expect(narrow).toMatch(
      /\.header-actions \{[^}]*max-width:\s*100%;[^}]*flex-wrap:\s*wrap;/s,
    );
    expect(css).toMatch(/\.status\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/s);
  });
});

describe('CF-C-004 coarse-pointer touch targets', () => {
  it('raises every HTML control and the previously omitted panel targets to 44px', () => {
    const touch = /@media \(max-width: 768px\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(touch).toMatch(/min-height:\s*44px;/);
    expect(touch).toMatch(/min-width:\s*44px;/);
    for (const selector of [
      '.section-pin',
      '.section-fav',
      '.group-pin',
      '.group-toggle',
      '.overlay-close',
      "input[type='color']",
      'input[type=\'range\']',
      '[role=\'tab\']',
      '[role=\'switch\']',
      '[role=\'menuitem\']',
    ]) {
      expect(touch).toContain(selector);
    }
    expect(touch).toContain('button,');
    expect(touch).toContain("input:not([type='hidden'])");
  });

  it('grows the reconciliation zoom container around its enlarged children', () => {
    const touch = /@media \(max-width: 768px\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(touch).toMatch(/\.recon-zoom-group \{[^}]*height:\s*44px;[^}]*overflow:\s*visible;/s);
    expect(touch).toMatch(/\.recon-zoom-group \{[^}]*flex:\s*0 0 auto;/s);
    expect(touch).toMatch(/\.recon-pane-header \{[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/s);
    expect(touch).toMatch(/\.recon-toolbar \{[^}]*flex:\s*0 0 auto;[^}]*flex-wrap:\s*nowrap;[^}]*min-height:\s*60px;[^}]*overflow-x:\s*auto;/s);
    expect(touch).toMatch(/\.recon-pane \{[^}]*grid-template-rows:\s*max-content minmax\(0, 1fr\);/s);
    expect(touch).toMatch(/\.recon-pane-count \{[^}]*display:\s*none;/s);
    expect(touch).toMatch(/\.recon-pane-title \{[^}]*flex:\s*1 1 0;/s);
    expect(touch).toMatch(/\.recon-status > \* \{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(touch).toMatch(/\.recon-workspace \{[^}]*overflow-y:\s*auto;/s);
    expect(touch).toMatch(/\.recon-workspace-row \{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*280px;/s);
  });

  it('uses the same 44px compact action track without overflowing a 232px row', () => {
    const touch = /@media \(max-width: 768px\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(touch).toMatch(/\.env-row \{[^}]*--env-action-track:\s*44px;/s);
    const compact = /@container \(max-width: 360px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(compact).toContain('grid-template-columns: minmax(108px, 1fr) var(--env-action-track, 32px) var(--env-action-track, 32px)');
    expect(compact).toMatch(/\.env-row > input\[type='text'\] \{[^}]*grid-row:\s*2;/s);
    expect(compact).toMatch(/\.env-row > \.env-summary \{[^}]*grid-row:\s*3;/s);
  });
});

describe('B-X02 environmental-event exact HEX input', () => {
  it('keeps every compact-row hex editor rendered and visible', () => {
    openEnvironmentalEvents();
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('.env-row .color-hex'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.value).toMatch(/^#[0-9a-f]{6}$/);
      expect(getComputedStyle(input).display).not.toBe('none');
      expect(getComputedStyle(input).visibility).not.toBe('hidden');
    }
  });

  it('provides a three-line compact-row layout when its container is narrow', () => {
    // At a 280px panel the event item has 232px of inline space. The colour
    // swatch + exact hex input and both 44px actions stay on row one; the name
    // and range summary each get a full-width line instead of overflowing.
    expect(css).toMatch(/\.env-item \{[^}]*container-type:\s*inline-size;/s);
    const compact = /@container \(max-width: 360px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(compact).toMatch(/\.env-row \{[^}]*grid-template-columns:/s);
    expect(compact).toMatch(/\.env-row > input\[type='text'\] \{[^}]*grid-row:\s*2;/s);
    expect(compact).toMatch(/\.env-row > \.env-summary \{[^}]*grid-row:\s*3;/s);
    expect(compact).toMatch(/\.env-row > \.btn\.icon \{[^}]*grid-row:\s*1;/s);
  });
});
