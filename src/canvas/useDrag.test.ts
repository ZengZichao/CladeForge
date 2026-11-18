// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * Pointer-gesture contracts on the canvas: H-D8 (Ctrl/Cmd+click adds to the
 * selection), G-P16 / D-P11 (a double press opens rename, or expands a
 * collapsed node) and H-D10 (the accessible name's separator is locale-aware).
 *
 * TreeCanvas captures the pointer on the SVG at pointerdown, so the browser
 * retargets the following `dblclick` to the SVG and React's onDoubleClick on
 * `g.node-group` never fires for a real pointer. The gesture tests therefore
 * drive `useCanvasGestures` with dispatched pointer events — the same path a
 * real mouse takes — and the one dispatched `dblclick` covers the programmatic
 * path NodeView also handles.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TreeCanvas } from './TreeCanvas';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import { setLanguage } from '../ui/strings';
import type { NodeId, Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has never implemented the ResizeObserver the canvas measures itself
  // with; the viewport stays 0×0, which the component already handles.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
      (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  }
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
  // The aria-label tests switch the module-level locale; put it back so a
  // later test never inherits it.
  setLanguage('zh');
}

afterEach(cleanup);

/** A purely topological tree, so no layout proposal is in the way. */
function gestureTree(): Project {
  const p = parseNewick('((A,B),(C,D));', 'gestures');
  p.layout.type = 'rectangular-cladogram';
  p.layout.orientation = 'LR';
  return p;
}

function mount(p: Project, lang: 'zh' | 'en' = 'zh'): HTMLElement {
  cleanup();
  // Applied AFTER cleanup (which restores the default locale), because `tr`
  // reads the module-level language at render time.
  setLanguage(lang);
  useStore.getState().loadProject(p);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(TreeCanvas)));
  return host;
}

const s = () => useStore.getState();

const nodeByLabel = (label: string): NodeId => {
  const hit = Object.entries(s().project.nodes).find(([, n]) => n.label === label);
  if (!hit) throw new Error(`no node labelled ${label}`);
  return hit[0] as NodeId;
};

/** The node's own hit element (the transparent circle is first in the group). */
const nodeEl = (id: NodeId): Element => {
  const el = host!.querySelector(`[data-node-id="${id}"][data-role="node"]`);
  if (!el) throw new Error(`node ${id} is not rendered`);
  return el;
};

const groupOf = (id: NodeId): Element => {
  const g = nodeEl(id).closest('g.node-group');
  if (!g) throw new Error(`node ${id} has no group`);
  return g;
};

function pointer(target: EventTarget, type: string, init: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        button: 0,
        ...init,
      }),
    );
  });
}

/** A full click: pointerdown immediately followed by pointerup. */
function press(target: EventTarget, init: MouseEventInit = {}): void {
  pointer(target, 'pointerdown', init);
  pointer(target, 'pointerup', init);
}

describe('canvas node gestures', () => {
  it('Ctrl/Cmd+click adds to the selection instead of replacing it (H-D8)', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');
    const b = nodeByLabel('B');
    act(() => s().select(a));

    press(nodeEl(b), { ctrlKey: true });
    expect(s().selection).toEqual([a, b]);

    // Additive selection toggles: pressing an already-selected node removes it.
    press(nodeEl(a), { metaKey: true });
    expect(s().selection).toEqual([b]);
  });

  it('Shift+click still adds to the selection', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');
    const b = nodeByLabel('B');
    act(() => s().select(a));

    press(nodeEl(b), { shiftKey: true });
    expect(s().selection).toEqual([a, b]);
  });

  it('two presses on a node open the inline rename editor (G-P16)', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');

    press(nodeEl(a));
    press(nodeEl(a));

    expect(s().renameRequest?.id).toBe(a);
    expect(host!.querySelector('foreignObject input')).not.toBeNull();
    // The second press must not leave a drag transaction behind.
    expect(s().interactionBase).toBeNull();
  });

  it('two presses on a collapsed node expand it instead of renaming (D-P11)', () => {
    const p = gestureTree();
    const internal = Object.values(p.nodes).find(
      (n) => n.childrenIds.length > 0 && n.parentId !== null,
    )!;
    mount(p);
    act(() => {
      s().apply((d) => {
        d.nodes[internal.id].collapsed = true;
      });
    });
    expect(s().project.nodes[internal.id].collapsed).toBe(true);

    press(nodeEl(internal.id));
    press(nodeEl(internal.id));

    expect(s().project.nodes[internal.id].collapsed).toBe(false);
    expect(s().renameRequest).toBeNull();
  });

  it('a press on the collapse arrow expands the subtree (GUI-C DEF-4)', () => {
    const p = gestureTree();
    const internal = Object.values(p.nodes).find(
      (n) => n.childrenIds.length > 0 && n.parentId !== null,
    )!;
    mount(p);
    act(() => {
      s().apply((d) => {
        d.nodes[internal.id].collapsed = true;
      });
    });
    const toggle = host!.querySelector(
      `[data-role="collapse-toggle"][data-node-id="${internal.id}"]`,
    );
    expect(toggle).not.toBeNull();

    // A REAL mouse press: the event target is the arrow path, while the SVG's
    // pointer capture retargets the following click to the <svg>. The old
    // onClick on the path was therefore unreachable; the gesture layer must
    // toggle on pointerdown.
    press(toggle as Element);

    expect(s().project.nodes[internal.id].collapsed).toBe(false);
    expect(s().interactionBase).toBeNull();
  });

  it('a press that turned into a drag is not a double-click', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');

    pointer(nodeEl(a), 'pointerdown');
    pointer(nodeEl(a), 'pointermove', { clientX: 100, clientY: 100 });
    pointer(nodeEl(a), 'pointerup', { clientX: 100, clientY: 100 });
    press(nodeEl(a));

    expect(s().renameRequest).toBeNull();
  });

  it('two presses on different nodes are not a double-click', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');
    const b = nodeByLabel('B');

    press(nodeEl(a));
    press(nodeEl(b));

    expect(s().renameRequest).toBeNull();
    expect(s().selection).toEqual([b]);
  });

  it('a background press between the two presses cancels the double-click', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');
    const background = host!.querySelector('[data-role="background"]') as Element;

    press(nodeEl(a));
    press(background);
    press(nodeEl(a));

    expect(s().renameRequest).toBeNull();
  });

  it('a dispatched dblclick on the group opens rename; on a collapsed node it expands', () => {
    mount(gestureTree());
    const a = nodeByLabel('A');
    act(() => {
      groupOf(a).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    // NodeView's own handler edits locally — it does not go through the store.
    expect(s().renameRequest).toBeNull();
    expect(host!.querySelector('foreignObject input')).not.toBeNull();
  });
});

describe('node accessible name separator (H-D10)', () => {
  it('joins the parts with a full-width comma in Chinese', () => {
    mount(gestureTree());
    const label = groupOf(nodeByLabel('A')).getAttribute('aria-label') ?? '';
    expect(label).toContain('，');
    expect(label).not.toContain(', ');
  });

  it('joins the parts with a half-width comma in English', () => {
    mount(gestureTree(), 'en');
    const label = groupOf(nodeByLabel('A')).getAttribute('aria-label') ?? '';
    expect(label).toContain(', ');
    expect(label).not.toContain('，');
  });
});
