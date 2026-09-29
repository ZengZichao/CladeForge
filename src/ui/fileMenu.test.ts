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
  actionImportTree: recorder.noop('actionImportTree'),
  actionExportSVG: recorder.noop('actionExportSVG'),
  actionExportPNG: recorder.noop('actionExportPNG'),
  actionExportPDF: recorder.noop('actionExportPDF'),
  actionExportNewick: recorder.noop('actionExportNewick'),
  actionExportNexus: recorder.noop('actionExportNexus'),
  actionExportNarrative: recorder.noop('actionExportNarrative'),
  actionExportHypothesisJSON: recorder.noop('actionExportHypothesisJSON'),
  actionExportRScript: recorder.noop('actionExportRScript'),
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
      it.sep ? '|' : it.label,
    );
    expect(labels).toEqual([
      S.menu.new,
      S.menu.open,
      S.menu.recent,
      '|',
      S.menu.importTree,
      '|',
      S.exportItems.svg,
      S.exportItems.png,
      S.exportItems.pdf,
      '|',
      S.exportItems.newick,
      S.exportItems.nexus,
      '|',
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
    expect(buildRecentItems([], () => undefined, () => undefined)).toEqual([
      { label: S.menu.recentEmpty },
    ]);
  });
});
