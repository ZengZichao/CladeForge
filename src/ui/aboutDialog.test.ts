// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// E-P6: the About box showed only the APP version (0.3.0) while saved project
// files carry the project-format version (PROJECT_VERSION, 0.2.0). Two
// different numbers with one label read as a contradiction, so the dialog must
// state the format version explicitly, next to the app version.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AboutDialog } from './AboutDialog';
import { PROJECT_VERSION } from '../model/types';
import pkg from '../../package.json';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(AboutDialog, { open: true, onClose: () => undefined })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function row(dtText: string): HTMLElement | undefined {
  return Array.from(host.querySelectorAll<HTMLElement>('.about-row')).find(
    (r) => r.querySelector('dt')?.textContent === dtText,
  );
}

describe('AboutDialog — app version vs project format version (E-P6)', () => {
  it('states the project format version from PROJECT_VERSION', () => {
    const format = row('项目格式版本');
    expect(format).toBeDefined();
    expect(format?.querySelector('dd')?.textContent).toBe(PROJECT_VERSION);
  });

  it('keeps the existing app-version row', () => {
    const app = row('版本');
    expect(app).toBeDefined();
    // Not under Tauri in tests, so the frontend package version is the fallback.
    expect(app?.querySelector('dd')?.textContent).toContain(pkg.version);
  });
});
