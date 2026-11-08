// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * Menus must not dismiss themselves when the user scrolls INSIDE them.
 *
 * The Preferences panel, the generic File/Recent dropdown and the Help menu all
 * cap their height and scroll internally. The window-capture `scroll` dismissal
 * exists only for a scroll ELSEWHERE (which would drift the fixed panel away
 * from its trigger); a scroll whose target is the panel itself belongs to the
 * menu and must leave it open.
 *
 * (`createElement` rather than JSX: vitest only collects `src/**\/*.test.ts`.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PreferencesMenu } from './PreferencesMenu';
import { Dropdown } from './Dropdown';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; PreferencesMenu reads the OS theme query on mount.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
  // Portals live in <body>; unmount removes them, but clear any left over by a
  // failed assertion so the next test starts from an empty document.
  document
    .querySelectorAll('.dropdown-panel, .prefs-panel, .help-panel')
    .forEach((el) => el.remove());
}

function mount(node: ReactElement): void {
  cleanup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click());
}

function scrollOn(el: Element): void {
  act(() => {
    el.dispatchEvent(new Event('scroll'));
  });
}

afterEach(cleanup);

describe('scrolling inside an open menu leaves it open', () => {
  it('preferences panel', () => {
    mount(createElement(PreferencesMenu));
    click(host!.querySelector('.prefs-trigger')!);
    const panel = document.querySelector('.prefs-panel');
    expect(panel).not.toBeNull();

    scrollOn(panel!);
    expect(document.querySelector('.prefs-panel')).not.toBeNull();

    // A scroll elsewhere still dismisses it (the panel would drift).
    scrollOn(document.body);
    expect(document.querySelector('.prefs-panel')).toBeNull();
  });

  it('generic dropdown used by File / Recent', () => {
    mount(createElement(Dropdown, { label: 'File', items: [{ label: 'Open' }] }));
    click(host!.querySelector('button[aria-haspopup="menu"]')!);
    const panel = document.querySelector('.dropdown-panel');
    expect(panel).not.toBeNull();

    scrollOn(panel!);
    expect(document.querySelector('.dropdown-panel')).not.toBeNull();

    scrollOn(document.body);
    expect(document.querySelector('.dropdown-panel')).toBeNull();
  });

  it('help menu', () => {
    mount(
      createElement(MenuBar, {
        onOpenShortcuts: () => {},
        onOpenTour: () => {},
        onOpenWorkflowTour: () => {},
        onOpenAbout: () => {},
      }),
    );
    click(host!.querySelector('.menubar-help-btn')!);
    const panel = document.querySelector('.help-panel');
    expect(panel).not.toBeNull();

    scrollOn(panel!);
    expect(document.querySelector('.help-panel')).not.toBeNull();

    scrollOn(document.body);
    expect(document.querySelector('.help-panel')).toBeNull();
  });
});
