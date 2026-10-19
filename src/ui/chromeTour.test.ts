// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * Contracts for the P2 chrome work (BUG-9 / BUG-10 / BUG-11):
 *
 *  - the header's clickable-target budget (≤10) survives the Help/Preferences
 *    consolidation, so adding a header control back cannot silently regress it;
 *  - the workflow tour really drives the module script
 *    Traits → Hypotheses → Analysis → Export, and cannot leave a tour mask
 *    behind on Done / Skip / Escape;
 *  - per-mode completion persistence keeps `cladeforge:onboarded` (basics)
 *    and `cladeforge:workflowTour` (workflow) separate;
 *  - the phone-width advisory shows once at ≤640px and remembers "continue".
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers only
 * `.test.ts` files under src, so a `.tsx` test file is never collected.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  FirstRunTour,
  LS_WORKFLOW_TOUR,
  markOnboarded,
  tourCompleted,
} from './FirstRunTour';
import { NarrowScreenHint, LS_NARROW_HINT, NARROW_HINT_MAX_WIDTH } from './NarrowScreenHint';
import { PreferencesMenu } from './PreferencesMenu';
import { MenuBar } from './MenuBar';
import { Toolbar } from './Toolbar';
import { changeLanguage, currentLanguage } from './i18n';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';

// React 18 refuses `act()` unless the environment declares itself.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;
let startLang = currentLanguage();

const mount = (node: ReactElement): void => {
  cleanup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
};

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
  // The dropdown menus portal into <body>; unmounting removes their portals with
  // the owning component, but clear anything a failed assertion left behind.
  document.querySelectorAll('.prefs-panel, .help-panel').forEach((el) => el.remove());
}

const button = (re: RegExp): HTMLButtonElement => {
  const found = [...(host ?? document.body).querySelectorAll('button')].find((b) =>
    re.test((b.textContent ?? '').trim()),
  );
  if (!found) throw new Error(`no button matching ${re}`);
  return found as HTMLButtonElement;
};

const click = (re: RegExp): void => {
  act(() => button(re).click());
};

const setWidth = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

const stubMatchMedia = (): void => {
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
};

beforeEach(() => {
  startLang = currentLanguage();
  changeLanguage('zh');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  stubMatchMedia();
  useStore.getState().loadProject(createEmptyProject());
  setWidth(1440);
});

afterEach(() => {
  cleanup();
  changeLanguage(startLang);
  document.documentElement.removeAttribute('data-theme');
  setWidth(1440);
});

