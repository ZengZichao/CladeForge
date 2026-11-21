// Source-level regression contracts for the three GUI test reports
// (软件实际测试-CladeForge-A/B/C). Runtime behaviour is covered by the
// component tests next to each fix; these guards stop the specific code shapes
// from being quietly reverted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZH_STRINGS, EN_STRINGS } from './strings';

const src = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

describe('GUI report A contracts', () => {
  it('P2: Add-children refuses both ends of the declared 1–50 range', () => {
    const dlg = src('AddChildrenDialog.tsx');
    expect(dlg).toContain('if (count > 50)');
    expect(dlg).toContain('disabled={!targetNode || !(count >= 1 && count <= 50)}');
    // The silent clamp must not come back.
    expect(dlg).not.toContain('Math.min(50, requested)');
  });

  it('P6: the CSV import toast calls the imported unit a data column', () => {
    const fa = src('../io/fileActions.ts');
    expect(fa).toContain('data column');
    expect(fa).toContain('个数据列');
    expect(fa).not.toContain('Imported ${appliedCharacters} character');
  });
});

describe('GUI report B contracts', () => {
  it('BUG-03 residual: Age never drops below zero, even without a calibration', () => {
    expect(src('PropertiesPanel.tsx')).toContain('Math.max(0, calibration?.minAge ?? 0)');
  });

  it('BUG-06: the header folds to its two-row layout when zoom shrinks the content space', () => {
    const app = src('../App.tsx');
    expect(app).toContain("cladeforge:ui-scale-change");
    expect(app).toContain("setAttribute('data-header-compact', 'true')");
    expect(app).toMatch(/innerWidth\s*\/\s*zoom/);
    expect(css).toContain(":root[data-header-compact='true'] .header-bar { flex-wrap: wrap; }");
    // Preferences announces every scale change so the shell can re-measure.
    expect(src('PreferencesMenu.tsx')).toContain("cladeforge:ui-scale-change");
  });

  it('BUG-04: the confirm layer stacks above portalled dialogs', () => {
    expect(css).toContain('--z-confirm: 250');
    expect(css).toContain('.dialog-backdrop.confirm-backdrop { z-index: var(--z-confirm); }');
    // The reset path must not close Preferences before asking.
    expect(src('PreferencesMenu.tsx')).not.toMatch(/setOpen\(false\);\s*\n\s*requestConfirm/);
  });

  it('BUG-07: the preset name mirrors its draft live', () => {
    expect(src('ExportSettingsDialog.tsx')).toMatch(/<TextField[\s\S]*?onChange=\{setPresetName\}/);
    expect(src('fields.tsx')).toContain('onChange?: (v: string) => void;');
  });

  it('BUG-08: an untouched blank tab is reused instead of accumulating tabs', () => {
    const opener = src('sampleOpener.ts');
    expect(opener).toContain('documentHasTree');
    expect(opener).toContain('st.revision === 0');
    expect(opener).toContain('st.loadProject(project)');
  });

  it('DEF-4 (report C): the collapse arrow toggles in the gesture layer', () => {
    const drag = src('../canvas/useDrag.ts');
    expect(drag).toContain("role === 'collapse-toggle'");
    expect(drag).toMatch(/collapse-toggle[\s\S]{0,900}?collapsed = !n\.collapsed/);
    // The path's own onClick was unreachable under SVG pointer capture.
    const node = src('../canvas/NodeView.tsx');
    const toggleIdx = node.indexOf('data-role="collapse-toggle"');
    expect(toggleIdx).toBeGreaterThan(0);
    expect(node.slice(toggleIdx, toggleIdx + 400)).not.toContain('onClick=');
  });

  it('OBS-03: the search query lives in the store and drives a canvas highlight', () => {
    expect(src('../model/store.ts')).toContain('searchQuery: string');
    expect(src('CanvasControls.tsx')).toContain('setSearchQuery');
    expect(src('../canvas/TreeCanvas.tsx')).toContain('searchHits?.has(n.id)');
    expect(src('../canvas/NodeView.tsx')).toContain('node-search-hit');
    expect(css).toMatch(/\.node-search-hit\s*\{/);
  });
});

describe('GUI report C contracts', () => {
  it('DEF-1/DEF-2: the event row reserves width for the name and equalises From/To', () => {
    expect(css).toContain('grid-template-columns: 32px minmax(48px, 1fr) minmax(0, auto) 32px 32px;');
    expect(css).toContain(
      'grid-template-columns: auto minmax(64px, 1fr) auto minmax(64px, 1fr) auto;',
    );
    expect(css).toMatch(/\.env-summary\s*\{[^}]*width:\s*auto/s);
  });

  it('DEF-5: toast clocks stay inside the 3–6s window', () => {
    const toast = src('toast.ts');
    expect(toast).toContain("kind === 'error' ? 6000 : 5000");
    expect(src('Toaster.tsx')).not.toContain('linger 30s');
  });

  it('OBS-1: the status bar states both the total and the tip count', () => {
    expect(ZH_STRINGS.status.tips).toBe('末端');
    expect(EN_STRINGS.status.tips).toBe('Tips');
    expect(src('StandardWorkspace.tsx')).toContain('${S.status.tips} ${tipCount}');
  });
});