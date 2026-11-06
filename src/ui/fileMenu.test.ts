// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md. 
// Menu side of the export entry points: the file dropdown must never hand the
// click event to an action that takes an options bag. `fileMenu.ts` exists so
// this is testable without rendering the menu bar.

import { describe, it, expect, vi } from 'vitest';

// `vi.hoisted` because the mock factory below is hoisted above the imports and
// cannot see plain module-level bindings.
const recorder = vi.hoisted(() => {
  const calls: { name: string; args: unknown[] }[] = [];
  const noop = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    return Promise.resolve();
  };
  return { calls, noop };
});
const { calls } = recorder;

vi.mock('../io/fileActions', () => ({
  actionNewProject: recorder.noop('actionNewProject'),
  actionOpenProject: recorder.noop('actionOpenProject'),
  // 3d03bdc added the lifecycle trio (保存/另存为/回退) to the FILE menu —
  // see fileMenu.ts; the mock has to cover them.
  actionSaveProject: recorder.noop('actionSaveProject'),
  actionSaveProjectAs: recorder.noop('actionSaveProjectAs'),
  actionRevertProject: recorder.noop('actionRevertProject'),
  actionImportTree: recorder.noop('actionImportTree'),
  actionImportTable: recorder.noop('actionImportTable'),
  actionPasteTreeFromClipboard: recorder.noop('actionPasteTreeFromClipboard'),
  actionExportNexml: recorder.noop('actionExportNexml'),
  actionExportMatrixCsv: recorder.noop('actionExportMatrixCsv'),
  actionExportAnnotationsCsv: recorder.noop('actionExportAnnotationsCsv'),
  actionExportMatrixTemplate: recorder.noop('actionExportMatrixTemplate'),
  actionExportSVG: recorder.noop('actionExportSVG'),
  actionExportPNG: recorder.noop('actionExportPNG'),
  actionExportPDF: recorder.noop('actionExportPDF'),
  actionExportNewick: recorder.noop('actionExportNewick'),
  actionExportNexus: recorder.noop('actionExportNexus'),
  actionExportNarrative: recorder.noop('actionExportNarrative'),
  actionExportHypothesisJSON: recorder.noop('actionExportHypothesisJSON'),
  actionExportRScript: recorder.noop('actionExportRScript'),
  // The export-settings dialog entry (导出选项…) is synchronous, not a promise.
  actionOpenExportSettings: recorder.noop('actionOpenExportSettings'),
}));

import { buildFileMenuItems, buildRecentItems, itemByLabel } from './fileMenu';
import { S } from './strings';
import { DEFAULT_NEXUS_OPTIONS } from '../io/nexus';
import type { DropdownItem } from './Dropdown';
import type { RecentEntry } from '../io/recent';

/** The synthetic event a real `<button onClick>` handler receives. */
const clickEvent = {
  type: 'click',
  target: {},
  currentTarget: {},
  bubbles: true,
  nativeEvent: {},
  preventDefault: () => undefined,
  stopPropagation: () => undefined,
};

function invokeAsClick(items: DropdownItem[]): void {
  for (const it of items) {
    if (!it.onClick) continue;
    // Called with the event, exactly as a DOM handler would be.
    (it.onClick as (e?: unknown) => void)(clickEvent);
  }
}

const recent: RecentEntry = { name: 'cetacea.cladeforge.json', kind: 'project' };

describe('buildFileMenuItems', () => {
  it('no menu handler forwards its arguments to a file action', () => {
    const items = buildFileMenuItems(recent, () => undefined);
    calls.length = 0;
    invokeAsClick(items);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // 导入表格 intentionally passes its documented target ('matrix'), never
      // the event — the invariant under test is "no handler forwards the click
      // event / an options bag", so the one string literal is allowed.
      if (call.name === 'actionImportTable') {
        expect(call.args, 'actionImportTable passes the documented mode').toEqual(['matrix']);
        continue;
      }
      expect(call.args, `${call.name} received ${call.args.length} argument(s)`).toEqual([]);
    }
  });

  it('the NEXUS entry exports with the documented defaults, not with the event', () => {
    const items = buildFileMenuItems(recent, () => undefined);
    const nexus = itemByLabel(items, S.exportItems.nexus);
    expect(nexus, 'the NEXUS item exists').toBeDefined();
    calls.length = 0;
    (nexus!.onClick as (e?: unknown) => void)(clickEvent);
    expect(calls).toEqual([{ name: 'actionExportNexus', args: [] }]);
    // And those defaults are the ones the dialog starts from, so both entry
    // points describe the same document.
    expect(DEFAULT_NEXUS_OPTIONS).toEqual({
      includeCharacters: false,
      includeHypothesis: false,
      includeMrBayes: false,
      includeBeast: false,
    });
  });

  it('keeps the full item list (labels, order, separators)', () => {
    const labels = buildFileMenuItems(recent, () => undefined).map((it) =>
      it.sep ? '|' : (it.heading ?? it.label),
    );
    // 3d03bdc grew the menu; the review round added group headings so the
    // fifteen export entries are scannable. Order here mirrors fileMenu.ts.
    expect(labels).toEqual([
      S.menu.new,
      S.menu.open,
      S.review.saveMenu,
      S.review.saveAsMenu,
      S.review.revertMenu,
      '|',
      S.review.recentProjects,
      '|',
      S.review.importGroup,
      S.menu.importTree,
      S.review.importTable,
      S.review.pasteTree,
      '|',
      S.review.exportFigures,
      S.exportItems.options,
      S.exportItems.svg,
      S.exportItems.png,
      S.exportItems.pdf,
      '|',
      S.review.exportData,
      S.exportItems.newick,
      S.exportItems.nexus,
      S.review.exportNexml,
      '|',
      S.review.exportTables,
      S.review.exportMatrixCsv,
      S.review.exportAnnotationsCsv,
      S.review.exportMatrixTemplate,
      '|',
      S.review.exportReports,
      S.exportItems.narrative,
      S.exportItems.hypothesisJSON,
      S.exportItems.rScript,
    ]);
  });

  it('the recents dropdown still routes each entry to its own record', () => {
    const opened: RecentEntry[] = [];
    const items = buildRecentItems([recent, { name: 'other.nwk', kind: 'tree' }], (e) => opened.push(e), () => undefined);
    invokeAsClick(items);
    expect(opened.map((e) => e.name)).toEqual([recent.name, 'other.nwk']);
    // The empty placeholder is now DISABLED (fileMenu.ts) so it cannot be
    // clicked into nothing.
    expect(buildRecentItems([], () => undefined, () => undefined)).toEqual([
      { label: S.menu.recentEmpty, disabled: true },
    ]);
  });
});
