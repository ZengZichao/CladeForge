// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * Reconciliation-pane interaction hot path (2026-11-08 lag analysis §3.2/§3.3):
 *
 *  (a) a burst of wheel events must commit at most once per animation frame
 *      instead of re-rendering per input event;
 *  (b) a pointer pan must do the same: per-move transforms stay in a ref and
 *      are painted once per frame;
 *  (c) the rows/edges/stubs stay memoised and world-space (architecture guard);
 *  (d) hovering a node does not remount the other nodes' DOM.
 *
 * (`createElement` rather than JSX: vitest only collects `src/**\/*.test.ts`.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Profiler, useCallback, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReconPane, type PaneNodeMeta } from './ReconPane';
import { computeLayout } from '../layout/autoLayout';
import { parseNewick } from '../io/newick';
import { DEFAULT_RECON_VIEW_OPTIONS } from '../model/types';
import type { PaneTransform } from './reconMapping';
import type { LayoutResult } from '../layout/autoLayout';
import type { NodeId, Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const doc: Project = parseNewick('((A,B),(C,D));', 'pane-perf');
const layout: LayoutResult = computeLayout(doc);

let host: HTMLElement | null = null;
let root: Root | null = null;
let commits = 0;
let lastTransform: PaneTransform = { tx: 0, ty: 0, scale: 1 };

function Harness() {
  const [t, setT] = useState<PaneTransform>({ tx: 0, ty: 0, scale: 1 });
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const handle = useCallback((next: PaneTransform) => {
    lastTransform = next;
    setT(next);
  }, []);
  const handleHover = useCallback((id: NodeId | null) => setHovered(id), []);
  // The real view derives this map from the store; here the hover state stands
  // in for it, so the memo bail-out is exercised the same way.
  const nodeMeta = useMemo(() => {
    if (!hovered) return undefined;
    return new Map<NodeId, PaneNodeMeta>([[hovered, { fill: 'var(--recon-tip)', hovered: true }]]);
  }, [hovered]);
  return createElement(ReconPane, {
    doc,
    layout,
    transform: t,
    onTransform: handle,
    onSizeChange: () => {},
    onFit: () => {},
    onResetZoom: () => {},
    title: 'Species',
    subtitle: '',
    nodeCount: Object.keys(doc.nodes).length,
    zoomPercent: Math.round(t.scale * 100),
    ariaLabel: 'Species pane',
    options: DEFAULT_RECON_VIEW_OPTIONS,
    side: 'species',
    nodeMeta,
    onNodeHover: handleHover,
  });
}

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

function mount(): { pane: HTMLElement; group: SVGGElement } {
  cleanup();
  commits = 0;
  lastTransform = { tx: 0, ty: 0, scale: 1 };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(Profiler, { id: 'pane', onRender: () => { commits += 1; } }, createElement(Harness)),
    ),
  );
  const pane = host.querySelector('.recon-pane-svg') as HTMLElement | null;
  const group = host.querySelector('svg g') as SVGGElement | null;
  if (!pane || !group) {
    throw new Error('pane did not mount');
  }
  commits = 0;
  return { pane, group };
}

const wheel = (pane: HTMLElement, init: WheelEventInit): void => {
  act(() => {
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
  });
};

const pointer = (target: EventTarget, type: string, clientX: number, clientY: number): void => {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }),
    );
  });
};

/** React derives pointerenter/leave from delegated pointerover/pointerout. */
const hover = (target: EventTarget, type: 'pointerover' | 'pointerout'): void => {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        relatedTarget: document.body,
      }),
    );
  });
};

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function endBurst(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 180));
  });
}

function groupScale(group: SVGGElement): number {
  const attr = group.getAttribute('transform') ?? '';
  return Number(/scale\(([^)]+)\)/.exec(attr)?.[1]);
}

afterEach(cleanup);

describe('reconciliation pane coalesces input gestures', () => {
  it('a wheel burst commits once per frame, not once per event', async () => {
    const { pane, group } = mount();
    const setAttribute = vi.spyOn(group, 'setAttribute');

    // 30 ticks inside one frame: all accumulate in the ref, nothing renders.
    for (let i = 0; i < 30; i += 1) wheel(pane, { deltaY: -100, clientX: 50, clientY: 50 });
    expect(commits).toBe(0);
    expect(groupScale(group)).toBe(1);

    await flushFrame();
    // 30 input events produce at most one state-commit cycle (React may count
    // two Profiler passes for one act() flush), never one per event.
    expect(commits).toBeGreaterThan(0);
    expect(commits).toBeLessThanOrEqual(2);
    // Compounded ×1.15^30 clamped to RECON_MAX_SCALE (4).
    expect(groupScale(group)).toBe(4);
    expect(lastTransform.scale).toBe(4);
    // One DOM write for the whole burst.
    expect(setAttribute.mock.calls.filter(([name]) => name === 'transform').length).toBe(1);
    const settled = commits;
    await flushFrame();
    expect(commits).toBe(settled); // no per-event backlog left behind

    await endBurst();
    // The idle flush republishes the same object: no extra React commit.
    expect(commits).toBe(settled);
  });

  it('a pointer pan paints once per frame and commits the final transform on release', async () => {
    const { pane, group } = mount();
    const setAttribute = vi.spyOn(group, 'setAttribute');

    pointer(pane, 'pointerdown', 100, 100);
    for (let i = 1; i <= 20; i += 1) pointer(pane, 'pointermove', 100 + i * 10, 100 + i * 5);

    expect(commits).toBe(0);
    expect(group.getAttribute('transform')).toBe('translate(0,0) scale(1)');

    await flushFrame();
    // 20 pointermoves produce at most one state-commit cycle.
    expect(commits).toBeGreaterThan(0);
    expect(commits).toBeLessThanOrEqual(2);
    expect(lastTransform.tx).toBe(200);
    expect(lastTransform.ty).toBe(100);
    expect(setAttribute.mock.calls.filter(([name]) => name === 'transform').length).toBe(1);

    pointer(pane, 'pointerup', 300, 200);
    // The release flushes the painted transform (a no-op re-publish is fine).
    expect(lastTransform).toEqual({ tx: 200, ty: 100, scale: 1 });
  });
});

describe('reconciliation pane rendering architecture', () => {
  it('keeps nodes/edges/stubs memoised with world-space props', () => {
    const src = readFileSync(join(__dirname, 'ReconPane.tsx'), 'utf8');
    expect(src).toContain('const PaneNode = memo(');
    expect(src).toContain('const PaneEdge = memo(');
    expect(src).toContain('const PaneStubLine = memo(');
    expect(src).toContain('export const ReconPane = memo(');
    expect(src).toContain('requestAnimationFrame(commitFrame)');
    expect(src).toContain('cullPaneNodes(');
  });

  it('hovering one node keeps every other node group identical (memo bail-out)', () => {
    const { pane } = mount();
    const nodes = [...pane.querySelectorAll('[data-node-id]')];
    expect(nodes.length).toBe(Object.keys(doc.nodes).length);
    const other = nodes[1];
    const hovered = nodes[0];

    hover(hovered, 'pointerover');
    expect(hovered.querySelectorAll('circle').length).toBe(2); // body + ring
    // React reused the untouched sibling's DOM node rather than remounting it.
    expect(pane.querySelectorAll('[data-node-id]')[1]).toBe(other);
    expect(other.querySelectorAll('circle').length).toBe(1);

    hover(hovered, 'pointerout');
    expect(hovered.querySelectorAll('circle').length).toBe(1);
    expect(pane.querySelectorAll('[data-node-id]')[1]).toBe(other);
  });
});
