// @vitest-environment jsdom
/**
 * Source-level contracts that a rendered test cannot otherwise re-check.
 *
 * a non-finite pinned position: cleared on load, ignored at draw time
 * `depthOf` is cycle-guarded like every other upward walk
 * every `Field`-wrapped control has an accessible name
 * a stale `draggingId` cannot keep serving a cached drag baseline
 * panel widths are re-clamped on render, not only on drag commit
 *
 * (`createElement` rather than JSX: vitest's `include` pattern covers
 * `src/` files ending in `.test.ts` only, so a `.tsx` test file is never collected.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProject } from '../model/validate';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren, depthOf } from '../model/treeOps';
import { computeLayout } from '../layout/autoLayout';
import type { Project } from '../model/types';
import { ColorField, DashSelect, Field, NumberField, RangeField, TextField } from './fields';

// React 18 refuses `act()` unless the environment declares itself.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** `Field` wraps one control; children go through props so TS sees them. */
function field(label: string, control: ReactNode): ReactNode {
  return createElement(Field, { label, children: control });
}

describe('a non-finite pinned position cannot reach the SVG', () => {
  function pin(project: Project, id: string, x: number, y: number): void {
    project.nodes[id].position = { x, y };
    project.nodes[id].pinned = true;
  }

  it('validateProject clears it and says so', () => {
    const p = createEmptyProject();
    const [child] = addChildren(p, p.rootId, 1);
    // `1e999` is how a non-finite value actually arrives: JSON has no NaN
    // literal, but a hand-edited document can carry a numeral that overflows.
    pin(p, child, 1e308 * 10, 42);
    const { project, issues } = validateProject(p);
    expect(project.nodes[child].position).toBeUndefined();
    expect(issues.join(' ')).toMatch(/不是有限数值|not a finite number/);
  });

  it('autoLayout ignores such a pin and reports it, so no NaN transform is emitted', () => {
    const p = createEmptyProject();
    const [child] = addChildren(p, p.rootId, 1);
    // Bypass `validateProject` to exercise the draw-time guard on its own — the
    // live-edit path, where the value never went through a loader.
    pin(p, child, Number.NaN, Number.NaN);
    const { positions, issues, bounds } = computeLayout(p);
    const pos = positions.get(child)!;
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
    expect(issues?.some((i) => i.kind === 'invalid-pinned-position')).toBe(true);
    expect(Number.isFinite(bounds.maxX)).toBe(true);
  });
});

describe('depthOf cannot hang on a parentId cycle', () => {
  it('terminates when two nodes claim each other as parent', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[a].parentId = b;
    p.nodes[b].parentId = a;
    // Without the visited set this never returns, so the assertion is that the
    // function comes back at all — with a finite number.
    expect(Number.isFinite(depthOf(p, a))).toBe(true);
    expect(Number.isFinite(depthOf(p, b))).toBe(true);
    expect(Number.isFinite(depthOf(p, p.rootId))).toBe(true);
  });

  it('still reports the true depth on a normal tree', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [grand] = addChildren(p, a, 1);
    expect(depthOf(p, p.rootId)).toBe(0);
    expect(depthOf(p, a)).toBe(1);
    expect(depthOf(p, grand)).toBe(2);
  });
});

describe('Field gives its control an accessible name', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  function render(node: ReactNode): HTMLElement {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(node));
    return host;
  }

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  /** Controls with no accessible name of any kind. */
  function nameless(box: HTMLElement): string[] {
    return Array.from(box.querySelectorAll('input, select, textarea'))
      .filter((el) => !el.getAttribute('aria-label') && !el.getAttribute('id'))
      .map((el) => el.outerHTML);
  }

  it('names the colour picker rather than leaving a bare <input type="color">', () => {
    const box = render(
      field('填充色', createElement(ColorField, { value: '#ff0000', onChange: () => undefined })),
    );
    const input = box.querySelector('input[type="color"]') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('填充色');
    expect(nameless(box)).toEqual([]);
  });

  it('names the number, range and select controls too', () => {
    const box = render(
      createElement(
        'div',
        null,
        field('枝长', createElement(NumberField, { value: 1, onCommit: () => undefined })),
        field(
          '透明度',
          createElement(RangeField, {
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
            onCommit: () => undefined,
          }),
        ),
        field('线型', createElement(DashSelect, { value: 'solid', onChange: () => undefined })),
      ),
    );
    expect(box.querySelector('input[type="number"]')!.getAttribute('aria-label')).toBe('枝长');
    expect(box.querySelector('input[type="range"]')!.getAttribute('aria-label')).toBe('透明度');
    expect(box.querySelector('select')!.getAttribute('aria-label')).toBe('线型');
    expect(nameless(box)).toEqual([]);
  });

  it('does not overwrite a name the control already declares', () => {
    const box = render(
      field(
        '分类名',
        createElement(TextField, {
          value: 'A',
          onCommit: () => undefined,
          ariaLabel: '自己的名字',
        }),
      ),
    );
    expect(box.querySelector('input')!.getAttribute('aria-label')).toBe('自己的名字');
  });

  it('still labels a plain host child through htmlFor rather than aria-label', () => {
    const box = render(field('备注', createElement('textarea')));
    const label = box.querySelector('label')!;
    const area = box.querySelector('textarea')!;
    expect(label.getAttribute('for')).toBeTruthy();
    expect(area.getAttribute('id')).toBe(label.getAttribute('for'));
  });
});

