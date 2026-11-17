// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Command palette (⌘K): fuzzy-search and run any command from one place, so the
// many scattered actions (reroot, ladderize, ASR, export, layers…) are reachable
// without hunting through panels. Arrow keys navigate, Enter runs, Esc closes.
//
// Enhanced with:
//   - Category headers (文件 / 编辑 / 视图 / 树操作 / 分析)
//   - Per-command icons
//   - Keyboard shortcut hints
//   - "No results" state
//   - English/pinyin aliases

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FileIcon,
  ReloadIcon,
  ResetIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  GearIcon,
  MagicWandIcon,
  TableIcon,
  DownloadIcon,
  UploadIcon,
  FrameIcon,
  ScissorsIcon,
  ShuffleIcon,
  LayersIcon,
  TargetIcon,
  Crosshair1Icon,
  EyeOpenIcon,
  QuestionMarkIcon,
} from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import * as file from '../io/fileActions';
import {
  addChildrenSpaced,
  applyMidpointReroot,
  toggleCollapse,
  extractSubtree,
  hasBranchLengths,
  collapseAll,
  expandAll,
  deriveBranchLengthsFromAges,
  estimateAgesWithCalibrations,
  type MidpointResult,
} from '../model/treeOps';
import { notify } from './toast';
import { isImeComposing } from './imeGuard';
import { useLanguage } from './i18n';
import { midpointText } from './treeEditNotices';
import { S, modKey, tr } from './strings';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import { openSample } from './sampleOpener';

