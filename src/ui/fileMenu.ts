// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md. 
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
import { S, tr } from './strings';
import type { RecentEntry } from '../io/recent';
import { useStore } from '../model/store';

/** Reroot at the current selection, with the same guards as every other entry
 *  point (shared by the left-panel 树操作 section). */
export function rerootAtSelection(): void {
  const st = useStore.getState();
  const id = st.selection[0];
  if (!id) {
    import('./toast').then(({ notify }) =>
      notify.info(tr('请先在画布上选中一个节点', 'Select a node on the canvas first')),
    );
    return;
  }
  if (id === st.project.rootId) {
    import('./toast').then(({ notify }) =>
      notify.info(tr('选中的就是根节点：请改用「定根」类命令改变根的位置', 'The selected node IS the root: use a reroot command to move the root instead')),
    );
    return;
  }
  file.actionRerootAtNode(id);
}

/** Ladderize the whole tree (shared by the left-panel 树操作 section). */
export function ladderizeTree(): void {
  file.actionLadderize(false);
}

/** The consolidated "文件" dropdown: lifecycle, tree import and the export
 *  entry. 用户反馈: 树操作 moved to the left panel, 导入表格 / 项目详情 are
 *  gone, and 查找与替换 / 历史记录 became toolbar buttons. */
export function buildFileMenuItems(): DropdownItem[] {
  return [
    { label: S.menu.new, onClick: () => file.actionNewProject(), kbd: '⌘T' },
    { label: S.menu.open, onClick: () => void file.actionOpenProject(), kbd: '⌘O' },
    // 保存 lives in the FILE menu — it used to exist only on the toolbar and
    // ⌘S, which is the least conventional place for the most conventional action.
    { label: S.review.saveMenu, onClick: () => void file.actionSaveProject(), kbd: '⌘S' },
    { label: S.review.saveAsMenu, onClick: () => void file.actionSaveProjectAs(), kbd: '⌘⇧S' },
    // OP-10: multi-tab users had to switch tabs and press ⌘S once each; the
    // string existed but no entry point ever used it.
    { label: S.review.saveAllTabs, onClick: () => void file.actionSaveAllProjects() },
    { label: S.review.revertMenu, onClick: () => void file.actionRevertProject() },
    { sep: true },
    // M1/m9 (UI_UX_REVIEW): the file-menu "最近项目" entry is gone — it
    // duplicated the dedicated 最近 dropdown (one data, one position) and its
    // old behaviour — silently opening the newest file, or doing nothing when
    // the list was empty — surprised rather than served. Recents stay in the
    // one place named for them.
    // 用户反馈: 树操作 (reroot / ladderize) lives in the left panel now; the
    // shared guards live in `rerootAtSelection` / `ladderizeTree` above.
    { heading: S.review.importGroup },
    { label: S.menu.importTree, onClick: () => void file.actionImportTree() },
    { label: S.review.pasteTree, onClick: () => void file.actionPasteTreeFromClipboard() },
    { sep: true },
    // M1 (UI_UX_REVIEW): the file menu carried THIRTEEN export entries that
    // duplicated the left 导出 module and the palette. ONE "导出…" entry now
    // opens the export surface (settings dialog + grouped list); every format
    // stays reachable there, in the palette, and on the left panel.
    { heading: S.review.exportFigures },
    {
      label: tr('导出…', 'Export…'),
      onClick: () => file.actionOpenExportSettings(),
    },
    { sep: true },
    // 工具 group: 用户反馈 — 查找与替换 / 历史记录 are toolbar buttons now.
    { heading: tr('工具', 'Tools') },
    { label: tr('示例库…', 'Sample library…'), onClick: () => file.openAppDialog('sampleLibrary') },
    // OP-22: import notes had a report; everything else evaporated as a toast.
    { label: tr('操作日志…', 'Operation log…'), onClick: () => file.openAppDialog('operationLog') },
  ];
}

/** The top-bar 导出 dropdown (用户反馈: 导出 moved out of the left rail into a
 *  top-level menu next to 文件 / 最近 / 帮助). Same actions and the same
 *  gene-tree gate as the old rail panel; the NEXUS row opens the options
 *  dialog through the app-dialog route. */
export function buildExportMenuItems(): DropdownItem[] {
  const hasGeneTrees = (useStore.getState().project.geneTrees?.length ?? 0) > 0;
  return [
    { label: S.exportItems.options, onClick: () => file.actionOpenExportSettings() },
    { sep: true },
    { heading: S.exportGroup.vector },
    { label: S.exportItems.svg, onClick: () => void file.actionExportSVG() },
    { label: S.exportItems.pdf, onClick: () => void file.actionExportPDF() },
    { heading: S.exportGroup.raster },
    { label: S.exportItems.png, onClick: () => void file.actionExportPNG() },
    { label: S.exportItems.tiff, onClick: () => void file.actionExportTIFF() },
    { heading: S.exportGroup.data },
    { label: S.exportItems.newick, onClick: () => void file.actionExportNewick() },
    { label: S.exportItems.nexus, onClick: () => file.openAppDialog('nexusExport') },
    { label: S.exportItems.hypothesisJSON, onClick: () => void file.actionExportHypothesisJSON() },
    { label: S.exportItems.rScript, onClick: () => void file.actionExportRScript() },
    {
      label: S.exportItems.reconReport,
      onClick: () => void file.actionExportReconciliationReport(),
      disabled: !hasGeneTrees,
    },
    { heading: S.exportGroup.report },
    { label: S.exportItems.narrative, onClick: () => void file.actionExportNarrative() },
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
