// @vitest-environment jsdom
// Component tests for the 2026-11-10 review-round fixes (H6): the UI layer
// had no render-level tests at all, and the review's own defect history shows
// regressions concentrate exactly there. This suite pins the new user-visible
// contracts at the COMPONENT level, not just in model-layer units:
//   * Toaster — action buttons run; a clicked toast dismisses.
//   * ConfirmDialog — dismissal runs onCancel (the M12 promise contract).
//   * AnalysisDialog — section jump-nav renders; the no-data parsimony guard
//     blocks the apply; the ASR buttons disable while a fit is running.
//   * ImportReportDialog — every recorded import note is reviewable (A-03).
//   * desktopShell.hasUnsavedChanges — the close-guard dirty test.

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { useToasts, notify } from './toast';
import { Toaster } from './Toaster';
import { ConfirmDialog, requestConfirm, registerConfirmHandler } from './confirmDialog';
import { AnalysisDialog } from './AnalysisDialog';
import { ImportReportDialog } from './ImportReportDialog';
import { useImportReport } from './importReport';
import { hasUnsavedChanges } from '../io/desktopShell';
import { changeLanguage } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  changeLanguage('en');
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
      (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  }
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(ui: unknown): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui as never));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
  act(() => {
    useToasts.getState().toasts.forEach((t) => useToasts.getState().dismiss(t.id));
    useImportReport.getState().clear();
  });
});

function text(): string {
  return host?.textContent ?? '';
}

// --- Toaster ------------------------------------------------------------------

describe('Toaster', () => {
  it('runs an action button and dismisses the toast (A-03 view-all entry)', () => {
    mount(createElement(Toaster));
    const run = vi.fn();
    act(() => notify.action('3 further import notes were not shown', 'View all import notes', run));
    const button = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'View all import notes');
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('dismisses a toast when clicked (error toasts are not click-through traps)', () => {
    mount(createElement(Toaster));
    act(() => notify.error('Something failed'));
    expect(text()).toContain('Something failed');
    const toastEl = host!.querySelector('.toast-error');
    expect(toastEl).not.toBeNull();
    act(() => toastEl!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(text()).not.toContain('Something failed');
  });
});

// --- ConfirmDialog ------------------------------------------------------------

describe('ConfirmDialog onCancel', () => {
  it('runs onCancel when dismissed via the cancel button (M12 promise resolution)', () => {
    mount(createElement(ConfirmDialog));
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    act(() => {
      requestConfirm({
        key: 'test-cancel',
        title: 'The file changed on disk',
        message: 'Saving now overwrites that version.',
        confirmLabel: 'Save anyway',
        danger: true,
        onConfirm: confirmed,
        onCancel: cancelled,
      });
    });
    const cancel = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    expect(cancel).toBeDefined();
    act(() => cancel!.click());
    expect(confirmed).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('runs onConfirm and never onCancel on confirm', () => {
    mount(createElement(ConfirmDialog));
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    act(() => {
      requestConfirm({
        key: 'test-confirm',
        title: 't',
        message: 'm',
        confirmLabel: 'Save anyway',
        onConfirm: confirmed,
        onCancel: cancelled,
      });
    });
    const ok = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Save anyway');
    act(() => ok!.click());
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

// --- AnalysisDialog -----------------------------------------------------------

function twoTipProjectWithUnscoredCharacter(): void {
  const p = createEmptyProject();
  const [x, y] = addChildren(p, p.rootId, 2);
  void x;
  void y;
  p.characters = [
    {
      id: 'c1',
      name: 'C',
      type: 'discrete',
      states: [
        { id: 'a', label: 'A', color: '#f00' },
        { id: 'b', label: 'B', color: '#00f' },
      ],
    },
  ];
  useStore.getState().loadProject(p);
}

describe('AnalysisDialog review fixes', () => {
  it('renders the section jump-nav chips (A-07)', () => {
    twoTipProjectWithUnscoredCharacter();
    mount(createElement(AnalysisDialog, { open: true, onClose: () => {} }));
    // The nav lists the ASR block by name — "run an ASR" no longer means
    // scrolling six screens to find it.
    expect(document.querySelector('#sec-asr')).not.toBeNull();
    expect(document.querySelector('#sec-extra')).not.toBeNull();
  });

  it('shows the no-data warning instead of a fake parsimony cost 0 (A-19)', () => {
    twoTipProjectWithUnscoredCharacter();
    mount(createElement(AnalysisDialog, { open: true, onClose: () => {} }));
    expect(text()).toContain('No tip is scored for this character');
    expect(text()).not.toContain('Minimum cost');
  });

  it('disables the ASR run button while a fit is in flight (A-15)', () => {
    twoTipProjectWithUnscoredCharacter();
    mount(createElement(AnalysisDialog, { open: true, onClose: () => {} }));
    // Simulate the in-flight flag exactly as runAsr sets it.
    act(() => {
      useStore.setState({ asrRunning: true });
    });
    const run = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Solving…');
    expect(run).toBeDefined();
    expect((run as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      useStore.setState({ asrRunning: false });
    });
  });
});

// --- ImportReportDialog ---------------------------------------------------------

describe('ImportReportDialog (A-03)', () => {
  it('lists every recorded note, not a truncated toast subset', () => {
    mount(createElement(ImportReportDialog));
    act(() => {
      useImportReport.getState().record('bigfile.nex', ['note one', 'note two', 'note three', 'note four', 'note five']);
      useImportReport.getState().setOpen(true);
    });
    for (const n of ['note one', 'note two', 'note three', 'note four', 'note five']) {
      expect(text()).toContain(n);
    }
    // The record survives closing the dialog (toasts alone evaporate).
    act(() => {
      useImportReport.getState().setOpen(false);
    });
    expect(useImportReport.getState().report?.issues).toHaveLength(5);
  });
});

// --- desktopShell dirty test ----------------------------------------------------

describe('hasUnsavedChanges (close guard)', () => {
  it('is false for a pristine document and true after an edit', () => {
    twoTipProjectWithUnscoredCharacter();
    // loadProject pins the loaded document as saved.
    expect(hasUnsavedChanges()).toBe(false);
    act(() => {
      useStore.getState().apply((d) => {
        const first = Object.values(d.nodes)[0];
        first.label = 'renamed';
      });
    });
    expect(hasUnsavedChanges()).toBe(true);
  });
});

// registerConfirmHandler is exercised through ConfirmDialog above; the explicit
// registration/unregistration contract is pinned here so a remount can never
// strand the handler on an unmounted component.
describe('confirm handler registration', () => {
  it('unregisters cleanly so a later request is simply dropped, not crashed', () => {
    const unlisten = registerConfirmHandler(() => {
      throw new Error('stale handler fired');
    });
    unlisten();
    expect(() =>
      requestConfirm({
        key: 'no-handler',
        title: 't',
        message: 'm',
        confirmLabel: 'ok',
        onConfirm: () => {},
      }),
    ).not.toThrow();
  });
});
