// @vitest-environment jsdom
/**
 * One colour interaction, one undo step, in every panel.
 *
 * `ColorField` coalesces a picker drag into a single commit, and every panel that
 * colours something routes through it. A raw `<input type="color" onChange={apply…}>`
 * in the 性状 state swatches, the 性状 low/high gradient ends or the 时间
 * environmental event colour fires `onChange` for every pixel of the native drag,
 * so one adjustment there burns dozens of the 100 history slots — in exactly the
 * panels a user drags through when styling a figure.
 *
 * These tests drive the REAL panels: a 30-frame drag plus the pointer release must
 * leave exactly one undo step behind, carrying the final colour. A source scan backs
 * the behavioural check, because a raw input in markup the tests never open would
 * otherwise pass silently.
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers `src/` files
 * ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CharacterPanel } from './CharacterPanel';
import { TimePanel } from './TimePanel';
import { useStore } from '../model/store';
import { useToasts } from './toast';
import { newCharacter } from '../model/characters';
import { S } from './strings';
import { parseNewick } from '../io/newick';
import type { Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The character editor scrolls itself into view on open; jsdom has no layout.
Element.prototype.scrollIntoView = function scrollIntoView(): void {
  /* no-op */
};

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(node: ReactNode): void {
  cleanup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

// --- the picker, as the OS drives it ------------------------------------------

const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)!.set!;

/** One pixel of a native colour drag: write through the prototype setter so React
 *  does not treat the following `input` event as "no change". */
function dragTo(el: HTMLInputElement, value: string): void {
  nativeValueSetter.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fire(el: HTMLInputElement, type: string): void {
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

/** A full interaction: 30 frames of the sweep, then the release. */
function pickFullDrag(el: HTMLInputElement, to: string): void {
  for (let i = 0; i < 30; i += 1) {
    const hex = i.toString(16).padStart(2, '0');
    dragTo(el, `#${hex}${hex}${hex}`);
  }
  dragTo(el, to);
  fire(el, 'pointerup');
}

function colorInputs(scope?: Element): HTMLInputElement[] {
  const root0 = scope ?? host;
  return Array.from(root0!.querySelectorAll('input[type="color"]'));
}

const s = () => useStore.getState();
const stepCount = () => s().past.length;

// --- documents ----------------------------------------------------------------

const SWATCH = '#00ff44';

function projectWithCharacters(id: string): { project: Project; discrete: string; continuous: string } {
  const p = parseNewick('((A,B),(C,D));', id);
  const discrete = newCharacter('离散性状');
  const continuous = newCharacter('连续性状');
  continuous.type = 'continuous';
  continuous.states = [];
  continuous.lowColor = '#dbeafe';
  continuous.highColor = '#1e3a8a';
  p.characters.push(discrete, continuous);
  for (const n of Object.values(p.nodes)) {
    if (n.childrenIds.length === 0) n.charStates = { [discrete.id]: discrete.states[0].id };
  }
  return { project: p, discrete: discrete.id, continuous: continuous.id };
}

function datedProjectWithEvent(id: string): { project: Project; eventId: string } {
  const p = parseNewick('((A,B),(C,D));', id);
  for (const n of Object.values(p.nodes)) n.age = 20;
  p.nodes[p.rootId].age = 100;
  const eventId = 'env-1';
  p.environmentalEvents.push({
    id: eventId,
    label: 'K-Pg 界线',
    from: 66,
    to: 66,
    color: '#f59e0b',
  });
  p.layout.type = 'time-calibrated';
  return { project: p, eventId };
}

/** Click the Nth “编辑” button in the character list (open that character). */
function openCharacterEditor(index: number): void {
  const buttons = Array.from(host!.querySelectorAll('button'));
  const target = buttons.filter((b) => b.textContent?.trim() === S.character.edit)[index];
  if (!target) throw new Error(`no character-edit button at ${index}`);
  act(() => {
    (target as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('every colour picker commits one undo step', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(cleanup);

  it('a state swatch drag in the 性状 panel is one step, carrying the final colour', () => {
    const { project, discrete } = projectWithCharacters('c4-state');
    const original = project.characters[0].states[0].color;
    s().loadProject(project);
    const before = stepCount();
    mount(createElement(CharacterPanel, { onOpenMatrix: () => {} }));
    openCharacterEditor(0);
    expect(colorInputs().length).toBe(2); // one swatch per declared state

    pickFullDrag(colorInputs()[0], SWATCH);

    expect(stepCount()).toBe(before + 1);
    expect(s().project.characters.find((c) => c.id === discrete)!.states[0].color).toBe(SWATCH);
    act(() => s().undo());
    expect(s().project.characters.find((c) => c.id === discrete)!.states[0].color).toBe(original);
    expect(stepCount()).toBe(before);
  });

  it('the gradient ends of a continuous character are one step each, not one per pixel', () => {
    const { project, continuous } = projectWithCharacters('c4-ramp');
    s().loadProject(project);
    const before = stepCount();
    mount(createElement(CharacterPanel, { onOpenMatrix: () => {} }));
    openCharacterEditor(1);
    const [low, high] = colorInputs();
    expect([low, high].filter(Boolean).length).toBe(2);

    pickFullDrag(low, SWATCH);
    expect(stepCount()).toBe(before + 1);
    pickFullDrag(high, '#101010');
    expect(stepCount()).toBe(before + 2);
    const c = s().project.characters.find((x) => x.id === continuous)!;
    expect([c.lowColor, c.highColor]).toEqual([SWATCH, '#101010']);
  });

  it('the swatches carry an accessible name through ColorField', () => {
    const { project } = projectWithCharacters('c4-a11y');
    s().loadProject(project);
    mount(createElement(CharacterPanel, { onOpenMatrix: () => {} }));
    openCharacterEditor(0);
    for (const input of colorInputs()) {
      expect(input.getAttribute('aria-label')).toBeTruthy();
    }
    // The hex readout is part of the buffered field, so the live value is visible.
    expect(host!.textContent).toMatch(/#[0-9a-f]{6}/i);
  });

  it('an environmental-event colour in the 时间 panel is one step', () => {
    const { project, eventId } = datedProjectWithEvent('c4-env');
    s().loadProject(project);
    const before = stepCount();
    mount(createElement(TimePanel));
    const swatch = colorInputs()[0];
    expect(swatch.disabled, 'time data present, so the control is enabled').toBe(false);

    pickFullDrag(swatch, SWATCH);

    expect(stepCount()).toBe(before + 1);
    expect(s().project.environmentalEvents.find((e) => e.id === eventId)!.color).toBe(SWATCH);
  });

  it('no panel renders a raw colour input any more (the flood cannot come back)', () => {
    for (const file of ['CharacterPanel.tsx', 'TimePanel.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      // Comments are stripped first: the notes explaining why a raw input is
      // forbidden quote that very markup, and must not read as the defect.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} routes colours through the buffered field`).toMatch(/ColorField/);
      expect(code, `${file} has no raw colour input`).not.toMatch(/type=["']color["']/);
    }
  });
});
