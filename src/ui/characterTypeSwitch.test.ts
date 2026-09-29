// @vitest-environment jsdom
/**
 * The character-type switch must not promise data loss it does not cause.
 *
 * The handler behind `setCharacterType` asks for no confirmation, because
 * `setCharacterType` only re-tags the character:
 *
 *   - the declared states stay on the character;
 *   - the tip values stay on the nodes;
 *   - the matrix and the inspector keep showing a value that is not a declared
 *     state as a stale value.
 *
 * A confirmation that lies about data loss is worse than none: it teaches the
 * user to click through warnings, and it hides the one thing that IS worth
 * knowing (a continuous character reads numbers, so the discrete values stop
 * being displayed). So the panel says out loud that nothing is deleted.
 * These tests pin the promise to the effect.
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers `src/` files
 * ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CharacterPanel } from './CharacterPanel';
import { registerConfirmHandler, type ConfirmRequest } from './confirmDialog';
import { useStore } from '../model/store';
import { useToasts } from './toast';
import { newCharacter } from '../model/characters';
import { S } from './strings';
import { parseNewick } from '../io/newick';
import type { NodeId, Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Element.prototype.scrollIntoView = function scrollIntoView(): void {
  /* no-op */
};

let host: HTMLElement | null = null;
let root: Root | null = null;
let requests: ConfirmRequest[] = [];

function mountPanel(): void {
  cleanup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CharacterPanel, { onOpenMatrix: () => {} })));
}

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

const s = () => useStore.getState();

/** A discrete character with two states, scored on every tip. */
function scoredProject(id: string): { project: Project; characterId: string; tips: NodeId[] } {
  const p = parseNewick('((A,B),(C,D));', id);
  const c = newCharacter('毛色');
  p.characters.push(c);
  const tips = Object.values(p.nodes)
    .filter((n) => n.childrenIds.length === 0)
    .map((n) => n.id);
  tips.forEach((tipId, i) => {
    p.nodes[tipId].charStates = { [c.id]: c.states[i % c.states.length].id };
  });
  return { project: p, characterId: c.id, tips };
}

const charOf = (id: string) => s().project.characters.find((c) => c.id === id)!;

/** Open the first character's editor and return its type <select>. */
function openTypeSelect(): HTMLSelectElement {
  const buttons = Array.from(host!.querySelectorAll('button'));
  const edit = buttons.find((b) => b.textContent?.trim() === S.character.edit);
  if (!edit) throw new Error('no edit button');
  act(() => {
    (edit as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const selects = Array.from(host!.querySelectorAll('select'));
  // [0] is 着色依据, [1] the character's own type selector.
  const typeSelect = selects[1];
  if (!typeSelect) throw new Error('no type select');
  return typeSelect as HTMLSelectElement;
}

function chooseType(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('the type switch does what its wording says', () => {
  beforeEach(() => {
    requests = [];
    registerConfirmHandler((req) => requests.push(req));
    useToasts.setState({ toasts: [] });
    localStorage.clear();
  });

  afterEach(cleanup);

  it('switching type asks for no confirmation, because nothing is discarded', () => {
    const { project, characterId, tips } = scoredProject('c6-confirm');
    s().loadProject(project);
    mountPanel();
    const select = openTypeSelect();
    const before = s().past.length;

    chooseType(select, 'continuous');

    expect(requests, 'no dialog: the promise it made was false').toEqual([]);
    expect(charOf(characterId).type).toBe('continuous');
    expect(s().past).toHaveLength(before + 1);
    // Switching type discards nothing, so every tip assignment is still here.
    for (const tipId of tips) {
      expect(s().project.nodes[tipId].charStates?.[characterId]).toBe(
        project.nodes[tipId].charStates?.[characterId],
      );
    }
  });

  it('the states survive, so switching back restores the colouring exactly', () => {
    const { project, characterId, tips } = scoredProject('c6-roundtrip');
    const before = project.characters[0].states.map((st) => ({ ...st }));
    const assignments = tips.map((t) => project.nodes[t].charStates?.[characterId]);
    s().loadProject(project);
    mountPanel();
    const select = openTypeSelect();

    chooseType(select, 'continuous');
    chooseType(select, 'discrete');

    expect(charOf(characterId).type).toBe('discrete');
    expect(charOf(characterId).states).toEqual(before);
    expect(tips.map((t) => s().project.nodes[t].charStates?.[characterId])).toEqual(assignments);
  });

  it('one ⌘Z reverses the switch — the whole edit is one step', () => {
    const { project, characterId } = scoredProject('c6-undo');
    s().loadProject(project);
    mountPanel();
    chooseType(openTypeSelect(), 'continuous');
    act(() => s().undo());
    expect(charOf(characterId).type).toBe('discrete');
    expect(s().past).toHaveLength(0);
  });

  it('the panel says the assignments are kept where the choice is made', () => {
    const { project } = scoredProject('c6-label');
    s().loadProject(project);
    mountPanel();
    openTypeSelect();
    const text = host!.textContent ?? '';
    // The panel's wording promises the opposite of data loss, and the opposite is
    // what the model call actually does.
    expect(text).not.toMatch(/将丢失|discards all/);
    expect(text).toMatch(/不会删除.*赋值|does not delete the .*assignment/);
    expect(text).toContain('4'); // the four scored tips
  });

  it('an unscored character gets no extra note (the hint is about real data)', () => {
    const p = parseNewick('((A,B),(C,D));', 'c6-empty');
    p.characters.push(newCharacter('毛色'));
    s().loadProject(p);
    mountPanel();
    openTypeSelect();
    expect(host!.textContent ?? '').not.toMatch(/不会删除|does not delete/);
  });
});
