// High-level document actions wiring the store, parsers and file service
// together. These are called from menus / keyboard shortcuts. User feedback is
// delivered through non-blocking toasts (see ui/toast) and all copy comes from
// the string catalogue (see ui/strings).

import { useStore } from '../model/store';
import { parseNewickTrees, serializeNewick, type NewickParseResult } from './newick';
import {
  DEFAULT_NEXUS_OPTIONS,
  applyMatrixToProject,
  parseNexusFile,
  parseNexusTrees,
  serializeNexus,
  tipNameNotices,
  type NexusMatrixResult,
  type NexusParseResult,
  type NexusExportOptions,
} from './nexus';
import { readProjectFile, serializeProject } from './projectIO';
import { APP_VERSION } from '../model/types';
import { exportSVGString, toPdfBlob, toPngBlob, type ExportOptions } from './exportImage';
import { buildHypothesisJSON, buildNarrative } from './hypothesisExport';
import { buildRScript } from './scriptExport';
import { buildReconciliationReport } from './reconExport';
import { openText, saveBinary, saveText, saveTextWithResult, isTauri, decodeBytesWithFallback, type DialogFilter, type OpenedText } from './fileService';
import { readBinaryFileNative, readTextFileNative, statFileMtimeNative } from './native';
import { requestConfirm } from '../ui/confirmDialog';
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
import { notify, useToasts } from '../ui/toast';
import { useImportReport } from '../ui/importReport';
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

/**
 * Surface "data we could not represent" notes from a parser.
 *
 * The full list is ALSO recorded in the import-report store, and a truncation
 * toast carries a "view all" action: toasts alone evaporate in seconds and
 * truncate at three, while these are exactly the notes that change how a
 * dataset may be interpreted (A-03 / M4 / C#15). The shown toasts linger 12 s
 * so a reader has a fighting chance of finishing a long note.
 */
