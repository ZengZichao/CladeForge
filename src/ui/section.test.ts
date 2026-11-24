// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// A `Section` that filters itself out must still run the same Hooks as one that
// renders. An early `if (q && !matchesSearch) return null;` placed BEFORE the
// `useEffect` makes the render that hides a section call fewer Hooks than the
// render that shows it, and React 18 throws "Rendered fewer hooks than expected"
// out of the search box; with no ErrorBoundary anywhere in the app, that blanks
// the whole window.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section, GroupSection } from './Section';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

/** Two sections whose titles only one query can match. */
function Panel(props: { query: string }) {
  return createElement(
    'div',
    null,
    createElement(Section, { id: 'sec-alpha', title: 'Alpha panel', searchQuery: props.query, children: 'A' }),
    createElement(Section, { id: 'sec-beta', title: 'Beta panel', searchQuery: props.query, children: 'B' }),
  );
}

function text() {
  return host.textContent ?? '';
}

describe('Section — search filtering keeps the Hook sequence stable', () => {
  it('shows both sections with an empty query', () => {
    mount(createElement(Panel, { query: '' }));
    expect(text()).toContain('Alpha panel');
    expect(text()).toContain('Beta panel');
  });

  it('hides the non-matching section without throwing, repeatedly', () => {
    mount(createElement(Panel, { query: '' }));
    // Each transition crosses the hidden / visible boundary for one of the two
    // sections, which is what changes the Hook count mid-tree.
    for (const q of ['alpha', 'beta', 'alph', '', 'zzz']) {
      expect(() => act(() => root.render(createElement(Panel, { query: q })))).not.toThrow();
    }
    expect(text()).not.toContain('Alpha panel');
    expect(text()).not.toContain('Beta panel');
  });

  it('renders exactly the matching section when a query is active', () => {
    mount(createElement(Panel, { query: 'bet' }));
    expect(text()).toContain('Beta panel');
    expect(text()).not.toContain('Alpha panel');
  });

  it('matches on keywords as well as the title', () => {
    mount(
      createElement(
        'div',
        null,
        createElement(
          Section,
          {
            id: 'sec-k',
            title: 'Time scale',
            keywords: ['calibration', '化石'],
            searchQuery: '化石',
            children: 'K',
          },
        ),
      ),
    );
    expect(text()).toContain('Time scale');
  });
});

// The collapsed inspector groups preview their current values in the header
// (`summary`) instead of only an "N items" count. The preview must never leak
// into the expanded state (where the actual fields are shown), must stay
// optional for every other panel that reuses Section, and must not disturb the
// search/pin force-open logic tested above.
describe('Section — optional collapsed summary', () => {
  function panelWithSummary(props: { query?: string; summary?: ReactNode; defaultOpen?: boolean }) {
    return createElement(
      'div',
      null,
      createElement(Section, {
        id: 'sec-sum',
        title: 'Node style',
        defaultOpen: props.defaultOpen ?? false,
        searchQuery: props.query ?? '',
        summary: props.summary,
        children: 'STYLE-BODY',
      }),
    );
  }

  it('shows the summary while collapsed and hides it once expanded', () => {
    mount(
      panelWithSummary({
        summary: createElement('span', { className: 'test-preview' }, 'Circle · 7px'),
      }),
    );
    expect(text()).toContain('Circle · 7px');
    expect(text()).not.toContain('STYLE-BODY');
    expect(host.querySelector('.section-toggle')!.getAttribute('aria-expanded')).toBe('false');

    act(() => (host.querySelector('.section-toggle') as HTMLButtonElement).click());
    // Expanded: the fields themselves carry the values, the preview is gone.
    expect(text()).not.toContain('Circle · 7px');
    expect(text()).toContain('STYLE-BODY');
  });

  it('renders exactly as before when no summary is passed', () => {
    mount(panelWithSummary({}));
    expect(host.querySelector('.section-summary')).toBeNull();
    expect(host.querySelector('.section-toggle')!.classList.contains('has-summary')).toBe(false);
  });

  it('hides the summary when a search query forces the section open', () => {
    mount(panelWithSummary({ query: 'style', summary: 'SHOULD-NOT-RENDER' }));
    expect(text()).toContain('STYLE-BODY');
    expect(text()).not.toContain('SHOULD-NOT-RENDER');
  });

  it('survives toggling and query changes with the Hook order intact', () => {
    mount(panelWithSummary({ summary: 'PREVIEW' }));
    expect(() =>
      act(() => {
        (host.querySelector('.section-toggle') as HTMLButtonElement).click();
      }),
    ).not.toThrow();
    expect(() => act(() => root.render(panelWithSummary({ query: 'zzz' })))).not.toThrow();
    expect(() => act(() => root.render(panelWithSummary({ query: '' })))).not.toThrow();
    expect(text()).toContain('Node style');
  });
});

