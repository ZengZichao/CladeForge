// Source-level guards for the 2026-11 layout requests:
//  1. four recon empty-state actions in a 2x2 grid, no "back to standard" there
//  2. "add children" sits to the right of the standard/recon switch
//  3. reconciliation is gone from the standard (and narrow) navigation rail
//  4. the tab bar reserves the traffic-light gutter only on macOS Tauri

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EN_STRINGS, ZH_STRINGS } from './strings';
import { SHORTCUT_GROUPS } from './ShortcutsDialog';

const source = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

describe('requested layout fixes', () => {
  it('keeps the recon empty state to a single status line, with creation actions in the panel', () => {
    // M9 (2026-11-15 review) put ALL FOUR creation paths on the empty stage;
    // 2026-11-16 用户反馈 replaced them with TWO entries — 新建协调视图 (seeds
    // the reconciliation from the species tree) and 导入协调视图 (opens a saved
    // project). The stage still must not offer an exit (leaving lives in the
    // header switch).
    const view = source('../canvas/ReconciliationView.tsx');
    expect(view).toContain('className="recon-empty-note"');
    expect(view).toContain('S.recon.emptyReconTitle');
    expect(view).toContain('S.recon.newReconView');
    expect(view).toContain('S.recon.importReconView');
    expect(view).toContain("void file.actionOpenProject()");
    // The retired four entries must not come back.
    expect(view).not.toContain("tr('构建基因树', 'Build gene tree')");
    expect(view).not.toContain("tr('构建物种树', 'Build species tree')");
    expect(view).not.toContain("tr('导入物种树', 'Import species tree')");
    expect(view).not.toContain("tr('导入基因树', 'Import gene tree')");
    expect(view).toContain("d.id === 'recon-family'");
    expect(view).toContain('empty-wordmark');
    expect(view).toContain('sample-card');
    expect(view).not.toContain('S.recon.exitView');
    expect(css).toMatch(/\.recon-empty-note\s*\{/);
    expect(css).toMatch(/\.recon-empty-actions\s*\{/);
    expect(css).toMatch(/grid-template-columns: 1fr 1fr/);
  });

  it('keeps the editing toolbar free of the view-mode switch (it lives in HeaderActions)', () => {
    // 2026-11-15: the 标准/协调 switch is a document-level mode change, so it
    // moved out of the editing row into HeaderActions, ahead of Save project.
    const toolbar = source('Toolbar.tsx');
    const editing = toolbar.indexOf('export function Toolbar');
    const actions = toolbar.indexOf('export function HeaderActions');
    expect(editing).toBeGreaterThan(0);
    expect(actions).toBeGreaterThan(editing);
    // The editing row between the two definitions carries no switch.
    expect(toolbar.slice(editing, actions)).not.toContain('<ViewModeSegment />');
    const viewSwitch = toolbar.indexOf('<ViewModeSegment />', actions);
    const save = toolbar.indexOf('className="btn primary header-save"', actions);
    expect(viewSwitch).toBeGreaterThan(actions);
    expect(save).toBeGreaterThan(viewSwitch);
    // The editing row keeps undo/redo first and add-children after. The
    // 用户反馈 round added the blank-document gate (hasTree) to the guard.
    const addChildren = toolbar.indexOf('{!reconMode && hasTree && (', editing);
    expect(addChildren).toBeGreaterThan(toolbar.indexOf('<UndoRedo />', editing));
    expect(toolbar.slice(editing, actions)).toContain('documentHasTree');
  });

  it('removes reconciliation from the standard navigation surfaces', () => {
    const workspace = source('StandardWorkspace.tsx');
    expect(workspace).not.toContain("id: 'recon'");
    expect(workspace).not.toContain("case 'recon'");
  });

  it('drops the module rail entirely — one plain merged left panel', () => {
    const workspace = source('StandardWorkspace.tsx');
    expect(workspace).not.toContain('NavigationRail');
    expect(workspace).not.toContain('BottomTabBar');
  });

  it('updates module counts and shortcuts after the rail collapsed to one module', () => {
    expect(ZH_STRINGS.tour.step3Desc).toContain('合并面板');
    expect(ZH_STRINGS.tour.step3Desc).not.toContain('五个模块');
    expect(EN_STRINGS.tour.step3Desc).toContain('merged panel');
    expect(EN_STRINGS.tour.step3Desc).not.toContain('Five modules');
    const rows = SHORTCUT_GROUPS().flatMap((group) => group.rows);
    expect(rows.some((row) => row.keys === '⌘1')).toBe(true);
    expect(rows.some((row) => row.keys === '⌘1 … ⌘5')).toBe(false);
    expect(source('../App.tsx')).toContain("detail: 'edit'");
    expect(source('../App.tsx')).not.toContain("'recon', 'time'");
  });

  it('only reserves the tab-bar traffic-light gutter on macOS Tauri', () => {
    const app = source('../App.tsx');
    expect(app).toContain('isTauri() && /Mac/i.test(navigator.userAgent)');
    expect(app).toContain('macos-titlebar');
    const defaultTabbar = /\.tabbar\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(defaultTabbar).not.toContain('80px');
    expect(css).toMatch(/\.app\.macos-titlebar \.tabbar\s*\{[^}]*padding-left:\s*80px/s);
  });

  it('faces the reconciliation trees towards each other with straight mapping lines', () => {
    const view = source('../canvas/ReconciliationView.tsx');
    expect(view).toContain("horizontalCladogram(project, 'LR')");
    expect(view).toContain("horizontalCladogram(entry.doc, 'RL')");
    const mapping = source('../canvas/reconMapping.ts');
    expect(mapping).toContain('export function bridgeLine');
    expect(mapping).not.toContain('bridgeCurve');
    expect(source('../canvas/ReconMappingLayer.tsx')).toContain('bridgeLine(l.from, l.to)');
  });

  it('uses one-column equal-width reconciliation action stacks', () => {
    const panel = source('ReconPanel.tsx');
    expect(panel.match(/className="recon-action-stack"/g)?.length).toBe(2);
    expect(panel).toContain('className="recon-cost-numbers"');
    expect(css).toMatch(/\.recon-action-stack\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.recon-action-stack \.btn\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.recon-cost-numbers \.field\s*\{[^}]*grid-template-columns/s);
  });

  it('keeps dropdown menus inside the viewport with internal scrolling', () => {
    const dropdown = source('Dropdown.tsx');
    expect(dropdown).toContain('maxHeight');
    expect(dropdown).toContain("overflowY: 'auto'");
    expect(source('MenuBar.tsx')).toContain('maxHeight');
  });
});
