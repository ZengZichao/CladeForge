// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The reconciliation workspace's own top toolbar row: active gene tree, Fit
// both, sync-zoom toggle, mapping-scope quick switch, exit. Layout row — never
// an absolutely-positioned floating bar over the panes (§5.5). No topology
// editing actions exist here by design: the gene tree is read-only and the
// species tree belongs to the standard workspace.

import { FrameIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import type { MappingScope } from '../model/types';
import { S } from './strings';

export function ReconToolbar({ onToggleRightPanel }: { onToggleRightPanel?: () => void }) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const clearGeneSelection = useStore((s) => s.clearGeneSelection);
  const options = useStore((s) => s.reconViewOptions);
  const setReconViewOptions = useStore((s) => s.setReconViewOptions);

  const scopes: { id: MappingScope; label: string }[] = [
    { id: 'tips', label: S.recon.scopeTips },
    { id: 'internal', label: S.recon.scopeInternal },
    { id: 'all', label: S.recon.scopeAll },
  ];

  return (
    <div className="recon-toolbar" role="toolbar" aria-label={S.recon.section}>
      <select
        className="recon-gene-select"
        value={activeGeneTreeId ?? ''}
        onChange={(e) => {
          setActiveGeneTree(e.target.value || null);
          clearGeneSelection();
        }}
        title={S.recon.activeGene}
        aria-label={S.recon.activeGene}
      >
        {(project.geneTrees ?? []).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <button
        className="btn"
        title={S.recon.fitBoth}
        onClick={() => window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'))}
      >
        <FrameIcon /> {S.recon.fitBoth}
      </button>

      <label className="recon-toolbar-toggle" title={S.recon.syncZoom}>
        <input
          type="checkbox"
          checked={options.syncZoom}
          onChange={(e) => setReconViewOptions({ syncZoom: e.target.checked })}
        />
        {S.recon.syncZoom}
      </label>

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
