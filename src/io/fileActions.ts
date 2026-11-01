// High-level document actions wiring the store, parsers and file service
// together. These are called from menus / keyboard shortcuts. User feedback is
// delivered through non-blocking toasts (see ui/toast) and all copy comes from
// the string catalogue (see ui/strings).

import { useStore } from '../model/store';
import { parseNewickTrees, serializeNewick, type NewickParseResult } from './newick';
import {
  DEFAULT_NEXUS_OPTIONS,
  parseNexusTrees,
  serializeNexus,
  tipNameNotices,
  type NexusParseResult,
  type NexusExportOptions,
} from './nexus';
import { readProjectFile, serializeProject } from './projectIO';
import { APP_VERSION } from '../model/types';
import { exportSVGString, toPdfBlob, toPngBlob, type ExportOptions } from './exportImage';
import { buildHypothesisJSON, buildNarrative } from './hypothesisExport';
import { buildRScript } from './scriptExport';
import { buildReconciliationReport } from './reconExport';
import { openText, saveBinary, saveText, saveTextWithResult, isTauri, type DialogFilter } from './fileService';
import { readTextFileNative } from './native';
import { serializeNexml } from './nexml';
import {
  applyMatrixImport,
  exportAnnotationsCsv,
  exportMatrixCsv,
  exportMatrixTemplate,
  importAnnotationsTable,
  importCalibrationTable,
  importMatrixTable,
  parseTable,
  type MatrixImportResult,
} from './tableIO';
import { readClipboardText, clipboardUnavailableMessage } from './clipboardIO';
import { pushRecent, type RecentEntry } from './recent';
import { notify } from '../ui/toast';
import { withBusy } from '../ui/busy';
import { S, importedFirstOf, repairedCount, tr, withReason } from '../ui/strings';
import type { Project } from '../model/types';
import { addGeneTree } from '../model/geneTrees';
import { MAX_PROJECT_CHARS, MAX_TREE_CHARS } from './limits';

// --- multi-tree import chooser ---------------------------------------------
// App registers a handler that opens the ImportTreesDialog; fileActions calls
// it when a file contains more than one tree. Without a handler (tests, early
// boot) the fallback is to import the first tree, and the `importedFirstOf`
// notice then tells the user exactly that.
type MultiTreeHandler = (projects: Project[], sourceName: string, path?: string) => void;
let multiTreeHandler: MultiTreeHandler | null = null;

export function registerMultiTreeHandler(fn: MultiTreeHandler | null): void {
  multiTreeHandler = fn;
}

/** Export-settings dialog opener, registered by App (mirrors the tree chooser). */
let exportSettingsHandler: (() => void) | null = null;
export function registerExportSettingsHandler(fn: (() => void) | null): void {
  exportSettingsHandler = fn;
}

/** Open the export-settings dialog (preset mode), or fall back to a direct export. */
export function actionOpenExportSettings(): void {
  if (exportSettingsHandler) {
    exportSettingsHandler();
    return;
  }
  void actionExportSVG();
}

/** Export through the current settings in the given format. */
export function actionExportWithSettings(format: 'svg' | 'png' | 'pdf'): void {
  if (format === 'svg') void actionExportSVG();
  else if (format === 'png') void actionExportPNG();
  else void actionExportPDF();
}

/** Surface "data we could not represent" notes from a parser. */
function reportParseIssues(issues: string[]): void {
  const MAX_TOASTS = 3;
  for (const msg of issues.slice(0, MAX_TOASTS)) notify.info(msg);
  if (issues.length > MAX_TOASTS) {
    notify.info(
      tr(
        `另有 ${issues.length - MAX_TOASTS} 条导入提示未显示（详见导出/工程文件）`,
        `${issues.length - MAX_TOASTS} further import note(s) were not shown`,
      ),
    );
  }
}

function openProjects(projects: Project[], name: string, path?: string): void {
  const st = useStore.getState();
  projects.forEach((p) => st.openInNewTab(p));
  pushRecent({ name, path, kind: 'tree' });
  notify.success(S.notify.treeImported);
}

