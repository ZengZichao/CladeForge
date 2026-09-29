// @vitest-environment jsdom
/**
 * The palette's reconcile-view label must follow the live store.
 *
 * `CommandPalette` builds its command list in a `useMemo` keyed on the four
 * dialog callbacks, and two of its labels read the state they depend on
 * imperatively:
 *
 *   label: st().reconMode ? S.recon.exitView : S.recon.enterView
 *
 * `st()` is `useStore.getState`, so the value is whatever `reconMode` happens to
 * be the first time the memo runs. Entering or leaving the reconciliation view
 * then never re-labels the item, so the palette keeps offering "进入协同视图" while
 * the user is already in it — and the same for every other label in the list
 * after a language switch, which the app only papers over by remounting its tree.
 *
 * The labels subscribe to what they read, so an already-open palette re-labels
 * itself. These tests drive a mounted, open palette.
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers `src/` files
 * ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette } from './CommandPalette';
import { changeLanguage, currentLanguage } from './i18n';
import { S } from './strings';
import { useStore } from '../model/store';
import { useToasts } from './toast';
import { createEmptyProject } from '../model/sampleTree';
import type { Language } from './strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The palette scrolls its highlighted row into view; jsdom has no layout engine.
Element.prototype.scrollIntoView = function scrollIntoView(): void {
  /* no-op */
};

let host: HTMLElement | null = null;
let root: Root | null = null;
let startLang: Language = 'zh';

function mountPalette(): void {
  cleanup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const noop = (): void => {};
  act(() =>
    root!.render(
      createElement(CommandPalette, {
        open: true,
        onClose: noop,
        onOpenMatrix: noop,
        onOpenAnalysis: noop,
        onOpenTour: noop,
        onOpenShortcuts: noop,
      }),
    ),
  );
}

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

const labelOf = (id: string): string => {
  const el = host!.querySelector(`#cmd-${id}`);
  if (!el) throw new Error(`command ${id} is not in the palette`);
  return el.textContent ?? '';
};

const setReconMode = (v: boolean): void => {
  act(() => useStore.getState().setReconMode(v));
};

/** A locale switch is an external store update: it has to be flushed like one. */
const setLanguage = (v: Language): void => {
  act(() => changeLanguage(v));
};

describe('palette labels track the live state', () => {
  beforeEach(() => {
    startLang = currentLanguage();
    changeLanguage('zh');
    useToasts.setState({ toasts: [] });
    useStore.getState().loadProject(createEmptyProject());
    useStore.getState().setReconMode(false);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    changeLanguage(startLang);
  });

  it('offers "enter" while the standard view is up', () => {
    mountPalette();
    expect(labelOf('reconView')).toContain(S.recon.enterView);
    expect(labelOf('reconView')).not.toContain(S.recon.exitView);
  });

  it('flips to "exit" the moment the reconciliation view is entered — while open', () => {
    mountPalette();
    const entered = S.recon.enterView;
    setReconMode(true);
    // The palette was never closed and re-mounted, so the label can only come from
    // the subscription, not from a list computed at mount.
    expect(labelOf('reconView')).toContain(S.recon.exitView);
    expect(labelOf('reconView')).not.toContain(entered);
  });

  it('flips back when the view is left', () => {
    mountPalette();
    setReconMode(true);
    expect(labelOf('reconView')).toContain(S.recon.exitView);
    setReconMode(false);
    expect(labelOf('reconView')).toContain(S.recon.enterView);
  });

  it('re-labels after a language switch, in both view modes', () => {
    mountPalette();
    const zhExit = S.recon.exitView;
    const zhEnter = S.recon.enterView;
    expect(zhExit).not.toBe('');
    setReconMode(true);
    expect(labelOf('reconView')).toContain(zhExit);

    setLanguage('en');
    expect(labelOf('reconView')).not.toContain(zhExit);
    expect(labelOf('reconView')).toContain(S.recon.exitView);

    setReconMode(false);
    expect(labelOf('reconView')).toContain(S.recon.enterView);
    expect(labelOf('reconView')).not.toContain(zhEnter);
  });

  it('the rest of the list follows the language too, not just this one label', () => {
    mountPalette();
    const zhCommands = ['undo', 'fit', 'relayout', 'asr'].map(labelOf);
    setLanguage('en');
    const enCommands = ['undo', 'fit', 'relayout', 'asr'].map(labelOf);
    expect(enCommands).not.toEqual(zhCommands);
    expect(labelOf('undo')).toContain(S.cmd.undo);
    expect(labelOf('matrix')).toContain(S.cmd.matrix);
  });

  it('running the command still reads the state at click time', () => {
    mountPalette();
    const item = host!.querySelector('#cmd-reconView') as HTMLElement;
    expect(useStore.getState().reconMode).toBe(false);
    act(() => item.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // No gene tree in this document, so the toggle path reports rather than acts.
    expect(useStore.getState().reconMode).toBe(false);
    const toasts = useToasts.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe(S.recon.empty);
  });
});