function reportParseIssues(issues: string[], sourceName = ''): void {
  const MAX_TOASTS = 3;
  if (issues.length === 0) return;
  useImportReport.getState().record(sourceName, issues);
  for (const msg of issues.slice(0, MAX_TOASTS)) {
    useToasts.getState().push('info', msg, undefined, 12_000);
  }
  if (issues.length > MAX_TOASTS) {
    notify.action(
      tr(
        `另有 ${issues.length - MAX_TOASTS} 条导入提示未显示`,
        `${issues.length - MAX_TOASTS} further import note${issues.length - MAX_TOASTS === 1 ? '' : 's'} were not shown`,
      ),
      S.review.importReportViewAll,
      () => useImportReport.getState().setOpen(true),
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
    reportParseIssues(issues, name);
    return;
  }
  // No chooser registered: keep only the first tree, but say so out loud.
  const shown = projects.length > 1 ? projects.slice(0, 1) : projects;
  if (projects.length > 1) notify.info(importedFirstOf(projects.length));
  openProjects(shown, name, path);
  reportParseIssues(issues, name);
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

/**
 * The ONE success toast for every export: file name + size, so "did it export?
 * how big?" never depends on which format was chosen (A-08 / C#9 / M20 — PDF,
 * Newick, hypothesis JSON, narrative and the recon report used to get a bare
 * "已导出").
 */
function notifyExported(name: string, content: string | Blob): void {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content).length : content.size;
  notify.success(
    tr(
      `已导出 ${name}（${(bytes / 1024).toFixed(0)} KB）`,
      `Exported ${name} (${(bytes / 1024).toFixed(0)} KB)`,
    ),
  );
}

/**
 * Disk-side mtime of each opened source file, recorded at open and refreshed
 * at every save. Before an in-place ⌘S the current mtime is compared against
 * the record: a mismatch means SOMETHING ELSE wrote the file since we opened
 * it, and the overwrite becomes a question instead of a silent clobber (M12).
 */
const sourceMtimes = new Map<string, number>();

async function recordSourceMtime(path: string | undefined): Promise<void> {
  if (!path || !isTauri()) return;
  const mtime = await statFileMtimeNative(path);
  if (mtime !== null) sourceMtimes.set(path, mtime);
}

function reportError(prefix: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  notify.error(withReason(prefix, message));
}

/**
 * Surface the non-fatal notes an open produced (an encoding fallback above
 * all): the user must learn their file was transcoded, not find out from
 * mojibake labels downstream.
 */
function surfaceOpenNotes(result: { notes?: string[] }): void {
  for (const note of result.notes ?? []) notify.info(note);
}

/**
 * Native text read with the GB18030 fallback for non-UTF-8 files (shared by
 * ⌘O, recents and the shell-open path — one definition of the behaviour).
 */
async function readNativeTextWithFallback(
  path: string,
  maxBytes: number,
  name: string,
): Promise<OpenedText> {
  try {
    return { name, text: await readTextFileNative(path, maxBytes), path };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/utf-?8/i.test(message)) throw e;
    const bytes = await readBinaryFileNative(path, maxBytes);
    return { ...decodeBytesWithFallback(bytes, name), path };
  }
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
    background: settings.transparentBackground ? undefined : settings.whiteBackground ? '#ffffff' : undefined,
    transparentBackground: settings.transparentBackground,
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
    surfaceOpenNotes(result);
    openProjectFromText(result.text, result.name, result.path);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

/** Shared body of ⌘O and the OS file association: parse, open, report. */
function openProjectFromText(text: string, name: string, path?: string): void {
  void recordSourceMtime(path);
  try {
    const existing = path ? tabHoldingPath(path) : null;
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
    const { project, issues } = readProjectFile(text);
    project.name = baseName(name);
    project.sourcePath = path;
    useStore.getState().openInNewTab(project);
    pushRecent({ name, path, kind: 'project' });
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(S.notify.projectOpened);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

/**
 * Open a file the OPERATING SYSTEM handed us: a double-clicked `.cladeforge.json`
 * project, a tree file from the file association, or a path forwarded by the
 * single-instance plugin when a second launch was folded into this one.
 *
 * The project-vs-tree decision sniffs content first (a JSON document is a
 * project; anything else goes through the same Newick/NEXUS pipeline as the
 * canvas dropzone) so a tree file saved with the wrong extension still opens.
 * Reading goes through the same native scoped-IO command as every other open,
 * so the path allow-list applies here too.
 */
export async function openPathFromShell(path: string): Promise<void> {
  try {
    const name = path.split(/[\\/]/).pop() ?? 'file';
    const text = await readTextFileNative(path, MAX_PROJECT_CHARS);
    const trimmed = text.trimStart();
    const looksLikeProject = trimmed.startsWith('{') || /\.json$/i.test(name);
    if (looksLikeProject) {
      openProjectFromText(text, name, path);
    } else {
      importTreeText(text, name, path);
    }
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
      // M12: an external edit since the file was opened must not be silently
      // overwritten — the write becomes a question. Files opened before this
      // feature (no recorded mtime) save straight through, so there are no
      // false positives.
      const known = sourceMtimes.get(target);
      if (known !== undefined) {
        const current = await statFileMtimeNative(target);
        if (current !== null && current !== known) {
          const proceed = await new Promise<boolean>((resolve) => {
            requestConfirm({
              key: 'save-overwrite-external-change',
              title: tr('文件已在磁盘上被修改', 'The file changed on disk'),
              message: tr(
                `「${target}」在本应用之外被修改过（例如同事或脚本改写了它）。仍然保存会覆盖那份修改（可先用「文件 › 打开工程」查看）。`,
                `"${target}" was modified outside this app (e.g. by a colleague or a script). Saving now overwrites that version (use File › Open project to inspect it first).`,
              ),
              confirmLabel: tr('仍然保存', 'Save anyway'),
              danger: true,
              onConfirm: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (!proceed) return;
        }
      }
      // In-place write via the native writer; the store pins the revision so
      // the dirty flag clears exactly here.
      const { writeTextFileNative } = await import('./native');
      await writeTextFileNative(target, serializeProject(project));
      await recordSourceMtime(target);
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
      await recordSourceMtime(saved.path);
      // C#19: in a browser "saved" means downloaded — say so instead of
      // implying a path-bound file the app can reopen.
      notify.success(
        isTauri()
          ? S.notify.projectSaved
          : tr(
              `已下载 ${outName(project.name, 'cladeforge.json')}（浏览器下载目录）`,
              `Downloaded ${outName(project.name, 'cladeforge.json')} (browser download folder)`,
            ),
      );
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
    if (looksLikeNexus(name, text)) {
      // A NEXUS file may carry trees, a character matrix, or both. Going
      // through `parseNexusFile` lets a matrix-ONLY .nex (the standard
      // MrBayes / PAUP morphology input) land as characters on the active
      // document instead of dying with "No TREES block" while the project sat
      // untouched.
      const parsed = parseNexusFile(text, baseName(name));
      if (parsed.projects.length > 0) {
        openTreeProjects(parsed.projects, name, path, parsed.issues);
        return;
      }
      if (parsed.matrix && parsed.matrix.characters.length > 0) {
        importMatrixOnly(parsed.matrix, name, parsed.issues);
        return;
      }
      throw new Error(
        parsed.issues[0] ||
          tr('NEXUS 文件中没有可解析的树或性状矩阵', 'No parsable trees or character matrix in the NEXUS file'),
      );
    }
    const { projects, issues } = parseNewickTrees(text, baseName(name));
    openTreeProjects(projects, name, path, issues);
  } catch (e) {
    reportError(S.notify.importFail, e);
  }
}

/** Apply a matrix-only NEXUS import onto the ACTIVE document as characters. */
function importMatrixOnly(matrix: NexusMatrixResult, name: string, issues: string[]): void {
  const st = useStore.getState();
  let matched = 0;
  let unmatched = 0;
  let added = 0;
  st.apply((d) => {
    added = matrix.characters.length;
    d.characters = [...d.characters, ...matrix.characters];
    const join = applyMatrixToProject(d, matrix);
    matched = join.matched;
    unmatched = join.unmatchedLabels.length;
  });
  if (matched > 0) {
    notify.info(
      tr(
        `已从「${name}」导入 ${added} 个性状，${matched} 个末端匹配成功${unmatched > 0 ? `；${unmatched} 行未匹配到末端` : ''}${issues.length > 0 ? `；另有 ${issues.length} 条解析备注（可用提示上的「${'查看全部导入提示'}」查看）` : ''}`,
        `Imported ${added} character${added === 1 ? '' : 's'} from "${name}"; ${matched} tip${matched === 1 ? '' : 's'} matched${unmatched > 0 ? `; ${unmatched} row${unmatched === 1 ? '' : 's'} matched no tip` : ''}${issues.length > 0 ? `; ${issues.length} parse note${issues.length === 1 ? '' : 's'} recorded (see "View all import notes" on the toast)` : ''}`,
      ),
    );
    reportParseIssues(issues, name);
  } else {
    reportError(
      S.notify.importFail,
      new Error(
        tr(
          `性状矩阵已读取（${added} 个性状），但没有一行能匹配当前文档的末端标签`,
          `The matrix was read (${added} characters) but no row matched the current document's tip labels`,
        ),
      ),
    );
  }
}

export async function actionImportTree(): Promise<void> {
  try {
    const result = await openText(TREE_FILTERS);
    if (!result) return;
    surfaceOpenNotes(result);
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
    surfaceOpenNotes(result);
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
    reportParseIssues(issues, result.name);
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
    // The kind is recorded in the recents list, so the exact ceiling applies
    // here — a mistyped 200 MB tree is refused by Rust, not read into the
    // webview and rejected afterwards. Non-UTF-8 files fall back to GB18030.
    const opened = await readNativeTextWithFallback(
      entry.path,
      entry.kind === 'tree' ? MAX_TREE_CHARS : MAX_PROJECT_CHARS,
      entry.name,
    );
    surfaceOpenNotes(opened);
    const text = opened.text;
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
    if (saved) notifyExported(outName(project.name, 'nwk'), serializeNewick(project, { rootedMarker: true }));
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
      ? tr(`导出文件中 ${renamed.length} 个末端名称被改写：${shown}`,
           `Export renames ${renamed.length} tip label${renamed.length === 1 ? '' : 's'}: ${shown}`)
      : tr(`导出文件中 ${renamed.length} 个末端名称被改写（如 ${shown} 等）`,
           `Export renames ${renamed.length} tip label${renamed.length === 1 ? '' : 's'}, e.g. ${shown}`),
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
      notifyExported(outName(project.name, 'nex'), serializeNexus(project, opts));
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
  // Density is NOT content: followView reproduces what the screen SHOWS, but
  // the user's DPI setting still decides the raster density — silently falling
  // back to 96 dpi ignored a journal-mandated 300 dpi (M8).
  const dpi = useStore.getState().exportSettings.dpi;
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
    if (saved) notifyExported(outName(project.name, 'pdf'), blob);
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
    if (saved) notifyExported(outName(project.name, 'md'), buildNarrative(project));
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
    if (saved) notifyExported(outName(project.name, 'hypothesis.json'), buildHypothesisJSON(project));
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
    if (saved) notifyExported(outName(project.name, 'recon.md'), buildReconciliationReport(project));
  } catch (e) {
    reportError(tr('导出协同报告失败', 'Failed to export the reconciliation report'), e);
  }
}

/**
 * Standalone R script reproducing figure + inference outputs (MEE GUI rule).
 * Building the script runs inference synchronously (parsimony/ASR snapshots),
 * so it is wrapped in the busy veil; the success toast says what RUNNING the
 * file needs (local R + ape) and where its outputs land — without that, a
 * 300-line .R file is a dead file for a non-programmer (M13).
 */
export async function actionExportRScript(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const script = await withBusy(S.busy.exportRScript ?? S.busy.exportPdf, () => Promise.resolve(buildRScript(project)));
    const saved = await saveText(outName(project.name, 'R'), script, [
      { name: 'R script', extensions: ['R'] },
    ]);
    if (saved) {
      notifyExported(outName(project.name, 'R'), script);
      notify.info(
        tr(
          '运行该脚本需要本机安装 R（≥ 4.0）与 ape 包：install.packages("ape")。在 R 中 source() 本文件后，图与表会写入当前工作目录（主图为 cladeforge_reconstruction.pdf）。',
          'Running the script needs a local R (≥ 4.0) with the ape package: install.packages("ape"). After source()-ing the file in R, the figure and tables are written to the working directory (main figure: cladeforge_reconstruction.pdf).',
        ),
      );
      notifyTipRenames(project);
    }
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
    surfaceOpenNotes(result);
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
          `Imported ${appliedCharacters} character${appliedCharacters === 1 ? '' : 's'}; ${report.matched} taxon label${report.matched === 1 ? '' : 's'} matched (${report.exact} exact, ${report.normalized} normalised)`,
        ),
      );
      if (report.unmatched.length > 0) {
        notify.error(
          tr(
            `${report.unmatched.length} 个表格行未匹配到树上末端（如 ${report.unmatched.slice(0, 3).join('、')}）：这些行被跳过。请核对名称拼写或下划线/空格差异`,
            `${report.unmatched.length} table row${report.unmatched.length === 1 ? '' : 's'} matched no tip (e.g. ${report.unmatched.slice(0, 3).join(', ')}); they were skipped. Check spelling or underscore/space differences`,
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
      const shapeIssues: string[] = [];
      st.apply((d) => {
        const r = importAnnotationsTable(d, result.text);
        applied = r.applied;
        report = r.report;
        shapeIssues.push(...r.issues);
      });
      notify.success(
        tr(
          `已为 ${applied} 个末端写入注释（未匹配 ${report.unmatched.length} 行）`,
          `Annotated ${applied} tip${applied === 1 ? '' : 's'} (${report.unmatched.length} unmatched row${report.unmatched.length === 1 ? '' : 's'})`,
        ),
      );
      // Structural notes (ragged rows, skipped key-empty rows) surface here so
      // a partial join is explainable, not just observable.
      for (const msg of shapeIssues) notify.info(msg);
      if (report.unmatched.length > 0) {
        notify.error(
          tr(
            `${report.unmatched.length} 行未匹配：${report.unmatched.slice(0, 5).join('、')}`,
            `${report.unmatched.length} row${report.unmatched.length === 1 ? '' : 's'} unmatched: ${report.unmatched.slice(0, 5).join(', ')}`,
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
    notify.success(tr(`已导入 ${applied} 个校准点`, `Imported ${applied} calibration point${applied === 1 ? '' : 's'}`));
    for (const msg of issues) notify.info(msg);
    if (report.unmatched.length > 0) {
      notify.error(
        tr(
          `${report.unmatched.length} 行未匹配到节点：${report.unmatched.slice(0, 5).join('、')}`,
          `${report.unmatched.length} row${report.unmatched.length === 1 ? '' : 's'} matched no node: ${report.unmatched.slice(0, 5).join(', ')}`,
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
    const nexmlNotes: string[] = [];
    const xml = serializeNexml(project, nexmlNotes);
    const saved = await saveText(outName(project.name, 'xml'), xml, [
      { name: 'NeXML', extensions: ['xml', 'nexml'] },
    ]);
    if (saved) {
      notifyExported(outName(project.name, 'xml'), xml);
      // Polymorphic cells that could not be represented are announced (C#10):
      // a silent drop read as "the export contains everything".
      for (const msg of nexmlNotes) notify.info(msg);
    }
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