function openTreeProjects(
  projects: Project[],
  name: string,
  path?: string,
  issues: string[] = [],
): void {
  if (projects.length > 1 && multiTreeHandler) {
    multiTreeHandler(projects, name, path);
    pushRecent({ name, path, kind: 'tree' });
    reportParseIssues(issues);
    return;
  }
  // No chooser registered: keep only the first tree, but say so out loud.
  const shown = projects.length > 1 ? projects.slice(0, 1) : projects;
  if (projects.length > 1) notify.info(importedFirstOf(projects.length));
  openProjects(shown, name, path);
  reportParseIssues(issues);
}

const PROJECT_FILTERS: DialogFilter[] = [{ name: 'CladeForge Project', extensions: ['json'] }];
const TREE_FILTERS: DialogFilter[] = [
  { name: 'Tree files', extensions: ['nwk', 'newick', 'tree', 'tre', 'nex', 'nexus'] },
];

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'tree';
}

/**
 * Strip characters the native filesystems refuse (`/ \\ : * ? " < > |`) from a
 * derived output name. Hypothesis / project names carry colons and slashes
 * constantly ("H1: Holocene vs Outgroup") and a bare `name + ext` turns those
 * into a failed save reported only as a native-layer error.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'untitled';
}

function outName(name: string, ext: string): string {
  return `${sanitizeFileName(baseName(name))}.${ext}`;
}

function reportError(prefix: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  notify.error(withReason(prefix, message));
}

/**
 * Decide Newick vs NEXUS by content, not by a 200-character guess. The old test
 * (`/#nexus/` in the first 200 chars, or a `.nex` extension) mis-routed files
 * saved as `tree.nex.txt` and NEXUS files whose first block is `BEGIN DATA`;
 * going the other way was worse — a Newick parser happily turns a NEXUS header
 * into a one-node junk tree.
 */
export function looksLikeNexus(name: string, text: string): boolean {
  if (/\.nex(us)?$/i.test(name)) return true;
  const head = text.slice(0, 64 * 1024);
  return /#nexus/i.test(head) || /\bbegin\s+(trees|data|characters|taxa|assumptions|sets|statistics)\b/i.test(head);
}

/** Parse a tree document with the right parser, returning every tree in it. */
function parseTreeDocument(text: string, name: string): NexusParseResult | NewickParseResult {
  return looksLikeNexus(name, text)
    ? parseNexusTrees(text, baseName(name))
    : parseNewickTrees(text, baseName(name));
}

/**
 * Semantic-layer overlay options for figure export.
 *
 * TWO modes. `followView` (the default) reproduces the historical behaviour —
 * export exactly what the screen shows. Otherwise the DECOUPLED export settings
 * decide the content, so "re-export the same figure twice" actually works: the
 * event toggle, the era bands and the support text come from the preset, not
 * from whatever happened to be on screen when the button was clicked.
 */
function exportOptions(): ExportOptions {
  const s = useStore.getState();
  const settings = s.exportSettings;
  const base: ExportOptions = {
    activeCharacterId: s.activeCharacterId,
    showTransitions: s.showTransitions,
    characterColorTarget: s.characterColorTarget,
    showEvents: s.showEvents,
    showEras: s.showEras,
    eraLevel: s.eraLevel,
    asr: s.asr,
  };
  if (settings.followView) return base;
  return {
    ...base,
    showEvents: settings.showEvents,
    showEras: settings.showEras,
    eraLevel: settings.eraLevel,
    showSupportValues: settings.showSupportValues,
    includeLegend: settings.includeLegend,
    includeScaleBar: settings.includeScaleBar,
    grayscale: settings.grayscale,
    background: settings.whiteBackground ? '#ffffff' : undefined,
    metadata: {
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      method: tr(
        '内容按导出预设（非屏幕快照）',
        'content follows the export preset, not the live view',
      ),
    },
  };
}

