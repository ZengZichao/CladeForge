// The menu bar's two dropdown lists, built outside the components so they are
// testable.
//
// The "文件" list is assembled here rather than inline in `MenuBar.tsx` so it is
// testable. Every entry is wrapped in an arrow that takes no parameters: writing
// `{ label: S.exportItems.nexus, onClick: file.actionExportNexus }` hands the
// React click event to `actionExportNexus(options?)` as its options bag, and
// TypeScript accepts it because the parameter is optional. Every include-flag
// then reads `undefined`, so the *menu* exports a TAXA + TREES file while the
// *dialog* exports one with the character matrix, the assumptions block and the
// MrBayes/BEAST templates — under the same filename and the same success toast.
// `fileActions.actionExportNexus` likewise refuses anything that is not a real
// options bag, which keeps the two paths in agreement.

import * as file from '../io/fileActions';
import type { DropdownItem } from './Dropdown';
import { S } from './strings';
import type { RecentEntry } from '../io/recent';

/** The consolidated "文件" dropdown: lifecycle, import, and every export target. */
export function buildFileMenuItems(
  firstRecent: RecentEntry | undefined,
  onOpenRecent: (entry: RecentEntry) => void,
): DropdownItem[] {
  return [
    { label: S.menu.new, onClick: () => file.actionNewProject() },
    { label: S.menu.open, onClick: () => void file.actionOpenProject() },
    // 保存 lives in the FILE menu — it used to exist only on the toolbar and
    // ⌘S, which is the least conventional place for the most conventional action.
    { label: S.review.saveMenu, onClick: () => void file.actionSaveProject() },
    { label: S.review.saveAsMenu, onClick: () => void file.actionSaveProjectAs() },
    { label: S.review.revertMenu, onClick: () => void file.actionRevertProject() },
    { sep: true },
    {
      // The recent entry OPENS THE LIST — the old behaviour jumped straight to
      // the most recent file with no submenu and no feedback, and with no
      // recents it silently did nothing at all.
      label: S.review.recentProjects,
      onClick: () => {
        if (firstRecent) onOpenRecent(firstRecent);
      },
    },
    { sep: true },
    { heading: S.review.importGroup },
    { label: S.menu.importTree, onClick: () => void file.actionImportTree() },
    { label: S.review.importTable, onClick: () => void file.actionImportTable('matrix') },
    { label: S.review.pasteTree, onClick: () => void file.actionPasteTreeFromClipboard() },
    { sep: true },
    { heading: S.review.exportFigures },
    { label: S.exportItems.svg, onClick: () => void file.actionExportSVG() },
    { label: S.exportItems.png, onClick: () => void file.actionExportPNG() },
    { label: S.exportItems.pdf, onClick: () => void file.actionExportPDF() },
    { sep: true },
    { heading: S.review.exportData },
    { label: S.exportItems.newick, onClick: () => void file.actionExportNewick() },
    {
      // Called with NO arguments — never `onClick: file.actionExportNexus`,
      // which would pass the click event through as the options bag.
      label: S.exportItems.nexus,
      onClick: () => void file.actionExportNexus(),
    },
    { label: S.review.exportNexml, onClick: () => void file.actionExportNexml() },
    { sep: true },
    { heading: S.review.exportTables },
    { label: S.review.exportMatrixCsv, onClick: () => void file.actionExportMatrixCsv() },
    { label: S.review.exportAnnotationsCsv, onClick: () => void file.actionExportAnnotationsCsv() },
    { label: S.review.exportMatrixTemplate, onClick: () => void file.actionExportMatrixTemplate() },
    { sep: true },
    { heading: S.review.exportReports },
    { label: S.exportItems.narrative, onClick: () => void file.actionExportNarrative() },
    { label: S.exportItems.hypothesisJSON, onClick: () => void file.actionExportHypothesisJSON() },
    { label: S.exportItems.rScript, onClick: () => void file.actionExportRScript() },
  ];
}

/** The "最近打开" dropdown (name list + clear), or its empty placeholder. */
export function buildRecentItems(
  recents: RecentEntry[],
  onOpen: (entry: RecentEntry) => void,
  onClear: () => void,
): DropdownItem[] {
  // The empty placeholder is DISABLED, not a clickable button with no handler —
  // clicking it used to do nothing at all, which reads as breakage.
  if (!recents.length) return [{ label: S.menu.recentEmpty, disabled: true }];
  return [
    ...recents.map((e, i) => ({
      label: `${i + 1}. ${e.name}`,
      onClick: () => onOpen(e),
    })),
    { sep: true },
    { label: S.menu.recentClear, onClick: () => onClear() },
  ];
}

/** Look up a menu entry by its (localised) label — used by the tests. */
export function itemByLabel(items: DropdownItem[], label: string): DropdownItem | undefined {
  return items.find((it) => it.label === label);
}
