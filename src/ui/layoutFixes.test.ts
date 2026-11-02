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
  it('replaces the recon empty-state rows with one 2x2 grid and no exit button', () => {
    const view = source('../canvas/ReconciliationView.tsx');
    expect(view).toContain('className="recon-empty-actions"');
    expect(view).toContain('S.recon.emptyBuild');
    expect(view).toContain('S.recon.emptyCopy');
    expect(view).toContain('S.recon.emptyImport');
    expect(view).toContain('S.recon.loadReconSample');
    expect(view).not.toContain('S.recon.exitView');
    expect(css).toMatch(
      /\.recon-empty-card \.recon-empty-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
    );
  });

  it('places add-children immediately after the view-mode switch', () => {
    const toolbar = source('Toolbar.tsx');
    const viewSwitch = toolbar.indexOf('<ViewModeSegment />');
    const addChildren = toolbar.indexOf('{!reconMode && (');
    expect(viewSwitch).toBeGreaterThanOrEqual(0);
    expect(addChildren).toBeGreaterThan(viewSwitch);
    expect(toolbar.indexOf('S.toolbar.addChildren')).toBeGreaterThan(viewSwitch);
  });

  it('removes reconciliation from both standard navigation rails', () => {
    expect(source('NavigationRail.tsx')).not.toContain("id: 'recon'");
    const workspace = source('StandardWorkspace.tsx');
    expect(workspace).not.toContain("id: 'recon'");
    expect(workspace).not.toContain("case 'recon'");
  });

  it('updates module counts and shortcuts after removing the recon rail entry', () => {
    expect(ZH_STRINGS.tour.step3Desc).toContain('六个模块');
    expect(ZH_STRINGS.tour.step3Desc).not.toContain('协调（基因树 DTL）');
    expect(EN_STRINGS.tour.step3Desc).toContain('Six modules');
    expect(EN_STRINGS.tour.step3Desc).not.toContain('Reconciliation');
    const rows = SHORTCUT_GROUPS().flatMap((group) => group.rows);
    expect(rows.some((row) => row.keys === '⌘1 … ⌘6')).toBe(true);
    expect(rows.some((row) => row.keys === '⌘1 … ⌘7')).toBe(false);
    expect(source('../App.tsx')).toContain('k <= \'6\'');
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
