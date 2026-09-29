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
  TargetIcon,
  Crosshair1Icon,
  EyeOpenIcon,
  QuestionMarkIcon,
} from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import * as file from '../io/fileActions';
import {
  addChildrenSpaced,
  ladderize,
  applyMidpointReroot,
  rerootAtNode,
  toggleCollapse,
  unpinAll,
  extractSubtree,
  hasBranchLengths,
  type MidpointResult,
} from '../model/treeOps';
import { notify } from './toast';
import { isImeComposing } from './imeGuard';
import { useLanguage } from './i18n';
import { midpointText } from './treeEditNotices';
import { S, tr } from './strings';

interface Command {
  id: string;
  label: string;
  category: string;
  icon?: ReactNode;
  kbd?: string;
  aliases?: string[];
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
  // from going on offering "进入协同视图" after the user has entered it, or the
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
    return [
      // --- 文件 ---
      { id: 'new', label: S.cmd.newTab, category: tr('文件','File'), icon: <PlusIcon />, kbd: '⌘T', aliases: ['new', 'tab', 'xinjian'], run: () => st().newTab() },
      { id: 'open', label: S.cmd.open, category: tr('文件','File'), icon: <FileIcon />, kbd: '⌘O', aliases: ['open', 'dakai'], run: () => void file.actionOpenProject() },
      { id: 'save', label: S.cmd.save, category: tr('文件','File'), icon: <DownloadIcon />, kbd: '⌘S', aliases: ['save', 'baocun'], run: () => void file.actionSaveProject() },
      { id: 'import', label: S.cmd.importTree, category: tr('文件','File'), icon: <UploadIcon />, aliases: ['import', 'daoru'], run: () => void file.actionImportTree() },
      { id: 'exSvg', label: S.cmd.exportSvg, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['svg', 'export'], run: () => void file.actionExportSVG() },
      { id: 'exPng', label: S.cmd.exportPng, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['png', 'export'], run: () => void file.actionExportPNG() },
      { id: 'exPdf', label: S.cmd.exportPdf, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['pdf', 'export'], run: () => void file.actionExportPDF() },
      { id: 'exNwk', label: S.cmd.exportNewick, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['newick', 'nwk', 'export'], run: () => void file.actionExportNewick() },
      { id: 'exNex', label: S.cmd.exportNexus, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['nexus', 'nex', 'export'], run: () => void file.actionExportNexus() },
      { id: 'exNarr', label: S.cmd.exportNarrative, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['narrative', 'report', 'export'], run: () => void file.actionExportNarrative() },
      { id: 'exHyp', label: S.cmd.exportHypothesis, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['hypothesis', 'json', 'export'], run: () => void file.actionExportHypothesisJSON() },
      { id: 'exRScript', label: S.exportItems.rScript, category: tr('文件','File'), icon: <DownloadIcon />, aliases: ['r', 'script', 'reproducib', 'export'], run: () => void file.actionExportRScript() },
      // --- 编辑 ---
      { id: 'undo', label: S.cmd.undo, category: tr('编辑','Edit'), icon: <ResetIcon />, kbd: '⌘Z', aliases: ['undo', 'chexiao'], run: () => st().undo() },
      { id: 'redo', label: S.cmd.redo, category: tr('编辑','Edit'), icon: <ReloadIcon />, kbd: '⌘⇧Z', aliases: ['redo', 'chongzuo'], run: () => st().redo() },
      // --- 视图 ---
      { id: 'fit', label: S.cmd.fit, category: tr('视图','View'), icon: <FrameIcon />, kbd: '⌘⇧F', aliases: ['fit', 'zoom', 'shiyin'], run: fit },
      { id: 'search', label: S.cmd.search, category: tr('视图','View'), icon: <MagnifyingGlassIcon />, kbd: '⌘F', aliases: ['search', 'find', 'sousuo'], run: () => window.dispatchEvent(new CustomEvent('cladeforge:focus-search')) },
      // --- 树操作 ---
      {
        id: 'relayout',
        label: S.cmd.relayout,
        category: tr('树操作','Tree'),
        icon: <GearIcon />,
        aliases: ['relayout', 'layout', 'chongpai'],
        run: () => { apply((d) => unpinAll(d)); fit(); },
      },
      {
        id: 'ladderAsc',
        label: S.cmd.ladderizeAsc,
        category: tr('树操作','Tree'),
        icon: <ScissorsIcon />,
        aliases: ['ladderize', 'ladder', 'jieti'],
        run: () => { apply((d) => ladderize(d, true)); fit(); },
      },
      {
        id: 'ladderDesc',
        label: S.cmd.ladderizeDesc,
        category: tr('树操作','Tree'),
        icon: <ScissorsIcon />,
        aliases: ['ladderize', 'ladder', 'jieti'],
        run: () => { apply((d) => ladderize(d, false)); fit(); },
      },
      {
        id: 'rerootSel',
        label: S.cmd.rerootHere,
        category: tr('树操作','Tree'),
        icon: <TargetIcon />,
        aliases: ['reroot', 're-root', 'dinggen', 'root'],
        run: () => {
          const id = sel();
          if (id && id !== st().project.rootId) { apply((d) => rerootAtNode(d, id)); fit(); }
        },
      },
      {
        id: 'rerootMid',
        label: S.cmd.rerootMidpoint,
        category: tr('树操作','Tree'),
        icon: <Crosshair1Icon />,
        aliases: ['midpoint', 'reroot', 'root', 'zhongdian', 'dinggen'],
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
      { id: 'addBin', label: S.cmd.addBinary, category: tr('树操作','Tree'), icon: <PlusIcon />, aliases: ['add', 'binary', 'tianjia'], run: () => apply((d) => addChildrenSpaced(d, target(), 2)) },
      {
        id: 'collapse',
        label: S.cmd.toggleCollapse,
        category: tr('树操作','Tree'),
        icon: <EyeOpenIcon />,
        aliases: ['collapse', 'fold', 'zhedie'],
        run: () => { const id = sel(); if (id) apply((d) => toggleCollapse(d, id)); },
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
          if (!id) return;
          const sub = extractSubtree(st().project, id);
          if (sub) st().openInNewTab(sub);
        },
      },
      // --- 协同 ---
      { id: 'reconImport', label: S.recon.importFile, category: tr('协同', 'Reconcile'), icon: <ShuffleIcon />, aliases: ['gene tree', 'import gene', 'jiyin', 'xietong'], run: () => void file.actionImportGeneTree() },
      {
        id: 'reconView',
        // Derived from the `reconMode` this render was built for (see above), not
        // from a `st()` read at memo-construction time.
        label: reconMode ? S.recon.exitView : S.recon.enterView,
        category: tr('协同', 'Reconcile'),
        icon: <ShuffleIcon />,
        aliases: ['reconciliation view', 'xietong shitu'],
        run: () => {
          const cur = useStore.getState();
          if (cur.reconMode) cur.setReconMode(false);
          else if (cur.activeGeneTreeId || cur.project.geneTrees?.length) {
            if (!cur.activeGeneTreeId) cur.setActiveGeneTree(cur.project.geneTrees![0].id);
            cur.setReconMode(true);
          } else notify.info(S.recon.empty);
        },
      },
      { id: 'reconReport', label: S.exportItems.reconReport, category: tr('协同', 'Reconcile'), icon: <DownloadIcon />, aliases: ['report', 'recon export'], run: () => void file.actionExportReconciliationReport() },
      // --- 分析 ---
      { id: 'asr', label: S.cmd.runAsr, category: tr('分析','Analysis'), icon: <MagicWandIcon />, aliases: ['asr', 'ancestral', '重建', 'zhuzu'], run: () => st().runAsr() },
      { id: 'matrix', label: S.cmd.matrix, category: tr('分析','Analysis'), icon: <TableIcon />, aliases: ['matrix', 'juzhen'], run: onOpenMatrix },
      { id: 'analysis', label: S.cmd.analysis, category: tr('分析','Analysis'), icon: <GearIcon />, aliases: ['analysis', 'inference', 'fenxi', 'tuili'], run: onOpenAnalysis },
      // --- 帮助 ---
      { id: 'shortcuts', label: S.menu.shortcuts, category: tr('帮助','Help'), icon: <QuestionMarkIcon />, kbd: '⌘?', aliases: ['shortcuts', 'help', 'bangzhu'], run: onOpenShortcuts },
      { id: 'guide', label: S.cmd.guide, category: tr('帮助','Help'), icon: <MagicWandIcon />, aliases: ['guide', 'tour', 'help', 'xinren'], run: onOpenTour },
      { id: 'about', label: S.menu.about, category: tr('帮助','Help'), icon: <QuestionMarkIcon />, aliases: ['about', 'version', 'guanyu', 'banben'], run: onOpenAbout },
    ];
  }, [onOpenMatrix, onOpenAnalysis, onOpenTour, onOpenShortcuts, onOpenAbout, reconMode, language]);

  // Search matches the label AND its aliases, so an English or pinyin term finds a
  // Chinese command.
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter((c) => {
      if (c.label.toLowerCase().includes(t)) return true;
      if (c.aliases?.some((a) => a.toLowerCase().includes(t))) return true;
      return false;
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

  if (!open) return null;

  const safeIdx = Math.min(idx, Math.max(0, filtered.length - 1));
  const activeId = filtered.length ? `cmd-${filtered[safeIdx].id}` : undefined;

  const run = (c?: Command) => {
    if (!c) return;
    c.run();
    onClose();
  };

  // Flatten grouped list for keyboard navigation index mapping
  let flatIdx = 0;
  const renderGroup = (category: string, items: Command[]) => (
    <div key={category} className="cmd-group">
      <div className="cmd-group-label">{category}</div>
      {items.map((c) => {
        const currentIdx = flatIdx++;
        return (
          <button
            key={c.id}
            id={`cmd-${c.id}`}
            className={`command-item${currentIdx === safeIdx ? ' active' : ''}`}
            data-active={currentIdx === safeIdx}
            role="option"
            aria-selected={currentIdx === safeIdx}
            tabIndex={-1}
            onMouseEnter={() => setIdx(currentIdx)}
            onClick={() => run(c)}
          >
            {c.icon && <span className="cmd-icon">{c.icon}</span>}
            <span>{c.label}</span>
            {c.kbd && <span className="cmd-kbd">{c.kbd}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={S.cmd.placeholder}
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
        <div className="command-list" role="listbox" id="command-list" aria-label={S.cmd.placeholder} ref={listRef}>
          {filtered.length === 0 && <div className="command-empty">{S.cmd.none}</div>}
          {grouped.map(([cat, items]) => renderGroup(cat, items))}
        </div>
      </div>
    </div>
  );
}