// CF-C-005: pointer/Enter already work in the running app. Space reaches the
// buttons too, but the canvas-wide pan modifier calls preventDefault() for every
// non-input target, cancelling the browser's native button activation. These
// tests exercise the buttons themselves, including persistence and repeat keys.
describe('Section — favourite and pin activation', () => {
  function mountToggles() {
    mount(
      createElement(Section, {
        id: 'node',
        title: 'Node',
        favoritable: true,
        pinable: true,
        children: 'NODE-BODY',
      }),
    );
  }

  function favourite(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>('.section-fav')!;
  }

  function pin(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>('.section-pin')!;
  }

  function space(target: HTMLElement, repeat = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
      repeat,
    });
    act(() => target.dispatchEvent(event));
    return event;
  }

  it('pointer activation toggles the favourite DOM and survives a remount', () => {
    mountToggles();
    expect(favourite().getAttribute('aria-pressed')).toBe('false');
    const before = favourite().outerHTML;
    act(() => favourite().click());
    expect(favourite().getAttribute('aria-pressed')).toBe('true');
    expect(favourite().classList.contains('active')).toBe(true);
    expect(favourite().outerHTML).not.toBe(before);
    expect(localStorage.getItem('cladeforge:fav:node')).toBe('true');

    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(Section, {
      id: 'node', title: 'Node', favoritable: true, pinable: true, children: 'NODE-BODY',
    })));
    expect(favourite().getAttribute('aria-pressed')).toBe('true');
    act(() => favourite().click());
    expect(favourite().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('cladeforge:fav:node')).toBe('false');
  });

  it('Space activates the favourite even when the canvas reserves Space', () => {
    mountToggles();
    favourite().focus();
    const event = space(favourite());
    expect(event.defaultPrevented).toBe(true);
    expect(favourite().getAttribute('aria-pressed')).toBe('true');
    expect(favourite().classList.contains('active')).toBe(true);
    expect(localStorage.getItem('cladeforge:fav:node')).toBe('true');
    space(favourite());
    expect(favourite().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('cladeforge:fav:node')).toBe('false');
  });

  it('ignores auto-repeated Space instead of toggling the favourite twice', () => {
    mountToggles();
    space(favourite());
    space(favourite(), true);
    expect(favourite().getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('cladeforge:fav:node')).toBe('true');
  });

  it('pins keep the body expanded, persist, and unpin without collapsing it', () => {
    mountToggles();
    act(() => host.querySelector<HTMLButtonElement>('.section-toggle')!.click());
    expect(host.querySelector('.section-toggle')!.getAttribute('aria-expanded')).toBe('false');
    act(() => pin().click());
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.section-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('NODE-BODY');
    expect(localStorage.getItem('cladeforge:pin:node')).toBe('true');
    expect(localStorage.getItem('cladeforge:section:node')).toBe('true');

    act(() => host.querySelector<HTMLButtonElement>('.section-toggle')!.click());
    expect(host.querySelector('.section-toggle')!.getAttribute('aria-expanded')).toBe('true');
    act(() => pin().click());
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('.section-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('cladeforge:pin:node')).toBe('false');
  });

  it('Space activates the pin and survives a remount', () => {
    mountToggles();
    const event = space(pin());
    expect(event.defaultPrevented).toBe(true);
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('cladeforge:pin:node')).toBe('true');

    act(() => root.unmount());
    mount(createElement(Section, {
      id: 'node', title: 'Node', favoritable: true, pinable: true, children: 'NODE-BODY',
    }));
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    space(pin());
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('cladeforge:pin:node')).toBe('false');
  });
});

describe('GroupSection — pin activation', () => {
  it('Space activates a group pin and persists its expanded state', () => {
    mount(createElement(GroupSection, { title: 'Tree operations', pinable: true, children: 'OPS' }));
    const pin = host.querySelector<HTMLButtonElement>('.group-pin')!;
    const event = new KeyboardEvent('keydown', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    });
    act(() => pin.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(Object.entries(localStorage).filter(([key, value]) =>
      key.startsWith('cladeforge:pin:group:') && value === 'true',
    )).toHaveLength(1);
    expect(text()).toContain('OPS');
  });
});
