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
import { exportSVGString, toPdfBlob, toPngBlob, type ExportOptions } from './exportImage';
import { buildHypothesisJSON, buildNarrative } from './hypothesisExport';
import { buildRScript } from './scriptExport';
import { buildReconciliationReport } from './reconExport';
import { openText, saveBinary, saveText, isTauri, type DialogFilter } from './fileService';
import { readTextFileNative } from './native';
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

function outName(name: string, ext: string): string {
  return `${baseName(name)}.${ext}`;
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

/** Semantic-layer overlay options for figure export, taken from the live UI. */
function exportOptions(): ExportOptions {
  const s = useStore.getState();
  return {
    activeCharacterId: s.activeCharacterId,
    showTransitions: s.showTransitions,
    showEvents: s.showEvents,
    showEras: s.showEras,
    eraLevel: s.eraLevel,
    asr: s.asr,
  };
}

export function actionNewProject(): void {
  useStore.getState().newTab();
}

export async function actionOpenProject(): Promise<void> {
  try {
    const result = await openText(PROJECT_FILTERS);
    if (!result) return;
    const { project, issues } = readProjectFile(result.text);
    project.name = baseName(result.name);
    useStore.getState().openInNewTab(project);
    pushRecent({ name: result.name, path: result.path, kind: 'project' });
    if (issues.length > 0) notify.info(repairedCount(issues.length));
    else notify.success(S.notify.projectOpened);
  } catch (e) {
    reportError(S.notify.openProjectFail, e);
  }
}

export async function actionSaveProject(): Promise<void> {
  const project = useStore.getState().project;
  try {
    const saved = await saveText(
      outName(project.name, 'cladeforge.json'),
      serializeProject(project),
      PROJECT_FILTERS,
    );
    if (saved) notify.success(S.notify.projectSaved);
  } catch (e) {
    reportError(S.notify.saveProjectFail, e);
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
    const saved = await saveText(outName(project.name, 'svg'), exportSVGString(project, exportOptions()), [
      { name: 'SVG', extensions: ['svg'] },
    ]);
    if (saved) notify.success(S.notify.exported);
  } catch (e) {
    reportError(S.notify.exportSvgFail, e);
  }
}

export async function actionExportPNG(): Promise<void> {
  const project = useStore.getState().project;
  try {
    // Rasterising a large tree at 2× can take a second or more; show a busy
    // veil so the user doesn't think the app froze or re-clicks.
    const blob = await withBusy(S.busy.exportPng, () => toPngBlob(project, 2, exportOptions()));
    const saved = await saveBinary(outName(project.name, 'png'), blob, [
      { name: 'PNG', extensions: ['png'] },
    ]);
    if (saved) notify.success(S.notify.exported);
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
