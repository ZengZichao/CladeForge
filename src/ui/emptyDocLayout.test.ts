// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Source-level + unit guards for the "a blank tab owns the canvas" layout
// request:
//  1. `documentHasTree` is the ONE definition of "this document has content":
//     a fresh tab (root only) is empty, a sample / a file / a first added child
//     is not, and a missing root reads as empty rather than crashing.
//  2. the standard workspace gates the module rail and BOTH side panels on it,
//     so a new tab cannot show sidebars around an empty-state card.
//  3. the sidebars carry a real heading level (a filled section band) and a
//     two-column field grid, so mixed-length labels stop reading as a flat,
//     ragged list.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEmptyProject, createSampleProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import { documentHasTree } from './documentContent';

const source = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

describe('documentHasTree — what counts as an opened document', () => {
  it('is false for a blank document (a root node with no children)', () => {
    expect(documentHasTree(createEmptyProject())).toBe(false);
  });

  it('is true for a built-in sample', () => {
    expect(documentHasTree(createSampleProject())).toBe(true);
  });

  it('turns true as soon as the first child exists', () => {
    const project = createEmptyProject();
    addChildren(project, project.rootId, 1);
    expect(documentHasTree(project)).toBe(true);
  });

  it('is false when the root is missing from the node map', () => {
    const broken = { ...createEmptyProject(), rootId: 'does-not-exist' };
    expect(documentHasTree(broken)).toBe(false);
  });
});

describe('blank document hides the sidebars', () => {
  const workspace = source('StandardWorkspace.tsx');

  it('derives panel visibility from the document, not from the tab', () => {
    expect(workspace).toContain('const canvasIsEmpty = !documentHasTree(project)');
    expect(workspace).toContain('const showPanels = !canvasIsEmpty');
  });

  it('gates the rail, both panels and both resizers on showPanels', () => {
    // Rail + left/right panels each carry the gate; the resizers follow.
    expect(workspace).toContain('!isNarrow && showPanels && !panelsHidden');
    expect(workspace.match(/\.\.\.\(!showPanels && \{ display: 'none' \}\)/g)).toHaveLength(2);
  });

  it('keeps the narrow-screen chrome hidden too', () => {
    // 用户反馈: the bottom tab bar is gone entirely; the toggle buttons still
    // gate on showPanels (they now also serve the desktop per-panel hide).
    expect(workspace).toContain('&& showPanels && (');
    expect(workspace.split('showPanels').length - 1).toBeGreaterThanOrEqual(6);
    expect(workspace).not.toContain('BottomTabBar');
  });
});

describe('sidebar heading hierarchy and row alignment', () => {
  it('marks section headings by weight and muted colour, not a filled band', () => {
    // shadcn redesign (2026-11): the old filled band was abandoned with the
    // square/ink design system; the heading level is carried by the muted
    // colour + medium weight instead.
    const toggle = /\.section-toggle\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(toggle).not.toContain('text-transform: uppercase');
    expect(toggle).toContain('color: var(--muted-foreground)');
    expect(toggle).toContain('font-weight: 500');
  });

  it('aligns side-panel field rows into a fixed label column + control column', () => {
    const rule = /\.panel \.field\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(rule).toContain('display: grid');
    expect(rule).toContain('grid-template-columns');
    // Row variants that are not label + control must keep their flex layout.
    expect(css).toMatch(/\.panel \.field\.check,\s*\n\s*\.panel \.field\.row-actions/);
  });
});
