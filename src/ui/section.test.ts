// @vitest-environment jsdom
// A `Section` that filters itself out must still run the same Hooks as one that
// renders. An early `if (q && !matchesSearch) return null;` placed BEFORE the
// `useEffect` makes the render that hides a section call fewer Hooks than the
// render that shows it, and React 18 throws "Rendered fewer hooks than expected"
// out of the search box; with no ErrorBoundary anywhere in the app, that blanks
// the whole window.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, useState, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section } from './Section';

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
