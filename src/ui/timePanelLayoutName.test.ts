// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// BUG-5 acceptance at the reported surface: the 时间 panel's warning quotes the
// current layout name. Browser re-verification found all four valid layouts
// correct; this test exists so a regression cannot reintroduce the empty
// 「current layout is “”」 — including for a document whose `layout.type` is
// blank or from another build (projectIO keeps an unknown value verbatim), and
// so the "already the time chart" case keeps suppressing the switch prompt.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimePanel } from './TimePanel';
import { layoutTypeName } from './layoutTypeName';
import { S, setLanguage } from './strings';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import type { LayoutType, Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;

function mountPanel(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TimePanel)));
}

function cleanup(): void {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

/** A dated tree, so the time-data gate is open and the mismatch hint applies. */
function datedProject(id: string, layout: LayoutType | string): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  for (const node of Object.values(p.nodes)) node.age = 10;
  p.nodes[p.rootId].age = 100;
  for (const child of p.nodes[p.rootId].childrenIds) p.nodes[child].age = 60;
  (p.layout as { type: LayoutType | string }).type = layout;
  return p;
}

// jsdom does not implement `innerText`; `textContent` carries the same text for
// these assertions.
const panelText = () => host?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  setLanguage('zh');
});

afterEach(cleanup);

describe('Time module layout-name hint (BUG-5)', () => {
  it('names each of the four layouts correctly and never renders “”', () => {
    for (const layout of [
      'rectangular-cladogram',
      'rectangular-phylogram',
      'circular',
    ] as const) {
      useStore.getState().loadProject(datedProject(`bug5-${layout}`, layout));
      mountPanel();
      const text = panelText();
      // Both the template and the interpolated name are on screen.
      expect(text, layout).toContain(layoutTypeName(layout));
      expect(text, layout).toContain(`「${layoutTypeName(layout)}」`);
      expect(text, layout).toContain('时间数据已具备');
      expect(text, layout).not.toContain('“”');
      expect(text, layout).not.toContain('「」');
      cleanup();
    }
  });

  it('the geological time chart shows the axis settings with NO switch prompt', () => {
    useStore.getState().loadProject(datedProject('bug5-time', 'time-calibrated'));
    mountPanel();
    const text = panelText();
    expect(text).not.toContain('时间数据已具备');
    expect(text).not.toContain(S.layoutPanel.switchToTimeChart);
    // Directly shows the time-axis settings instead of the "please switch" banner.
    expect(text).toContain(S.layoutPanel.timeSection);
    expect(text).toContain(S.layoutPanel.showEras);
  });

  it('a blank / legacy layout id gets an explicit non-empty name', () => {
    for (const weird of ['', 'timechart'] as const) {
      useStore.getState().loadProject(datedProject(`bug5-weird-${weird}`, weird));
      mountPanel();
      const text = panelText();
      expect(text, JSON.stringify(weird)).toContain(layoutTypeName(weird));
      expect(text, JSON.stringify(weird)).not.toContain('“”');
      expect(text, JSON.stringify(weird)).not.toContain('「」');
      cleanup();
    }
    // Blank id: the explicit fallback label, not an empty pair of quotes.
    expect(layoutTypeName('')).toBe('未知布局');
  });

  it('the English template is correct too', () => {
    setLanguage('en');
    useStore.getState().loadProject(datedProject('bug5-en', 'circular'));
    mountPanel();
    const text = panelText();
    expect(text).toContain('current layout is “Circular”');
    expect(text).not.toContain('“”');
  });
});