/** PNG pixel scale from the DPI setting: CSS px are treated as 96 dpi. */
function pngScaleFromDpi(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) return 2;
  return Math.min(8, Math.max(1, dpi / 96));
}

export function actionNewProject(): void {
  useStore.getState().newTab();
}

/**
 * Find an already-open tab holding the same file (by sourcePath). Opening the
 * same file twice used to create two oblivious copies that overwrote each
 * other's autosave — now the existing tab is focused instead.
 */
function tabHoldingPath(path: string): string | null {
  const st = useStore.getState();
  if (st.project.sourcePath === path) return st.activeTabId;
  for (const [tabId, snap] of Object.entries(st.tabStore)) {
    if (snap.project.sourcePath === path) return tabId;
  }
  return null;
}

function focusTab(tabId: string): void {
  const st = useStore.getState();
  if (tabId !== st.activeTabId) st.switchTab(tabId);
}

export async function actionOpenProject(): Promise<void> {
  try {
    const result = await openText(PROJECT_FILTERS);
    if (!result) return;
    const existing = result.path ? tabHoldingPath(result.path) : null;
    if (existing) {
      focusTab(existing);
      notify.info(
        tr(
          `该文件已在标签页中打开，已切换到那一页（未创建重复副本）`,
          `That file is already open in a tab — focused it instead of creating a duplicate`,
        ),
      );
      return;
    }
    const { project, issues } = readProjectFile(result.text);
    project.name = baseName(result.name);
    project.sourcePath = result.path;
    useStore.getState().openInNewTab(project);
    pushRecent({ name: result.name, path: result.path, kind: 'project' });
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(S.notify.projectOpened);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

/**
 * Save. ⌘S saves IN PLACE when the document remembers its path (sourcePath);
 * only a never-saved document opens the native dialog. This is the Document ↔
 * File binding every desktop editor owes its user: twenty ⌘S presses in a
 * twenty-minute session must not be twenty dialog boxes.
 */
export async function actionSaveProject(): Promise<void> {
  const st = useStore.getState();
  const project = st.project;
  try {
    const target = project.sourcePath;
    if (target && isTauri()) {
      // In-place write via the native writer; the store pins the revision so
      // the dirty flag clears exactly here.
      const { writeTextFileNative } = await import('./native');
      await writeTextFileNative(target, serializeProject(project));
      st.apply((d) => {
        d.savedAt = new Date().toISOString();
        d.modifiedAt = new Date().toISOString();
      });
      useStore.getState().markSaved();
      notify.success(
        tr(
          `已保存到 ${target}`,
          `Saved to ${target}`,
        ),
      );
      return;
    }
    const saved = await saveTextWithResult(
      outName(project.name, 'cladeforge.json'),
      serializeProject(project),
      PROJECT_FILTERS,
    );
    if (saved.ok) {
      st.apply((d) => {
        if (saved.path) d.sourcePath = saved.path;
        d.savedAt = new Date().toISOString();
        d.modifiedAt = new Date().toISOString();
      });
      useStore.getState().markSaved();
      notify.success(S.notify.projectSaved);
    }
  } catch (e) {
    reportError(S.notify.saveProjectFail, e);
  }
}

/** ⌘⇧S — always ask where to put the file (and adopt that path). */
export async function actionSaveProjectAs(): Promise<void> {
  const st = useStore.getState();
  const project = st.project;
  try {
    const saved = await saveTextWithResult(
      outName(project.name, 'cladeforge.json'),
      serializeProject(project),
      PROJECT_FILTERS,
    );
    if (saved.ok) {
      st.apply((d) => {
        if (saved.path) d.sourcePath = saved.path;
        d.savedAt = new Date().toISOString();
        d.modifiedAt = new Date().toISOString();
      });
      useStore.getState().markSaved();
      notify.success(
        saved.path
          ? tr(`已另存为 ${saved.path}`, `Saved as ${saved.path}`)
          : S.notify.projectSaved,
      );
    }
  } catch (e) {
    reportError(S.notify.saveProjectFail, e);
  }
}

/**
 * Revert to the on-disk copy of the current document ("I broke it, take me
 * back"): reloads sourcePath into the CURRENT tab. Refuses (with a message)
 * when the document has no remembered path — the browser build cannot re-read
 * a file it never stored.
 */
export async function actionRevertProject(): Promise<void> {
  const st = useStore.getState();
  const project = st.project;
  if (!project.sourcePath || !isTauri()) {
    notify.info(
      tr(
        '当前文档没有已知的磁盘路径（可能来自浏览器会话或新建），无法回退；请用 文件 › 打开 重新选择',
        'This document has no known disk path (browser session or new document); revert is unavailable — use File › Open instead',
      ),
    );
    return;
  }
  try {
    const text = await readTextFileNative(project.sourcePath, MAX_PROJECT_CHARS);
    const { project: fresh, issues } = readProjectFile(text);
    fresh.sourcePath = project.sourcePath;
    st.loadProject(fresh);
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(tr('已回退到磁盘上的版本', 'Reverted to the on-disk version'));
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

/** Parse a tree file's text and open it in a new tab. Shared by the file
 * picker (actionImportTree), the canvas dropzone and the recent-files list so
 * all three behave identically — including the NEXUS branch, which goes through
 * the tree chooser instead of quietly keeping only the first tree.
 * Parsing errors are caught here so BOTH entry points (picker and dropzone)
 * surface a toast instead of an unhandled rejection. */
export function importTreeText(text: string, name: string, path?: string): void {
  try {
    const { projects, issues } = parseTreeDocument(text, name);
    openTreeProjects(projects, name, path, issues);
  } catch (e) {
    reportError(S.notify.importFail, e);
  }
}

export async function actionImportTree(): Promise<void> {
  try {
    const result = await openText(TREE_FILTERS);
    if (!result) return;
    importTreeText(result.text, result.name, result.path);
  } catch (e) {
    reportError(S.notify.importFail, e);
  }
}

/**
 * Import one-or-more trees from a file as EMBEDDED gene trees of the active
 * document (DTL reconciliation). Multi-tree files import every tree instead of
 * opening the chooser — gene families routinely ship as batches — and that
 * includes multi-tree NEXUS files: taking only the first tree of a posterior
 * sample could mean taking a burn-in one.
 */
export async function actionImportGeneTree(): Promise<void> {
  try {
    const result = await openText(TREE_FILTERS);
    if (!result) return;
    const { projects: docs, issues } = parseTreeDocument(result.text, result.name);
    const st = useStore.getState();
    let firstId: string | null = null;
    st.apply((d) => {
      for (const doc of docs) {
        const name = docs.length > 1 ? `${baseName(result.name)} ${docs.indexOf(doc) + 1}` : baseName(result.name);
        const id = addGeneTree(d, doc, name);
        if (!firstId) firstId = id;
      }
    });
    if (firstId) st.setActiveGeneTree(firstId);
    notify.success(
      docs.length === 1 ? tr('已导入 1 个基因树', 'Imported 1 gene tree') : tr(`已导入 ${docs.length} 个基因树`, `Imported ${docs.length} gene trees`),
    );
    reportParseIssues(issues);
  } catch (e) {
    reportError(S.notify.importFail, e);
  }
}

export async function actionOpenRecent(entry: RecentEntry): Promise<void> {
  // Without a stored path (browser) fall back to the normal picker.
  if (!entry.path || !isTauri()) {
    if (entry.kind === 'tree') return actionImportTree();
    return actionOpenProject();
  }
  try {
    const text = await readTextFileNative(
      entry.path,
      // The kind is recorded in the recents list, so the exact ceiling applies
      // here — a mistyped 200 MB tree is refused by Rust, not read into the
      // webview and rejected afterwards.
      entry.kind === 'tree' ? MAX_TREE_CHARS : MAX_PROJECT_CHARS,
    );
    if (entry.kind === 'tree') {
      // Same code path as the picker / dropzone, so recents get the same format
      // sniffing, tree chooser and lossy-import notes.
      importTreeText(text, entry.name, entry.path);
      return;
    }
    const { project, issues } = readProjectFile(text);
    project.name = baseName(entry.name);
    useStore.getState().openInNewTab(project);
    pushRecent(entry);
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(S.notify.projectOpened);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

export async function actionExportNewick(): Promise<void> {
  const project = useStore.getState().project;
  try {
    // `rootedMarker` keeps the rootedness round-trip lossless: a document parsed
    // from an `[&U]` / trifurcate Newick (or re-declared by the user) re-exports as
    // unrooted instead of being silently re-interpreted as rooted downstream.
    const saved = await saveText(
      outName(project.name, 'nwk'),
      serializeNewick(project, { rootedMarker: true }),
      [{ name: 'Newick', extensions: ['nwk', 'newick', 'tree'] }],
    );
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(S.notify.exportNewickFail, e);
  }
}

/**
 * NEXUS export. A caller wired as `onClick: file.actionExportNexus` would hand the
 * React click event to `options`, making every include-flag read as `undefined` —
 * the same menu item would then silently produce a different file from the dialog.
 * A non-options argument is therefore ignored (falling back to
 * DEFAULT_NEXUS_OPTIONS), and the minimal fallback says what it contained instead
 * of pretending to be the full export.
 */
/**
 * NEXUS TAXLABELS and the R script's tip vectors must be unique, so blank,
 * padded or repeated labels are rewritten on export. The rewrite is announced:
 * say which names the file carries rather than changing them in silence.
 */
function notifyTipRenames(project: Project): void {
  const renamed = tipNameNotices(project);
  if (renamed.length === 0) return;
  const shown = renamed.slice(0, 3).join(', ');
  notify.info(
    renamed.length <= 3
      ? tr(`导出文件中 ${renamed.length} 个尖端名称被改写：${shown}`,
           `Export renames ${renamed.length} tip label(s): ${shown}`)
      : tr(`导出文件中 ${renamed.length} 个尖端名称被改写（如 ${shown} 等）`,
           `Export renames ${renamed.length} tip label(s), e.g. ${shown}`),
  );
}

export async function actionExportNexus(options?: NexusExportOptions): Promise<void> {
  const project = useStore.getState().project;
  const explicit = isNexusOptions(options);
  const opts = explicit ? (options as NexusExportOptions) : DEFAULT_NEXUS_OPTIONS;
  try {
    const saved = await saveText(outName(project.name, 'nex'), serializeNexus(project, opts), [
      { name: 'Nexus', extensions: ['nex', 'nexus'] },
    ]);
    if (!saved) return;
    notifyTipRenames(project);
    if (explicit) {
      notify.success(S.notify.exported);
      return;
    }
    const included = [
      opts.includeCharacters && tr('性状矩阵', 'character matrices'),
      opts.includeHypothesis && tr('假设/代价矩阵', 'assumptions & cost matrices'),
      opts.includeMrBayes && 'MrBayes',
      opts.includeBeast && 'BEAST',
    ].filter(Boolean);
    notify.info(
      included.length
        ? tr(`NEXUS 已导出（含 ${included.join('、')}）`, `NEXUS exported (incl. ${included.join(', ')})`)
        : tr(
            'NEXUS 已导出：仅 TAXA + TREES。用「导出 › NEXUS…」对话框可附加性状矩阵、假设块与 MrBayes/BEAST 模板',
            'NEXUS exported: TAXA + TREES only. Use "Export › NEXUS…" to add character matrices, the assumptions block and the MrBayes/BEAST templates',
          ),
    );
  } catch (e) {
    reportError(S.notify.exportNexusFail, e);
  }
}

/**
 * True only for a real options bag — not for a React synthetic event. Exported
 * so the regression test can pin the discriminator itself, rather than relying
 * on "undefined flags happen to print like false ones".
 */
export function isNexusOptions(v: unknown): v is NexusExportOptions {
  if (!v || typeof v !== 'object') return false;
  const keys = Object.keys(v as Record<string, unknown>);
  if (keys.length === 0) return false;
  const allowed = ['includeCharacters', 'includeHypothesis', 'includeMrBayes', 'includeBeast'];
  return keys.every((k) => allowed.includes(k));
}

export async function actionExportSVG(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const svgOut = exportSVGString(project, exportOptions());
    const saved = await saveText(outName(project.name, 'svg'), svgOut, [
      { name: 'SVG', extensions: ['svg'] },
    ]);
    // PM-64: the success toast names the file and its size, so "did it export?
    // where?" has an answer without opening the file manager.
    if (saved) {
      notify.success(
        tr(
          `已导出 ${outName(project.name, 'svg')}（${(svgOut.length / 1024).toFixed(0)} KB）`,
          `Exported ${outName(project.name, 'svg')} (${(svgOut.length / 1024).toFixed(0)} KB)`,
        ),
      );
    }
  } catch (e) {
    reportError(S.notify.exportSvgFail, e);
  }
}

export async function actionExportPNG(): Promise<void> {
  const project = useStore.getState().project;
  const dpi = useStore.getState().exportSettings.followView ? 96 : useStore.getState().exportSettings.dpi;
  const scale = pngScaleFromDpi(dpi);
  try {
    // Rasterising a large tree at high scale can take a second or more; show a
    // busy veil so the user doesn't think the app froze or re-clicks.
    const blob = await withBusy(
      S.busy.exportPng,
      () =>
        toPngBlob(project, scale, exportOptions(), (requested, effective) => {
          notify.error(
            tr(
              `目标分辨率超出画布上限，已从 ${(requested * 96).toFixed(0)} dpi 降至 ${(effective * 96).toFixed(0)} dpi。建议改为导出 SVG（矢量）后放大`,
              `The requested resolution exceeds the canvas budget; reduced from ${(requested * 96).toFixed(0)} to ${(effective * 96).toFixed(0)} dpi. Export SVG (vector) instead and scale there`,
            ),
          );
        }),
    );
    const saved = await saveBinary(outName(project.name, 'png'), blob, [
      { name: 'PNG', extensions: ['png'] },
    ]);
    if (saved) {
      notify.success(
        tr(
          `已导出 ${outName(project.name, 'png')}（${(scale * 96).toFixed(0)} dpi，${(blob.size / 1024).toFixed(0)} KB）`,
          `Exported ${outName(project.name, 'png')} (${(scale * 96).toFixed(0)} dpi, ${(blob.size / 1024).toFixed(0)} KB)`,
        ),
      );
    }
  } catch (e) {
    reportError(S.notify.exportPngFail, e);
  }
}

export async function actionExportPDF(): Promise<void> {
  const project = useStore.getState().project;
  try {
    // svg2pdf on a large tree is the slowest export path; keep the user informed.
    const blob = await withBusy(S.busy.exportPdf, () => toPdfBlob(project, exportOptions()));
    const saved = await saveBinary(outName(project.name, 'pdf'), blob, [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(S.notify.exportPdfFail, e);
  }
}

export async function actionExportNarrative(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(outName(project.name, 'md'), buildNarrative(project), [
      { name: 'Markdown', extensions: ['md', 'txt'] },
    ]);
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(S.notify.exportNarrativeFail, e);
  }
}

export async function actionExportHypothesisJSON(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(
      outName(project.name, 'hypothesis.json'),
      buildHypothesisJSON(project),
      [{ name: 'Hypothesis JSON', extensions: ['json'] }],
    );
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(S.notify.exportHypothesisFail, e);
  }
}

/** Markdown reconciliation report for every embedded gene tree. */
export async function actionExportReconciliationReport(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(
      outName(project.name, 'recon.md'),
      buildReconciliationReport(project),
      [{ name: 'Markdown', extensions: ['md', 'txt'] }],
    );
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(tr('导出协同报告失败', 'Failed to export the reconciliation report'), e);
  }
}

/** Standalone R script reproducing figure + inference outputs (MEE GUI rule). */
export async function actionExportRScript(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(outName(project.name, 'R'), buildRScript(project), [
      { name: 'R script', extensions: ['R'] },
    ]);
    if (saved) notify.success(S.notify.exported);
    if (saved) notifyTipRenames(project);
  } catch (e) {
    reportError(tr('导出 R 脚本失败', 'Failed to export the R script'), e);
  }
}

// --- table (CSV/TSV) and NeXML actions ----------------------------------------
// The spreadsheet is where trait data actually lives; these actions make the
// app able to take it in one step and hand an empty template back.

export const TABLE_FILTERS: DialogFilter[] = [{ name: 'Table (CSV/TSV)', extensions: ['csv', 'tsv', 'txt'] }];

export type TableImportMode = 'matrix' | 'annotations' | 'calibrations';

/**
 * Import a CSV/TSV table into the active document. The mode chooses the join:
 *  - matrix: columns become characters, first column matches tips;
 *  - annotations: columns become structured tip metadata (host/country/…);
 *  - calibrations: node label + min/max ages become calibration points.
 * The matching report (exact / normalized / unmatched) is always surfaced — a
 * partial join must be a decision, not a surprise.
 */
export async function actionImportTable(mode: TableImportMode = 'matrix'): Promise<void> {
  try {
    const result = await openText(TABLE_FILTERS);
    if (!result) return;
    const st = useStore.getState();
    if (mode === 'matrix') {
      const parsed = importMatrixTable(result.text, st.project.name);
      let report!: import('./tableIO').LabelJoinReport;
      let appliedCharacters = 0;
      st.apply((d) => {
        const r = applyMatrixImport(d, parsed);
        report = r.report;
        appliedCharacters = r.appliedCharacters;
      });
      notify.success(
        tr(
          `已导入 ${appliedCharacters} 个性状，${report.matched} 个分类单元匹配成功（精确 ${report.exact}，归一化 ${report.normalized}）`,
          `Imported ${appliedCharacters} character(s); ${report.matched} taxon label(s) matched (${report.exact} exact, ${report.normalized} normalized)`,
        ),
      );
      if (report.unmatched.length > 0) {
        notify.error(
          tr(
            `${report.unmatched.length} 个表格行未匹配到树上末端（如 ${report.unmatched.slice(0, 3).join('、')}）：这些行被跳过。请核对名称拼写或下划线/空格差异`,
            `${report.unmatched.length} table row(s) matched no tip (e.g. ${report.unmatched.slice(0, 3).join(', ')}); they were skipped. Check spelling or underscore/space differences`,
          ),
        );
      }
      if (report.duplicates.length > 0) {
        notify.info(
          tr(
            `注意：分类单元 ${report.duplicates.slice(0, 3).join('、')} 被多行同时命中，后一行覆盖前一行`,
            `Note: taxon/taxa ${report.duplicates.slice(0, 3).join(', ')} were hit by multiple rows; the last row won`,
          ),
        );
      }
      for (const msg of parsed.issues) notify.info(msg);
      return;
    }
    if (mode === 'annotations') {
      let applied = 0;
      let report!: import('./tableIO').LabelJoinReport;
      st.apply((d) => {
        const r = importAnnotationsTable(d, result.text);
        applied = r.applied;
        report = r.report;
      });
      notify.success(
        tr(
          `已为 ${applied} 个尖端写入注释（未匹配 ${report.unmatched.length} 行）`,
          `Annotated ${applied} tip(s) (${report.unmatched.length} unmatched row(s))`,
        ),
      );
      if (report.unmatched.length > 0) {
        notify.error(
          tr(
            `${report.unmatched.length} 行未匹配：${report.unmatched.slice(0, 5).join('、')}`,
            `${report.unmatched.length} row(s) unmatched: ${report.unmatched.slice(0, 5).join(', ')}`,
          ),
        );
      }
      return;
    }
    let applied = 0;
    let report!: import('./tableIO').LabelJoinReport;
    const issues: string[] = [];
    st.apply((d) => {
      const r = importCalibrationTable(d, result.text);
      applied = r.applied;
      report = r.report;
      issues.push(...r.issues);
    });
    notify.success(tr(`已导入 ${applied} 个校准点`, `Imported ${applied} calibration point(s)`));
    for (const msg of issues) notify.info(msg);
    if (report.unmatched.length > 0) {
      notify.error(
        tr(
          `${report.unmatched.length} 行未匹配到节点：${report.unmatched.slice(0, 5).join('、')}`,
          `${report.unmatched.length} row(s) matched no node: ${report.unmatched.slice(0, 5).join(', ')}`,
        ),
      );
    }
  } catch (e) {
    reportError(tr('导入表格失败', 'Failed to import the table'), e);
  }
}

export interface TableOutcome {
  appliedCharacters: number;
  matchedTips: number;
  report: MatrixImportResult['report'];
  issues: string[];
}

export async function actionExportMatrixCsv(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(outName(project.name, 'matrix.csv'), exportMatrixCsv(project), [
      { name: 'CSV', extensions: ['csv'] },
    ]);
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(tr('导出性状表失败', 'Failed to export the matrix CSV'), e);
  }
}

export async function actionExportMatrixTemplate(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(
      outName(project.name, 'matrix-template.csv'),
      exportMatrixTemplate(project),
      [{ name: 'CSV', extensions: ['csv'] }],
    );
    if (saved) {
      notify.success(
        tr(
          '已导出空模板：在表格软件中填写状态后拖回窗口即可导入',
          'Template exported: fill the states in a spreadsheet and drop the file back into the window to import',
        ),
      );
    }
  } catch (e) {
    reportError(tr('导出模板失败', 'Failed to export the template'), e);
  }
}

export async function actionExportAnnotationsCsv(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(
      outName(project.name, 'annotations.csv'),
      exportAnnotationsCsv(project),
      [{ name: 'CSV', extensions: ['csv'] }],
    );
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(tr('导出注释表失败', 'Failed to export the annotations CSV'), e);
  }
}

