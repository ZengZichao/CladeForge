// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * Wheel navigation must not re-render the tree per event.
 *
 * The handler accumulates into a ref and paints the world group through a ref
 * once per animation frame; the store (and therefore React) is updated only at
 * coarse thresholds and when the burst ends. These tests mount the real canvas
 * and assert:
 *   (a) a burst of wheel ticks performs no synchronous store/React update;
 *   (b) the whole burst becomes ONE committed view + ONE group-attribute write;
 *   (c) the old semantics survive: pointer-anchored Ctrl-zoom, horizontal pan,
 *       small-delta trackpad pan, and MIN/MAX clamping;
 *   (d) pointer panning paints through the same coalesced path — no store or
 *       React update per pointermove, one DOM write per frame, one commit on
 *       release.
 *
 * (`createElement` rather than JSX: vitest only collects `src/**\/*.test.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TreeCanvas } from './TreeCanvas';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import { getLiveView } from './liveView';
import type { Project, ViewTransform } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let host: HTMLElement | null = null;
let root: Root | null = null;
let commits = 0;

const s = () => useStore.getState();

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

/** A purely topological tree, so no layout proposal is in the way. */
function plainTree(id: string): Project {
  const p = parseNewick('((A,B),(C,D));', id);
  p.layout.type = 'rectangular-cladogram';
  p.layout.orientation = 'LR';
  return p;
}

function mount(): SVGSVGElement {
  cleanup();
  s().loadProject(plainTree('wheel-test'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(
        Profiler,
        { id: 'canvas', onRender: () => { commits += 1; } },
        createElement(TreeCanvas),
      ),
    ),
  );
  const svg = host.querySelector('svg[role="tree"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error('canvas svg not mounted');
  commits = 0;
  return svg;
}

function identity(): void {
  act(() => s().setView({ tx: 0, ty: 0, scale: 1 }));
}

function wheel(svg: SVGSVGElement, init: WheelEventInit): void {
  act(() => {
    svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
  });
}

const worldGroup = (svg: SVGSVGElement) => svg.querySelector('g[data-role="world"]') as SVGGElement;

function worldScale(svg: SVGSVGElement): number {
  const attr = worldGroup(svg).getAttribute('transform') ?? '';
  const m = /scale\(([^)]+)\)/.exec(attr);
  return Number(m?.[1]);
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Let the 140 ms burst-end flush run (frame already painted). */
async function endBurst(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 180));
  });
}

/** Let the rAF paint and the burst-end flush run. */
async function settle(): Promise<void> {
  await flushFrame();
  await endBurst();
}

const live = (): ViewTransform => getLiveView(s().view);

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('wheel zoom/pan is coalesced into one frame and one commit', () => {
  beforeEach(() => {
    host = null;
    root = null;
    commits = 0;
  });

  afterEach(cleanup);

  it('performs no synchronous update for a burst and commits it once', async () => {
    const svg = mount();
    identity();
    commits = 0;
    let viewChanges = 0;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.view !== prev.view) viewChanges += 1;
    });
    const group = worldGroup(svg);
    const setAttribute = vi.spyOn(group, 'setAttribute');
    const transformWrites = () =>
      setAttribute.mock.calls.filter(([name]) => name === 'transform').length;

    const ticks = 10;
    for (let i = 0; i < ticks; i += 1) {
      wheel(svg, { deltaY: -100, deltaMode: 0, clientX: 300, clientY: 200 });
    }

    // The handler accumulated into the ref only: no store write, no React commit,
    // and not even a paint yet (the frame callback performs it).
    expect(viewChanges).toBe(0);
    expect(commits).toBe(0);
    expect(s().view.scale).toBe(1);
    expect(live().scale).toBe(1);
    expect(transformWrites()).toBe(0);

    await flushFrame();
    // Exactly ONE attribute write paints the whole burst; the store commit's
    // notification is deduped against the frame's already-applied view.
    expect(transformWrites()).toBe(1);
    expect(live().scale).toBeCloseTo(1.1 ** ticks, 6);
    expect(worldScale(svg)).toBeCloseTo(1.1 ** ticks, 6);
    expect(viewChanges).toBeLessThanOrEqual(1);
    expect(commits).toBeLessThanOrEqual(1);

    await endBurst();
    // The final view is committed exactly once at burst end, then culling
    // refreshes once; neither scales with the number of wheel ticks.
    expect(viewChanges).toBeLessThanOrEqual(2);
    expect(viewChanges).toBeLessThan(ticks);
    expect(s().view.scale).toBeCloseTo(1.1 ** ticks, 6);
    expect(commits).toBeLessThanOrEqual(2);
    expect(commits).toBeLessThan(ticks);
    // The burst-end flush repaints the same transform; no extra DOM write.
    expect(transformWrites()).toBe(1);
    setAttribute.mockRestore();
    unsubscribe();
  }, 20000);

  it('latches one mode per burst so a scroll cannot pan and zoom together', async () => {
    const svg = mount();

    // A high-resolution wheel/trackpad ramps deltaY across the 12 px boundary
    // inside one burst. Both events arrive before the frame: the first is a
    // pan-sized tick, the second a full wheel notch.
    identity();
    wheel(svg, { deltaY: 5, deltaX: 0, deltaMode: 0, clientX: 200, clientY: 150 });
    wheel(svg, { deltaY: -100, deltaX: 0, deltaMode: 0, clientX: 200, clientY: 150 });
    await flushFrame();
    // Latched to pan: both ticks pan (ty = -5 - (-100)), and no zoom happened.
    expect(live()).toEqual({ tx: 0, ty: 95, scale: 1 });
    await endBurst();

    // The reverse ramp: starts as a full wheel notch, then small ticks.
    identity();
    wheel(svg, { deltaY: -100, deltaMode: 0, clientX: 200, clientY: 150 });
    wheel(svg, { deltaY: -5, deltaMode: 0, clientX: 200, clientY: 150 });
    await flushFrame();
    // Latched to zoom: two anchored 1.1× steps, no vertical pan.
    const zoomed = live();
    expect(zoomed.scale).toBeCloseTo(1.21, 9);
    expect(zoomed.tx).toBeCloseTo(-42, 6);
    expect(zoomed.ty).toBeCloseTo(-31.5, 6);
    await endBurst();

    // A vertical trackpad swipe with small horizontal noise still pans only on
    // the latched axis, exactly like the old per-event behaviour.
    identity();
    wheel(svg, { deltaY: 6, deltaX: 2, deltaMode: 0, clientX: 200, clientY: 150 });
    await flushFrame();
    expect(live()).toEqual({ tx: 0, ty: -6, scale: 1 });
    await endBurst();
  }, 20000);

  it('keeps the documented wheel semantics and scale clamps', async () => {
    const svg = mount();

    // Ctrl+wheel zooms about the pointer.
    identity();
    wheel(svg, { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 200, clientY: 150 });
    await flushFrame();
    expect(live().scale).toBeCloseTo(1.1, 12);
    expect(live().tx).toBeCloseTo(-20, 9);
    expect(live().ty).toBeCloseTo(-15, 9);
    await endBurst();

    // A dominant horizontal delta pans (no zoom).
    identity();
    wheel(svg, { deltaX: 50, deltaY: 4, deltaMode: 0, clientX: 200, clientY: 150 });
    await flushFrame();
    expect(live()).toEqual({ tx: -50, ty: 0, scale: 1 });
    await endBurst();

    // A small plain vertical delta is trackpad pan, not an 11% zoom step.
    identity();
    wheel(svg, { deltaY: 5, deltaX: 0, deltaMode: 0, clientX: 200, clientY: 150 });
    await flushFrame();
    expect(live()).toEqual({ tx: 0, ty: -5, scale: 1 });
    await endBurst();

    // Ctrl+wheel still zooms even when the delta is small.
    identity();
    wheel(svg, { deltaY: 5, deltaMode: 0, ctrlKey: true, clientX: 200, clientY: 150 });
    await flushFrame();
    expect(live().scale).toBeCloseTo(1 / 1.1, 12);
    await endBurst();

    // Scale is clamped at both ends; a no-op burst leaves the view untouched.
    act(() => s().setView({ tx: 0, ty: 0, scale: 8 }));
    wheel(svg, { deltaY: -100, deltaMode: 0, clientX: 200, clientY: 150 });
    expect(live()).toEqual({ tx: 0, ty: 0, scale: 8 });

    act(() => s().setView({ tx: 0, ty: 0, scale: 0.1 }));
    wheel(svg, { deltaY: 100, deltaMode: 0, clientX: 200, clientY: 150 });
    expect(live()).toEqual({ tx: 0, ty: 0, scale: 0.1 });
  }, 20000);
});

describe('pointer panning uses the coalesced view fast path', () => {
  beforeEach(() => {
    host = null;
    root = null;
    commits = 0;
  });

  afterEach(cleanup);

  it('per pointermove: no store/React update; once per frame: one paint', async () => {
    const svg = mount();
    identity();
    commits = 0;
    let viewChanges = 0;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.view !== prev.view) viewChanges += 1;
    });
    const group = worldGroup(svg);
    const setAttribute = vi.spyOn(group, 'setAttribute');
    const transformWrites = () =>
      setAttribute.mock.calls.filter(([name]) => name === 'transform').length;

    const background = svg.querySelector('rect[data-role="background"]') as SVGRectElement;
    const pointer = (type: string, clientX: number, clientY: number) => {
      act(() => {
        background.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }),
        );
      });
    };

    // Plain background drag: the first move crosses the 4 px threshold and
    // becomes a pan; the following moves are pure view updates.
    pointer('pointerdown', 5000, 5000);
    for (let i = 1; i <= 20; i += 1) {
      pointer('pointermove', 5000 + i * 10, 5000 + i * 5);
    }

    expect(viewChanges).toBe(0);
    expect(commits).toBe(0);
    expect(transformWrites()).toBe(0);
    expect(s().view).toEqual({ tx: 0, ty: 0, scale: 1 });

    await flushFrame();
    expect(transformWrites()).toBe(1);
    expect(live()).toEqual({ tx: 200, ty: 100, scale: 1 });
    expect(viewChanges).toBeLessThanOrEqual(1);
    expect(commits).toBeLessThanOrEqual(1);

    pointer('pointerup', 5200, 5100);
    await flushFrame();
    // Released: one committed view and one culling refresh, not one per move.
    expect(s().view).toEqual({ tx: 200, ty: 100, scale: 1 });
    expect(viewChanges).toBeLessThanOrEqual(2);
    expect(commits).toBeLessThanOrEqual(2);
    expect(transformWrites()).toBe(1);
    setAttribute.mockRestore();
    unsubscribe();
  }, 20000);
});

describe('the canvas hot path stays off the view subscription', () => {
  it('TreeCanvas paints the world group imperatively', () => {
    const tree = sourceOf('./TreeCanvas.tsx');
    expect(tree).not.toMatch(/^\s*const \w+\s*=\s*useStore\(\(s\)\s*=>\s*s\.view\)/m);
    expect(tree).toContain('viewGroupRef.current?.setAttribute');
    expect(tree).toContain('data-role="world"');
    expect(tree).not.toContain('transform={`translate(${view.tx}');
  });

  it('NodeView and the pointer-gesture layer do not select the view', () => {
    expect(sourceOf('./NodeView.tsx')).not.toMatch(/useStore\(\(s\)\s*=>\s*s\.view/);
    expect(sourceOf('./useDrag.ts')).not.toMatch(/useStore\(\(s\)\s*=>\s*s\.view/);
  });
});
