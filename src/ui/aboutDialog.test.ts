// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// E-P6: the About box showed only the APP version (0.3.0) while saved project
// files carry the project-format version (PROJECT_VERSION, 0.2.0). Two
// different numbers with one label read as a contradiction, so the dialog must
// state the format version explicitly, next to the app version.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AboutDialog } from './AboutDialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PROJECT_VERSION } from '../model/types';
import { useToasts } from './toast';
// Preload the real clipboard module so repository-copy assertions exercise the
// shared helper rather than import timing; each test awaits the click result.
import '../io/clipboardIO';
import pkg from '../../package.json';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The OS browser launch is external to the component; everything from the click
// handler through result reporting remains real.
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useToasts.setState({ toasts: [] });
  vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
  act(() => root.render(createElement(AboutDialog, { open: true, onClose: () => undefined })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useToasts.setState({ toasts: [] });
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

async function clickRepository(): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent === 'github.com/zengzichao/CladeForge',
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Flush the handler's opener import and clipboard promises.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
}

async function clickCopyRepository(): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => /Copy repository URL|复制仓库地址/.test(candidate.textContent ?? ''),
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
}

function mockClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const clipboard = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  return clipboard;
}

function row(dtText: string): HTMLElement | undefined {
  return Array.from(host.querySelectorAll<HTMLElement>('.about-row')).find(
    (r) => r.querySelector('dt')?.textContent === dtText,
  );
}

describe('AboutDialog — repository navigation (A BUG-002)', () => {
  it('reports only an open request when an isolated browser tab returns null', async () => {
    // `noopener` makes window.open return null even on success; the external
    // contract is the requested URL/target/features, not its return value.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const writeText = mockClipboard(async () => undefined);

    await clickRepository();

    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/zengzichao/CladeForge',
      '_blank',
      'noopener,noreferrer',
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'info',
        message: expect.stringMatching(/open requested|已请求打开/),
      }),
    ]);
    expect(useToasts.getState().toasts[0].message).not.toMatch(/Opening|正在打开/);
  });

  it('keeps an explicit copy action after an ambiguous browser-open result', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const writeText = mockClipboard(async () => undefined);

    await clickRepository();
    useToasts.setState({ toasts: [] });
    await clickCopyRepository();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/zengzichao/CladeForge',
    );
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'success',
        message: expect.stringMatching(/Repository URL copied|仓库地址已复制/),
      }),
    ]);
  });

  it('reports failure when the explicit repository copy is denied', async () => {
    mockClipboard(async () => {
      throw new Error('clipboard denied');
    });

    await clickCopyRepository();

    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'error',
        message: expect.stringMatching(/Could not copy repository URL|无法复制仓库地址/),
      }),
    ]);
  });

  it('copies the repository URL and reports fallback when browser opening throws', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('popup blocked');
    });
    const writeText = mockClipboard(async () => undefined);

    await clickRepository();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/zengzichao/CladeForge',
    );
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'info' }),
    ]);
    expect(useToasts.getState().toasts[0].message).toMatch(/copied|已复制/i);
  });

  it('reports navigation failure when opening and clipboard fallback both fail', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('popup blocked');
    });
    mockClipboard(async () => {
      throw new Error('clipboard denied');
    });

    await clickRepository();

    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'error' }),
    ]);
    expect(useToasts.getState().toasts[0].message).toMatch(/could not open|无法打开/i);
  });

  it('uses the native opener and reports success in the Tauri desktop shell', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const writeText = mockClipboard(async () => undefined);

    await clickRepository();

    expect(openUrl).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/zengzichao/CladeForge',
    );
    expect(open).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'success',
        message: expect.stringMatching(/Opening repository URL|正在打开仓库地址/),
      }),
    ]);
  });

  it('falls back to copying when the Tauri native opener rejects', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.mocked(openUrl).mockRejectedValue(new Error('no default browser'));
    const writeText = mockClipboard(async () => undefined);

    await clickRepository();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/zengzichao/CladeForge',
    );
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'info' }),
    ]);
    expect(useToasts.getState().toasts[0].message).toMatch(/copied|已复制/i);
  });
});

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
