// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEmptyProject } from '../model/sampleTree';
import { useStore } from '../model/store';
import { PropertiesPanel } from './PropertiesPanel';
import { setLanguage } from './strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mountWithCalibration(search = 'calibration', withCharacter = false): void {
  const project = createEmptyProject('Calibration test');
  project.nodes[project.rootId].age = 54;
  project.calibrationPoints = [
    { id: 'cp', nodeId: project.rootId, minAge: 50, maxAge: 55 },
  ];
  if (withCharacter) {
    project.characters.push({
      id: 'trait', name: 'Trait', type: 'discrete',
      states: [{ id: 'a', label: 'A', color: '#000000' }],
    });
  }
  useStore.getState().loadProject(project);
  useStore.getState().select(project.rootId);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PropertiesPanel)));

  // Searching forces the normally-collapsed calibration section open and
  // filters out the unrelated node-age field.
  if (search !== '') {
    const searchInput = host.querySelector('#inspector-search') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchInput, search);
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function calibrationInputs(scope: ParentNode = host!): HTMLInputElement[] {
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input[type=number]')];
  expect(inputs).toHaveLength(2);
  return inputs;
}

function typeAndBlur(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => input.dispatchEvent(new Event('focusout', { bubbles: true })));
}

function storedRange(): { minAge: number; maxAge: number } {
  const cp = useStore.getState().project.calibrationPoints[0];
  return { minAge: cp.minAge, maxAge: cp.maxAge };
}

beforeEach(() => {
  localStorage.clear();
  setLanguage('en');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

describe('PropertiesPanel calibration interval (CF-B-004)', () => {
  it('refuses Min age 60 over Max age 55 with clear inline feedback', () => {
    mountWithCalibration();
    const [minInput] = calibrationInputs();
    typeAndBlur(minInput, '60');
    expect(storedRange()).toEqual({ minAge: 50, maxAge: 55 });
    expect(minInput.getAttribute('aria-invalid')).toBe('true');
    expect(minInput.closest('.field')?.textContent).toMatch(/minimum age.*maximum age|最小年龄.*最大年龄/i);
  });

  it('refuses Max age 45 below Min age 50 with clear inline feedback', () => {
    mountWithCalibration();
    const [, maxInput] = calibrationInputs();
    typeAndBlur(maxInput, '45');
    expect(storedRange()).toEqual({ minAge: 50, maxAge: 55 });
    expect(maxInput.getAttribute('aria-invalid')).toBe('true');
    expect(maxInput.closest('.field')?.textContent).toMatch(/maximum age.*minimum age|最大年龄.*最小年龄/i);
  });

  it('accepts equal bounds and keeps the existing valid-edit behavior', () => {
    mountWithCalibration();
    const [minInput, maxInput] = calibrationInputs();
    typeAndBlur(minInput, '55');
    expect(storedRange()).toEqual({ minAge: 55, maxAge: 55 });
    typeAndBlur(maxInput, '60');
    expect(storedRange()).toEqual({ minAge: 55, maxAge: 60 });
  });
});

describe('PropertiesPanel — CF-C-005/C-006 acceptance', () => {
  it('all six node favourite controls toggle their DOM and persist through remount', () => {
    mountWithCalibration('', true);
    const titles = ['Node', 'Branch', 'Evolutionary events', 'Time constraint', 'Node style', 'Label'];
    const sections = titles.map((title) => {
      const section = Array.from(host!.querySelectorAll<HTMLElement>('.inspector-content .panel-section'))
        .find((candidate) => candidate.querySelector('.section-title')?.textContent === title);
      expect(section, title).toBeDefined();
      return section!;
    });
    expect(sections).toHaveLength(6);

    for (const [index, section] of sections.entries()) {
      const star = section.querySelector<HTMLButtonElement>('.section-fav')!;
      expect(star.getAttribute('aria-pressed'), titles[index]).toBe('false');
      const before = star.outerHTML;
      act(() => star.click());
      expect(star.getAttribute('aria-pressed'), titles[index]).toBe('true');
      expect(star.classList.contains('active'), titles[index]).toBe(true);
      expect(star.outerHTML, titles[index]).not.toBe(before);
    }
    const saved = Object.entries(localStorage).filter(([key, value]) =>
      key.startsWith('cladeforge:fav:') && value === 'true',
    );
    expect(saved).toHaveLength(6);

    act(() => root!.unmount());
    const remounted = createRoot(host!);
    root = remounted;
    act(() => remounted.render(createElement(PropertiesPanel)));
    const restored = Array.from(host!.querySelectorAll<HTMLButtonElement>('.inspector-content .section-fav'));
    expect(restored).toHaveLength(6);
    expect(restored.every((star) => star.getAttribute('aria-pressed') === 'true')).toBe(true);
    for (const star of restored) act(() => star.click());
    expect(restored.every((star) => star.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(Object.entries(localStorage).filter(([key, value]) =>
      key.startsWith('cladeforge:fav:') && value === 'true',
    )).toHaveLength(0);
  });

  it('Time constraint Reset to default explicitly clears the override without inventing ages', () => {
    mountWithCalibration('');
    const timeSection = Array.from(host!.querySelectorAll<HTMLElement>('.panel-section'))
      .find((section) => section.querySelector('.section-title')?.textContent === 'Time constraint')!;
    act(() => timeSection.querySelector<HTMLButtonElement>('.section-toggle')!.click());
    const [minInput, maxInput] = calibrationInputs(timeSection);
    typeAndBlur(minInput, '10');
    typeAndBlur(maxInput, '20');
    expect(storedRange()).toEqual({ minAge: 10, maxAge: 20 });

    const reset = Array.from(host!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => /Reset to default/i.test(button.textContent ?? ''));
    expect(reset, 'Time constraint needs an explicit Reset to default action').toBeDefined();
    expect(reset!.title).toMatch(/remove.*calibration/i);
    const ageBefore = useStore.getState().project.nodes[useStore.getState().project.rootId].age;
    act(() => reset!.click());

    expect(useStore.getState().project.calibrationPoints).toEqual([]);
    expect(useStore.getState().project.nodes[useStore.getState().project.rootId].age).toBe(ageBefore);
    expect(ageBefore).toBe(54);
    expect(host!.textContent).toContain('Add calibration');
    expect(Array.from(host!.querySelectorAll('button')).some((button) =>
      /Reset to default/i.test(button.textContent ?? ''),
    )).toBe(false);
  });
});