// ---------------------------------------------------------------------------
describe('header target budget (BUG-10)', () => {
  it('renders at most ten clickable targets in the menu bar + toolbar', () => {
    mount(
      createElement(
        'div',
        { className: 'header-bar' },
        createElement(MenuBar, {
          onOpenShortcuts: () => {},
          onOpenTour: () => {},
          onOpenWorkflowTour: () => {},
          onOpenAbout: () => {},
        }),
        createElement(Toolbar, { onAddChildrenDialog: () => {} }),
      ),
    );
    const targets = host!.querySelectorAll('button, select, a');
    expect(targets.length).toBeLessThanOrEqual(10);
    // The consolidation is present: one Help trigger and one Preferences trigger.
    expect(host!.querySelector('.menubar-help-btn')).not.toBeNull();
    expect(host!.querySelector('.prefs-trigger')).not.toBeNull();
  });

  it('preferences reaches every language and theme option from the one trigger', () => {
    mount(createElement(PreferencesMenu));
    const trigger = host!.querySelector('.prefs-trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('偏好');
    act(() => trigger.click());

    const panel = document.body.querySelector('.prefs-panel');
    expect(panel).not.toBeNull();
    const options = [...panel!.querySelectorAll('[role="menuitemradio"]')];
    // The check glyph marks the active option; strip it for a stable label list.
    const labels = options.map((o) => (o.textContent ?? '').replace('✓', ''));
    expect(labels).toEqual(
      expect.arrayContaining(['中文', 'English', '浅色', '深色', '跟随系统']),
    );
    expect(panel!.querySelector('[role="menuitemradio"][aria-checked="true"]')).not.toBeNull();

    // Language swap still works and closes the menu.
    const en = options.find((o) => /English/.test(o.textContent ?? '')) as HTMLElement;
    act(() => en.click());
    expect(currentLanguage()).toBe('en');
    expect(document.body.querySelector('.prefs-panel')).toBeNull();

    // Theme choice still works and persists.
    act(() => trigger.click());
    const dark = [...document.body.querySelectorAll('.prefs-panel .menu-item')].find((o) =>
      /Dark|深色/.test(o.textContent ?? ''),
    ) as HTMLElement;
    act(() => dark.click());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('cladeforge:theme')).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
describe('workflow tour (BUG-11)', () => {
  it('persists completion per mode, keeping the basics key untouched', () => {
    expect(tourCompleted('basics')).toBe(false);
    expect(tourCompleted('workflow')).toBe(false);
    markOnboarded('workflow');
    expect(localStorage.getItem(LS_WORKFLOW_TOUR)).toBe('true');
    expect(localStorage.getItem('cladeforge:onboarded')).toBeNull();
    expect(tourCompleted('workflow')).toBe(true);
    expect(tourCompleted('basics')).toBe(false);
    markOnboarded('basics');
    expect(localStorage.getItem('cladeforge:onboarded')).toBe('true');
    expect(tourCompleted('basics')).toBe(true);
  });

  it('walks Traits → Hypotheses → Analysis → Export and marks completion on Done', () => {
    const visited: string[] = [];
    let closed = 0;
    mount(
      createElement(FirstRunTour, {
        open: true,
        mode: 'workflow',
        onNavigate: (m: string) => visited.push(m),
        onOpenShortcuts: () => {},
        onClose: () => {
          closed += 1;
        },
      }),
    );

    expect(host!.querySelector('.tour-step')?.textContent).toContain('1 / 5');
    expect(host!.querySelector('.tour-title')?.textContent).toContain('编码性状');
    expect(visited).toEqual(['traits']);

    click(/^下一步$/);
    expect(visited).toEqual(['traits', 'layers']);
    click(/^下一步$/);
    expect(visited).toEqual(['traits', 'layers', 'analysis']);
    click(/^下一步$/);
    expect(visited).toEqual(['traits', 'layers', 'analysis', 'export']);
    // The final card has no target/module: advancing again must not navigate.
    click(/^下一步$/);
    expect(visited).toEqual(['traits', 'layers', 'analysis', 'export']);

    // Final card: replay / shortcut reference / done.
    expect(host!.querySelector('.tour-step')?.textContent).toContain('5 / 5');
    expect([...host!.querySelectorAll('.tour-actions .btn')].map((b) => b.textContent)).toEqual([
      '重放',
      '快捷键速查',
      '完成',
    ]);
    click(/^完成$/);
    expect(closed).toBe(1);
    expect(localStorage.getItem(LS_WORKFLOW_TOUR)).toBe('true');
  });

  it('Skip closes the tour, marks it done and leaves no mask behind', () => {
    let closed = 0;
    mount(
      createElement(FirstRunTour, {
        open: true,
        mode: 'workflow',
        onNavigate: () => {},
        onClose: () => {
          closed += 1;
        },
      }),
    );
    expect(document.querySelector('.tour-mask')).not.toBeNull();
    click(/^跳过导览$/);
    expect(closed).toBe(1);
    expect(localStorage.getItem(LS_WORKFLOW_TOUR)).toBe('true');
    // Cleanup unmounts the closed tour: no overlay may survive it.
    cleanup();
    expect(document.querySelector('.tour-mask')).toBeNull();
    expect(document.querySelector('.tour-backdrop')).toBeNull();
  });

  it('Escape closes the tour with no residual mask', () => {
    let closed = 0;
    mount(
      createElement(FirstRunTour, {
        open: true,
        mode: 'workflow',
        onNavigate: () => {},
        onClose: () => {
          closed += 1;
        },
      }),
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
    cleanup();
    expect(document.querySelector('.tour-mask')).toBeNull();
  });

  it('replay from the final card returns to step 1 without closing', () => {
    let closed = 0;
    mount(
      createElement(FirstRunTour, {
        open: true,
        mode: 'workflow',
        onNavigate: () => {},
        onClose: () => {
          closed += 1;
        },
      }),
    );
    click(/^下一步$/);
    click(/^下一步$/);
    click(/^下一步$/);
    click(/^下一步$/);
    expect(host!.querySelector('.tour-step')?.textContent).toContain('5 / 5');
    click(/^重放$/);
    expect(host!.querySelector('.tour-step')?.textContent).toContain('1 / 5');
    expect(closed).toBe(0);
    expect(localStorage.getItem(LS_WORKFLOW_TOUR)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('narrow-screen advisory (BUG-9)', () => {
  it(`shows at ≤${NARROW_HINT_MAX_WIDTH}px until dismissed, then never again`, () => {
    setWidth(375);
    mount(createElement(NarrowScreenHint));
    expect(host!.querySelector('.narrow-hint')).not.toBeNull();
    expect(host!.querySelector('.narrow-hint-card')?.textContent).toContain('1280');

    click(/仍要继续/);
    expect(host!.querySelector('.narrow-hint')).toBeNull();
    expect(localStorage.getItem(LS_NARROW_HINT)).toBe('true');

    // A later visit (fresh mount) must not nag again.
    mount(createElement(NarrowScreenHint));
    expect(host!.querySelector('.narrow-hint')).toBeNull();
  });

  it('stays hidden on desktop widths', () => {
    setWidth(1024);
    mount(createElement(NarrowScreenHint));
    expect(host!.querySelector('.narrow-hint')).toBeNull();
  });
});
