// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation workspace's own bottom status bar: mapping completeness,
// unresolved count, error/note counts, the σ/δ/τ/λ tally and the per-pane zoom
// readouts. The standard bar's nodes/edges/zoom/selection figures describe the
// standard canvas, not this task (§5.5) — so this workspace carries its own.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import type { ReconLayoutMode } from '../model/types';
import { geneTreeRows } from './reconStats';
import { S } from './strings';

export function ReconStatusBar({
  speciesZoom,
  geneZoom,
  mode = 'side-by-side',
  embeddedZoom,
}: {
  speciesZoom: number;
  geneZoom: number;
  /** Which canvas layout the readouts describe (single zoom when embedded). */
  mode?: ReconLayoutMode;
  embeddedZoom?: number;
}) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const options = useStore((s) => s.reconViewOptions);

  const row = useMemo(() => {
    const rows = geneTreeRows(project);
    return rows.find((r) => r.id === activeGeneTreeId) ?? null;
  }, [project, activeGeneTreeId]);

  if (!row) return null;
  const unresolved = row.summary.totalInternal - row.summary.mappedInternal;
  const embedded = mode === 'embedded';

  return (
    <div className="status recon-status" role="status">
      {/* 用户反馈: the single left panel stacks every section, so these
          readouts no longer JUMP anywhere — plain figures like the tally. */}
      <span className="status-plain" title={S.recon.nodeMapping}>
        {S.recon.sbTipsMapped(row.mappedTips, row.tips)}
      </span>
      <span className="status-plain">
        {S.recon.sbInternal(row.summary.mappedInternal, row.summary.totalInternal)}
      </span>
      {unresolved > 0 && (
        <span className="status-plain status-warn">
          {S.recon.sbUnresolved(unresolved)}
        </span>
      )}
      {/* 用户反馈: the error/note tally no longer jumps to a removed 校验
          section — it is a readout only. */}
      <span className={`status-plain${row.errors > 0 ? ' status-bad' : ''}`}>
        {S.recon.sbIssues(row.errors, row.warnings)}
      </span>
      <span className="recon-chip chip-sigma">S {row.summary.speciation}</span>
      <span className="recon-chip chip-dup">D {row.summary.duplication}</span>
      <span className="recon-chip chip-transfer">T {row.summary.transfer}</span>
      <span className="recon-chip chip-loss">L {row.summary.losses}</span>
      <span className="spacer" />
      <span>
        {embedded
          ? S.recon.sbZoomEmbedded(Math.round((embeddedZoom ?? 1) * 100))
          : S.recon.sbZoom(Math.round(speciesZoom * 100), Math.round(geneZoom * 100))}
        {!embedded && options.syncZoom ? ' ⇔' : ''}
      </span>
    </div>
  );
}
