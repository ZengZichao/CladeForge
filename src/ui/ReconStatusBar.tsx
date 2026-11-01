// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation workspace's own bottom status bar: mapping completeness,
// unresolved count, error/note counts, the σ/δ/τ/λ tally and the per-pane zoom
// readouts. The standard bar's nodes/edges/zoom/selection figures describe the
// standard canvas, not this task (§5.5) — so this workspace carries its own.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { geneTreeRows } from './reconStats';
import { S } from './strings';

export function ReconStatusBar({
  speciesZoom,
  geneZoom,
}: {
  speciesZoom: number;
  geneZoom: number;
}) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const setReconSection = useStore((s) => s.setReconSection);
  const options = useStore((s) => s.reconViewOptions);

  const row = useMemo(() => {
    const rows = geneTreeRows(project);
    return rows.find((r) => r.id === activeGeneTreeId) ?? null;
  }, [project, activeGeneTreeId]);

  if (!row) return null;
  const unresolved = row.summary.totalInternal - row.summary.mappedInternal;

  return (
    <div className="status recon-status" role="status">
      <button
        className="status-link"
        title={S.recon.assumptionList}
        onClick={() => setReconSection('scenario')}
      >
        {S.recon.sbTipsMapped(row.mappedTips, row.tips)}
      </button>
      <button
        className="status-link"
        onClick={() => setReconSection('scenario')}
      >
        {S.recon.sbInternal(row.summary.mappedInternal, row.summary.totalInternal)}
      </button>
      {unresolved > 0 && (
        <button
          className="status-link status-warn"
          onClick={() => setReconSection('scenario')}
        >
          {S.recon.sbUnresolved(unresolved)}
        </button>
      )}
      <button
        className={`status-link${row.errors > 0 ? ' status-bad' : ''}`}
        onClick={() => setReconSection('validation')}
      >
        {S.recon.sbIssues(row.errors, row.warnings)}
      </button>
      <span className="recon-chip chip-sigma">σ {row.summary.speciation}</span>
      <span className="recon-chip chip-dup">δ {row.summary.duplication}</span>
      <span className="recon-chip chip-transfer">τ {row.summary.transfer}</span>
      <span className="recon-chip chip-loss">λ {row.summary.losses}</span>
      <span className="spacer" />
      <span>
        {S.recon.sbZoom(Math.round(speciesZoom * 100), Math.round(geneZoom * 100))}
        {options.syncZoom ? ' · ⇔' : ''}
      </span>
    </div>
  );
}