export async function actionExportNexml(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(outName(project.name, 'xml'), serializeNexml(project), [
      { name: 'NeXML', extensions: ['xml', 'nexml'] },
    ]);
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(tr('导出 NeXML 失败', 'Failed to export NeXML'), e);
  }
}

// --- clipboard ------------------------------------------------------------------

/** Paste Newick/NEXUS text from the system clipboard into a new tab. */
export async function actionPasteTreeFromClipboard(): Promise<void> {
  const text = await readClipboardText();
  if (!text) {
    notify.info(clipboardUnavailableMessage());
    return;
  }
  importTreeText(text, tr('剪贴板树', 'Clipboard tree'));
}

/** Copy the current character-state matrix as CSV to the clipboard. */
export async function actionCopyMatrixToClipboard(): Promise<void> {
  const { writeClipboardText } = await import('./clipboardIO');
  const csv = exportMatrixCsv(useStore.getState().project);
  const ok = await writeClipboardText(csv);
  notify.success(
    ok
      ? tr('性状表已复制到剪贴板（CSV），可直接粘贴进 Excel', 'Matrix copied to the clipboard as CSV — paste straight into Excel')
      : tr('无法写入剪贴板', 'Could not write to the clipboard'),
  );
}

/**
 * Open a project from TEXT already in memory (drop-zone path): same pipeline
 * as the picker (read → migrate → validate → new tab) with the file name for
 * the tab title. Returns nothing; errors surface as toasts like every other
 * open path.
 */
export function actionOpenProjectText(text: string, name: string): void {
  try {
    const { project, issues } = readProjectFile(text);
    project.name = baseName(name);
    useStore.getState().openInNewTab(project);
    pushRecent({ name, kind: 'project' });
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(S.notify.projectOpened);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}
