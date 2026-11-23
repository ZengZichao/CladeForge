// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation workspace's own top toolbar row: active gene tree, the
// FOUR edit-target surfaces (物种树编辑 / 基因树编辑 / 协调映射编辑 / 协调嵌套预览),
// Fit, sync-zoom toggle, mapping-scope quick switch. Layout row — never an
// absolutely-positioned floating bar over the panes (§5.5). No topology
// editing actions exist here by design: the gene tree is read-only and the
// species tree belongs to the standard workspace.
//
// 用户反馈 (2026-11-23): the old 「点选目标」(species|gene click toggle) and the
// 「并排对照|嵌套视图」 layout toggle are gone. Plain clicks land on whichever
// pane they fall in; the nested preview is a first-class edit target beside
// the mapping editor, so the canvas layout follows the edit target (set in
// the store's setReconEditTarget).

import { FrameIcon, DownloadIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import type { MappingScope } from '../model/types';
import { actionExportEmbeddedSvg } from '../io/fileActions';
import { S, tr } from './strings';

export function ReconToolbar({ onToggleRightPanel }: { onToggleRightPanel?: () => void }) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const clearGeneSelection = useStore((s) => s.clearGeneSelection);
  const options = useStore((s) => s.reconViewOptions);
  const setReconViewOptions = useStore((s) => s.setReconViewOptions);
  const reconEditTarget = useStore((s) => s.reconEditTarget);
  const setReconEditTarget = useStore((s) => s.setReconEditTarget);

  const scopes: { id: MappingScope; label: string }[] = [
    { id: 'tips', label: S.recon.scopeTips },
    { id: 'internal', label: S.recon.scopeInternal },
    { id: 'all', label: S.recon.scopeAll },
  ];
  // 协调映射编辑 keeps the side-by-side panes; 协调嵌套预览 keeps the
  // embedded figure. The layout mode itself follows the edit target.
  const coordination = reconEditTarget === 'recon' || reconEditTarget === 'embedded';
  const embedded = options.layoutMode === 'embedded';
  // While 「基因树编辑」 is swapped the gene trees live on the backup — the
  // toolbar must stay visible in the edit modes or the user could not switch
  // back to the coordination canvas.
  const geneEditBackup = useStore((s) => s.geneEditBackup);
  const hasGeneTrees = geneEditBackup
    ? (geneEditBackup.project.geneTrees?.length ?? 0) > 0
    : (project.geneTrees ?? []).length > 0;

  // With no gene tree there is nothing for this row to control: the layout
  // switch, fit, sync zoom and mapping scope all act on a gene pane that does
  // not exist. The canvas empty state owns the next step instead.
  if (!hasGeneTrees) return null;

  return (
    <div className="recon-toolbar" role="toolbar" aria-label={S.recon.section}>
      {/* 用户反馈: a rounded button look for the family picker, sitting left of
          the layout switch. During the 「基因树编辑」 swap the trees live on the
          backup — show the edited tree's name and freeze the picker (switching
          families mid-edit would orphan the swapped document). */}
      <select
        className="recon-gene-select btn"
        value={geneEditBackup ? geneEditBackup.geneId : (activeGeneTreeId ?? '')}
        disabled={!!geneEditBackup}
        onChange={(e) => {
          setActiveGeneTree(e.target.value || null);
          clearGeneSelection();
        }}
        title={S.recon.activeGene}
        aria-label={S.recon.activeGene}
      >
        {(geneEditBackup ? (geneEditBackup.project.geneTrees ?? []) : (project.geneTrees ?? [])).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      {/* 用户反馈 (2026-11-23): FOUR peer edit surfaces — 物种树编辑 and 基因树编辑
          hand one tree to the STANDARD editor; 协调映射编辑 is the side-by-side
          coordination canvas where the node mappings live; 协调嵌套预览 is the
          nested figure of the same reconciliation. */}
      <div className="seg recon-edit-seg" role="tablist" aria-label={tr('编辑目标', 'Edit target')}>
        {([
          ['species', S.recon.editTargetSpecies],
          ['gene', S.recon.editTargetGene],
          ['recon', S.recon.editTargetRecon],
          ['embedded', S.recon.editTargetEmbedded],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            className={`seg-btn${reconEditTarget === id ? ' active' : ''}`}
            onClick={() => setReconEditTarget(id)}
            aria-selected={reconEditTarget === id}
            role="tab"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Canvas controls — only the two coordination canvases consume these;
          the tree-edit surfaces render the standard workspace instead. */}
      {coordination && (
      <>
      <button
        className="btn"
        title={embedded ? S.recon.fitEmbedded : S.recon.fitBoth}
        onClick={() => window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'))}
      >
        <FrameIcon /> {embedded ? S.recon.fitEmbedded : S.recon.fitBoth}
      </button>

      {/* syncZoom only means something with two panes. */}
      {!embedded && (
        /* A state that applies on click is a switch, not a form checkbox. */
        <span className="recon-toolbar-toggle" title={S.recon.syncZoom}>
          <button
            type="button"
            role="switch"
            aria-checked={options.syncZoom}
            aria-label={S.recon.syncZoom}
            className="switch switch-sm"
            onClick={() => setReconViewOptions({ syncZoom: !options.syncZoom })}
          >
            <span className="switch-thumb" aria-hidden="true" />
          </button>
          {S.recon.syncZoom}
        </span>
      )}

      <div className="seg recon-scope-seg" role="tablist" aria-label={S.recon.scopeLabel}>
        {scopes.map((sc) => (
          <button
            key={sc.id}
            className={`seg-btn${options.mappingScope === sc.id ? ' active' : ''}`}
            onClick={() => setReconViewOptions({ mappingScope: sc.id })}
            aria-selected={options.mappingScope === sc.id}
            role="tab"
          >
            {sc.label}
          </button>
        ))}
      </div>

      {/* Embedded figure export (plan §8.4): the nested hypothesis drawing as a
          standalone vector file. Only meaningful in the embedded mode. */}
      {embedded && (
        <button
          className="btn"
          title={tr('将嵌套协调图导出为 SVG（矢量图，可用于假说文档）', 'Export the embedded reconciliation figure as SVG (vector, for hypothesis documents)')}
          onClick={() => void actionExportEmbeddedSvg()}
        >
          <DownloadIcon /> {tr('导出嵌套图', 'Export figure')}
        </button>
      )}
      </>
      )}

      <div className="spacer" />
      {/* The right panel is a DRAWER below 1200px — open it from here. (No exit
          button: leaving the workspace lives in the header mode switch and the
          rail's bottom action — a third one would be visual noise, R-19.) */}
      {onToggleRightPanel && (
        <button className="btn" onClick={onToggleRightPanel} title={S.recon.overviewTitle}>
          {S.recon.overviewTitle}
        </button>
      )}
    </div>
  );
}