interface Command {
  id: string;
  label: string;
  category: string;
  icon?: ReactNode;
  kbd?: string;
  aliases?: string[];
  /** Optional second-level heading rendered INSIDE a category (M6): the FILE
   *  group's 18 entries mix document lifecycle with import and export; a
   *  导入 / 导出 sub-heading keeps the seven-category order the manual
   *  documents while restoring scannability. */
  sub?: string;
  /** M18 (UI_UX_REVIEW): the palette used to bypass the toolbar's disabled
   *  rules — in recon mode a topology edit silently invalidates the mappings.
   *  Disabled entries stay visible (discoverable) but cannot run. */
  disabled?: boolean;
  disabledHint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenMatrix,
  onOpenAnalysis,
  onOpenTour,
  onOpenShortcuts,
  onOpenAbout = () => {},
}: {
  open: boolean;
  onClose: () => void;
  onOpenMatrix: () => void;
  onOpenAnalysis: () => void;
  onOpenTour: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout?: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Two of the labels below read live store state (`reconMode`) or the active
  // locale (`S.*`) while the whole list is memoised, so the memo has to depend on
  // exactly what those labels read. Subscribing here is what keeps an open palette
  // from going on offering "进入协调视图" after the user has entered it, or the
  // pre-switch language after a locale change — the palette must not lean on App
  // remounting its tree to stay honest.
  const reconMode = useStore((s) => s.reconMode);
  const language = useLanguage();

  const commands = useMemo<Command[]>(() => {
    const st = useStore.getState;
    const apply = (r: Parameters<ReturnType<typeof st>['apply']>[0]) => st().apply(r);
    const sel = () => st().selection[0] as string | undefined;
    const target = () => sel() ?? st().project.rootId;
    const fit = () => st().requestFit();
    // M18: topology edits must not run in the reconciliation workspace — the
    // toolbar hides them there; the palette now obeys the same rule instead of
    // silently invalidating the mappings.
    const reconDisabledHint = tr(
      '协调视图下不可修改树拓扑（会作废映射假设）；请返回标准视图编辑。',
      'Tree topology cannot be edited in the reconciliation workspace (mappings would be invalidated); switch to the standard view to edit.',
    );
    // One-shot snapshots for commands that report what they did.
    const deriveBranchLengthsFromAgesSnapshot = (): string | null => {
      let msg: string | null = null;
      apply((d) => {
        const r = deriveBranchLengthsFromAges(d);
        msg = tr(
          `已从年龄推导 ${r.derived} 条枝长（仍缺 ${r.stillMissing} 条）`,
          `Derived ${r.derived} branch length${r.derived === 1 ? '' : 's'} from ages (${r.stillMissing} still missing)`,
        );
      });
      return msg;
    };
    const fitCalibratedAgesSnapshot = (): string | null => {
      let msg: string | null = null;
      apply((d) => {
        const r = estimateAgesWithCalibrations(d);
        msg = tr(
          `已按校准点拟合年代（${r.filled.length} 个节点更新，${r.conflicts.length} 处冲突）`,
          `Fitted ages to calibration points (${r.filled.length} node${r.filled.length === 1 ? '' : 's'} updated, ${r.conflicts.length} conflict${r.conflicts.length === 1 ? '' : 's'})`,
        );
      });
      return msg;
    };
    const compareLayers = (): void => {
      const p = st().project;
      if (p.layers.length < 2) {
        notify.info(tr('至少需要两个假说层', 'At least two hypothesis layers are needed'));
        return;
      }
      // S14/m14 (Sonus+UI_UX_REVIEW): the same-named command now opens the SAME
      // A/B compare dialog as the hypothesis panel — the toast-only quick
      // variant with different behavior is retired (one command, one result).
      file.openAppDialog('layerCompare');
    };
    // Category order is the manual's order (文件 → 编辑 → 视图 → 树操作 →
    // 分析 → 协调 → 帮助) and the array below is laid out in that order too,
    // so what renders matches both. The 2026-11-15 UI review found the render
    // order broken by a block of 视图 module-jumps sitting before 编辑 and by
    // four 树操作 commands parked between 协调 and 分析.
    return [
      // --- 文件 ---
      { id: 'new', label: S.cmd.newTab, category: tr('文件','File'), icon: <PlusIcon />, kbd: `${modKey()}T`, aliases: ['new', 'tab', 'xinjian'], run: () => st().newTab() },
      { id: 'open', label: S.cmd.open, category: tr('文件','File'), icon: <FileIcon />, kbd: `${modKey()}O`, aliases: ['open', 'dakai'], run: () => void file.actionOpenProject() },
      { id: 'save', label: S.cmd.save, category: tr('文件','File'), icon: <DownloadIcon />, kbd: `${modKey()}S`, aliases: ['save', 'baocun'], run: () => void file.actionSaveProject() },
      { id: 'saveAs', label: S.review.cmdSaveAs, category: tr('文件','File'), icon: <DownloadIcon />, kbd: `${modKey()}⇧S`, aliases: ['save as', 'lingcun', 'saveas'], run: () => void file.actionSaveProjectAs() },
      { id: 'revert', label: S.review.cmdRevert, category: tr('文件','File'), icon: <ResetIcon />, aliases: ['revert', 'huitui'], run: () => void file.actionRevertProject() },
      // App-level dialogs (2026-11-15): identity/provenance, batch text edit,
      // undo history and the sample catalogue were menu-only until now.
      { id: 'projectInfo', label: S.review.projectProperties, category: tr('文件','File'), icon: <GearIcon />, aliases: ['project info', 'rename', 'provenance', 'xiangmu'], run: () => file.openAppDialog('projectInfo') },
      { id: 'sampleLibrary', label: tr('示例库…', 'Sample library…'), category: tr('文件','File'), icon: <LayersIcon />, aliases: ['sample', 'library', 'shili', 'yangben'], run: () => file.openAppDialog('sampleLibrary') },
      { id: 'pasteTree', label: S.review.pasteTree, category: tr('文件','File'), sub: tr('导入', 'Import'), icon: <UploadIcon />, aliases: ['paste', 'clipboard', 'newick', 'jiantieban'], run: () => void file.actionPasteTreeFromClipboard() },
      { id: 'importTable', label: S.review.importTable, category: tr('文件','File'), sub: tr('导入', 'Import'), icon: <TableIcon />, aliases: ['csv', 'tsv', 'table', 'biaoge', 'excel'], run: () => void file.actionImportTable('matrix') },
      { id: 'import', label: S.cmd.importTree, category: tr('文件','File'), sub: tr('导入', 'Import'), icon: <UploadIcon />, aliases: ['import', 'daoru'], run: () => void file.actionImportTree() },
      { id: 'exSvg', label: S.cmd.exportSvg, category: tr('文件','File'), sub: tr('导出', 'Export'), icon: <DownloadIcon />, aliases: ['svg', 'export'], run: () => void file.actionExportSVG() },
      { id: 'exPng', label: S.cmd.exportPng, category: tr('文件','File'), sub: tr('导出', 'Export'), icon: <DownloadIcon />, aliases: ['png', 'export'], run: () => void file.actionExportPNG() },
      { id: 'exTiff', label: S.exportItems.tiff, category: tr('文件','File'), sub: tr('导出', 'Export'), icon: <DownloadIcon />, aliases: ['tiff', 'tif', 'export'], run: () => void file.actionExportTIFF() },
      { id: 'exPdf', label: S.cmd.exportPdf, category: tr('文件','File'), sub: tr('导出', 'Export'), icon: <DownloadIcon />, aliases: ['pdf', 'export'], run: () => void file.actionExportPDF() },
      { id: 'exNwk', label: S.cmd.exportNewick, category: tr('文件','File'), sub: tr('导出', 'Export'), icon: <DownloadIcon />, aliases: ['newick', 'nwk', 'export'], run: () => void file.actionExportNewick() },
      { id: 'exNex', label: S.cmd.exportNexus, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['nexus', 'nex', 'export'], run: () => void file.actionExportNexus() },
      { id: 'exNarr', label: S.cmd.exportNarrative, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['narrative', 'report', 'export'], run: () => void file.actionExportNarrative() },
      { id: 'exHyp', label: S.cmd.exportHypothesis, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['hypothesis', 'json', 'export'], run: () => void file.actionExportHypothesisJSON() },
      { id: 'exRScript', label: S.exportItems.rScript, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['r', 'script', 'reproducible', 'reproducib', 'export'], run: () => void file.actionExportRScript() },
      // --- 编辑 ---
      { id: 'undo', label: S.cmd.undo, category: tr('编辑','Edit'), icon: <ResetIcon />, kbd: `${modKey()}Z`, aliases: ['undo', 'chexiao'], run: () => st().undo() },
      { id: 'redo', label: S.cmd.redo, category: tr('编辑','Edit'), icon: <ReloadIcon />, kbd: `${modKey()}⇧Z`, aliases: ['redo', 'chongzuo'], run: () => st().redo() },
      { id: 'findReplace', label: tr('查找与替换…', 'Find & replace…'), category: tr('编辑','Edit'), icon: <MagnifyingGlassIcon />, aliases: ['find', 'replace', 'search and replace', 'tihuan', 'chazhao'], run: () => file.openAppDialog('findReplace') },
      { id: 'history', label: tr('历史记录…', 'History…'), category: tr('编辑','Edit'), icon: <ReloadIcon />, aliases: ['history', 'undo list', 'lishi'], run: () => file.openAppDialog('history') },
      { id: 'operationLog', label: tr('操作日志…', 'Operation log…'), category: tr('编辑','Edit'), icon: <TableIcon />, aliases: ['log', 'operations', 'caozuo', 'rizhi'], run: () => file.openAppDialog('operationLog') },
      // --- 视图 ---
      { id: 'fit', label: S.cmd.fit, category: tr('视图','View'), icon: <FrameIcon />, kbd: `${modKey()}⇧F`, aliases: ['fit', 'zoom', 'shiyin'], run: fit },
      { id: 'search', label: S.cmd.search, category: tr('视图','View'), icon: <MagnifyingGlassIcon />, kbd: `${modKey()}F`, aliases: ['search', 'find', 'sousuo'], run: () => window.dispatchEvent(new CustomEvent('cladeforge:focus-search')) },
      // OP-04: fit-to-window answers "show the whole tree"; a multi-selection
      // asks "show THIS clade". One chord, one event, no extra store state.
      { id: 'zoomSelection', label: S.cmd.zoomSelection, category: tr('视图','View'), icon: <FrameIcon />, aliases: ['zoom selection', 'fit selection', 'suofang'], run: () => window.dispatchEvent(new CustomEvent('cladeforge:fit-selection')) },
      // Module jumps close the view group (navigation, not canvas state).
      // 用户反馈: the rail has ONE module (时间 + 样式 merged), so a single ⌘1.
      { id: 'navEdit', label: S.review.cmdFocusModule(S.nav.edit), category: tr('视图','View'), icon: <FrameIcon />, kbd: `${modKey()}1`, aliases: ['edit', 'panel', 'bianji'], run: () => window.dispatchEvent(new CustomEvent('cladeforge:tour-navigate', { detail: 'edit' })) },
      // --- 树操作 ---
      {
        id: 'relayout',
        label: S.cmd.relayout,
        category: tr('树操作','Tree'),
        icon: <GearIcon />,
        aliases: ['relayout', 'layout', 'chongpai'],
        run: () => file.actionRelayout(),
      },
      {
        id: 'ladderAsc',
        label: S.cmd.ladderizeAsc,
        category: tr('树操作','Tree'),
        icon: <ScissorsIcon />,
        aliases: ['ladderize', 'ladder', 'jieti'],
        disabled: reconMode,
        disabledHint: reconDisabledHint,
        // M17: same definition as the context menu / file menu (shared action).
        run: () => file.actionLadderize(true),
      },
      {
        id: 'ladderDesc',
        label: S.cmd.ladderizeDesc,
        category: tr('树操作','Tree'),
        icon: <ScissorsIcon />,
        aliases: ['ladderize', 'ladder', 'jieti'],
        disabled: reconMode,
        disabledHint: reconDisabledHint,
        run: () => file.actionLadderize(false),
      },
      {
        id: 'rerootSel',
        label: S.cmd.rerootHere,
        category: tr('树操作','Tree'),
        icon: <TargetIcon />,
        aliases: ['reroot', 're-root', 'dinggen', 'root'],
        disabled: reconMode,
        disabledHint: reconDisabledHint,
        run: () => {
          const id = sel();
          if (!id) {
            // Keyboard users got a closed palette and nothing else (M3): say
            // what is missing, exactly like the midpoint-reroot command does.
            notify.info(tr('请先选中一个节点，再执行「在此重新定根」', 'Select a node first, then run "Reroot here"'));
            return;
          }
          if (id !== st().project.rootId) {
            // M17: the SAME confirm + refit the context menu always showed.
            file.actionRerootAtNode(id);
          } else {
            notify.info(tr('选中的就是根节点：请改用「定根」类命令改变根的位置', 'The selected node IS the root: use a reroot command to move the root instead'));
          }
        },
      },
      {
        id: 'rerootMid',
        label: S.cmd.rerootMidpoint,
        category: tr('树操作','Tree'),
        icon: <Crosshair1Icon />,
        aliases: ['midpoint', 'reroot', 'root', 'zhongdian', 'dinggen'],
        disabled: reconMode,
        disabledHint: reconDisabledHint,
        run: () => {
          const project = st().project;
          if (!hasBranchLengths(project)) {
            notify.info(S.notify.needBranchLength);
            return;
          }
          // Root at the true patristic midpoint — splitting
          // the branch — and report the measured diameter and the branches that
          // are excluded because they carry no usable length. Rooting at the
          // nearest NODE via `midpointTarget` + `rerootAtNode` reports nothing.
          const box: { result: MidpointResult | null } = { result: null };
          apply((d) => {
            box.result = applyMidpointReroot(d);
          });
          if (box.result) notify.info(midpointText(box.result));
          fit();
        },
      },
      {
        id: 'addBin',
        label: S.cmd.addBinary,
        category: tr('树操作','Tree'),
        icon: <PlusIcon />,
        aliases: ['add', 'binary', 'tianjia'],
        disabled: reconMode,
        disabledHint: reconDisabledHint,
        run: () => apply((d) => addChildrenSpaced(d, target(), 2)),
      },
      {
        id: 'collapse',
        label: S.cmd.toggleCollapse,
        category: tr('树操作','Tree'),
        icon: <EyeOpenIcon />,
        aliases: ['collapse', 'fold', 'zhedie'],
        run: () => {
          const id = sel();
          if (!id) {
            notify.info(tr('请先选中一个节点，再折叠/展开该枝', 'Select a node first to collapse/expand its clade'));
            return;
          }
          apply((d) => toggleCollapse(d, id));
        },
      },
      {
        id: 'selectLeaves',
        label: tr('选中全部末端节点','Select all tip nodes'),
        category: tr('树操作','Tree'),
        icon: <FrameIcon />,
        aliases: ['leaves', 'tips', 'select', 'moduan'],
        run: () => {
          const ids = Object.values(st().project.nodes)
            .filter((n) => n.childrenIds.length === 0)
            .map((n) => n.id);
          st().selectMany(ids);
        },
      },
      // Extract subtree — opens the selected clade as its own tab.
      {
        id: 'extractSubtree',
        label: S.cmd.extractSubtree,
        category: tr('树操作','Tree'),
        icon: <ScissorsIcon />,
        aliases: ['extract', 'subtree', 'tiqu', 'zishu'],
        run: () => {
          const id = sel();
          if (!id) {
            notify.info(tr('请先选中一个节点，再提取其子树为新标签页', 'Select a node first to extract its subtree into a new tab'));
            return;
          }
          const sub = extractSubtree(st().project, id);
          if (sub) st().openInNewTab(sub);
        },
      },
      { id: 'collapseAll', label: S.review.cmdCollapseAll, category: tr('树操作','Tree'), icon: <FrameIcon />, aliases: ['collapse all', 'zhedie'], run: () => apply((d) => void collapseAll(d)) },
      { id: 'expandAll', label: S.review.cmdExpandAll, category: tr('树操作','Tree'), icon: <FrameIcon />, aliases: ['expand all', 'zhangkai'], run: () => apply((d) => void expandAll(d)) },
      { id: 'deriveLens', label: S.review.cmdDeriveBranchLengths, category: tr('树操作','Tree'), icon: <MagicWandIcon />, aliases: ['branch length', 'ages', 'zhichang'], run: () => { const r = deriveBranchLengthsFromAgesSnapshot(); if (r) notify.info(r); } },
      { id: 'fitCalib', label: S.review.cmdEstimateCalibratedAges, category: tr('树操作','Tree'), icon: <MagicWandIcon />, aliases: ['calibration', 'isotonic', 'jiaozhun'], run: () => { const r = fitCalibratedAgesSnapshot(); if (r) notify.info(r); } },
      // --- 分析 ---
      { id: 'compareTrees', label: S.review.cmdCompareTrees, category: tr('分析','Analysis'), icon: <TableIcon />, aliases: ['robinson foulds', 'distance', 'duibi'], run: () => file.openTreeDistance() },
      { id: 'layerDiff', label: S.review.cmdLayerDiff, category: tr('分析','Analysis'), icon: <LayersIcon />, aliases: ['diff', 'layers compare', 'duibi'], run: compareLayers },
      { id: 'asr', label: S.cmd.runAsr, category: tr('分析','Analysis'), icon: <MagicWandIcon />, aliases: ['asr', 'ancestral', '重建', 'zhuzu'], run: () => st().runAsr() },
      { id: 'matrix', label: S.cmd.matrix, category: tr('分析','Analysis'), icon: <TableIcon />, aliases: ['matrix', 'juzhen'], run: onOpenMatrix },
      { id: 'analysis', label: S.cmd.analysis, category: tr('分析','Analysis'), icon: <GearIcon />, aliases: ['analysis', 'inference', 'fenxi', 'tuili'], run: onOpenAnalysis },
      // --- 协调 ---
      { id: 'reconImport', label: S.recon.importFile, category: tr('协调', 'Reconcile'), icon: <ShuffleIcon />, aliases: ['gene tree', 'import gene', 'jiyin', 'xietong'], run: () => void file.actionImportGeneTree() },
      {
        // m18 (UI_UX_REVIEW): every other export lives in the palette / export
        // surface — the embedded figure gets a command entry here too, while
        // the contextual toolbar button stays for in-view discoverability.
        id: 'reconExportFigure',
        label: tr('导出嵌套协调图…', 'Export embedded reconciliation figure…'),
        category: tr('协调', 'Reconcile'),
        icon: <DownloadIcon />,
        aliases: ['export embedded', 'nested figure', 'daochu xietong'],
        run: () => void file.actionExportEmbeddedSvg(),
      },
      {
        id: 'reconView',
        // Derived from the `reconMode` this render was built for (see above), not
        // from a `st()` read at memo-construction time.
        label: reconMode ? S.recon.exitView : S.recon.enterView,
        category: tr('协调', 'Reconcile'),
        icon: <ShuffleIcon />,
        aliases: ['reconciliation view', 'xietong shitu'],
        run: () => {
          const cur = useStore.getState();
          if (cur.reconMode) cur.exitReconWorkspace();
          else cur.enterReconWorkspace();
        },
      },
      {
        // Reachable from ANY document state (§7.4): the sample cards only exist
        // on an empty canvas, so this command is the non-empty-document entry.
        id: 'reconSample',
        label: S.recon.loadReconSample,
        category: tr('协调', 'Reconcile'),
        icon: <ShuffleIcon />,
        aliases: ['sample', 'demo', 'reconciliation sample', 'xietong shili', 'yangli'],
        run: () => {
          const d = SAMPLE_PROJECTS.find((x) => x.id === 'recon-family');
          if (d) openSample(d);
        },
      },
      { id: 'reconReport', label: S.exportItems.reconReport, category: tr('协调', 'Reconcile'), icon: <DownloadIcon />, aliases: ['report', 'recon export'], run: () => {
        // M10 (review finding 10): same disable-with-reason rule as the export
        // panel — no gene trees, nothing to report; say so instead of writing
        // an empty archive.
        if ((useStore.getState().project.geneTrees?.length ?? 0) === 0) {
          notify.info(
            tr('当前文档没有基因树，无协调场景可导出', 'This document has no gene trees; there is no reconciliation scenario to export'),
          );
          return;
        }
        void file.actionExportReconciliationReport();
      } },
      // --- 帮助 ---
      { id: 'shortcuts', label: S.menu.shortcuts, category: tr('帮助','Help'), icon: <QuestionMarkIcon />, kbd: `${modKey()}?`, aliases: ['shortcuts', 'help', 'bangzhu'], run: onOpenShortcuts },
      { id: 'guide', label: S.cmd.guide, category: tr('帮助','Help'), icon: <MagicWandIcon />, aliases: ['guide', 'tour', 'help', 'xinren', 'workflow', 'gongzuo'], run: onOpenTour },
      { id: 'manual', label: S.menu.manual, category: tr('帮助','Help'), icon: <QuestionMarkIcon />, aliases: ['manual', 'documentation', 'shouce'], run: () => file.openAppDialog('manual') },
      { id: 'about', label: S.menu.about, category: tr('帮助','Help'), icon: <QuestionMarkIcon />, aliases: ['about', 'version', 'guanyu', 'banben'], run: onOpenAbout },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- language is read through the module-level tr(); listing it rebuilds the catalogue when the UI language switches.
  }, [onOpenMatrix, onOpenAnalysis, onOpenTour, onOpenShortcuts, onOpenAbout, reconMode, language]);

  // Search matches the label AND its aliases, so an English or pinyin term finds a
  // Chinese command. A9: whitespace-separated tokens AND together — "svg 导出"
  // or "export newick" match, which substring matching silently rejected.
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    const tokens = t.split(/\s+/);
    return commands.filter((c) => {
      const haystack = [c.label, ...(c.aliases ?? [])].map((s) => s.toLowerCase());
      return tokens.every((tok) => haystack.some((s) => s.includes(tok)));
    });
  }, [q, commands]);

  // Group filtered commands by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      const h = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(h);
    }
    return undefined;
  }, [open]);
  useEffect(() => setIdx(0), [q]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx, q]);

  // The palette lists ~51 commands in a 50vh box. macOS draws overlay scroll
  // bars that only appear while scrolling, so the list looked complete while its
  // last row was sliced in half. This tracks the list's own position and feeds a
  // hairline rail that is always there.
  const [scroll, setScroll] = useState({ top: 0, ratio: 1, overflow: false });
  const syncScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScroll({
      top: max > 0 ? el.scrollTop / max : 0,
      ratio: el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1,
      overflow: max > 1,
    });
  };
  useEffect(() => {
    if (open) syncScroll();
  }, [open, q, filtered.length, language]);

  if (!open) return null;

  const safeIdx = Math.min(idx, Math.max(0, filtered.length - 1));
  const activeId = filtered.length ? `cmd-${filtered[safeIdx].id}` : undefined;

  const run = (c?: Command) => {
    if (!c) return;
    // M18: a disabled command explains itself instead of silently running (or
    // silently doing nothing).
    if (c.disabled) {
      notify.info(c.disabledHint ?? tr('该命令当前不可用', 'This command is unavailable right now'));
      return;
    }
    c.run();
    onClose();
  };

  // Flatten grouped list for keyboard navigation index mapping
  let flatIdx = 0;
  const renderGroup = (category: string, items: Command[]) => {
    const nodes: ReactNode[] = [];
    // M6: the `sub` heading resets at every category boundary — a category
    // without subgroups must not inherit the previous category's heading.
    let lastSub: string | undefined = undefined;
    for (const c of items) {
      const currentIdx = flatIdx++;
      if (c.sub !== undefined && c.sub !== lastSub) {
        nodes.push(
          <div className="cmd-sub-label" key={`sub-${category}-${c.sub}`}>
            {c.sub}
          </div>,
        );
        lastSub = c.sub;
      }
      nodes.push(
        <button
          key={c.id}
          id={`cmd-${c.id}`}
          className={`command-item${currentIdx === safeIdx ? ' active' : ''}`}
          data-active={currentIdx === safeIdx}
          role="option"
          aria-selected={currentIdx === safeIdx}
          aria-disabled={c.disabled || undefined}
          title={c.disabled ? c.disabledHint : undefined}
          tabIndex={-1}
          onMouseEnter={() => setIdx(currentIdx)}
          onClick={() => run(c)}
        >
          {c.icon && <span className="cmd-icon">{c.icon}</span>}
          <span>{c.label}</span>
          {c.kbd && <span className="cmd-kbd">{c.kbd}</span>}
        </button>,
      );
    }
    return (
      <div key={category} className="cmd-group">
        <div className="cmd-group-label">{category}</div>
        {nodes}
      </div>
    );
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={S.shortcuts.palette}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="command-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={S.shortcuts.palette}
          placeholder={S.cmd.placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // The palette advertises Pinyin aliases, so a composition session is
            // routinely open here: Enter would run the highlighted command and
            // arrows would scroll the list while the user is still picking
            // characters. Every one of those keys belongs to the IME
            // until composition ends.
            if (isImeComposing(e)) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(filtered[safeIdx]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'Tab') {
              e.preventDefault();
            }
          }}
        />
        <div className="command-list-wrap">
          <div
            className="command-list"
            role="listbox"
            id="command-list"
            aria-label={S.shortcuts.palette}
            ref={listRef}
            onScroll={syncScroll}
          >
            {filtered.length === 0 && <div className="command-empty">{S.cmd.none}</div>}
            {grouped.map(([cat, items]) => renderGroup(cat, items))}
          </div>
          {scroll.overflow && (
            <div className="command-scrollrail" aria-hidden="true">
              <div
                className="command-scrollthumb"
                style={{
                  height: `${Math.max(6, scroll.ratio * 100)}%`,
                  top: `${scroll.top * (100 - Math.max(6, scroll.ratio * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