describe('the remaining source-level contracts', () => {
  it('a cached drag baseline requires an interaction still in progress', () => {
    const canvas = sourceOf('../canvas/TreeCanvas.tsx');
    expect(canvas).toContain('draggingId && interactionActive');
  });

  it('the shared confirm dialog mounts LAST so it stacks above every app modal (P-12)', () => {
    // All backdrops share z-index var(--z-modal); source order breaks the tie.
    // Mounted before SampleLibraryDialog, the confirm rendered underneath it
    // while its focus trap still stole focus — “Replace current document”
    // looked dead and every click stacked another invisible scrim.
    const app = sourceOf('../App.tsx');
    const confirm = app.indexOf('<ConfirmDialog />');
    expect(confirm).toBeGreaterThan(-1);
    for (const modal of ['<SampleLibraryDialog', '<ImportReportDialog', '<ManualDialog']) {
      expect(confirm, modal).toBeGreaterThan(app.indexOf(modal));
    }
  });

  it('find & replace updates its preview on every keystroke (P-05)', () => {
    const dlg = sourceOf('../ui/FindReplaceDialog.tsx');
    // The live inputs replace the buffered TextField: onChange writes the query
    // state directly, so the "No matches" preview can never lag the typed text.
    expect(dlg).toContain('onChange={(e) => setFind(e.target.value)}');
    expect(dlg).toContain('onChange={(e) => setReplace(e.target.value)}');
  });

  it('the reconciliation report is never greyed without a reason (P-18)', () => {
    const menu = sourceOf('../ui/fileMenu.ts');
    expect(menu).not.toContain('disabled: !hasGeneTrees');
    // The action itself explains the missing gene trees when clicked.
    const actions = sourceOf('../io/fileActions.ts');
    const guard = actions.indexOf('actionExportReconciliationReport');
    expect(guard).toBeGreaterThan(-1);
    expect(actions.slice(guard, guard + 400)).toContain('emptyReconTitle');
  });

  it('the import-note overflow toast agrees in number with its subject (BUG-08)', () => {
    const actions = sourceOf('../io/fileActions.ts');
    expect(actions).toContain("=== 1 ? ' was' : 's were'");
  });

  it('underscore-only Newick names get the convention note, not a whitespace warning (BUG-08)', () => {
    const newick = sourceOf('../io/newick.ts');
    expect(newick).toContain('raw: v');
    expect(newick).toContain('hadRealWhitespace');
  });

  it('left-panel sections persist per document, not globally (P-08)', () => {
    const sec = sourceOf('../ui/Section.tsx');
    expect(sec).toContain('scope ? `${scope}::${baseId}` : baseId');
    expect(sourceOf('../ui/TimePanel.tsx')).toContain('scope={project.id}');
    expect(sourceOf('../ui/LayoutPanel.tsx')).toContain('scope={project.id}');
  });

  it('Custom time unit starts EMPTY and shows as Custom… in the dropdown (P-07)', () => {
    const panel = sourceOf('../ui/TimePanel.tsx');
    expect(panel).toContain("customUnitMode || !storedIsPreset");
    expect(panel).toContain('value={customDraft}');
    expect(panel).toContain('setCustomDraft(\'\')');
  });

  it('panel widths are re-clamped at render, not only on commit', () => {
    // The standard panel widths live in StandardWorkspace since the workspace
    // split; the recon workspace clamps its own widths through the same rule.
    const ws = sourceOf('../ui/StandardWorkspace.tsx');
    expect(ws).toContain('const panelLeft = clampPanel(leftWidth)');
    expect(ws).toContain('const panelRight = clampPanel(rightWidth)');
    expect(ws).toContain('width: isNarrow ? 280 : panelLeft');
    expect(ws).toContain('width: isNarrow ? 300 : panelRight');
    expect(ws).not.toMatch(/width: isNarrow \? \d+ : (leftWidth|rightWidth)/);
    const recon = sourceOf('../canvas/ReconWorkspace.tsx');
    expect(recon).toContain('clampReconPanel');
  });
});
